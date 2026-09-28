// Edge Function chamada pelos triggers de mensagens e candidaturas (migrations
// 0017/0018). Busca os tokens do destinatário e manda pro serviço de push do Expo.
//
// Deploy (ver "Notificações push" no README):
//   supabase functions deploy enviar-push --no-verify-jwt
//   supabase secrets set PUSH_WEBHOOK_SECRET=...   (o mesmo valor do Vault)
//   supabase secrets set EXPO_ACCESS_TOKEN=...     (ver comentário abaixo)
//
// Quem pode chamar: SÓ o banco. Antes a função confiava no verify_jwt do
// gateway, que aceita qualquer JWT válido — inclusive a chave anon, que vai
// dentro do app. Qualquer pessoa conseguia mandar notificação com título e
// texto arbitrários pra qualquer usuário (phishing com a cara do app). Agora
// o chamador precisa apresentar o segredo dedicado no header x-push-secret, e
// o verify_jwt fica desligado (supabase/config.toml) porque o banco não tem
// JWT nenhum pra mandar.
//
// O EXPO_ACCESS_TOKEN fica como secret e nunca entra no bundle do app: a
// documentação do Expo avisa que, sem ele, qualquer um que descubra um token de
// push consegue se passar pelo seu servidor e disparar notificações em nome do
// projeto. Gere em expo.dev > Account Settings > Access Tokens e ative
// "Enhanced Security for Push Notifications" no projeto.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { segredoConfere, validarPedido } from './validacao.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// O endpoint do Expo aceita no máximo 100 mensagens por requisição.
const TAMANHO_LOTE = 100;

// O corpo legítimo tem poucas centenas de bytes; nada justifica ler mais.
const TAMANHO_MAX_REQUISICAO = 16 * 1024;

function emLotes<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

function responder(status: number, corpo: Record<string, unknown>) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return responder(405, { erro: 'Método não permitido' });
  }

  // Sem o segredo configurado a função fica fechada (nunca aberta).
  const segredo = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!segredo) {
    console.error('PUSH_WEBHOOK_SECRET não configurado: recusando todas as chamadas.');
    return responder(503, { erro: 'Função não configurada' });
  }

  // Autentica antes de ler o corpo: pedido de fora não chega nem no parser.
  if (!(await segredoConfere(req.headers.get('x-push-secret'), segredo))) {
    return responder(401, { erro: 'Não autorizado' });
  }

  if (Number(req.headers.get('content-length') ?? 0) > TAMANHO_MAX_REQUISICAO) {
    return responder(413, { erro: 'Pedido grande demais' });
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return responder(400, { erro: 'JSON inválido' });
  }

  const pedido = validarPedido(corpo);
  if (!pedido) {
    return responder(400, { erro: 'Pedido inválido' });
  }

  // service_role porque a função precisa ler os tokens de OUTRA pessoa (quem
  // vai receber a notificação), o que a RLS de push_tokens corretamente proíbe
  // pro cliente. A chave é injetada pelo próprio Supabase no runtime da
  // função e nunca sai daqui.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: tokens, error } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('usuario_id', pedido.usuario_id);

  if (error) {
    console.error('Falha ao buscar tokens:', error.code);
    return responder(500, { erro: 'Falha ao buscar tokens' });
  }
  if (!tokens?.length) {
    return responder(200, { enviados: 0 });
  }

  const mensagens = tokens.map(({ token }) => ({
    to: token,
    title: pedido.titulo,
    body: pedido.corpo,
    data: pedido.dados,
    sound: 'default',
    channelId: 'default',
  }));

  const cabecalhos: Record<string, string> = { 'Content-Type': 'application/json' };
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (accessToken) cabecalhos.Authorization = `Bearer ${accessToken}`;

  const tokensInvalidos: string[] = [];

  for (const lote of emLotes(mensagens, TAMANHO_LOTE)) {
    const resposta = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: cabecalhos,
      body: JSON.stringify(lote),
    });

    // Só o status vai pro log: o corpo de erro do Expo pode citar os tokens
    // dos aparelhos, que são dado do usuário.
    if (!resposta.ok) {
      console.error('Expo respondeu com status', resposta.status);
      continue;
    }

    // DeviceNotRegistered = app desinstalado ou token rotacionado. Se não
    // apagar, a tabela vai acumulando tokens mortos e cada envio fica mais
    // lento e mais perto do limite de 600 notificações/s do Expo.
    const { data: recibos } = (await resposta.json()) as {
      data?: { status: string; details?: { error?: string } }[];
    };
    recibos?.forEach((recibo, indice) => {
      if (recibo.status === 'error' && recibo.details?.error === 'DeviceNotRegistered') {
        tokensInvalidos.push(lote[indice].to);
      }
    });
  }

  if (tokensInvalidos.length) {
    await supabase.from('push_tokens').delete().in('token', tokensInvalidos);
  }

  return responder(200, { enviados: mensagens.length - tokensInvalidos.length, removidos: tokensInvalidos.length });
});

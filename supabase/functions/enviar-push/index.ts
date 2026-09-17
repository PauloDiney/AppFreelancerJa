// Edge Function chamada pelos triggers de mensagens e candidaturas (migration
// 0017). Busca os tokens do destinatário e manda pro serviço de push do Expo.
//
// Deploy:
//   supabase functions deploy enviar-push
//   supabase secrets set EXPO_ACCESS_TOKEN=...   (ver comentário abaixo)
//
// O EXPO_ACCESS_TOKEN fica como secret e nunca entra no bundle do app: a
// documentação do Expo avisa que, sem ele, qualquer um que descubra um token de
// push consegue se passar pelo seu servidor e disparar notificações em nome do
// projeto. Gere em expo.dev > Account Settings > Access Tokens e ative
// "Enhanced Security for Push Notifications" no projeto.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// O endpoint do Expo aceita no máximo 100 mensagens por requisição.
const TAMANHO_LOTE = 100;

type Payload = {
  usuario_id: string;
  titulo: string;
  corpo: string;
  dados?: Record<string, unknown>;
};

function emLotes<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ erro: 'JSON inválido' }), { status: 400 });
  }

  const { usuario_id, titulo, corpo, dados } = payload;
  if (!usuario_id || !titulo || !corpo) {
    return new Response(JSON.stringify({ erro: 'usuario_id, titulo e corpo são obrigatórios' }), { status: 400 });
  }

  // service_role porque a função precisa ler os tokens de OUTRA pessoa (quem
  // vai receber a notificação), o que a RLS de push_tokens corretamente proíbe
  // pro cliente. Esta função só é alcançável pelos triggers, que já mandam o
  // Bearer do service_role — nunca é chamada pelo app.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: tokens, error } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('usuario_id', usuario_id);

  if (error) {
    console.error('Falha ao buscar tokens:', error.message);
    return new Response(JSON.stringify({ erro: 'Falha ao buscar tokens' }), { status: 500 });
  }
  if (!tokens?.length) {
    return new Response(JSON.stringify({ enviados: 0 }), { status: 200 });
  }

  const mensagens = tokens.map(({ token }) => ({
    to: token,
    title: titulo,
    body: corpo,
    data: dados ?? {},
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

    if (!resposta.ok) {
      console.error('Expo respondeu', resposta.status, await resposta.text());
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

  return new Response(
    JSON.stringify({ enviados: mensagens.length - tokensInvalidos.length, removidos: tokensInvalidos.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});

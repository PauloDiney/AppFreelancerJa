// Regras puras da enviar-push (autenticação do chamador e validação do
// pedido), separadas do handler: não dependem de Deno nem do Supabase, então
// rodam com `node --test` (ver validacao.test.ts) sem subir o runtime.

// Mesmos tetos que fazem sentido numa notificação: o nome de quem manda
// (profiles.nome_completo tem até 120) e um trecho da mensagem.
export const TAMANHO_MAX_TITULO = 120;
export const TAMANHO_MAX_CORPO = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Só os formatos que o banco monta e que o app sabe abrir (use-push-token.ts):
// mensagem → conversa; qualquer aviso do ciclo de vida (0019, e o
// "candidatura" antigo da 0017) → bico. Qualquer outra coisa vira {}: o toque
// na notificação não navega pra lugar nenhum em vez de navegar pra onde o
// pedido mandar.
export const TIPOS_DO_BICO = new Set([
  'candidatura',
  'candidatura_recebida',
  'candidatura_aceita',
  'candidatura_recusada',
  'bico_iniciado',
  'bico_finalizado',
  'bico_concluido',
  'bico_cancelado',
  'disputa_aberta',
  'disputa_resolvida',
  'avaliacao_recebida',
]);

export type DadosPush =
  | { tipo: 'mensagem'; conversa_id: string }
  | { tipo: string; bico_id: string }
  | Record<string, never>;

export type PedidoPush = {
  usuario_id: string;
  titulo: string;
  corpo: string;
  dados: DadosPush;
};

async function sha256(texto: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
}

// Compara o segredo recebido com o configurado sem vazar pelo tempo de
// resposta quantos caracteres batem: compara os hashes (tamanho fixo) inteiros,
// sem sair no primeiro byte diferente. Segredo não configurado nunca autoriza.
export async function segredoConfere(recebido: string | null | undefined, esperado: string | null | undefined) {
  if (!esperado || !recebido) return false;
  const [a, b] = await Promise.all([sha256(recebido), sha256(esperado)]);
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a[i] ^ b[i];
  return diferenca === 0;
}

// Corta por code point (não por unidade UTF-16) pra não partir emoji ao meio.
function textoLimitado(valor: unknown, maximo: number): string | null {
  if (typeof valor !== 'string') return null;
  const caracteres = Array.from(valor.trim());
  if (caracteres.length === 0) return null;
  if (caracteres.length <= maximo) return caracteres.join('');
  return `${caracteres.slice(0, maximo - 1).join('')}…`;
}

function dadosPermitidos(valor: unknown): DadosPush {
  if (!valor || typeof valor !== 'object') return {};
  const dados = valor as Record<string, unknown>;
  if (dados.tipo === 'mensagem' && typeof dados.conversa_id === 'string' && UUID.test(dados.conversa_id)) {
    return { tipo: 'mensagem', conversa_id: dados.conversa_id };
  }
  if (
    typeof dados.tipo === 'string' &&
    TIPOS_DO_BICO.has(dados.tipo) &&
    typeof dados.bico_id === 'string' &&
    UUID.test(dados.bico_id)
  ) {
    return { tipo: dados.tipo, bico_id: dados.bico_id };
  }
  return {};
}

// Devolve o pedido normalizado, ou null se não der pra enviar nada com ele.
export function validarPedido(corpo: unknown): PedidoPush | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const pedido = corpo as Record<string, unknown>;

  if (typeof pedido.usuario_id !== 'string' || !UUID.test(pedido.usuario_id)) return null;

  const titulo = textoLimitado(pedido.titulo, TAMANHO_MAX_TITULO);
  const texto = textoLimitado(pedido.corpo, TAMANHO_MAX_CORPO);
  if (!titulo || !texto) return null;

  return { usuario_id: pedido.usuario_id, titulo, corpo: texto, dados: dadosPermitidos(pedido.dados) };
}

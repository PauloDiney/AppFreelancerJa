export type ErroSupabase = { message?: string; code?: string; hint?: string | null } | Error | null | undefined;

// Códigos de domínio que as RPCs e triggers do ciclo de vida mandam no HINT
// do erro (migration 0019). O texto que a pessoa lê mora aqui, e não no
// banco: a mensagem do Postgres pode mudar (ou citar nomes internos, como
// "aberto -> concluido") sem mudar o que aparece na tela.
const MENSAGENS_DOMINIO: Record<string, string> = {
  NOT_AUTHENTICATED: 'Sua sessão expirou. Entre novamente.',
  ACCOUNT_SUSPENDED: 'Sua conta está suspensa. Fale com o suporte.',

  JOB_NOT_FOUND: 'Este bico não existe mais.',
  NOT_JOB_OWNER: 'Só quem publicou o bico pode fazer isso.',
  NOT_SELECTED_WORKER: 'Só o prestador escolhido pode fazer isso.',
  NOT_JOB_PARTICIPANT: 'Você não participa deste bico.',
  JOB_NOT_OPEN: 'Este bico não está mais aberto.',
  JOB_ALREADY_ASSIGNED: 'Este bico já tem um prestador escolhido.',
  JOB_NOT_ASSIGNED: 'Este bico não está aguardando o início do serviço.',
  JOB_NOT_IN_PROGRESS: 'O serviço precisa estar em andamento para isso.',
  JOB_NOT_AWAITING_CONFIRMATION: 'O prestador ainda não marcou o serviço como finalizado.',
  INVALID_JOB_TRANSITION: 'Essa ação não é possível na etapa atual do bico.',
  JOB_LOCKED: 'Depois que o prestador é escolhido, o bico não pode mais ser editado.',
  JOB_MUST_START_OPEN: 'Não foi possível publicar o bico. Tente novamente.',
  JOB_FIELDS_IMMUTABLE: 'Esses dados do bico não podem ser alterados.',

  CANNOT_APPLY_OWN_JOB: 'Você não pode se candidatar ao seu próprio bico.',
  APPLICATION_ALREADY_EXISTS: 'Você já se candidatou a este bico.',
  APPLICATION_NOT_FOUND: 'Candidatura não encontrada.',
  APPLICATION_NOT_PENDING: 'Essa candidatura não está mais disponível.',
  CANNOT_SELECT_OWNER: 'Você não pode ser o prestador do seu próprio bico.',
  APPLICANT_UNAVAILABLE: 'Esse candidato não está mais disponível.',

  CANCELLATION_NOT_ALLOWED: 'Este bico não pode ser cancelado agora. Se houver um problema, abra uma disputa.',
  INVALID_CANCELLATION_REASON: 'Escolha um motivo para o cancelamento.',
  CANCELLATION_DETAILS_REQUIRED: 'Conte em poucas palavras por que está cancelando.',

  DISPUTE_NOT_ALLOWED: 'Só dá para abrir disputa com o serviço em andamento ou aguardando confirmação.',
  DISPUTE_ALREADY_OPEN: 'Já existe uma disputa aberta para este bico.',
  INVALID_DISPUTE_REASON: 'Escolha um motivo para a disputa.',
  DISPUTE_DESCRIPTION_REQUIRED: 'Descreva o problema com pelo menos 10 caracteres.',
  DISPUTE_NOT_FOUND: 'Disputa não encontrada.',
  DISPUTE_ALREADY_RESOLVED: 'Esta disputa já foi encerrada.',

  REVIEW_NOT_ALLOWED: 'Só quem participou pode avaliar, e só depois que o bico for concluído.',
  REVIEW_WINDOW_CLOSED: 'O prazo para avaliar este bico já terminou.',
  REVIEW_ALREADY_EXISTS: 'Você já avaliou este bico.',
  INVALID_RATING: 'Escolha de 1 a 5 estrelas.',
  REVIEW_IMMUTABLE: 'Avaliações não podem ser alteradas.',
};

// Traduz erros técnicos do Postgres/PostgREST (nomes de constraint, coluna,
// tabela) em mensagens que fazem sentido pro usuário. Ordem: código de
// domínio conhecido → mensagem das nossas próprias funções (raise exception,
// P0001, escrita pra aparecer na tela) → códigos genéricos → texto padrão.
export function mensagemErro(erro: ErroSupabase, acao = 'concluir esta ação'): string {
  if (!erro) return `Não foi possível ${acao}. Tente novamente.`;

  const codigo = 'code' in erro ? erro.code : undefined;
  const mensagem = 'message' in erro ? (erro.message ?? '') : '';
  const dominio = 'hint' in erro ? erro.hint : undefined;

  if (dominio && MENSAGENS_DOMINIO[dominio]) return MENSAGENS_DOMINIO[dominio];
  if (codigo === 'P0001') return mensagem;

  switch (codigo) {
    case '23505':
      return 'Isso já foi feito antes.';
    case '23503':
      return 'Um dos itens relacionados não existe mais.';
    case '42501':
      return 'Você não tem permissão para fazer isso.';
    default:
      break;
  }

  if (/network|fetch/i.test(mensagem)) return 'Sem conexão. Verifique sua internet e tente novamente.';

  return `Não foi possível ${acao}. Tente novamente.`;
}

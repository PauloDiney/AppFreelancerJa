type ErroSupabase = { message?: string; code?: string } | Error | null | undefined;

// Traduz erros técnicos do Postgres/PostgREST (nomes de constraint, coluna,
// tabela) em mensagens que fazem sentido pro usuário. Exceções lançadas pelas
// nossas próprias funções (raise exception, code P0001) já vêm com uma
// mensagem pensada pra aparecer na tela, então passam direto.
export function mensagemErro(erro: ErroSupabase, acao = 'concluir esta ação'): string {
  if (!erro) return `Não foi possível ${acao}. Tente novamente.`;

  const codigo = 'code' in erro ? erro.code : undefined;
  const mensagem = 'message' in erro ? (erro.message ?? '') : '';

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

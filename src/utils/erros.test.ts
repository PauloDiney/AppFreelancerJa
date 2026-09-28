// Testes do mapeamento de erros (roda com `npm test`, sem dependência nova).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mensagemErro } from './erros.ts';

test('código de domínio no HINT vira a mensagem do app, não o texto do banco', () => {
  const erro = { code: 'P0001', message: 'Transição de status inválida: aberto -> concluido', hint: 'INVALID_JOB_TRANSITION' };
  assert.equal(mensagemErro(erro), 'Essa ação não é possível na etapa atual do bico.');
});

test('cada código do ciclo de vida tem mensagem própria', () => {
  const codigos = [
    'JOB_NOT_OPEN',
    'JOB_ALREADY_ASSIGNED',
    'APPLICATION_ALREADY_EXISTS',
    'NOT_JOB_OWNER',
    'NOT_SELECTED_WORKER',
    'INVALID_JOB_TRANSITION',
    'JOB_NOT_AWAITING_CONFIRMATION',
    'DISPUTE_NOT_ALLOWED',
    'REVIEW_NOT_ALLOWED',
  ];
  const mensagens = codigos.map((hint) => mensagemErro({ code: 'P0001', message: 'x', hint }, 'agir'));
  mensagens.forEach((texto, i) => {
    assert.notEqual(texto, 'x', `${codigos[i]} não pode mostrar o texto cru do banco`);
    assert.doesNotMatch(texto, /Não foi possível agir/, `${codigos[i]} precisa de mensagem específica`);
  });
  assert.equal(new Set(mensagens).size, codigos.length, 'mensagens não se repetem entre códigos diferentes');
});

test('P0001 sem código conhecido mostra a mensagem escrita pela função', () => {
  assert.equal(mensagemErro({ code: 'P0001', message: 'Mensagem pensada pra tela.' }), 'Mensagem pensada pra tela.');
});

test('erros genéricos do Postgres não vazam detalhes', () => {
  const vazamento = 'duplicate key value violates unique constraint "candidaturas_bico_id_candidato_id_key"';
  assert.equal(mensagemErro({ code: '23505', message: vazamento }), 'Isso já foi feito antes.');
  assert.equal(mensagemErro({ code: '42501', message: 'permission denied for table bicos' }), 'Você não tem permissão para fazer isso.');
  assert.equal(mensagemErro({ code: 'XX000', message: 'internal error at src/backend' }, 'salvar'), 'Não foi possível salvar. Tente novamente.');
});

test('falha de rede vira aviso de conexão', () => {
  assert.equal(mensagemErro(new Error('Network request failed')), 'Sem conexão. Verifique sua internet e tente novamente.');
});

test('sem erro ainda devolve uma frase útil', () => {
  assert.equal(mensagemErro(null, 'cancelar'), 'Não foi possível cancelar. Tente novamente.');
});

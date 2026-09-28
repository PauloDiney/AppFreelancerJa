// Testes das regras puras da enviar-push. Rodam com o runner embutido do Node
// (`npm test`), sem Deno e sem dependência nova. Não entram no deploy: a
// função só empacota o que index.ts importa.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TAMANHO_MAX_CORPO, segredoConfere, validarPedido } from './validacao.ts';

const USUARIO = '11111111-1111-1111-1111-111111111111';
const CONVERSA = '22222222-2222-2222-2222-222222222222';

test('segredo: só autoriza com o valor exato configurado', async () => {
  assert.equal(await segredoConfere('s3gredo-longo', 's3gredo-longo'), true);
  assert.equal(await segredoConfere('s3gredo-longO', 's3gredo-longo'), false);
  assert.equal(await segredoConfere('s3gredo', 's3gredo-longo'), false);
});

test('segredo: sem header ou sem segredo configurado, nunca autoriza', async () => {
  assert.equal(await segredoConfere(null, 's3gredo'), false);
  assert.equal(await segredoConfere('', 's3gredo'), false);
  assert.equal(await segredoConfere('s3gredo', undefined), false);
  assert.equal(await segredoConfere('', ''), false);
});

test('segredo: a chave anon (JWT) não passa por segredo', async () => {
  const jwtAnon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.assinatura';
  assert.equal(await segredoConfere(jwtAnon, 's3gredo'), false);
});

test('pedido válido do trigger de mensagem é aceito como veio', () => {
  const pedido = validarPedido({
    usuario_id: USUARIO,
    titulo: 'Maria',
    corpo: 'Chego às 8h',
    dados: { tipo: 'mensagem', conversa_id: CONVERSA },
  });
  assert.deepEqual(pedido, {
    usuario_id: USUARIO,
    titulo: 'Maria',
    corpo: 'Chego às 8h',
    dados: { tipo: 'mensagem', conversa_id: CONVERSA },
  });
});

test('pedido sem destinatário válido é recusado', () => {
  assert.equal(validarPedido({ usuario_id: 'todos', titulo: 'x', corpo: 'y' }), null);
  assert.equal(validarPedido({ titulo: 'x', corpo: 'y' }), null);
  assert.equal(validarPedido(null), null);
  assert.equal(validarPedido('texto'), null);
});

test('pedido sem título ou corpo é recusado', () => {
  assert.equal(validarPedido({ usuario_id: USUARIO, titulo: '   ', corpo: 'y' }), null);
  assert.equal(validarPedido({ usuario_id: USUARIO, titulo: 'x', corpo: 42 }), null);
});

test('dados fora dos formatos conhecidos são descartados', () => {
  const pedido = validarPedido({
    usuario_id: USUARIO,
    titulo: 'x',
    corpo: 'y',
    dados: { tipo: 'mensagem', conversa_id: '../../configuracoes', url: 'https://golpe.example' },
  });
  assert.deepEqual(pedido?.dados, {});
});

test('texto longo é cortado sem partir emoji', () => {
  const pedido = validarPedido({ usuario_id: USUARIO, titulo: 'x', corpo: '🎉'.repeat(TAMANHO_MAX_CORPO + 50) });
  const caracteres = Array.from(pedido?.corpo ?? '');
  assert.equal(caracteres.length, TAMANHO_MAX_CORPO);
  assert.equal(caracteres.at(-1), '…');
  assert.ok(caracteres.slice(0, -1).every((c) => c === '🎉'));
});

// Testes do adaptador que guarda a sessão no Keychain/Keystore. Rodam com o
// runner embutido do Node (`npm test`); o cofre e o AsyncStorage são trocados
// por mapas em memória, então nada aqui depende de aparelho.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_BYTES_POR_PEDACO, criarArmazenamentoSessao, dividirEmPedacos, type Cofre } from './armazenamento-sessao.ts';

const CHAVE = 'sb-abcdefghijklmnop-auth-token';

// Sessão do tamanho de uma de verdade (~3,5 KB), com acento e emoji no nome.
const SESSAO = JSON.stringify({
  access_token: 'eyJ'.padEnd(1100, 'x'),
  refresh_token: 'r'.repeat(40),
  expires_at: 1_900_000_000,
  user: { id: '11111111-1111-1111-1111-111111111111', user_metadata: { nome_completo: 'João Conceição 🎉' } },
  extra: 'y'.repeat(2200),
});

function criarCofreFalso() {
  const itens = new Map<string, string>();
  const cofre: Cofre & { itens: Map<string, string>; falharGravacaoEm: number } = {
    itens,
    falharGravacaoEm: Infinity,
    async ler(chave) {
      assert.match(chave, /^[A-Za-z0-9._-]+$/, `chave inválida para o SecureStore: ${chave}`);
      return itens.get(chave) ?? null;
    },
    async gravar(chave, valor) {
      assert.ok(Buffer.byteLength(valor, 'utf8') <= MAX_BYTES_POR_PEDACO, 'pedaço acima do limite');
      if (cofre.falharGravacaoEm-- <= 0) throw new Error('Keychain indisponível');
      itens.set(chave, valor);
    },
    async apagar(chave) {
      itens.delete(chave);
    },
  };
  return cofre;
}

function criarLegadoFalso(inicial: Record<string, string> = {}) {
  const itens = new Map(Object.entries(inicial));
  return {
    itens,
    async getItem(chave: string) {
      return itens.get(chave) ?? null;
    },
    async removeItem(chave: string) {
      itens.delete(chave);
    },
  };
}

test('pedaços respeitam o limite em bytes e remontam o valor original', () => {
  const pedacos = dividirEmPedacos(SESSAO);
  assert.ok(pedacos.length > 1);
  assert.ok(pedacos.every((p) => Buffer.byteLength(p, 'utf8') <= MAX_BYTES_POR_PEDACO));
  assert.equal(pedacos.join(''), SESSAO);
});

test('grava no cofre (nunca no AsyncStorage) e lê de volta', async () => {
  const cofre = criarCofreFalso();
  const legado = criarLegadoFalso();
  await criarArmazenamentoSessao({ cofre, legado }).setItem(CHAVE, SESSAO);

  assert.equal(legado.itens.size, 0);
  assert.ok(![...cofre.itens.values()].some((v) => v === SESSAO), 'deveria estar em pedaços');

  // Instância nova = app reaberto: lê do cofre, não da memória.
  assert.equal(await criarArmazenamentoSessao({ cofre, legado }).getItem(CHAVE), SESSAO);
});

test('sessão antiga do AsyncStorage migra pro cofre sem deslogar e some de lá', async () => {
  const cofre = criarCofreFalso();
  const legado = criarLegadoFalso({ [CHAVE]: SESSAO });

  assert.equal(await criarArmazenamentoSessao({ cofre, legado }).getItem(CHAVE), SESSAO);
  assert.equal(legado.itens.has(CHAVE), false, 'cópia sem criptografia deveria ter sido apagada');
  assert.equal(await criarArmazenamentoSessao({ cofre, legado: criarLegadoFalso() }).getItem(CHAVE), SESSAO);
});

test('regravar troca de vaga e não deixa pedaço da sessão anterior', async () => {
  const cofre = criarCofreFalso();
  const armazenamento = criarArmazenamentoSessao({ cofre, legado: criarLegadoFalso() });
  await armazenamento.setItem(CHAVE, SESSAO);
  const nova = SESSAO.replace('r'.repeat(40), 'n'.repeat(40)).slice(0, 1500);
  await armazenamento.setItem(CHAVE, nova);

  assert.equal(await criarArmazenamentoSessao({ cofre, legado: criarLegadoFalso() }).getItem(CHAVE), nova);
  assert.equal([...cofre.itens.keys()].length, dividirEmPedacos(nova).length + 1);
});

test('app morto no meio da gravação mantém a sessão anterior inteira', async () => {
  const cofre = criarCofreFalso();
  await criarArmazenamentoSessao({ cofre, legado: criarLegadoFalso() }).setItem(CHAVE, SESSAO);

  cofre.falharGravacaoEm = 1; // grava o 1º pedaço da sessão nova e "morre"
  await criarArmazenamentoSessao({ cofre, legado: criarLegadoFalso() }).setItem(CHAVE, 'x'.repeat(4000));

  assert.equal(await criarArmazenamentoSessao({ cofre, legado: criarLegadoFalso() }).getItem(CHAVE), SESSAO);
});

test('sem cofre utilizável a sessão fica só em memória, nunca no AsyncStorage', async () => {
  const cofre = criarCofreFalso();
  cofre.falharGravacaoEm = 0;
  const legado = criarLegadoFalso();
  const armazenamento = criarArmazenamentoSessao({ cofre, legado });

  await armazenamento.setItem(CHAVE, SESSAO);
  assert.equal(await armazenamento.getItem(CHAVE), SESSAO);
  assert.equal(legado.itens.size, 0);
  assert.equal(cofre.itens.size, 0);
});

test('logout apaga tudo do cofre e do AsyncStorage', async () => {
  const cofre = criarCofreFalso();
  const legado = criarLegadoFalso({ [CHAVE]: SESSAO });
  const armazenamento = criarArmazenamentoSessao({ cofre, legado });
  await armazenamento.getItem(CHAVE);
  await armazenamento.setItem(CHAVE, SESSAO);

  await armazenamento.removeItem(CHAVE);

  assert.equal(await armazenamento.getItem(CHAVE), null);
  assert.equal(cofre.itens.size, 0);
  assert.equal(legado.itens.size, 0);
  assert.equal(await criarArmazenamentoSessao({ cofre, legado }).getItem(CHAVE), null);
});

test('logout nunca lança, mesmo com o cofre falhando', async () => {
  const cofre = criarCofreFalso();
  const armazenamento = criarArmazenamentoSessao({ cofre, legado: criarLegadoFalso() });
  await armazenamento.setItem(CHAVE, SESSAO);
  cofre.apagar = async () => {
    throw new Error('Keychain indisponível');
  };

  await assert.doesNotReject(armazenamento.removeItem(CHAVE));
  assert.equal(await armazenamento.getItem(CHAVE), null);
});

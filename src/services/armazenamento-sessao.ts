// Onde a sessão do Supabase (access token + refresh token) fica guardada no
// celular. Antes ia inteira pro AsyncStorage: um SQLite/arquivo sem
// criptografia, que entra no backup automático do Android e no backup do
// iPhone. O refresh token não expira sozinho e dá acesso à conta toda (CPF,
// endereço, chaves Pix, conversas) — quem copiasse o arquivo virava o usuário.
//
// Agora vai pro Keychain (iOS) / Keystore (Android), via expo-secure-store
// (a ligação com o módulo nativo fica em supabaseClient.ts; este arquivo não
// importa nada de React Native pra poder ser testado com `npm test`). Três
// detalhes que o SecureStore exige:
//  - o valor é partido em pedaços de até 1800 bytes: alguns iOS recusam item
//    acima de ~2 KB, e a sessão costuma passar disso;
//  - a gravação escreve os pedaços numa "vaga" (a/b) e só no fim troca o
//    ponteiro (.meta): se o app morrer no meio, a sessão anterior continua
//    inteira em vez de virar uma mistura de pedaços novos e velhos;
//  - o auth-js lê o storage a CADA requisição (getSession), então o valor fica
//    em memória depois da primeira leitura — o Keychain só é tocado de novo
//    quando a sessão muda.
// Quem já estava logado não precisa entrar de novo: na primeira leitura a
// sessão antiga é copiada do AsyncStorage pro cofre e apagada de lá.

export type ArmazenamentoSessao = {
  getItem: (chave: string) => Promise<string | null>;
  setItem: (chave: string, valor: string) => Promise<void>;
  removeItem: (chave: string) => Promise<void>;
};

export type Cofre = {
  ler: (chave: string) => Promise<string | null>;
  gravar: (chave: string, valor: string) => Promise<void>;
  apagar: (chave: string) => Promise<void>;
};

type ArmazenamentoLegado = {
  getItem: (chave: string) => Promise<string | null>;
  removeItem: (chave: string) => Promise<void>;
};

export const MAX_BYTES_POR_PEDACO = 1800;
const MAX_PEDACOS = 32;

type Vaga = 'a' | 'b';

function bytesUtf8(codePoint: number) {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

// Corta por bytes UTF-8 (o limite do Keychain é em bytes) sem partir nenhum
// caractere: o nome do usuário vai junto na sessão e pode ter acento/emoji.
export function dividirEmPedacos(valor: string, maxBytes = MAX_BYTES_POR_PEDACO): string[] {
  const pedacos: string[] = [];
  let atual = '';
  let bytes = 0;
  for (const caractere of valor) {
    const tamanho = bytesUtf8(caractere.codePointAt(0) ?? 0);
    if (bytes + tamanho > maxBytes && atual) {
      pedacos.push(atual);
      atual = '';
      bytes = 0;
    }
    atual += caractere;
    bytes += tamanho;
  }
  if (atual) pedacos.push(atual);
  return pedacos;
}

// O SecureStore só aceita letras, números, ".", "-" e "_" na chave.
function chaveNoCofre(chave: string) {
  return chave.replace(/[^A-Za-z0-9._-]/g, '_');
}

function lerPonteiro(texto: string | null): { vaga: Vaga; total: number } | null {
  const partes = /^([ab]):(\d{1,2})$/.exec(texto ?? '');
  if (!partes || Number(partes[2]) > MAX_PEDACOS) return null;
  return { vaga: partes[1] as Vaga, total: Number(partes[2]) };
}

export function criarArmazenamentoSessao({
  cofre,
  legado,
}: {
  cofre: Cofre;
  legado: ArmazenamentoLegado;
}): ArmazenamentoSessao {
  const cache = new Map<string, string | null>();

  // Uma operação de cofre por vez: duas gravações intercaladas escreveriam
  // na mesma vaga ao mesmo tempo.
  let fila: Promise<unknown> = Promise.resolve();
  function emOrdem<T>(tarefa: () => Promise<T>): Promise<T> {
    const resultado = fila.then(tarefa, tarefa);
    fila = resultado.catch(() => undefined);
    return resultado;
  }

  async function lerDoCofre(base: string): Promise<string | null> {
    const ponteiro = lerPonteiro(await cofre.ler(`${base}.meta`));
    if (!ponteiro) return null;
    const pedacos = await Promise.all(
      Array.from({ length: ponteiro.total }, (_, i) => cofre.ler(`${base}.${ponteiro.vaga}.${i}`))
    );
    if (pedacos.some((pedaco) => pedaco === null)) return null;
    return pedacos.join('');
  }

  // Os pedaços de uma vaga são sempre contíguos a partir do 0, então basta
  // apagar até achar o primeiro que não existe — isso também limpa sobra de
  // uma gravação interrompida.
  async function apagarVaga(base: string, vaga: Vaga) {
    for (let i = 0; i < MAX_PEDACOS; i++) {
      const chave = `${base}.${vaga}.${i}`;
      if ((await cofre.ler(chave)) === null) return;
      await cofre.apagar(chave);
    }
  }

  async function gravarNoCofre(base: string, valor: string) {
    const pedacos = dividirEmPedacos(valor);
    if (pedacos.length > MAX_PEDACOS) throw new Error('Sessão grande demais para o armazenamento seguro.');

    const anterior = lerPonteiro(await cofre.ler(`${base}.meta`));
    const vaga: Vaga = anterior?.vaga === 'a' ? 'b' : 'a';
    for (let i = 0; i < pedacos.length; i++) await cofre.gravar(`${base}.${vaga}.${i}`, pedacos[i]);
    await cofre.gravar(`${base}.meta`, `${vaga}:${pedacos.length}`);
    if (anterior) await apagarVaga(base, anterior.vaga);
  }

  async function carregar(chave: string): Promise<string | null> {
    const base = chaveNoCofre(chave);
    let valor: string | null = null;
    try {
      valor = await lerDoCofre(base);
    } catch {
      // Item ilegível (ex.: chave do Keystore invalidada) equivale a não ter
      // sessão: o usuário entra de novo, nada é exposto.
      valor = null;
    }
    if (valor !== null) return valor;

    const antigo = await legado.getItem(chave).catch(() => null);
    if (antigo === null) return null;
    try {
      await gravarNoCofre(base, antigo);
      await legado.removeItem(chave);
    } catch {
      // Cofre indisponível agora: mantém a cópia antiga e tenta de novo na
      // próxima gravação, em vez de deslogar o usuário.
    }
    return antigo;
  }

  return {
    getItem(chave) {
      if (cache.has(chave)) return Promise.resolve(cache.get(chave) ?? null);
      return emOrdem(async () => {
        if (!cache.has(chave)) cache.set(chave, await carregar(chave));
        return cache.get(chave) ?? null;
      });
    },

    setItem(chave, valor) {
      cache.set(chave, valor);
      return emOrdem(async () => {
        try {
          await gravarNoCofre(chaveNoCofre(chave), valor);
          await legado.removeItem(chave).catch(() => undefined);
        } catch {
          // Sem Keychain/Keystore utilizável a sessão vale só enquanto o app
          // está aberto. Cair pro AsyncStorage seria voltar ao problema.
        }
      });
    },

    // Nunca lança: se lançasse, o auth-js não emitiria SIGNED_OUT e a tela
    // ficaria "logada" com a sessão já apagada da memória. O ponteiro sai
    // primeiro — sem ele os pedaços que sobrarem não formam sessão nenhuma.
    removeItem(chave) {
      cache.set(chave, null);
      return emOrdem(async () => {
        const base = chaveNoCofre(chave);
        await cofre.apagar(`${base}.meta`).catch(() => cofre.gravar(`${base}.meta`, '-').catch(() => undefined));
        await apagarVaga(base, 'a').catch(() => undefined);
        await apagarVaga(base, 'b').catch(() => undefined);
        await legado.removeItem(chave).catch(() => undefined);
      });
    },
  };
}

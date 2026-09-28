# Estou Dentro

App de bicos: quem precisa de uma mão publica o serviço, quem quer trabalhar se candidata, os dois combinam pelo chat e se avaliam no final.

React Native + Expo SDK 57 (expo-router), Supabase (Postgres + Auth + Realtime + Storage), React Query e Zustand.

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha com os dados do seu projeto Supabase
npx expo start
```

As duas variáveis do `.env.local` saem de **Project Settings > API** no painel do Supabase:

| Variável | Onde achar |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Project API keys > `anon` `public` |

> A chave `anon` é pública por design — ela vai dentro do bundle do app. Quem protege os dados é a RLS do Postgres, não o segredo da chave. A chave `service_role` **nunca** entra neste repositório nem no app: ela só existe como secret da Edge Function.

### Banco de dados

As migrations em `supabase/migrations/` são feitas pra rodar **em ordem**, coladas no SQL Editor do Supabase Studio. Cada arquivo abre com um comentário explicando o que corrige e por quê.

Ordem importa: a `0015` depende de tabelas e policies criadas nas anteriores.

### Notificações push

Push **não funciona no Expo Go** (desde a SDK 53) — precisa de um development build:

```bash
eas build --profile development --platform android
```

Do lado do servidor, depois de rodar até a `0018`. Primeiro gere um segredo
aleatório que serve **só** pro banco chamar a function (nunca use a
`service_role` aqui):

```bash
openssl rand -hex 32   # guarde a saída: é o PUSH_WEBHOOK_SECRET

supabase functions deploy enviar-push --no-verify-jwt   # a function confere o segredo no código
supabase secrets set PUSH_WEBHOOK_SECRET=...            # o valor gerado acima
supabase secrets set EXPO_ACCESS_TOKEN=...              # expo.dev > Account Settings > Access Tokens
```

E os dois segredos que o trigger lê do Vault (SQL Editor):

```sql
select vault.create_secret('https://SEU-REF.supabase.co', 'push_project_url');
select vault.create_secret('O_MESMO_PUSH_WEBHOOK_SECRET', 'push_webhook_secret');
```

Sem esses segredos o app continua funcionando normalmente — só não envia
notificação. Se você seguiu a versão antiga deste README e gravou
`app.settings.service_role_key` no banco, a `0018` tenta removê-lo; confira e
**rotacione a service_role key** (ver `docs/ARCHITECTURE_SECURITY_AUDIT.md`).

## Estrutura

```
src/
  app/          telas (expo-router: cada arquivo é uma rota)
  components/   ThemedText, ThemedView, BottomTabBar
  constants/    cores, espaçamentos
  hooks/        acesso a dados compartilhado entre telas
  services/     cliente único do Supabase
  stores/       Zustand (sessão, tema, notificações) — preferências são por usuário
  utils/        formatação, validação de documentos, upload de avatar, erros
supabase/
  migrations/   schema e RLS, em ordem
  functions/    Edge Functions (Deno — fora do tsconfig do app de propósito)
```

## Checagens

```bash
npx tsc --noEmit    # tipos
npx expo lint       # ESLint
npx expo-doctor     # sanidade do app.json e das dependências
npm test            # testes unitários (sessão no Keychain, validação da enviar-push)
npm run test:db     # testes de RLS/regras de negócio (pgTAP; precisa de Docker + Supabase CLI)
```

Os testes de banco ficam em `supabase/tests/database/` e rodam contra um
Supabase local (`supabase start` aplica todas as migrations antes).

## Onde a segurança mora

Quase toda a autorização está nas migrations, não no app — o cliente roda no
celular do usuário e não dá pra confiar nele. Dois padrões se repetem e valem
ser entendidos antes de mexer no schema:

- **RLS é por linha, não por coluna.** Onde uma tabela tem colunas sensíveis
  (telefone e CPF em `profiles`, GPS em `bicos`), o acesso é fechado com
  `revoke ... from authenticated` + `grant (colunas específicas)`. Um
  `select *` novo numa dessas tabelas vai falhar — é de propósito.
- **Regra de negócio que precisa valer sempre vive em trigger ou função**, não
  na policy: `validar_insercao_bico` (todo bico nasce `aberto`, sem prestador)
  e `validar_transicao_bico` (só se escolhe candidatura ativa, nunca o dono)
  são o que impede forjar o prestador escolhido — e valem tanto pro `insert`/
  `update` direto quanto pelas RPCs.
- **Função `security definer` não pode devolver o que a coluna esconde.**
  `bicos_proximos` calcula tudo sobre o ponto arredondado pra uma grade de
  ~1 km; com a distância exata, três chamadas davam a coordenada da casa.

A auditoria completa (o que foi corrigido, o que falta e os passos manuais no
painel do Supabase) está em `docs/ARCHITECTURE_SECURITY_AUDIT.md`.

## O que ainda falta

1. Exclusão de conta e exportação de dados (LGPD — o app coleta CPF/CNPJ, nascimento, endereço e GPS)
2. Cancelar/disputar bico já em andamento (hoje só dá pra cancelar enquanto está `aberto`)
3. Pix de verdade: hoje a chave é combinada pelo chat, sem QR Code nem repasse
4. Denúncias e bloqueio (a tabela `denuncias` existe desde a `0001`, sem UI)
5. Busca e paginação no servidor (hoje o filtro é no cliente, sobre as últimas 15/30 linhas)
6. Busca por proximidade (`bicos_proximos` já devolve distância, falta ligar na tela)
7. Recuperação de senha e login com Google
8. CI rodando `npm test` e `npm run test:db` a cada push (os testes já existem)

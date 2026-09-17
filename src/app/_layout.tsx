import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useRegistroPush } from '@/hooks/use-push-token';
import { useResolvedColorScheme } from '@/hooks/use-resolved-color-scheme';
import { supabase } from '@/services/supabaseClient';
import { useAuthStore } from '@/stores/auth-store';

// Layout raiz do expo-router: fica montado o tempo todo, então é o lugar
// certo pra coisas globais (providers, a única inscrição de realtime do
// app, espelhar a sessão do Supabase no auth-store) sem precisar duplicar
// isso em cada tela.
//
// staleTime/gcTime/retry definidos aqui porque sem eles cada foco de tela
// refazia todas as requisições e qualquer oscilação de rede virava tela de
// erro na hora — num app que roda em 4G isso é o caso comum, não a exceção.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
    },
  },
});

// Mantém uma única inscrição de realtime pro app inteiro. Se cada tela que usa a
// tab bar abrisse seu próprio canal "mensagens-globais", a segunda tentativa de
// dar .on() num canal com o mesmo nome já inscrito quebra ("cannot add
// postgres_changes callbacks... after subscribe()").
function AssinaturaMensagens() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const canal = supabase
      .channel('mensagens-globais')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mensagens' }, () => {
        queryClient.invalidateQueries({ queryKey: ['total-nao-lidas'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [queryClient]);

  return null;
}

// Mantém o id do usuário logado num store global, atualizado sempre que a sessão
// muda (login/logout/troca de conta). Preferências como o tema usam esse id pra
// não vazar a escolha de um usuário pro próximo que logar no mesmo aparelho.
function AssinaturaAutenticacao() {
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      useAuthStore.getState().definirUsuarioId(data.session?.user?.id ?? null);
    });

    const { data: assinatura } = supabase.auth.onAuthStateChange((evento, sessao) => {
      useAuthStore.getState().definirUsuarioId(sessao?.user?.id ?? null);

      // O queryClient é criado no módulo e vive enquanto o app estiver aberto:
      // sem limpar aqui, o cache com nome, bicos, conversas e estatísticas da
      // conta anterior continuava em memória depois do logout e a próxima conta
      // via dados que não são dela até cada query revalidar. Fica neste ponto
      // (e não nos botões "Sair") porque assim cobre também token expirado e
      // sessão revogada, que não passam por botão nenhum.
      if (evento === 'SIGNED_OUT') queryClient.clear();
    });

    return () => {
      assinatura.subscription.unsubscribe();
    };
  }, [queryClient]);

  return null;
}

// Separado do RootLayout porque precisa estar dentro do QueryClientProvider
// (AssinaturaAutenticacao usa useQueryClient) e ler o auth-store.
function Navegacao() {
  const usuarioId = useAuthStore((estado) => estado.usuarioId);
  const carregando = useAuthStore((estado) => estado.carregando);
  const logado = !!usuarioId;

  // Registra o aparelho pra push e trata o toque na notificação. Fica aqui
  // porque precisa do router montado pra conseguir navegar até a conversa.
  useRegistroPush(usuarioId);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Rota âncora: é pra cá que o expo-router manda quem tenta abrir uma
          tela protegida sem permissão (deeplink com o app deslogado, sessão
          expirada). Fica fora de qualquer guard de propósito. */}
      <Stack.Screen name="index" />

      <Stack.Protected guard={!logado && !carregando}>
        <Stack.Screen name="login" />
      </Stack.Protected>

      <Stack.Protected guard={logado}>
        <Stack.Screen name="home" />
        <Stack.Screen name="buscar" />
        <Stack.Screen name="chat" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="perfil" />
        <Stack.Screen name="bico/[id]" />
        <Stack.Screen name="criar-bico" />
        <Stack.Screen name="editar-perfil" />
        <Stack.Screen name="dados-pessoais" />
        <Stack.Screen name="configuracoes" />
        <Stack.Screen name="historico-bicos" />
        <Stack.Screen name="metodos-pagamento" />
        <Stack.Screen name="pagamentos" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useResolvedColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AssinaturaAutenticacao />
        <AssinaturaMensagens />
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Navegacao />
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

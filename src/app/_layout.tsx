import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useResolvedColorScheme } from '@/hooks/use-resolved-color-scheme';
import { supabase } from '@/services/supabaseClient';
import { useAuthStore } from '@/stores/auth-store';

// Layout raiz do expo-router: fica montado o tempo todo, então é o lugar
// certo pra coisas globais (providers, a única inscrição de realtime do
// app, espelhar a sessão do Supabase no auth-store) sem precisar duplicar
// isso em cada tela.
const queryClient = new QueryClient();

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
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      useAuthStore.getState().definirUsuarioId(data.session?.user?.id ?? null);
    });

    const { data: assinatura } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      useAuthStore.getState().definirUsuarioId(sessao?.user?.id ?? null);
    });

    return () => {
      assinatura.subscription.unsubscribe();
    };
  }, []);

  return null;
}

export default function RootLayout() {
  const colorScheme = useResolvedColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AssinaturaAutenticacao />
        <AssinaturaMensagens />
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack screenOptions={{ headerShown: false }} />
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

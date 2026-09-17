import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { useAuthStore } from '@/stores/auth-store';

// Rota raiz ("/") e âncora do <Stack.Protected> do _layout: além de ser a
// primeira tela ao abrir o app, é pra cá que o expo-router manda quem tenta
// acessar uma tela protegida sem permissão (deeplink com o app deslogado,
// sessão expirada no meio do uso). Não tem UI própria além do spinner.
//
// Lê o auth-store em vez de chamar getSession() direto: assim reage a
// logout e expiração de token, e não só ao primeiro carregamento.
export default function Gate() {
  const router = useRouter();
  const theme = useTheme();
  const usuarioId = useAuthStore((estado) => estado.usuarioId);
  const carregando = useAuthStore((estado) => estado.carregando);

  useEffect(() => {
    if (carregando) return;
    router.replace(usuarioId ? '/home' : '/login');
  }, [carregando, usuarioId, router]);

  return (
    <ThemedView style={styles.container}>
      <StatusBar style="auto" />
      <ActivityIndicator color={theme.primary} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

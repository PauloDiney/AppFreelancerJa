import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/services/supabaseClient';

export default function Gate() {
  const router = useRouter();
  const theme = useTheme();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      router.replace(data.session ? '/home' : '/login');
    });
  }, [router]);

  return (
    <ThemedView style={styles.container}>
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

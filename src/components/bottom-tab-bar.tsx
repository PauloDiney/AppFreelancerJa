import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/services/supabaseClient';
import { contarNaoLidas } from '@/utils/chat';

export type TabKey = 'inicio' | 'buscar' | 'chat' | 'perfil';

const TABS: { key: TabKey; label: string; icone: keyof typeof Ionicons.glyphMap; rota?: '/home' | '/buscar' | '/perfil' | '/chat' }[] = [
  { key: 'inicio', label: 'Início', icone: 'home', rota: '/home' },
  { key: 'buscar', label: 'Buscar', icone: 'search-outline', rota: '/buscar' },
  { key: 'chat', label: 'Chat', icone: 'chatbubble-outline', rota: '/chat' },
  { key: 'perfil', label: 'Perfil', icone: 'person-outline', rota: '/perfil' },
];

export function BottomTabBar({ ativo }: { ativo: TabKey }) {
  const theme = useTheme();
  const router = useRouter();

  const usuarioQuery = useQuery({
    queryKey: ['usuario-logado'],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    },
  });
  const usuarioId = usuarioQuery.data?.id;

  const naoLidasQuery = useQuery({
    queryKey: ['total-nao-lidas', usuarioId],
    queryFn: () => contarNaoLidas(usuarioId!),
    enabled: !!usuarioId,
  });

  return (
    <SafeAreaView edges={['bottom']} style={[styles.tabBar, { backgroundColor: theme.background, borderTopColor: theme.backgroundSelected }]}>
      {TABS.slice(0, 2).map((tab) => (
        <TabItem key={tab.key} tab={tab} ativo={ativo === tab.key} />
      ))}

      <Pressable style={styles.tabItem} onPress={() => router.push('/criar-bico')}>
        <View style={[styles.tabCentral, { backgroundColor: theme.primary }]}>
          <Ionicons name="add" size={24} color={theme.background} />
        </View>
      </Pressable>

      {TABS.slice(2).map((tab) => (
        <TabItem
          key={tab.key}
          tab={tab}
          ativo={ativo === tab.key}
          badge={tab.key === 'chat' ? naoLidasQuery.data : undefined}
        />
      ))}
    </SafeAreaView>
  );
}

function TabItem({
  tab,
  ativo,
  badge,
}: {
  tab: { key: TabKey; label: string; icone: keyof typeof Ionicons.glyphMap; rota?: '/home' | '/buscar' | '/perfil' | '/chat' };
  ativo: boolean;
  badge?: number;
}) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Pressable style={styles.tabItem} onPress={tab.rota ? () => router.push(tab.rota!) : undefined}>
      <View>
        <Ionicons name={tab.icone} size={20} color={ativo ? theme.primary : theme.textSecondary} />
        {!!badge && (
          <View style={[styles.badge, { backgroundColor: theme.statusDanger }]}>
            <ThemedText type="small" themeColor="background" style={styles.badgeTexto}>
              {badge > 9 ? '9+' : badge}
            </ThemedText>
          </View>
        )}
      </View>
      <ThemedText type="small" themeColor={ativo ? 'primary' : 'textSecondary'}>
        {tab.label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: Spacing.two,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
  },
  tabCentral: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -Spacing.four,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeTexto: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
  },
});

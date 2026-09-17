import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabBar } from '@/components/bottom-tab-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useBicosAbertos } from '@/hooks/use-bicos-abertos';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/services/supabaseClient';
import { AVATAR_PALETTE, calcularBadge, formatarValor, iniciais, tempoRelativo } from '@/utils/bico';

type Categoria = {
  id: number;
  nome: string;
};

// Feed inicial (tab "Início"): lista os 15 bicos abertos mais recentes,
// com filtro por categoria e busca por título aplicados só no cliente sobre
// esse mesmo lote de 15 — não é uma busca no banco. Pra buscar entre todos
// os bicos abertos, é a tela /buscar.
export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [categoriaSelecionada, setCategoriaSelecionada] = useState<number | null>(null);
  const [busca, setBusca] = useState('');

  const perfilQuery = useQuery({
    queryKey: ['perfil-logado'],
    queryFn: async () => {
      const { data: sessao } = await supabase.auth.getUser();
      if (!sessao.user) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('nome_completo')
        .eq('id', sessao.user.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const categoriasQuery = useQuery({
    queryKey: ['categorias'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categorias').select('id, nome').order('id');
      if (error) throw error;
      return data as Categoria[];
    },
  });

  const bicosQuery = useBicosAbertos(15);

  const bicosFiltrados = useMemo(() => {
    const lista = bicosQuery.data ?? [];
    return lista.filter((bico) => {
      const bateCategoria = categoriaSelecionada == null || bico.categoria_id === categoriaSelecionada;
      const bateBusca = busca.trim().length === 0 || bico.titulo.toLowerCase().includes(busca.trim().toLowerCase());
      return bateCategoria && bateBusca;
    });
  }, [bicosQuery.data, categoriaSelecionada, busca]);

  const primeiroNome = perfilQuery.data?.nome_completo?.split(' ')[0];
  const carregando = perfilQuery.isLoading || categoriasQuery.isLoading || bicosQuery.isLoading;

  return (
    <ThemedView style={styles.container}>
      <StatusBar style="light" />
      <View style={[styles.hero, { backgroundColor: theme.primary }]}>
        <SafeAreaView edges={['top']} style={styles.heroContent}>
          <View style={styles.heroTopRow}>
            <View>
              <ThemedText type="small" themeColor="background" style={styles.heroSubtitle}>
                Tô Dentro
              </ThemedText>
              <ThemedText type="title" themeColor="background" style={styles.heroTitle}>
                E aí{primeiroNome ? `, ${primeiroNome}` : ''}!
              </ThemedText>
            </View>
            <View style={[styles.avatarHero, { backgroundColor: theme.background }]}>
              <ThemedText type="smallBold" themeColor="primary">
                {iniciais(perfilQuery.data?.nome_completo ?? null)}
              </ThemedText>
            </View>
          </View>

          <View style={[styles.searchRow, { backgroundColor: theme.background }]}>
            <Ionicons name="search" size={18} color={theme.textSecondary} />
            <TextInput
              value={busca}
              onChangeText={setBusca}
              placeholder="Buscar bico..."
              placeholderTextColor={theme.textSecondary}
              style={[styles.searchInput, { color: theme.text }]}
            />
          </View>
        </SafeAreaView>
      </View>

      {carregando ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            <Pressable
              style={[
                styles.chip,
                { backgroundColor: categoriaSelecionada == null ? theme.primary : theme.backgroundSelected },
              ]}
              onPress={() => setCategoriaSelecionada(null)}
            >
              <ThemedText type="smallBold" themeColor={categoriaSelecionada == null ? 'background' : 'textSecondary'}>
                Todos
              </ThemedText>
            </Pressable>
            {categoriasQuery.data?.map((categoria) => (
              <Pressable
                key={categoria.id}
                style={[
                  styles.chip,
                  { backgroundColor: categoriaSelecionada === categoria.id ? theme.primary : theme.backgroundSelected },
                ]}
                onPress={() => setCategoriaSelecionada(categoria.id)}
              >
                <ThemedText
                  type="smallBold"
                  themeColor={categoriaSelecionada === categoria.id ? 'background' : 'textSecondary'}
                >
                  {categoria.nome}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.sectionHeader}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Em destaque
            </ThemedText>
            <Pressable onPress={() => router.push('/buscar')}>
              <ThemedText type="smallBold" themeColor="primary">
                Ver tudo
              </ThemedText>
            </Pressable>
          </View>

          {bicosFiltrados.length === 0 ? (
            <View style={styles.vazio}>
              <ThemedText themeColor="textSecondary" style={styles.centerText}>
                Nenhum bico por aqui ainda.
              </ThemedText>
            </View>
          ) : (
            bicosFiltrados.map((bico, index) => {
              const destaque = index === 0;
              const badge = calcularBadge(bico.data_hora_desejada);
              const paleta = AVATAR_PALETTE[index % AVATAR_PALETTE.length];

              return (
                <Pressable
                  key={bico.id}
                  style={[
                    styles.card,
                    { backgroundColor: destaque ? theme.text : theme.backgroundElement },
                  ]}
                  onPress={() => router.push({ pathname: '/bico/[id]', params: { id: bico.id } })}
                >
                  <View style={styles.cardTopRow}>
                    {!destaque && (
                      <View style={[styles.avatarCard, { backgroundColor: paleta.bg }]}>
                        <ThemedText type="smallBold" themeColor={paleta.text}>
                          {iniciais(bico.profiles?.nome_completo ?? null)}
                        </ThemedText>
                      </View>
                    )}
                    <View style={styles.cardTitleBlock}>
                      <ThemedText
                        type="smallBold"
                        themeColor={destaque ? 'background' : 'text'}
                        style={styles.cardTitle}
                      >
                        {bico.titulo}
                      </ThemedText>
                      <ThemedText type="small" themeColor={destaque ? 'backgroundSelected' : 'textSecondary'}>
                        {bico.profiles?.nome_completo ?? 'Alguém'} · ★{' '}
                        {bico.profiles?.nota_media_como_contratante?.toFixed(1) ?? '—'}
                      </ThemedText>
                    </View>
                    {badge && (
                      <View style={[styles.badge, { backgroundColor: theme[badge.cor] }]}>
                        <ThemedText type="small" themeColor="background" style={styles.badgeText}>
                          {badge.texto}
                        </ThemedText>
                      </View>
                    )}
                  </View>

                  <View style={styles.cardBottomRow}>
                    <ThemedText type="small" themeColor={destaque ? 'backgroundSelected' : 'textSecondary'}>
                      {bico.endereco_texto ?? 'Endereço a combinar'} · {tempoRelativo(bico.criado_em)}
                    </ThemedText>
                    <ThemedText type="smallBold" themeColor={destaque ? 'background' : 'text'}>
                      {formatarValor(bico.valor_oferecido)}
                    </ThemedText>
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}

      <BottomTabBar ativo="inicio" />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hero: {
    borderBottomLeftRadius: Spacing.five,
    borderBottomRightRadius: Spacing.five,
  },
  heroContent: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  heroSubtitle: {
    opacity: 0.85,
  },
  heroTitle: {
    fontSize: 24,
    lineHeight: 30,
  },
  avatarHero: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  chipsRow: {
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
  },
  vazio: {
    paddingVertical: Spacing.five,
  },
  centerText: {
    textAlign: 'center',
  },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  avatarCard: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitleBlock: {
    flex: 1,
    gap: Spacing.half,
  },
  cardTitle: {
    fontSize: 16,
  },
  badge: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  badgeText: {
    fontWeight: '700',
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});

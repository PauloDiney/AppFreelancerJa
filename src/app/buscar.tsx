import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabBar } from '@/components/bottom-tab-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/services/supabaseClient';
import { formatarValor, iniciais, tempoRelativo } from '@/utils/bico';

type Categoria = {
  id: number;
  nome: string;
  icone: string | null;
};

type Bico = {
  id: string;
  titulo: string;
  valor_oferecido: number | null;
  endereco_texto: string | null;
  criado_em: string;
  categoria_id: number | null;
  profiles: {
    nome_completo: string | null;
    nota_media_como_prestador: number | null;
  } | null;
};

type Ordenacao = 'recentes' | 'menor' | 'maior';

const ORDENACAO_LABEL: Record<Ordenacao, string> = {
  recentes: 'mais recentes',
  menor: 'menor valor',
  maior: 'maior valor',
};

const CATEGORIA_CORES = [
  { bg: '#E1EAFB', cor: '#1E5FCC' },
  { bg: '#FBEFD6', cor: '#C98A1B' },
  { bg: '#DCEFE1', cor: '#2E9E5B' },
  { bg: '#EDE1FB', cor: '#7C4FD1' },
  { bg: '#FBE1E1', cor: '#E53935' },
];
const COR_TUDO = { bg: '#E8E8E8', cor: '#5B6472' };

// Tela de busca (tab "Buscar"): busca por título, filtro por categoria e
// ordenação por valor/recência — tudo aplicado no cliente sobre os 30 bicos
// abertos mais recentes buscados do banco, não é uma query de busca real no
// servidor. Botão de "Filtros avançados" ainda não foi implementado.
export default function BuscarScreen() {
  const theme = useTheme();
  const [busca, setBusca] = useState('');
  const [categoriaSelecionada, setCategoriaSelecionada] = useState<number | null>(null);
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('recentes');

  const categoriasQuery = useQuery({
    queryKey: ['categorias'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categorias').select('id, nome, icone').order('id');
      if (error) throw error;
      return data as Categoria[];
    },
  });

  const bicosQuery = useQuery({
    queryKey: ['bicos-destaque'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bicos')
        .select(
          'id, titulo, valor_oferecido, endereco_texto, criado_em, categoria_id, profiles!bicos_criado_por_fkey(nome_completo, nota_media_como_prestador)'
        )
        .eq('status', 'aberto')
        .order('criado_em', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as unknown as Bico[];
    },
  });

  const resultados = useMemo(() => {
    const lista = (bicosQuery.data ?? []).filter((bico) => {
      const bateCategoria = categoriaSelecionada == null || bico.categoria_id === categoriaSelecionada;
      const bateBusca = busca.trim().length === 0 || bico.titulo.toLowerCase().includes(busca.trim().toLowerCase());
      return bateCategoria && bateBusca;
    });

    return [...lista].sort((a, b) => {
      if (ordenacao === 'menor') return (a.valor_oferecido ?? 0) - (b.valor_oferecido ?? 0);
      if (ordenacao === 'maior') return (b.valor_oferecido ?? 0) - (a.valor_oferecido ?? 0);
      return b.criado_em.localeCompare(a.criado_em);
    });
  }, [bicosQuery.data, categoriaSelecionada, busca, ordenacao]);

  const proximaOrdenacao = () => {
    setOrdenacao((atual) => (atual === 'recentes' ? 'menor' : atual === 'menor' ? 'maior' : 'recentes'));
  };

  const carregando = categoriasQuery.isLoading || bicosQuery.isLoading;

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.hero, { backgroundColor: theme.primary }]}>
        <SafeAreaView edges={['top']} style={styles.heroContent}>
          <ThemedText type="subtitle" themeColor="background" style={styles.heroTitle}>
            Buscar
          </ThemedText>

          <View style={styles.searchRow}>
            <View style={[styles.searchBox, { backgroundColor: theme.background }]}>
              <Ionicons name="search" size={18} color={theme.textSecondary} />
              <TextInput
                value={busca}
                onChangeText={setBusca}
                placeholder="O que você precisa?"
                placeholderTextColor={theme.textSecondary}
                style={[styles.searchInput, { color: theme.text }]}
              />
              {busca.length > 0 && (
                <Pressable onPress={() => setBusca('')}>
                  <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
                </Pressable>
              )}
            </View>
            <Pressable
              style={[styles.filterButton, { backgroundColor: 'rgba(255,255,255,0.25)' }]}
              onPress={() => Alert.alert('Filtros avançados', 'Em breve: distância, faixa de preço e data.')}
            >
              <FontAwesome5 name="sliders-h" size={16} color={theme.background} />
            </Pressable>
          </View>
        </SafeAreaView>
      </View>

      {carregando ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.field}>
            <ThemedText type="smallBold">Categorias</ThemedText>
            <View style={styles.categoriasGrid}>
              <CategoriaTile
                nome="Tudo"
                icone="ellipsis-h"
                cores={COR_TUDO}
                selecionada={categoriaSelecionada == null}
                onPress={() => setCategoriaSelecionada(null)}
              />
              {categoriasQuery.data?.map((categoria, index) => (
                <CategoriaTile
                  key={categoria.id}
                  nome={categoria.nome}
                  icone={categoria.icone ?? 'briefcase'}
                  cores={CATEGORIA_CORES[index % CATEGORIA_CORES.length]}
                  selecionada={categoriaSelecionada === categoria.id}
                  onPress={() => setCategoriaSelecionada(categoria.id)}
                />
              ))}
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <ThemedText type="smallBold">Resultados · {resultados.length}</ThemedText>
            <Pressable style={styles.ordenarButton} onPress={proximaOrdenacao}>
              <ThemedText type="small" themeColor="textSecondary">
                {ORDENACAO_LABEL[ordenacao]}
              </ThemedText>
              <Ionicons name="chevron-down" size={14} color={theme.textSecondary} />
            </Pressable>
          </View>

          {resultados.length === 0 ? (
            <ThemedText themeColor="textSecondary" style={styles.centerText}>
              Nenhum bico encontrado.
            </ThemedText>
          ) : (
            resultados.map((bico, index) => {
              const paleta = CATEGORIA_CORES[index % CATEGORIA_CORES.length];
              return (
                <View key={bico.id} style={[styles.card, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
                  <View style={[styles.avatar, { backgroundColor: paleta.bg }]}>
                    <ThemedText type="smallBold" style={{ color: paleta.cor }}>
                      {iniciais(bico.profiles?.nome_completo ?? null)}
                    </ThemedText>
                  </View>
                  <View style={styles.cardInfo}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {bico.titulo}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {bico.profiles?.nome_completo ?? 'Alguém'} · ★ {bico.profiles?.nota_media_como_prestador?.toFixed(1) ?? '—'}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {bico.endereco_texto ?? 'Endereço a combinar'} · {tempoRelativo(bico.criado_em)}
                    </ThemedText>
                  </View>
                  <ThemedText type="smallBold">{formatarValor(bico.valor_oferecido)}</ThemedText>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <BottomTabBar ativo="buscar" />
    </ThemedView>
  );
}

function CategoriaTile({
  nome,
  icone,
  cores,
  selecionada,
  onPress,
}: {
  nome: string;
  icone: string;
  cores: { bg: string; cor: string };
  selecionada: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable style={styles.categoriaTile} onPress={onPress}>
      <View
        style={[
          styles.categoriaIcone,
          { backgroundColor: cores.bg },
          selecionada && { borderWidth: 2, borderColor: theme.primary },
        ]}
      >
        <FontAwesome5 name={icone} size={20} color={cores.cor} solid />
      </View>
      <ThemedText type="small" themeColor={selecionada ? 'primary' : 'text'} numberOfLines={1}>
        {nome}
      </ThemedText>
    </Pressable>
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
  heroTitle: {
    fontSize: 26,
  },
  searchRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  searchBox: {
    flex: 1,
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
  filterButton: {
    width: 48,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: Spacing.four,
    gap: Spacing.four,
  },
  field: {
    gap: Spacing.three,
  },
  categoriasGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  categoriaTile: {
    width: '22%',
    alignItems: 'center',
    gap: Spacing.two,
  },
  categoriaIcone: {
    width: 56,
    height: 56,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ordenarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  centerText: {
    textAlign: 'center',
    paddingTop: Spacing.five,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    flex: 1,
    gap: Spacing.half,
  },
});

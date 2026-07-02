import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabBar } from '@/components/bottom-tab-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useEstatisticasPerfil } from '@/hooks/use-estatisticas-perfil';
import { useTheme } from '@/hooks/use-theme';
import { useUsuarioLogado } from '@/hooks/use-usuario-logado';
import { supabase } from '@/services/supabaseClient';
import { AVATAR_PALETTE, formatarDataCurta, formatarGanhos, formatarMesAno, formatarQuando, formatarValor, iniciais } from '@/utils/bico';
import { abrirConversa } from '@/utils/chat';
import { mensagemErro } from '@/utils/erros';

type StatusHistorico = 'em_andamento' | 'concluido' | 'cancelado';
type Filtro = 'todos' | 'em_andamento' | 'concluido';

type BicoHistorico = {
  id: string;
  titulo: string;
  status: StatusHistorico;
  valor_oferecido: number | null;
  forma_pagamento: 'dinheiro' | 'pix';
  data_hora_desejada: string | null;
  atualizado_em: string;
  criado_por: string;
  profiles: { nome_completo: string | null } | null;
};

function badgeStatus(status: StatusHistorico) {
  if (status === 'em_andamento') return { texto: 'A PAGAR', cor: 'statusPending' as const };
  if (status === 'concluido') return { texto: '✓ PAGO', cor: 'statusSuccess' as const };
  return { texto: 'CANCELADO', cor: 'textSecondary' as const };
}

export default function HistoricoBicosScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [abrindoConversa, setAbrindoConversa] = useState(false);

  const usuarioQuery = useUsuarioLogado();
  const usuarioId = usuarioQuery.data?.id;

  const estatisticas = useEstatisticasPerfil(usuarioId);

  const historicoQuery = useQuery({
    queryKey: ['historico-bicos', usuarioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bicos')
        .select(
          'id, titulo, status, valor_oferecido, forma_pagamento, data_hora_desejada, atualizado_em, criado_por, profiles!bicos_criado_por_fkey(nome_completo)'
        )
        .eq('candidato_selecionado_id', usuarioId)
        .in('status', ['em_andamento', 'concluido', 'cancelado'])
        .order('atualizado_em', { ascending: false });
      if (error) throw error;
      return data as unknown as BicoHistorico[];
    },
    enabled: !!usuarioId,
  });

  const minhasAvaliacoesQuery = useQuery({
    queryKey: ['minhas-avaliacoes-dadas', usuarioId],
    queryFn: async () => {
      const { data, error } = await supabase.from('avaliacoes').select('bico_id, nota').eq('avaliador_id', usuarioId);
      if (error) throw error;
      return data;
    },
    enabled: !!usuarioId,
  });

  const notaPorBico = useMemo(() => {
    const mapa = new Map<string, number>();
    minhasAvaliacoesQuery.data?.forEach((avaliacao) => mapa.set(avaliacao.bico_id, avaliacao.nota));
    return mapa;
  }, [minhasAvaliacoesQuery.data]);

  const filtrados = useMemo(() => {
    const lista = historicoQuery.data ?? [];
    if (filtro === 'todos') return lista;
    return lista.filter((bico) => bico.status === filtro);
  }, [historicoQuery.data, filtro]);

  const { emAndamento, grupos } = useMemo(() => {
    const emAndamento = filtrados.filter((bico) => bico.status === 'em_andamento');
    const outros = filtrados.filter((bico) => bico.status !== 'em_andamento');
    const grupos: { titulo: string; itens: BicoHistorico[] }[] = [];
    outros.forEach((bico) => {
      const chave = formatarMesAno(bico.atualizado_em);
      const grupoExistente = grupos.find((g) => g.titulo === chave);
      if (grupoExistente) grupoExistente.itens.push(bico);
      else grupos.push({ titulo: chave, itens: [bico] });
    });
    return { emAndamento, grupos };
  }, [filtrados]);

  const avaliarAgora = async (bicoId: string, contratanteId: string) => {
    if (!usuarioId) return;
    setAbrindoConversa(true);
    try {
      const conversaId = await abrirConversa(bicoId, usuarioId, contratanteId);
      router.push({ pathname: '/chat/[id]', params: { id: conversaId } });
    } catch (erro) {
      Alert.alert('Não foi possível abrir a conversa', mensagemErro(erro as Error, 'abrir a conversa'));
    } finally {
      setAbrindoConversa(false);
    }
  };

  const carregando = usuarioQuery.isLoading || historicoQuery.isLoading;

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.hero, { backgroundColor: theme.primary }]}>
        <SafeAreaView edges={['top']} style={styles.heroContent}>
          <View style={styles.heroTopRow}>
            <Pressable style={[styles.backButton, { backgroundColor: 'rgba(255,255,255,0.25)' }]} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={20} color={theme.background} />
            </Pressable>
            <ThemedText type="subtitle" themeColor="background" style={styles.heroTitle}>
              Histórico de bicos
            </ThemedText>
          </View>

          <View style={styles.statsRow}>
            <View style={[styles.statBox, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
              <ThemedText type="subtitle" themeColor="background" style={styles.statValor}>
                {estatisticas.totalBicos}
              </ThemedText>
              <ThemedText type="small" themeColor="backgroundSelected">
                CONCLUÍDOS
              </ThemedText>
            </View>
            <View style={[styles.statBox, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
              <ThemedText type="subtitle" themeColor="background" style={styles.statValor}>
                {formatarGanhos(estatisticas.totalGanhos)}
              </ThemedText>
              <ThemedText type="small" themeColor="backgroundSelected">
                RECEBIDO
              </ThemedText>
            </View>
            <View style={[styles.statBox, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
              <ThemedText type="subtitle" themeColor="background" style={styles.statValor}>
                {estatisticas.nota?.toFixed(1) ?? '—'}
              </ThemedText>
              <ThemedText type="small" themeColor="backgroundSelected">
                NOTA MÉDIA
              </ThemedText>
            </View>
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.filtros}>
        {(
          [
            { key: 'todos', label: 'Todos' },
            { key: 'em_andamento', label: 'Em andamento' },
            { key: 'concluido', label: 'Concluídos' },
          ] as { key: Filtro; label: string }[]
        ).map((item) => (
          <Pressable
            key={item.key}
            style={[styles.chip, { backgroundColor: filtro === item.key ? theme.primary : theme.backgroundSelected }]}
            onPress={() => setFiltro(item.key)}
          >
            <ThemedText type="smallBold" themeColor={filtro === item.key ? 'background' : 'textSecondary'}>
              {item.label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {carregando ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {filtrados.length === 0 && (
            <ThemedText themeColor="textSecondary" style={styles.centerText}>
              Nenhum bico por aqui ainda.
            </ThemedText>
          )}

          {!!emAndamento.length && (
            <View style={styles.field}>
              <ThemedText type="small" themeColor="textSecondary">
                AGORA
              </ThemedText>
              {emAndamento.map((bico) => {
                const badge = badgeStatus(bico.status);
                return (
                  <Pressable
                    key={bico.id}
                    style={[styles.cardEscuro, { backgroundColor: theme.text }]}
                    onPress={() => router.push({ pathname: '/bico/[id]', params: { id: bico.id } })}
                  >
                    <View style={styles.linhaTopo}>
                      <View style={[styles.avatar, { backgroundColor: theme.background }]}>
                        <ThemedText type="smallBold" themeColor="primary">
                          {iniciais(bico.profiles?.nome_completo ?? null)}
                        </ThemedText>
                      </View>
                      <View style={styles.flex1}>
                        <ThemedText type="smallBold" themeColor="background">
                          {bico.titulo}
                        </ThemedText>
                        <ThemedText type="small" themeColor="backgroundSelected">
                          {bico.profiles?.nome_completo ?? 'Contratante'} · {formatarQuando(bico.data_hora_desejada)}
                        </ThemedText>
                      </View>
                      <View style={[styles.badge, { backgroundColor: theme[badge.cor] }]}>
                        <ThemedText type="small" themeColor="background" style={styles.badgeTexto}>
                          {badge.texto}
                        </ThemedText>
                      </View>
                    </View>
                    <View style={[styles.divisor, { borderTopColor: 'rgba(255,255,255,0.15)' }]} />
                    <View style={styles.linhaBase}>
                      <ThemedText type="small" themeColor="backgroundSelected">
                        {bico.forma_pagamento === 'pix' ? 'Pix' : 'Dinheiro'} · aguardando
                      </ThemedText>
                      <ThemedText type="smallBold" themeColor="background">
                        {formatarValor(bico.valor_oferecido)}
                      </ThemedText>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {grupos.map((grupo) => (
            <View key={grupo.titulo} style={styles.field}>
              <ThemedText type="small" themeColor="textSecondary">
                {grupo.titulo}
              </ThemedText>
              {grupo.itens.map((bico, index) => {
                const badge = badgeStatus(bico.status);
                const paleta = bico.status === 'cancelado' ? { bg: theme.backgroundSelected, text: 'textSecondary' as const } : AVATAR_PALETTE[index % AVATAR_PALETTE.length];
                const minhaNota = notaPorBico.get(bico.id);

                return (
                  <Pressable
                    key={bico.id}
                    style={[styles.cardClaro, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}
                    onPress={() => router.push({ pathname: '/bico/[id]', params: { id: bico.id } })}
                  >
                    <View style={styles.linhaTopo}>
                      <View style={[styles.avatar, { backgroundColor: paleta.bg }]}>
                        <ThemedText type="smallBold" themeColor={paleta.text}>
                          {iniciais(bico.profiles?.nome_completo ?? null)}
                        </ThemedText>
                      </View>
                      <View style={styles.flex1}>
                        <ThemedText type="smallBold" numberOfLines={1}>
                          {bico.titulo}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                          {bico.profiles?.nome_completo ?? 'Contratante'} · {formatarDataCurta(bico.atualizado_em)}
                        </ThemedText>
                      </View>
                      <View style={[styles.badgeClaro, { backgroundColor: theme.backgroundElement }]}>
                        <ThemedText type="small" themeColor={badge.cor} style={styles.badgeTexto}>
                          {badge.texto}
                        </ThemedText>
                      </View>
                    </View>
                    <View style={[styles.divisor, { borderTopColor: theme.backgroundSelected }]} />
                    <View style={styles.linhaBase}>
                      {bico.status === 'cancelado' ? (
                        <ThemedText type="small" themeColor="textSecondary">
                          Sem pagamento
                        </ThemedText>
                      ) : minhaNota ? (
                        <ThemedText type="small" themeColor="textSecondary">
                          {'★'.repeat(minhaNota)}
                          {'☆'.repeat(5 - minhaNota)} você avaliou
                        </ThemedText>
                      ) : (
                        <Pressable
                          disabled={abrindoConversa}
                          onPress={(evento) => {
                            evento.stopPropagation();
                            avaliarAgora(bico.id, bico.criado_por);
                          }}
                        >
                          <ThemedText type="smallBold" themeColor="primary">
                            Avaliar agora →
                          </ThemedText>
                        </Pressable>
                      )}
                      <ThemedText type="smallBold">{formatarValor(bico.valor_oferecido)}</ThemedText>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}

      <BottomTabBar ativo="perfil" />
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
    alignItems: 'center',
    gap: Spacing.three,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: 22,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  statBox: {
    flex: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    gap: Spacing.half,
  },
  statValor: {
    fontSize: 18,
    lineHeight: 22,
  },
  filtros: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
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
  centerText: {
    textAlign: 'center',
    paddingTop: Spacing.five,
  },
  field: {
    gap: Spacing.two,
  },
  flex1: {
    flex: 1,
  },
  cardEscuro: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardClaro: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  linhaTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  badgeClaro: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  badgeTexto: {
    fontWeight: '700',
  },
  divisor: {
    borderTopWidth: 1,
  },
  linhaBase: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});

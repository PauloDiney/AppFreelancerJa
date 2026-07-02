import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useUsuarioLogado } from '@/hooks/use-usuario-logado';
import { supabase } from '@/services/supabaseClient';
import { AVATAR_PALETTE, calcularBadge, formatarQuando, formatarValor, iniciais } from '@/utils/bico';
import { abrirConversa } from '@/utils/chat';
import { mensagemErro } from '@/utils/erros';

type Bico = {
  id: string;
  titulo: string;
  descricao: string | null;
  valor_oferecido: number | null;
  endereco_texto: string | null;
  data_hora_desejada: string | null;
  forma_pagamento: 'dinheiro' | 'pix';
  status: 'aberto' | 'em_andamento' | 'concluido' | 'cancelado';
  criado_por: string;
  candidato_selecionado_id: string | null;
  profiles: {
    nome_completo: string | null;
    nota_media_como_contratante: number | null;
  } | null;
};

type Candidatura = {
  id: string;
  candidato_id: string;
  status: 'pendente' | 'aceita' | 'recusada' | 'retirada';
  profiles: {
    nome_completo: string | null;
    nota_media_como_prestador: number | null;
    total_bicos_como_prestador: number | null;
  } | null;
};

// Tela de detalhe de um bico. O conteúdo muda bastante dependendo de quem
// está olhando: quem criou o bico (souCriador) vê a lista de candidatos e
// pode escolher um; quem não criou vê o próprio status de candidatura
// (pendente/aceita/recusada) e o botão de se candidatar.
export default function BicoDetalheScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [processando, setProcessando] = useState(false);
  const [abrindoConversa, setAbrindoConversa] = useState(false);

  const usuarioQuery = useUsuarioLogado();

  const bicoQuery = useQuery({
    queryKey: ['bico', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bicos')
        .select(
          'id, titulo, descricao, valor_oferecido, endereco_texto, data_hora_desejada, forma_pagamento, status, criado_por, candidato_selecionado_id, profiles!bicos_criado_por_fkey(nome_completo, nota_media_como_contratante)'
        )
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as unknown as Bico;
    },
    enabled: !!id,
  });

  const usuarioId = usuarioQuery.data?.id;
  const souCriador = !!usuarioId && !!bicoQuery.data && usuarioId === bicoQuery.data.criado_por;

  const candidaturasQuery = useQuery({
    queryKey: ['candidaturas', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidaturas')
        .select('id, candidato_id, status, profiles(nome_completo, nota_media_como_prestador, total_bicos_como_prestador)')
        .eq('bico_id', id);
      if (error) throw error;
      const lista = data as unknown as Candidatura[];
      // Ordena por nota decrescente (candidatos sem nota ainda ficam por
      // último) — é essa ordem que define quem aparece com o botão
      // "Escolher" direto (index 0) e quem cai no fluxo de confirmação.
      return [...lista].sort(
        (a, b) => (b.profiles?.nota_media_como_prestador ?? 0) - (a.profiles?.nota_media_como_prestador ?? 0)
      );
    },
    enabled: souCriador,
  });

  const minhaCandidaturaQuery = useQuery({
    queryKey: ['minha-candidatura', id, usuarioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidaturas')
        .select('id, status')
        .eq('bico_id', id)
        .eq('candidato_id', usuarioId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !souCriador && !!usuarioId && !!bicoQuery.data,
  });

  const atualizarTudo = () => {
    queryClient.invalidateQueries({ queryKey: ['bico', id] });
    queryClient.invalidateQueries({ queryKey: ['candidaturas', id] });
    queryClient.invalidateQueries({ queryKey: ['minha-candidatura', id, usuarioId] });
    queryClient.invalidateQueries({ queryKey: ['bicos-destaque'] });
  };

  const escolherCandidato = async (candidatoId: string) => {
    setProcessando(true);
    // RPC no banco (não um update direto) porque escolher um candidato é
    // uma transação com 3 passos — aceitar essa candidatura, recusar as
    // outras pendentes e marcar o bico como em_andamento — que precisam
    // acontecer juntos ou não acontecer (ver migration 0004).
    const { error } = await supabase.rpc('escolher_candidato', {
      p_bico_id: id,
      p_candidato_id: candidatoId,
    });
    setProcessando(false);

    if (error) {
      Alert.alert('Não foi possível escolher', mensagemErro(error, 'escolher este candidato'));
      return;
    }
    atualizarTudo();
  };

  const confirmarEscolha = (nome: string, candidatoId: string) => {
    Alert.alert('Escolher candidato', `Escolher ${nome} para este bico?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Escolher', onPress: () => escolherCandidato(candidatoId) },
    ]);
  };

  const iniciarConversa = async (outroId: string) => {
    if (!usuarioId || !id) return;
    setAbrindoConversa(true);
    try {
      const conversaId = await abrirConversa(id, usuarioId, outroId);
      router.push({ pathname: '/chat/[id]', params: { id: conversaId } });
    } catch (erro) {
      Alert.alert('Não foi possível abrir a conversa', mensagemErro(erro as Error, 'abrir a conversa'));
    } finally {
      setAbrindoConversa(false);
    }
  };

  const candidatarSe = async () => {
    if (!usuarioId) return;
    setProcessando(true);
    const { error } = await supabase.from('candidaturas').insert({ bico_id: id, candidato_id: usuarioId });
    setProcessando(false);

    if (error) {
      Alert.alert('Não foi possível se candidatar', mensagemErro(error, 'se candidatar'));
      return;
    }
    atualizarTudo();
  };

  if (bicoQuery.isLoading || !bicoQuery.data) {
    return (
      <ThemedView style={styles.loading}>
        <ActivityIndicator color={theme.primary} />
      </ThemedView>
    );
  }

  const bico = bicoQuery.data;
  const badge = calcularBadge(bico.data_hora_desejada);

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.hero, { backgroundColor: theme.primary }]}>
        <SafeAreaView edges={['top']} style={styles.heroContent}>
          <View style={styles.heroTopRow}>
            <Pressable style={[styles.backButton, { backgroundColor: 'rgba(255,255,255,0.25)' }]} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={20} color={theme.background} />
            </Pressable>
            {badge && (
              <View style={[styles.badge, { backgroundColor: theme[badge.cor] }]}>
                <ThemedText type="small" themeColor="background" style={styles.badgeText}>
                  {badge.texto}
                </ThemedText>
              </View>
            )}
          </View>

          <ThemedText type="subtitle" themeColor="background" style={styles.heroTitle}>
            {bico.titulo}
          </ThemedText>

          <View style={styles.heroBottomRow}>
            <View style={styles.heroCreatorRow}>
              <View style={[styles.avatar, { backgroundColor: theme.background }]}>
                <ThemedText type="smallBold" themeColor="primary">
                  {iniciais(bico.profiles?.nome_completo ?? null)}
                </ThemedText>
              </View>
              <View>
                <ThemedText type="smallBold" themeColor="background">
                  {bico.profiles?.nome_completo ?? 'Contratante'}
                </ThemedText>
                <ThemedText type="small" themeColor="backgroundSelected">
                  ★ {bico.profiles?.nota_media_como_contratante?.toFixed(1) ?? '—'} · contratante
                </ThemedText>
              </View>
            </View>
            <ThemedText type="title" themeColor="background" style={styles.heroValor}>
              {formatarValor(bico.valor_oferecido)}
            </ThemedText>
          </View>
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.infoRow}>
          <View style={[styles.infoBox, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <ThemedText type="small" themeColor="textSecondary">
              LOCAL
            </ThemedText>
            <ThemedText type="smallBold" numberOfLines={1}>
              {bico.endereco_texto ?? 'A combinar'}
            </ThemedText>
          </View>
          <View style={[styles.infoBox, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <ThemedText type="small" themeColor="textSecondary">
              QUANDO
            </ThemedText>
            <ThemedText type="smallBold" numberOfLines={1}>
              {formatarQuando(bico.data_hora_desejada)}
            </ThemedText>
          </View>
          <View style={[styles.infoBox, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <ThemedText type="small" themeColor="textSecondary">
              PAGTO
            </ThemedText>
            <ThemedText type="smallBold" themeColor={bico.forma_pagamento === 'pix' ? 'primary' : 'text'} numberOfLines={1}>
              {bico.forma_pagamento === 'pix' ? 'Pix' : 'Dinheiro'}
            </ThemedText>
          </View>
        </View>

        {bico.descricao && <ThemedText themeColor="textSecondary">{bico.descricao}</ThemedText>}

        {souCriador ? (
          <View style={styles.field}>
            <View style={styles.sectionHeader}>
              <ThemedText type="subtitle" style={styles.sectionTitle}>
                Candidatos · {candidaturasQuery.data?.length ?? 0}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                por avaliação
              </ThemedText>
            </View>

            {candidaturasQuery.isLoading ? (
              <ActivityIndicator color={theme.primary} />
            ) : candidaturasQuery.data?.length === 0 ? (
              <ThemedText themeColor="textSecondary">Ainda não tem candidatos.</ThemedText>
            ) : (
              candidaturasQuery.data?.map((candidatura, index) => {
                const paleta = AVATAR_PALETTE[index % AVATAR_PALETTE.length];
                const nome = candidatura.profiles?.nome_completo ?? 'Candidato';

                return (
                  <View
                    key={candidatura.id}
                    style={[styles.candidatoRow, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}
                  >
                    <View style={[styles.avatar, { backgroundColor: paleta.bg }]}>
                      <ThemedText type="smallBold" themeColor={paleta.text}>
                        {iniciais(nome)}
                      </ThemedText>
                    </View>
                    <View style={styles.candidatoInfo}>
                      <ThemedText type="smallBold">{nome}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        ★ {candidatura.profiles?.nota_media_como_prestador?.toFixed(1) ?? '—'} ·{' '}
                        {candidatura.profiles?.total_bicos_como_prestador ?? 0} bicos
                      </ThemedText>
                    </View>

                    {candidatura.status === 'aceita' ? (
                      <View style={styles.selecionadoColuna}>
                        <ThemedText type="smallBold" themeColor="statusSuccess">
                          Selecionado
                        </ThemedText>
                        <Pressable disabled={abrindoConversa} onPress={() => iniciarConversa(candidatura.candidato_id)}>
                          <ThemedText type="small" themeColor="primary">
                            Conversar
                          </ThemedText>
                        </Pressable>
                      </View>
                    ) : candidatura.status === 'recusada' ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        Recusado
                      </ThemedText>
                    ) : bico.status !== 'aberto' ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        Não selecionado
                      </ThemedText>
                    ) : index === 0 ? (
                      <Pressable
                        style={[styles.acaoBotao, { backgroundColor: theme.primary }]}
                        disabled={processando}
                        onPress={() => escolherCandidato(candidatura.candidato_id)}
                      >
                        <ThemedText type="smallBold" themeColor="background">
                          Escolher
                        </ThemedText>
                      </Pressable>
                    ) : (
                      <Pressable
                        style={[styles.acaoBotaoOutline, { borderColor: theme.primary }]}
                        disabled={processando}
                        onPress={() => confirmarEscolha(nome, candidatura.candidato_id)}
                      >
                        <ThemedText type="smallBold" themeColor="primary">
                          Ver
                        </ThemedText>
                      </Pressable>
                    )}
                  </View>
                );
              })
            )}
          </View>
        ) : (
          <View style={[styles.statusBox, { backgroundColor: theme.backgroundElement }]}>
            {minhaCandidaturaQuery.data?.status === 'aceita' ? (
              <View style={styles.field}>
                <ThemedText themeColor="statusSuccess" style={styles.centerText}>
                  Você foi escolhido! Combine os detalhes com {bico.profiles?.nome_completo ?? 'o contratante'}.
                </ThemedText>
                <Pressable
                  style={[styles.button, { backgroundColor: theme.primary }, abrindoConversa && styles.disabled]}
                  disabled={abrindoConversa}
                  onPress={() => iniciarConversa(bico.criado_por)}
                >
                  <ThemedText type="default" themeColor="background" style={styles.buttonText}>
                    Iniciar conversa
                  </ThemedText>
                </Pressable>
              </View>
            ) : minhaCandidaturaQuery.data?.status === 'recusada' ? (
              <ThemedText themeColor="textSecondary" style={styles.centerText}>
                Você não foi escolhido para esse bico.
              </ThemedText>
            ) : minhaCandidaturaQuery.data?.status === 'pendente' ? (
              <ThemedText themeColor="textSecondary" style={styles.centerText}>
                Você se candidatou — aguardando resposta do contratante.
              </ThemedText>
            ) : bico.status !== 'aberto' ? (
              <ThemedText themeColor="textSecondary" style={styles.centerText}>
                Esse bico já foi preenchido.
              </ThemedText>
            ) : (
              <Pressable
                style={[styles.button, { backgroundColor: theme.primary }, processando && styles.disabled]}
                onPress={candidatarSe}
                disabled={processando}
              >
                <ThemedText type="default" themeColor="background" style={styles.buttonText}>
                  {processando ? 'Enviando...' : 'Candidatar-se para este bico'}
                </ThemedText>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    justifyContent: 'space-between',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: 26,
    lineHeight: 32,
  },
  heroBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroCreatorRow: {
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
  heroValor: {
    fontSize: 28,
    lineHeight: 32,
  },
  badge: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  badgeText: {
    fontWeight: '700',
  },
  body: {
    padding: Spacing.four,
    gap: Spacing.four,
  },
  infoRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  infoBox: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two,
    gap: Spacing.half,
  },
  field: {
    gap: Spacing.three,
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
  candidatoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  candidatoInfo: {
    flex: 1,
    gap: Spacing.half,
  },
  selecionadoColuna: {
    alignItems: 'flex-end',
    gap: Spacing.half,
  },
  acaoBotao: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  acaoBotaoOutline: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  statusBox: {
    borderRadius: Spacing.two,
    padding: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  button: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontWeight: '700',
  },
});

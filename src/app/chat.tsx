import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { Extrapolation, interpolate, SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabBar } from '@/components/bottom-tab-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useUsuarioLogado } from '@/hooks/use-usuario-logado';
import { supabase } from '@/services/supabaseClient';
import { AVATAR_PALETTE, iniciais } from '@/utils/bico';
import { formatarDataLista } from '@/utils/chat';
import { mensagemErro } from '@/utils/erros';

type Filtro = 'todas' | 'nao_lidas' | 'ativos';

type ConversaBruta = {
  id: string;
  bico_id: string;
  participante_1_id: string;
  participante_2_id: string;
  oculta_participante_1: boolean;
  oculta_participante_2: boolean;
  bicos: { titulo: string; status: string } | null;
  participante_1: { nome_completo: string | null } | null;
  participante_2: { nome_completo: string | null } | null;
};

function AcaoOcultar({ progress, onPress }: { progress: SharedValue<number>; onPress: () => void }) {
  const theme = useTheme();
  const estiloAnimado = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.4, 1], Extrapolation.CLAMP) }],
  }));

  return (
    <View style={styles.acaoOcultarContainer}>
      <Pressable onPress={onPress}>
        <Animated.View style={[styles.acaoOcultar, { backgroundColor: theme.statusDanger }, estiloAnimado]}>
          <Ionicons name="trash" size={20} color={theme.background} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

type Mensagem = {
  conversa_id: string;
  conteudo: string;
  enviado_em: string;
  remetente_id: string;
  lido_em: string | null;
};

export default function ChatListaScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busca, setBusca] = useState('');

  const usuarioQuery = useUsuarioLogado();
  const meuId = usuarioQuery.data?.id;

  const conversasQuery = useQuery({
    queryKey: ['conversas', meuId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversas')
        .select(
          'id, bico_id, participante_1_id, participante_2_id, oculta_participante_1, oculta_participante_2, bicos(titulo, status), participante_1:profiles!conversas_participante_1_id_fkey(nome_completo), participante_2:profiles!conversas_participante_2_id_fkey(nome_completo)'
        )
        .or(`participante_1_id.eq.${meuId},participante_2_id.eq.${meuId}`);
      if (error) throw error;
      return data as unknown as ConversaBruta[];
    },
    enabled: !!meuId,
  });

  const conversaIds = useMemo(() => conversasQuery.data?.map((c) => c.id) ?? [], [conversasQuery.data]);

  const mensagensQuery = useQuery({
    queryKey: ['mensagens-resumo', conversaIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mensagens')
        .select('conversa_id, conteudo, enviado_em, remetente_id, lido_em')
        .in('conversa_id', conversaIds)
        .order('enviado_em', { ascending: true });
      if (error) throw error;
      return data as Mensagem[];
    },
    enabled: conversaIds.length > 0,
  });

  const conversas = useMemo(() => {
    if (!conversasQuery.data || !meuId) return [];

    return conversasQuery.data
      .filter((conversa) => {
        const souParticipante1 = conversa.participante_1_id === meuId;
        return souParticipante1 ? !conversa.oculta_participante_1 : !conversa.oculta_participante_2;
      })
      .map((conversa) => {
        const souParticipante1 = conversa.participante_1_id === meuId;
        const outro = souParticipante1 ? conversa.participante_2 : conversa.participante_1;
        const mensagens = (mensagensQuery.data ?? []).filter((m) => m.conversa_id === conversa.id);
        const ultimaMensagem = mensagens[mensagens.length - 1] ?? null;
        const naoLidas = mensagens.filter((m) => m.remetente_id !== meuId && !m.lido_em).length;

        return {
          id: conversa.id,
          nome: outro?.nome_completo ?? 'Usuário',
          tituloBico: conversa.bicos?.titulo ?? 'Bico',
          statusBico: conversa.bicos?.status ?? 'aberto',
          campoOculto: souParticipante1 ? ('oculta_participante_1' as const) : ('oculta_participante_2' as const),
          ultimaMensagem,
          naoLidas,
        };
    });
  }, [conversasQuery.data, mensagensQuery.data, meuId]);

  const conversasFiltradas = useMemo(() => {
    return conversas
      .filter((conversa) => {
        if (filtro === 'nao_lidas') return conversa.naoLidas > 0;
        if (filtro === 'ativos') return conversa.statusBico === 'em_andamento';
        return true;
      })
      .filter((conversa) => {
        if (!busca.trim()) return true;
        const alvo = busca.trim().toLowerCase();
        return conversa.nome.toLowerCase().includes(alvo) || conversa.tituloBico.toLowerCase().includes(alvo);
      })
      .sort((a, b) => {
        const dataA = a.ultimaMensagem?.enviado_em ?? '';
        const dataB = b.ultimaMensagem?.enviado_em ?? '';
        return dataB.localeCompare(dataA);
      });
  }, [conversas, filtro, busca]);

  const totalNaoLidas = useMemo(() => conversas.reduce((total, c) => total + c.naoLidas, 0), [conversas]);
  const carregando = usuarioQuery.isLoading || conversasQuery.isLoading;

  const ocultarConversa = (conversaId: string, campoOculto: 'oculta_participante_1' | 'oculta_participante_2') => {
    Alert.alert('Ocultar conversa', 'Ela some da sua lista, mas continua existindo pro outro participante.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Ocultar',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('conversas')
            .update({ [campoOculto]: true })
            .eq('id', conversaId);
          if (error) {
            Alert.alert('Não foi possível ocultar', mensagemErro(error, 'ocultar a conversa'));
            return;
          }
          queryClient.invalidateQueries({ queryKey: ['conversas'] });
        },
      },
    ]);
  };

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.hero, { backgroundColor: theme.primary }]}>
        <SafeAreaView edges={['top']} style={styles.heroContent}>
          <View style={styles.heroTopRow}>
            <ThemedText type="subtitle" themeColor="background" style={styles.heroTitle}>
              Mensagens
            </ThemedText>
            {totalNaoLidas > 0 && (
              <View style={[styles.badgeNovas, { backgroundColor: theme.background }]}>
                <ThemedText type="smallBold" themeColor="primary">
                  {totalNaoLidas} {totalNaoLidas === 1 ? 'nova' : 'novas'}
                </ThemedText>
              </View>
            )}
          </View>

          <View style={[styles.searchRow, { backgroundColor: theme.background }]}>
            <Ionicons name="search" size={18} color={theme.textSecondary} />
            <TextInput
              value={busca}
              onChangeText={setBusca}
              placeholder="Buscar conversa..."
              placeholderTextColor={theme.textSecondary}
              style={[styles.searchInput, { color: theme.text }]}
            />
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.filtros}>
        {(
          [
            { key: 'todas', label: 'Todas' },
            { key: 'nao_lidas', label: 'Não lidas' },
            { key: 'ativos', label: 'Ativos' },
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
        <ScrollView contentContainerStyle={styles.lista}>
          {conversasFiltradas.length === 0 ? (
            <ThemedText themeColor="textSecondary" style={styles.centerText}>
              Nenhuma conversa por aqui ainda.
            </ThemedText>
          ) : (
            conversasFiltradas.map((conversa, index) => {
              const paleta = AVATAR_PALETTE[index % AVATAR_PALETTE.length];
              const naoLida = conversa.naoLidas > 0;
              const podeOcultar = conversa.statusBico === 'concluido';

              const linha = (
                <Pressable
                  style={[styles.linha, { backgroundColor: theme.background }]}
                  onPress={() => router.push({ pathname: '/chat/[id]', params: { id: conversa.id } })}
                >
                  <View style={[styles.avatar, { backgroundColor: paleta.bg }]}>
                    <ThemedText type="smallBold" themeColor={paleta.text}>
                      {iniciais(conversa.nome)}
                    </ThemedText>
                  </View>
                  <View style={styles.linhaInfo}>
                    <ThemedText type="smallBold">{conversa.nome}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {conversa.tituloBico}
                    </ThemedText>
                    <ThemedText
                      type={naoLida ? 'smallBold' : 'small'}
                      themeColor={naoLida ? 'text' : 'textSecondary'}
                      numberOfLines={1}
                    >
                      {conversa.ultimaMensagem?.conteudo ?? 'Sem mensagens ainda'}
                    </ThemedText>
                  </View>
                  <View style={styles.linhaMeta}>
                    <ThemedText type="small" themeColor={naoLida ? 'primary' : 'textSecondary'}>
                      {conversa.ultimaMensagem ? formatarDataLista(conversa.ultimaMensagem.enviado_em) : ''}
                    </ThemedText>
                    {naoLida && (
                      <View style={[styles.badgeNaoLida, { backgroundColor: theme.primary }]}>
                        <ThemedText type="small" themeColor="background" style={styles.badgeNaoLidaTexto}>
                          {conversa.naoLidas}
                        </ThemedText>
                      </View>
                    )}
                  </View>
                </Pressable>
              );

              if (!podeOcultar) return <View key={conversa.id}>{linha}</View>;

              return (
                <Swipeable
                  key={conversa.id}
                  overshootRight={false}
                  rightThreshold={40}
                  renderRightActions={(progress) => (
                    <AcaoOcultar progress={progress} onPress={() => ocultarConversa(conversa.id, conversa.campoOculto)} />
                  )}
                >
                  {linha}
                </Swipeable>
              );
            })
          )}
        </ScrollView>
      )}

      <BottomTabBar ativo="chat" />
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
    justifyContent: 'space-between',
  },
  heroTitle: {
    fontSize: 24,
  },
  badgeNovas: {
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
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
  lista: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  centerText: {
    textAlign: 'center',
    paddingTop: Spacing.five,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linhaInfo: {
    flex: 1,
    gap: Spacing.half,
  },
  linhaMeta: {
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  badgeNaoLida: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.half,
  },
  badgeNaoLidaTexto: {
    fontWeight: '700',
  },
  acaoOcultarContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
  },
  acaoOcultar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

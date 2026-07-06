import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
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
import { formatarGanhos, formatarQuando, formatarValor } from '@/utils/bico';
import { abrirConversa } from '@/utils/chat';
import { mensagemErro } from '@/utils/erros';

type Perfil = {
  nome_completo: string | null;
  foto_url: string | null;
};

type BicoEmAndamento = {
  id: string;
  titulo: string;
  data_hora_desejada: string | null;
  profiles: { nome_completo: string | null } | null;
};

type BicoCriado = {
  id: string;
  titulo: string;
  status: 'aberto' | 'em_andamento' | 'concluido' | 'cancelado';
  valor_oferecido: number | null;
  candidato_selecionado_id: string | null;
  profiles: { nome_completo: string | null } | null;
};

function labelStatusBico(status: BicoCriado['status']) {
  if (status === 'aberto') return 'Aguardando candidatos';
  if (status === 'em_andamento') return 'Em andamento';
  if (status === 'concluido') return 'Concluído';
  return 'Cancelado';
}

const LISTA_MENU: {
  label: string;
  icone: keyof typeof Ionicons.glyphMap;
  cor: 'primary' | 'statusSuccess' | 'statusPending' | 'textSecondary';
  rota?: '/configuracoes' | '/historico-bicos' | '/pagamentos';
}[] = [
  { label: 'Histórico de bicos', icone: 'time-outline', cor: 'primary', rota: '/historico-bicos' },
  { label: 'Pagamentos e comprovantes', icone: 'cash-outline', cor: 'statusSuccess', rota: '/pagamentos' },
  { label: 'Configurações e segurança', icone: 'settings-outline', cor: 'textSecondary', rota: '/configuracoes' },
];

// Tela de perfil próprio (tab "Perfil"): estatísticas gerais, bicos em que o
// usuário foi escolhido como prestador ("Em andamento") e bicos que o
// usuário criou como contratante e ainda não concluiu ("Bicos criados").
export default function PerfilScreen() {
  const theme = useTheme();
  const router = useRouter();

  const usuarioQuery = useUsuarioLogado();
  const usuarioId = usuarioQuery.data?.id;

  const perfilQuery = useQuery({
    queryKey: ['perfil-logado', usuarioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('nome_completo, foto_url')
        .eq('id', usuarioId)
        .single();
      if (error) throw error;
      return data as Perfil;
    },
    enabled: !!usuarioId,
  });

  const estatisticas = useEstatisticasPerfil(usuarioId);

  const emAndamentoQuery = useQuery({
    queryKey: ['bicos-em-andamento', usuarioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bicos')
        .select('id, titulo, data_hora_desejada, profiles!bicos_criado_por_fkey(nome_completo)')
        .eq('candidato_selecionado_id', usuarioId)
        .eq('status', 'em_andamento')
        .order('data_hora_desejada', { ascending: true });
      if (error) throw error;
      return data as unknown as BicoEmAndamento[];
    },
    enabled: !!usuarioId,
  });

  const bicosCriadosQuery = useQuery({
    queryKey: ['bicos-criados', usuarioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bicos')
        .select(
          'id, titulo, status, valor_oferecido, candidato_selecionado_id, profiles!bicos_candidato_selecionado_id_fkey(nome_completo)'
        )
        .eq('criado_por', usuarioId)
        .neq('status', 'concluido')
        .order('criado_em', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as unknown as BicoCriado[];
    },
    enabled: !!usuarioId,
  });

  const abrirChatComContratado = async (bicoId: string, candidatoId: string) => {
    if (!usuarioId) return;
    try {
      const conversaId = await abrirConversa(bicoId, usuarioId, candidatoId);
      router.push({ pathname: '/chat/[id]', params: { id: conversaId } });
    } catch (erro) {
      Alert.alert('Não foi possível abrir a conversa', mensagemErro(erro as Error, 'abrir a conversa'));
    }
  };

  const sair = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  const carregando = usuarioQuery.isLoading || perfilQuery.isLoading;

  if (carregando) {
    return (
      <ThemedView style={styles.loading}>
        <ActivityIndicator color={theme.primary} />
      </ThemedView>
    );
  }

  const perfil = perfilQuery.data;

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.hero, { backgroundColor: theme.primary }]}>
        <SafeAreaView edges={['top']} style={styles.heroContent}>
          <View style={styles.heroTopRow}>
            <ThemedText type="subtitle" themeColor="background" style={styles.heroTitle}>
              Meu perfil
            </ThemedText>
            <Pressable style={[styles.iconButton, { backgroundColor: 'rgba(255,255,255,0.25)' }]} onPress={sair}>
              <Ionicons name="log-out-outline" size={20} color={theme.background} />
            </Pressable>
          </View>

          <View style={styles.perfilRow}>
            <View style={[styles.avatar, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              {perfil?.foto_url ? (
                <Image source={{ uri: perfil.foto_url }} style={styles.avatarImagem} />
              ) : (
                <Ionicons name="person" size={32} color={theme.background} />
              )}
            </View>
            <View style={styles.flex1}>
              <ThemedText type="subtitle" themeColor="background" style={styles.nome}>
                {perfil?.nome_completo ?? 'Sem nome'}
              </ThemedText>
              <ThemedText type="small" themeColor="backgroundSelected">
                ★ {estatisticas.nota?.toFixed(1) ?? '—'}
              </ThemedText>
            </View>
          </View>

          <Pressable
            style={[styles.editarButton, { backgroundColor: theme.background }]}
            onPress={() => router.push('/editar-perfil')}
          >
            <ThemedText type="smallBold" themeColor="primary">
              Editar perfil
            </ThemedText>
          </Pressable>
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.statsRow}>
          <View style={[styles.statBox, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <ThemedText type="subtitle" style={styles.statValor}>
              {estatisticas.totalBicos}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              BICOS
            </ThemedText>
          </View>
          <View style={[styles.statBox, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <ThemedText type="subtitle" style={styles.statValor}>
              {estatisticas.nota?.toFixed(1) ?? '—'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              NOTA
            </ThemedText>
          </View>
          <View style={[styles.statBox, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <ThemedText type="subtitle" themeColor="statusSuccess" style={styles.statValor}>
              {formatarGanhos(estatisticas.totalGanhos)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              GANHOS
            </ThemedText>
          </View>
        </View>

        {!!emAndamentoQuery.data?.length && (
          <View style={styles.field}>
            <ThemedText type="smallBold">Em andamento</ThemedText>
            {emAndamentoQuery.data.map((bico) => (
              <Pressable
                key={bico.id}
                style={[styles.cardAndamento, { backgroundColor: theme.text }]}
                onPress={() => router.push({ pathname: '/bico/[id]', params: { id: bico.id } })}
              >
                <View style={styles.flex1}>
                  <ThemedText type="smallBold" themeColor="background">
                    {bico.titulo}
                  </ThemedText>
                  <ThemedText type="small" themeColor="backgroundSelected">
                    {bico.profiles?.nome_completo ?? 'Contratante'} · {formatarQuando(bico.data_hora_desejada)}
                  </ThemedText>
                </View>
                <View style={[styles.badge, { backgroundColor: theme.statusPending }]}>
                  <ThemedText type="small" themeColor="background" style={styles.badgeText}>
                    A PAGAR
                  </ThemedText>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {!!bicosCriadosQuery.data?.length && (
          <View style={styles.field}>
            <ThemedText type="smallBold">Bicos criados</ThemedText>
            {bicosCriadosQuery.data.map((bico) => (
              <Pressable
                key={bico.id}
                style={[styles.bicoCriadoRow, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}
                onPress={() => router.push({ pathname: '/bico/[id]', params: { id: bico.id } })}
              >
                <View style={styles.flex1}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {bico.titulo}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {labelStatusBico(bico.status)}
                    {bico.profiles?.nome_completo ? ` · ${bico.profiles.nome_completo}` : ''}
                  </ThemedText>
                </View>
                <ThemedText type="smallBold">{formatarValor(bico.valor_oferecido)}</ThemedText>
                {bico.candidato_selecionado_id && (
                  <Pressable
                    style={[styles.chatIconButton, { backgroundColor: theme.backgroundElement }]}
                    onPress={(evento) => {
                      evento.stopPropagation();
                      abrirChatComContratado(bico.id, bico.candidato_selecionado_id!);
                    }}
                  >
                    <Ionicons name="chatbubble-outline" size={16} color={theme.primary} />
                  </Pressable>
                )}
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.field}>
          {LISTA_MENU.map((item) => (
            <Pressable
              key={item.label}
              style={[styles.menuRow, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}
              onPress={item.rota ? () => router.push(item.rota!) : undefined}
            >
              <View style={[styles.menuIcone, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name={item.icone} size={18} color={theme[item.cor]} />
              </View>
              <ThemedText type="default" style={styles.flex1}>
                {item.label}
              </ThemedText>
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <BottomTabBar ativo="perfil" />
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
  heroTitle: {
    fontSize: 22,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perfilRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  flex1: {
    flex: 1,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImagem: {
    width: 64,
    height: 64,
  },
  nome: {
    fontSize: 20,
    lineHeight: 26,
  },
  editarButton: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  body: {
    padding: Spacing.four,
    gap: Spacing.four,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  statBox: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    gap: Spacing.half,
  },
  statValor: {
    fontSize: 20,
    lineHeight: 26,
  },
  field: {
    gap: Spacing.two,
  },
  cardAndamento: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  badge: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  badgeText: {
    fontWeight: '700',
  },
  bicoCriadoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  chatIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  menuIcone: {
    width: 32,
    height: 32,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

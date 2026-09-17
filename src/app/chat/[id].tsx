import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useUsuarioLogado } from '@/hooks/use-usuario-logado';
import { supabase } from '@/services/supabaseClient';
import { formatarValor, iniciais } from '@/utils/bico';
import { formatarHoraMensagem } from '@/utils/chat';
import { mensagemErro } from '@/utils/erros';

type ConversaBruta = {
  id: string;
  participante_1_id: string;
  participante_2_id: string;
  bicos: {
    id: string;
    titulo: string;
    forma_pagamento: 'dinheiro' | 'pix';
    status: string;
    valor_oferecido: number | null;
    criado_por: string;
  } | null;
  participante_1: { nome_completo: string | null } | null;
  participante_2: { nome_completo: string | null } | null;
};

type Mensagem = {
  id: string;
  conversa_id: string;
  remetente_id: string;
  conteudo: string;
  enviado_em: string;
  lido_em: string | null;
};

function labelPagamento(bico: ConversaBruta['bicos']) {
  if (!bico) return '';
  const metodo = bico.forma_pagamento === 'pix' ? 'Pix' : 'Dinheiro';
  if (bico.status === 'concluido') return `${metodo} · pago`;
  if (bico.status === 'em_andamento') return `${metodo} · aguardando pagamento`;
  return metodo;
}

// Tela de uma conversa. Além de mandar/receber mensagem em tempo real,
// concentra o fim do ciclo de vida do bico: o contratante fecha o serviço
// (marca concluído + avalia o prestador) e o prestador avalia o contratante
// depois que o bico está concluído.
export default function ChatConversaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);

  const [mensagemAtual, setMensagemAtual] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [avaliacao, setAvaliacao] = useState<{ papel: 'prestador' | 'contratante'; acao: 'fechar' | 'avaliar' } | null>(
    null
  );
  const [notaSelecionada, setNotaSelecionada] = useState(0);
  const [comentarioAvaliacao, setComentarioAvaliacao] = useState('');
  const [enviandoAvaliacao, setEnviandoAvaliacao] = useState(false);

  const usuarioQuery = useUsuarioLogado();
  const meuId = usuarioQuery.data?.id;

  const conversaQuery = useQuery({
    queryKey: ['conversa', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversas')
        .select(
          'id, participante_1_id, participante_2_id, bicos(id, titulo, forma_pagamento, status, valor_oferecido, criado_por), participante_1:profiles!conversas_participante_1_id_fkey(nome_completo), participante_2:profiles!conversas_participante_2_id_fkey(nome_completo)'
        )
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as unknown as ConversaBruta;
    },
    enabled: !!id,
  });

  const mensagensQuery = useQuery({
    queryKey: ['mensagens', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mensagens')
        .select('id, conversa_id, remetente_id, conteudo, enviado_em, lido_em')
        .eq('conversa_id', id)
        .order('enviado_em', { ascending: true });
      if (error) throw error;
      return data as Mensagem[];
    },
    enabled: !!id,
  });

  const bicoId = conversaQuery.data?.bicos?.id;
  const souContratante = !!meuId && conversaQuery.data?.bicos?.criado_por === meuId;
  const bicoConcluido = conversaQuery.data?.bicos?.status === 'concluido';
  const outroId = conversaQuery.data
    ? conversaQuery.data.participante_1_id === meuId
      ? conversaQuery.data.participante_2_id
      : conversaQuery.data.participante_1_id
    : undefined;

  const minhaAvaliacaoQuery = useQuery({
    queryKey: ['minha-avaliacao', bicoId, meuId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('avaliacoes')
        .select('id')
        .eq('bico_id', bicoId)
        .eq('avaliador_id', meuId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !souContratante && !!meuId && !!bicoId && bicoConcluido,
  });

  useEffect(() => {
    if (!id) return;
    const topico = `mensagens-${id}`;
    // Remove uma inscrição antiga no mesmo tópico antes de assinar de novo:
    // sem isso, um remount rápido da tela (ex: navegação rápida entre
    // conversas) tenta dar .on() num canal já inscrito e quebra (mesmo
    // problema documentado no _layout.tsx pro canal global de mensagens).
    const canalExistente = supabase.getChannels().find((c) => c.topic === `realtime:${topico}`);
    if (canalExistente) supabase.removeChannel(canalExistente);

    const canal = supabase
      .channel(topico)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mensagens', filter: `conversa_id=eq.${id}` },
        (payload) => {
          const nova = payload.new as Mensagem;
          queryClient.setQueryData<Mensagem[]>(['mensagens', id], (atual = []) =>
            atual.some((m) => m.id === nova.id) ? atual : [...atual, nova]
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [id, queryClient]);

  // Marca como lidas as mensagens do outro participante assim que essa tela
  // abre (ou quando chegam novas via realtime). É esse efeito que zera o
  // badge de não lidas na bottom tab bar e na lista de conversas.
  useEffect(() => {
    if (!meuId || !mensagensQuery.data) return;
    const naoLidas = mensagensQuery.data.filter((m) => m.remetente_id !== meuId && !m.lido_em);
    if (naoLidas.length === 0) return;

    const agora = new Date().toISOString();
    supabase
      .from('mensagens')
      .update({ lido_em: agora })
      .in(
        'id',
        naoLidas.map((m) => m.id)
      )
      .then(({ error }) => {
        if (error) return;
        queryClient.setQueryData<Mensagem[]>(['mensagens', id], (atual = []) =>
          atual.map((m) => (naoLidas.some((n) => n.id === m.id) ? { ...m, lido_em: agora } : m))
        );
        queryClient.invalidateQueries({ queryKey: ['conversas'] });
        queryClient.invalidateQueries({ queryKey: ['mensagens-resumo'] });
        queryClient.invalidateQueries({ queryKey: ['total-nao-lidas'] });
      });
  }, [meuId, mensagensQuery.data, id, queryClient]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [mensagensQuery.data?.length]);

  const enviarMensagem = async () => {
    const texto = mensagemAtual.trim();
    if (!texto || !meuId || !id) return;
    setMensagemAtual('');
    setEnviando(true);
    const { data, error } = await supabase
      .from('mensagens')
      .insert({ conversa_id: id, remetente_id: meuId, conteudo: texto })
      .select()
      .single();
    setEnviando(false);

    if (error) {
      Alert.alert('Não foi possível enviar', mensagemErro(error, 'enviar a mensagem'));
      setMensagemAtual(texto);
      return;
    }

    queryClient.setQueryData<Mensagem[]>(['mensagens', id], (atual = []) =>
      atual.some((m) => m.id === data.id) ? atual : [...atual, data as Mensagem]
    );
  };

  const confirmarAvaliacao = async () => {
    if (!avaliacao || !meuId || !bicoId || !outroId || notaSelecionada === 0) return;
    setEnviandoAvaliacao(true);

    if (avaliacao.acao === 'fechar') {
      // RPC (não update + insert separados) porque fechar o bico, gravar a
      // avaliação e mandar a mensagem de encerramento precisam acontecer
      // como uma transação só — se a avaliação falhar (ex: duplicada), o
      // bico não pode ficar marcado concluído sem avaliação (migration 0011).
      const { error: erroFechar } = await supabase.rpc('fechar_bico_e_avaliar', {
        p_bico_id: bicoId,
        p_nota: notaSelecionada,
        p_comentario: comentarioAvaliacao.trim() || null,
      });
      if (erroFechar) {
        setEnviandoAvaliacao(false);
        Alert.alert('Não foi possível concluir', mensagemErro(erroFechar, 'concluir o serviço'));
        return;
      }
    } else {
      const { error: erroAvaliacao } = await supabase.from('avaliacoes').insert({
        bico_id: bicoId,
        avaliador_id: meuId,
        avaliado_id: outroId,
        papel_avaliado: avaliacao.papel,
        nota: notaSelecionada,
        comentario: comentarioAvaliacao.trim() || null,
      });

      if (erroAvaliacao) {
        setEnviandoAvaliacao(false);
        Alert.alert('Não foi possível enviar a avaliação', mensagemErro(erroAvaliacao, 'enviar a avaliação'));
        return;
      }
    }

    setEnviandoAvaliacao(false);
    setAvaliacao(null);
    setNotaSelecionada(0);
    setComentarioAvaliacao('');

    queryClient.invalidateQueries({ queryKey: ['conversa', id] });
    queryClient.invalidateQueries({ queryKey: ['mensagens', id] });
    queryClient.invalidateQueries({ queryKey: ['minha-avaliacao', bicoId, meuId] });
    queryClient.invalidateQueries({ queryKey: ['bico', bicoId] });
    queryClient.invalidateQueries({ queryKey: ['bicos-em-andamento'] });
    queryClient.invalidateQueries({ queryKey: ['bicos-criados'] });
    queryClient.invalidateQueries({ queryKey: ['ganhos'] });
    queryClient.invalidateQueries({ queryKey: ['estatisticas-prestador'] });
    queryClient.invalidateQueries({ queryKey: ['conversas'] });
  };

  if (conversaQuery.isLoading || !conversaQuery.data || !meuId) {
    return (
      <ThemedView style={styles.loading}>
        <ActivityIndicator color={theme.primary} />
      </ThemedView>
    );
  }

  const conversa = conversaQuery.data;
  const outro = conversa.participante_1_id === meuId ? conversa.participante_2 : conversa.participante_1;
  const nomeOutro = outro?.nome_completo ?? 'Usuário';
  const podeFechar = souContratante && conversa.bicos?.status === 'em_andamento';
  const podeAvaliarContratante = !souContratante && bicoConcluido && minhaAvaliacaoQuery.data === null;

  return (
    <ThemedView style={styles.container}>
      {/* Esta tela é a única sem hero azul: o cabeçalho usa a cor de fundo do
          tema, então o texto da status bar acompanha o tema, não o contrário. */}
      <StatusBar style="auto" />
      <View style={[styles.hero, { backgroundColor: theme.background, borderBottomColor: theme.backgroundSelected }]}>
        <SafeAreaView edges={['top']} style={styles.heroContent}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={22} color={theme.text} />
          </Pressable>
          <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold" themeColor="primary">
              {iniciais(nomeOutro)}
            </ThemedText>
          </View>
          <ThemedText type="smallBold">{nomeOutro}</ThemedText>
        </SafeAreaView>
      </View>

      {conversa.bicos && (
        <View style={[styles.bicoCard, { backgroundColor: theme.text }]}>
          <View style={styles.bicoCardTopo}>
            <View style={styles.flex1}>
              <ThemedText type="smallBold" themeColor="background">
                {conversa.bicos.titulo}
              </ThemedText>
              <ThemedText type="small" themeColor="backgroundSelected">
                {labelPagamento(conversa.bicos)}
              </ThemedText>
            </View>
            <ThemedText type="smallBold" themeColor="background">
              {formatarValor(conversa.bicos.valor_oferecido)}
            </ThemedText>
          </View>

          {podeFechar && (
            <Pressable
              style={[styles.fecharButton, { backgroundColor: theme.statusSuccess }]}
              onPress={() => setAvaliacao({ papel: 'prestador', acao: 'fechar' })}
            >
              <ThemedText type="smallBold" themeColor="background">
                Fechar serviço
              </ThemedText>
            </Pressable>
          )}

          {podeAvaliarContratante && (
            <Pressable
              style={[styles.fecharButton, { backgroundColor: theme.statusPending }]}
              onPress={() => setAvaliacao({ papel: 'contratante', acao: 'avaliar' })}
            >
              <ThemedText type="smallBold" themeColor="background">
                Avaliar contratante
              </ThemedText>
            </Pressable>
          )}

          {!souContratante && bicoConcluido && minhaAvaliacaoQuery.data && (
            <ThemedText type="small" themeColor="backgroundSelected" style={styles.centerText}>
              Você já avaliou este serviço.
            </ThemedText>
          )}
        </View>
      )}

      <KeyboardAvoidingView style={styles.flex1} behavior="padding">
        <ScrollView ref={scrollRef} style={styles.body} contentContainerStyle={styles.bodyContent}>
          {mensagensQuery.data?.map((mensagem) => {
            const minha = mensagem.remetente_id === meuId;
            return (
              <View key={mensagem.id} style={[styles.bolhaWrapper, minha && styles.bolhaWrapperMinha]}>
                <View
                  style={[
                    styles.bolha,
                    { backgroundColor: minha ? theme.primary : theme.background, borderColor: theme.backgroundSelected },
                  ]}
                >
                  <ThemedText themeColor={minha ? 'background' : 'text'}>{mensagem.conteudo}</ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary" style={styles.horaMensagem}>
                  {formatarHoraMensagem(mensagem.enviado_em)}
                </ThemedText>
              </View>
            );
          })}
        </ScrollView>

        <View
          style={[
            styles.inputRow,
            { backgroundColor: theme.background, borderTopColor: theme.backgroundSelected, paddingBottom: insets.bottom || Spacing.two },
          ]}
        >
          <TextInput
            value={mensagemAtual}
            onChangeText={setMensagemAtual}
            placeholder="Mensagem..."
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
            multiline
          />
          <Pressable
            style={[styles.enviarButton, { backgroundColor: theme.primary }, enviando && styles.disabled]}
            onPress={enviarMensagem}
            disabled={enviando || !mensagemAtual.trim()}
          >
            <Ionicons name="arrow-up" size={18} color={theme.background} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={!!avaliacao} transparent animationType="fade" onRequestClose={() => setAvaliacao(null)}>
        <View style={styles.modalFundo}>
          <View style={[styles.modalCartao, { backgroundColor: theme.background }]}>
            <ThemedText type="smallBold" style={styles.centerText}>
              {avaliacao?.acao === 'fechar' ? `Avalie o serviço de ${nomeOutro}` : `Avalie ${nomeOutro} como contratante`}
            </ThemedText>

            <View style={styles.estrelasRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} onPress={() => setNotaSelecionada(n)}>
                  <Ionicons
                    name={n <= notaSelecionada ? 'star' : 'star-outline'}
                    size={32}
                    color={theme.statusPending}
                  />
                </Pressable>
              ))}
            </View>

            <TextInput
              value={comentarioAvaliacao}
              onChangeText={setComentarioAvaliacao}
              placeholder="Comentário (opcional)"
              placeholderTextColor={theme.textSecondary}
              style={[styles.modalInput, { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.backgroundSelected }]}
              multiline
            />

            <View style={styles.modalBotoes}>
              <Pressable
                style={[styles.modalBotao, { backgroundColor: theme.backgroundSelected }]}
                onPress={() => {
                  setAvaliacao(null);
                  setNotaSelecionada(0);
                  setComentarioAvaliacao('');
                }}
              >
                <ThemedText type="smallBold">Cancelar</ThemedText>
              </Pressable>
              <Pressable
                style={[
                  styles.modalBotao,
                  { backgroundColor: theme.primary },
                  (notaSelecionada === 0 || enviandoAvaliacao) && styles.disabled,
                ]}
                disabled={notaSelecionada === 0 || enviandoAvaliacao}
                onPress={confirmarAvaliacao}
              >
                <ThemedText type="smallBold" themeColor="background">
                  {enviandoAvaliacao ? 'Enviando...' : avaliacao?.acao === 'fechar' ? 'Concluir e avaliar' : 'Enviar avaliação'}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
    borderBottomWidth: 1,
  },
  heroContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  backButton: {
    padding: Spacing.one,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bicoCard: {
    margin: Spacing.three,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  bicoCardTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fecharButton: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  flex1: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  bolhaWrapper: {
    alignItems: 'flex-start',
    maxWidth: '80%',
  },
  bolhaWrapperMinha: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  bolha: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  horaMensagem: {
    marginTop: Spacing.half,
    marginHorizontal: Spacing.one,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    borderTopWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  input: {
    flex: 1,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    maxHeight: 96,
    fontSize: 16,
  },
  enviarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.6,
  },
  centerText: {
    textAlign: 'center',
  },
  modalFundo: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  modalCartao: {
    width: '100%',
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  estrelasRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 64,
    textAlignVertical: 'top',
    fontSize: 16,
  },
  modalBotoes: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  modalBotao: {
    flex: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});

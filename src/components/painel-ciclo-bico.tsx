import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/services/supabaseClient';
import { StatusBico, prazoDeAvaliacaoAberto } from '@/utils/bico';
import {
  MOTIVOS_CANCELAMENTO,
  MOTIVOS_DISPUTA,
  abrirDisputa,
  atualizarDepoisDaAcao,
  avaliarBico,
  cancelarBico,
  confirmarConclusaoBico,
  iniciarBico,
  labelMotivo,
  marcarBicoFinalizado,
} from '@/utils/ciclo-bico';
import { ErroSupabase, mensagemErro } from '@/utils/erros';

export type BicoCiclo = {
  id: string;
  titulo: string;
  status: StatusBico;
  criado_por: string;
  candidato_selecionado_id: string | null;
  concluido_em: string | null;
};

type Papel = 'contratante' | 'prestador';
type Formulario = 'cancelar' | 'disputa' | 'avaliar' | null;

function textoDoEstado(status: StatusBico, papel: Papel, outro: string) {
  switch (status) {
    case 'aberto':
      return 'Aguardando candidatos. Escolha alguém na lista para começar.';
    case 'atribuido':
      return papel === 'prestador'
        ? 'Você foi escolhido! Quando chegar ao local, toque em "Iniciar serviço".'
        : `${outro} foi escolhido. O serviço começa quando o prestador iniciar pelo app.`;
    case 'em_andamento':
      return papel === 'prestador'
        ? 'Serviço em andamento. Ao terminar, marque como finalizado.'
        : 'Serviço em andamento. Quando o prestador finalizar, você confirma a conclusão.';
    case 'aguardando_confirmacao':
      return papel === 'prestador'
        ? 'Você marcou o serviço como finalizado. Aguardando o contratante confirmar.'
        : `${outro} marcou o serviço como finalizado. Confira e confirme a conclusão.`;
    case 'em_disputa':
      return 'Este bico está em disputa. A equipe do Estou Dentro vai analisar e avisar vocês.';
    case 'concluido':
      return 'Serviço concluído.';
    case 'cancelado':
      return 'Bico cancelado.';
  }
}

// Painel do ciclo de vida do bico para quem participa dele (contratante ou
// prestador escolhido): o estado atual em palavras e só as ações que o banco
// aceitaria dessa pessoa agora (docs/JOB_LIFECYCLE_DESIGN.md, B2 e B5). Usado
// na tela do bico e no chat, pra existir uma implementação só. Quem decide de
// verdade é a RPC; esconder botão aqui é só pra não oferecer o que vai falhar.
export function PainelCicloBico({
  bico,
  usuarioId,
  nomeOutraParte,
  escuro = false,
  aoConversar,
  conversando = false,
}: {
  bico: BicoCiclo;
  usuarioId: string;
  nomeOutraParte?: string | null;
  // Cartão de cor invertida (o do chat): textos na cor de fundo do tema.
  escuro?: boolean;
  aoConversar?: () => void;
  conversando?: boolean;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [processando, setProcessando] = useState(false);
  const [formulario, setFormulario] = useState<Formulario>(null);

  const papel: Papel | null =
    bico.criado_por === usuarioId ? 'contratante' : bico.candidato_selecionado_id === usuarioId ? 'prestador' : null;

  // A própria avaliação é sempre visível para quem a escreveu (a da outra
  // parte, não: avaliação cega).
  const minhaAvaliacaoQuery = useQuery({
    queryKey: ['minha-avaliacao', bico.id, usuarioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('avaliacoes')
        .select('nota')
        .eq('bico_id', bico.id)
        .eq('avaliador_id', usuarioId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!papel && bico.status === 'concluido',
  });

  const cancelamentoQuery = useQuery({
    queryKey: ['ciclo-bico', 'cancelamento', bico.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cancelamentos')
        .select('cancelado_por, motivo, detalhes')
        .eq('bico_id', bico.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!papel && bico.status === 'cancelado',
  });

  const disputaQuery = useQuery({
    queryKey: ['ciclo-bico', 'disputa', bico.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('disputas')
        .select('aberta_por, motivo')
        .eq('bico_id', bico.id)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!papel && bico.status === 'em_disputa',
  });

  if (!papel) return null;

  const outro = nomeOutraParte || (papel === 'contratante' ? 'O prestador' : 'O contratante');
  const corTexto: ThemeColor = escuro ? 'background' : 'text';
  const corSecundaria: ThemeColor = escuro ? 'backgroundSelected' : 'textSecondary';
  const corLink: ThemeColor = escuro ? 'background' : 'primary';

  const executar = async (acao: () => Promise<void>, descricao: string, depois?: () => void) => {
    setProcessando(true);
    try {
      await acao();
      atualizarDepoisDaAcao(queryClient);
      depois?.();
    } catch (erro) {
      Alert.alert(`Não foi possível ${descricao}`, mensagemErro(erro as ErroSupabase, descricao));
    } finally {
      setProcessando(false);
    }
  };

  const confirmarAntes = (titulo: string, texto: string, rotulo: string, acao: () => void) => {
    Alert.alert(titulo, texto, [
      { text: 'Voltar', style: 'cancel' },
      { text: rotulo, onPress: acao },
    ]);
  };

  const iniciar = () =>
    confirmarAntes('Iniciar serviço?', 'Faça isso quando chegar ao local combinado.', 'Iniciar', () =>
      executar(() => iniciarBico(bico.id), 'iniciar o serviço')
    );

  const finalizar = () =>
    confirmarAntes(
      'Marcar como finalizado?',
      'O contratante vai confirmar a conclusão pelo app. Depois disso vocês podem se avaliar.',
      'Finalizar',
      () => executar(() => marcarBicoFinalizado(bico.id), 'finalizar o serviço')
    );

  const confirmarConclusao = () =>
    confirmarAntes('Confirmar conclusão?', 'Isso encerra o bico e libera as avaliações.', 'Confirmar', () =>
      executar(() => confirmarConclusaoBico(bico.id), 'confirmar a conclusão', () => setFormulario('avaliar'))
    );

  const podeIniciar = papel === 'prestador' && bico.status === 'atribuido';
  const podeFinalizar = papel === 'prestador' && bico.status === 'em_andamento';
  const podeConfirmar = papel === 'contratante' && bico.status === 'aguardando_confirmacao';
  const podeCancelar =
    (bico.status === 'aberto' && papel === 'contratante') ||
    bico.status === 'atribuido' ||
    (bico.status === 'em_andamento' && papel === 'prestador');
  const podeDisputar = bico.status === 'em_andamento' || bico.status === 'aguardando_confirmacao';
  const minhaNota = minhaAvaliacaoQuery.data?.nota;
  const podeAvaliar =
    bico.status === 'concluido' && minhaAvaliacaoQuery.data === null && prazoDeAvaliacaoAberto(bico.concluido_em);

  const cancelamento = cancelamentoQuery.data;
  const quemCancelou = !cancelamento
    ? null
    : cancelamento.cancelado_por == null
      ? 'pela equipe do Estou Dentro'
      : cancelamento.cancelado_por === usuarioId
        ? 'por você'
        : papel === 'contratante'
          ? 'pelo prestador'
          : 'pelo contratante';
  const disputa = disputaQuery.data;

  return (
    <View style={styles.painel}>
      <ThemedText type="small" themeColor={corTexto} style={styles.centro}>
        {textoDoEstado(bico.status, papel, outro)}
      </ThemedText>

      {bico.status === 'cancelado' && cancelamento && (
        <ThemedText type="small" themeColor={corSecundaria} style={styles.centro}>
          Cancelado {quemCancelou} · {labelMotivo(cancelamento.motivo)}
          {cancelamento.detalhes ? `\n"${cancelamento.detalhes}"` : ''}
        </ThemedText>
      )}

      {bico.status === 'em_disputa' && disputa && (
        <ThemedText type="small" themeColor={corSecundaria} style={styles.centro}>
          {labelMotivo(disputa.motivo)} · aberta {disputa.aberta_por === usuarioId ? 'por você' : 'pela outra parte'}
        </ThemedText>
      )}

      {bico.status === 'concluido' && minhaNota != null && (
        <ThemedText type="small" themeColor={corSecundaria} style={styles.centro}>
          Você avaliou com {'★'.repeat(minhaNota)}
          {'☆'.repeat(5 - minhaNota)}. A avaliação da outra parte aparece quando ela avaliar (ou em até 14 dias).
        </ThemedText>
      )}

      {bico.status === 'concluido' && minhaAvaliacaoQuery.data === null && !podeAvaliar && (
        <ThemedText type="small" themeColor={corSecundaria} style={styles.centro}>
          O prazo para avaliar este bico terminou.
        </ThemedText>
      )}

      {processando && <ActivityIndicator color={escuro ? theme.background : theme.primary} />}

      <View style={styles.acoes}>
        {podeIniciar && <Botao rotulo="Iniciar serviço" cor="primary" onPress={iniciar} desabilitado={processando} />}
        {podeFinalizar && (
          <Botao rotulo="Marcar como finalizado" cor="statusSuccess" onPress={finalizar} desabilitado={processando} />
        )}
        {podeConfirmar && (
          <Botao rotulo="Confirmar conclusão" cor="statusSuccess" onPress={confirmarConclusao} desabilitado={processando} />
        )}
        {podeAvaliar && (
          <Botao
            rotulo={papel === 'contratante' ? 'Avaliar prestador' : 'Avaliar contratante'}
            cor="statusPending"
            onPress={() => setFormulario('avaliar')}
            desabilitado={processando}
          />
        )}
        {aoConversar && bico.status !== 'aberto' && (
          <Botao rotulo="Conversar" cor="primary" onPress={aoConversar} desabilitado={conversando} />
        )}

        {(podeDisputar || podeCancelar) && (
          <View style={styles.linhaLinks}>
            {podeDisputar && (
              <Pressable disabled={processando} onPress={() => setFormulario('disputa')}>
                <ThemedText type="smallBold" themeColor={corLink}>
                  Abrir disputa
                </ThemedText>
              </Pressable>
            )}
            {podeCancelar && (
              <Pressable disabled={processando} onPress={() => setFormulario('cancelar')}>
                <ThemedText type="smallBold" themeColor="statusDanger">
                  {bico.status === 'aberto' ? 'Cancelar este bico' : 'Cancelar'}
                </ThemedText>
              </Pressable>
            )}
          </View>
        )}
      </View>

      <Modal visible={!!formulario} transparent animationType="fade" onRequestClose={() => setFormulario(null)}>
        <View style={styles.modalFundo}>
          <View style={[styles.modalCartao, { backgroundColor: theme.background }]}>
            {formulario === 'cancelar' && (
              <FormularioMotivo
                titulo="Cancelar bico"
                explicacao={
                  bico.status === 'aberto'
                    ? 'Ele sai do feed e ninguém mais pode se candidatar. Não dá pra desfazer.'
                    : 'A outra parte será avisada. Não dá pra desfazer.'
                }
                motivos={MOTIVOS_CANCELAMENTO}
                placeholder="Detalhes (obrigatório em “Outro motivo”)"
                minimoTexto={(motivo) => (motivo === 'outro' ? 5 : 0)}
                maximoTexto={500}
                rotuloConfirmar="Cancelar bico"
                corConfirmar="statusDanger"
                aoFechar={() => setFormulario(null)}
                aoConfirmar={(motivo, texto) =>
                  executar(() => cancelarBico(bico.id, motivo, texto), 'cancelar o bico', () => setFormulario(null))
                }
              />
            )}

            {formulario === 'disputa' && (
              <FormularioMotivo
                titulo="Abrir disputa"
                explicacao="O bico fica em disputa até a equipe do Estou Dentro analisar. Conte o que aconteceu."
                motivos={MOTIVOS_DISPUTA}
                placeholder="Descreva o problema (mínimo de 10 caracteres)"
                minimoTexto={() => 10}
                maximoTexto={2000}
                rotuloConfirmar="Abrir disputa"
                corConfirmar="statusDanger"
                aoFechar={() => setFormulario(null)}
                aoConfirmar={(motivo, texto) =>
                  executar(() => abrirDisputa(bico.id, motivo, texto), 'abrir a disputa', () => setFormulario(null))
                }
              />
            )}

            {formulario === 'avaliar' && (
              <FormularioAvaliacao
                titulo={papel === 'contratante' ? `Avalie o serviço de ${outro}` : `Avalie ${outro} como contratante`}
                enviando={processando}
                aoFechar={() => setFormulario(null)}
                aoConfirmar={(nota, comentario) =>
                  executar(() => avaliarBico(bico.id, nota, comentario), 'enviar a avaliação', () => setFormulario(null))
                }
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Botao({
  rotulo,
  cor,
  onPress,
  desabilitado,
}: {
  rotulo: string;
  cor: ThemeColor;
  onPress: () => void;
  desabilitado?: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      style={[styles.botao, { backgroundColor: theme[cor] }, desabilitado && styles.desabilitado]}
      onPress={onPress}
      disabled={desabilitado}
    >
      <ThemedText type="smallBold" themeColor="background">
        {rotulo}
      </ThemedText>
    </Pressable>
  );
}

// Escolha de motivo + texto, usada para cancelar e para abrir disputa (as
// regras de tamanho são as mesmas do banco, só pra avisar antes de enviar).
function FormularioMotivo<T extends string>({
  titulo,
  explicacao,
  motivos,
  placeholder,
  minimoTexto,
  maximoTexto,
  rotuloConfirmar,
  corConfirmar,
  aoFechar,
  aoConfirmar,
}: {
  titulo: string;
  explicacao: string;
  motivos: { valor: T; label: string }[];
  placeholder: string;
  minimoTexto: (motivo: T | null) => number;
  maximoTexto: number;
  rotuloConfirmar: string;
  corConfirmar: ThemeColor;
  aoFechar: () => void;
  aoConfirmar: (motivo: T, texto: string) => void;
}) {
  const theme = useTheme();
  const [motivo, setMotivo] = useState<T | null>(null);
  const [texto, setTexto] = useState('');
  const valido = !!motivo && texto.trim().length >= minimoTexto(motivo);

  return (
    <View style={styles.formulario}>
      <ThemedText type="smallBold" style={styles.centro}>
        {titulo}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.centro}>
        {explicacao}
      </ThemedText>

      <View style={styles.chips}>
        {motivos.map((item) => (
          <Pressable
            key={item.valor}
            style={[styles.chip, { backgroundColor: motivo === item.valor ? theme.primary : theme.backgroundSelected }]}
            onPress={() => setMotivo(item.valor)}
          >
            <ThemedText type="small" themeColor={motivo === item.valor ? 'background' : 'text'}>
              {item.label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <TextInput
        value={texto}
        onChangeText={setTexto}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        maxLength={maximoTexto}
        multiline
        style={[
          styles.entrada,
          { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.backgroundSelected },
        ]}
      />

      <View style={styles.modalBotoes}>
        <Pressable style={[styles.modalBotao, { backgroundColor: theme.backgroundSelected }]} onPress={aoFechar}>
          <ThemedText type="smallBold">Voltar</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.modalBotao, { backgroundColor: theme[corConfirmar] }, !valido && styles.desabilitado]}
          disabled={!valido}
          onPress={() => motivo && aoConfirmar(motivo, texto)}
        >
          <ThemedText type="smallBold" themeColor="background">
            {rotuloConfirmar}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function FormularioAvaliacao({
  titulo,
  enviando,
  aoFechar,
  aoConfirmar,
}: {
  titulo: string;
  enviando: boolean;
  aoFechar: () => void;
  aoConfirmar: (nota: number, comentario: string) => void;
}) {
  const theme = useTheme();
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState('');

  return (
    <View style={styles.formulario}>
      <ThemedText type="smallBold" style={styles.centro}>
        {titulo}
      </ThemedText>

      <View style={styles.estrelas}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setNota(n)}>
            <Ionicons name={n <= nota ? 'star' : 'star-outline'} size={32} color={theme.statusPending} />
          </Pressable>
        ))}
      </View>

      <TextInput
        value={comentario}
        onChangeText={setComentario}
        placeholder="Comentário (opcional)"
        placeholderTextColor={theme.textSecondary}
        maxLength={1000}
        multiline
        style={[
          styles.entrada,
          { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.backgroundSelected },
        ]}
      />

      <ThemedText type="small" themeColor="textSecondary" style={styles.centro}>
        Sua avaliação fica oculta até a outra parte avaliar também (ou até 14 dias depois da conclusão).
      </ThemedText>

      <View style={styles.modalBotoes}>
        <Pressable style={[styles.modalBotao, { backgroundColor: theme.backgroundSelected }]} onPress={aoFechar}>
          <ThemedText type="smallBold">Depois</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.modalBotao, { backgroundColor: theme.primary }, (nota === 0 || enviando) && styles.desabilitado]}
          disabled={nota === 0 || enviando}
          onPress={() => aoConfirmar(nota, comentario)}
        >
          <ThemedText type="smallBold" themeColor="background">
            {enviando ? 'Enviando...' : 'Enviar avaliação'}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  painel: {
    gap: Spacing.two,
  },
  acoes: {
    gap: Spacing.two,
  },
  linhaLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.four,
    paddingVertical: Spacing.one,
  },
  botao: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  desabilitado: {
    opacity: 0.6,
  },
  centro: {
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
  },
  formulario: {
    gap: Spacing.three,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  entrada: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 64,
    textAlignVertical: 'top',
    fontSize: 16,
  },
  estrelas: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.two,
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

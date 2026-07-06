import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useUsuarioLogado } from '@/hooks/use-usuario-logado';
import { supabase } from '@/services/supabaseClient';
import {
  LABEL_TIPO_CHAVE_PIX,
  TipoChavePix,
  mascararChavePix,
  somenteDigitos,
  validarCNPJ,
  validarCPF,
  validarEmail,
} from '@/utils/documentos';
import { mensagemErro } from '@/utils/erros';

type ChavePix = {
  id: string;
  tipo: TipoChavePix;
  valor: string;
  banco_nome: string | null;
  principal: boolean;
};

const TIPOS_CHAVE: TipoChavePix[] = ['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'];

const PLACEHOLDER_CHAVE: Record<TipoChavePix, string> = {
  cpf: '000.000.000-00',
  cnpj: '00.000.000/0000-00',
  email: 'seuemail@exemplo.com',
  telefone: '(11) 90000-0000',
  aleatoria: 'Chave aleatória (UUID)',
};

// Tela "Métodos de pagamento" (Configurações → Conta): gerencia as chaves
// Pix do usuário pra receber (tabela chaves_pix, sempre uma marcada como
// principal — ver migration 0013) e mostra, informativamente, os métodos já
// suportados pra pagar bicos que ele contrata (Pix e Dinheiro já existem
// como forma_pagamento em bicos; cartão ainda não tem processador de
// pagamento integrado, por isso fica como "em breve").
export default function MetodosPagamentoScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const usuarioQuery = useUsuarioLogado();
  const usuarioId = usuarioQuery.data?.id;

  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<ChavePix | null>(null);
  const [tipo, setTipo] = useState<TipoChavePix>('cpf');
  const [valor, setValor] = useState('');
  const [bancoNome, setBancoNome] = useState('');
  const [salvando, setSalvando] = useState(false);

  const chavesQuery = useQuery({
    queryKey: ['chaves-pix', usuarioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chaves_pix')
        .select('id, tipo, valor, banco_nome, principal')
        .eq('usuario_id', usuarioId)
        .order('principal', { ascending: false })
        .order('criado_em', { ascending: true });
      if (error) throw error;
      return data as ChavePix[];
    },
    enabled: !!usuarioId,
  });

  const abrirNovaChave = () => {
    setEditando(null);
    setTipo('cpf');
    setValor('');
    setBancoNome('');
    setModalAberto(true);
  };

  const abrirEditarChave = (chave: ChavePix) => {
    setEditando(chave);
    setTipo(chave.tipo);
    setValor(mascararChavePix(chave.tipo, chave.valor));
    setBancoNome(chave.banco_nome ?? '');
    setModalAberto(true);
  };

  const fecharModal = () => setModalAberto(false);

  const validarValorChave = () => {
    if (tipo === 'cpf') return validarCPF(valor);
    if (tipo === 'cnpj') return validarCNPJ(valor);
    if (tipo === 'email') return validarEmail(valor);
    if (tipo === 'telefone') return somenteDigitos(valor).length === 11;
    return valor.trim().length >= 8;
  };

  const salvarChave = async () => {
    if (!usuarioId) return;
    if (!validarValorChave()) {
      Alert.alert('Chave inválida', 'Confira o valor da chave Pix antes de salvar.');
      return;
    }

    const valorParaSalvar = tipo === 'email' || tipo === 'aleatoria' ? valor.trim() : somenteDigitos(valor);
    const payload = {
      tipo,
      valor: valorParaSalvar,
      banco_nome: bancoNome.trim() || null,
    };

    setSalvando(true);
    const { error } = editando
      ? await supabase.from('chaves_pix').update(payload).eq('id', editando.id)
      : await supabase.from('chaves_pix').insert({ ...payload, usuario_id: usuarioId });
    setSalvando(false);

    if (error) {
      Alert.alert('Não foi possível salvar', mensagemErro(error, 'salvar a chave Pix'));
      return;
    }

    queryClient.invalidateQueries({ queryKey: ['chaves-pix', usuarioId] });
    fecharModal();
  };

  const definirPrincipal = async (chave: ChavePix) => {
    const { error } = await supabase.rpc('definir_chave_pix_principal', { p_chave_id: chave.id });
    if (error) {
      Alert.alert('Não foi possível definir como principal', mensagemErro(error, 'definir esta chave como principal'));
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['chaves-pix', usuarioId] });
    setEditando({ ...chave, principal: true });
  };

  const excluirChave = (chave: ChavePix) => {
    Alert.alert('Excluir chave Pix', 'Tem certeza que quer remover essa chave?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('chaves_pix').delete().eq('id', chave.id);
          if (error) {
            Alert.alert('Não foi possível excluir', mensagemErro(error, 'excluir esta chave'));
            return;
          }
          queryClient.invalidateQueries({ queryKey: ['chaves-pix', usuarioId] });
          fecharModal();
        },
      },
    ]);
  };

  const cartaoEmBreve = () => {
    Alert.alert('Em breve', 'Cadastro de cartão de crédito ainda não está disponível — estamos trabalhando nisso.');
  };

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <Pressable style={[styles.backButton, { backgroundColor: theme.background }]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color={theme.text} />
        </Pressable>
        <ThemedText type="subtitle" style={styles.headerTitle}>
          Métodos de pagamento
        </ThemedText>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            PARA RECEBER
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Sua chave Pix aparece pra quem for te pagar.
          </ThemedText>

          {chavesQuery.isLoading ? (
            <ActivityIndicator color={theme.primary} style={styles.loadingChaves} />
          ) : (
            chavesQuery.data?.map((chave) =>
              chave.principal ? (
                <Pressable
                  key={chave.id}
                  style={[styles.cardPrincipal, { backgroundColor: theme.text }]}
                  onPress={() => abrirEditarChave(chave)}
                >
                  <View style={styles.linhaTopo}>
                    <View style={[styles.avatar, { backgroundColor: theme.background }]}>
                      <ThemedText type="smallBold" themeColor="primary">
                        P
                      </ThemedText>
                    </View>
                    <View style={styles.flex1}>
                      <ThemedText type="small" themeColor="backgroundSelected">
                        Chave Pix · {LABEL_TIPO_CHAVE_PIX[chave.tipo]}
                      </ThemedText>
                      <ThemedText type="smallBold" themeColor="background" style={styles.valorGrande} numberOfLines={1}>
                        {mascararChavePix(chave.tipo, chave.valor)}
                      </ThemedText>
                    </View>
                    <View style={[styles.badgePrincipal, { backgroundColor: theme.statusSuccess }]}>
                      <ThemedText type="small" themeColor="background" style={styles.badgeTexto}>
                        PRINCIPAL
                      </ThemedText>
                    </View>
                  </View>
                  {!!chave.banco_nome && (
                    <>
                      <View style={[styles.divisor, { borderTopColor: 'rgba(255,255,255,0.15)' }]} />
                      <ThemedText type="small" themeColor="backgroundSelected">
                        {chave.banco_nome}
                      </ThemedText>
                    </>
                  )}
                </Pressable>
              ) : (
                <Pressable
                  key={chave.id}
                  style={[styles.cardClaro, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}
                  onPress={() => abrirEditarChave(chave)}
                >
                  <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="smallBold" themeColor="primary">
                      P
                    </ThemedText>
                  </View>
                  <View style={styles.flex1}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Chave Pix · {LABEL_TIPO_CHAVE_PIX[chave.tipo]}
                    </ThemedText>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {mascararChavePix(chave.tipo, chave.valor)}
                    </ThemedText>
                  </View>
                  <Ionicons name="ellipsis-horizontal" size={18} color={theme.textSecondary} />
                </Pressable>
              )
            )
          )}

          <Pressable style={[styles.botaoTracejado, { borderColor: theme.primary }]} onPress={abrirNovaChave}>
            <Ionicons name="add" size={18} color={theme.primary} />
            <ThemedText type="smallBold" themeColor="primary">
              Adicionar chave Pix
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            PARA PAGAR
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Métodos disponíveis pra pagar os bicos que você contrata.
          </ThemedText>

          <View style={[styles.cardClaro, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold" themeColor="primary">
                P
              </ThemedText>
            </View>
            <View style={styles.flex1}>
              <ThemedText type="smallBold">Pix</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Pague na hora pelo app do banco
              </ThemedText>
            </View>
            <Ionicons name="checkmark-circle" size={20} color={theme.statusSuccess} />
          </View>

          <View style={[styles.cardClaro, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold" themeColor="statusSuccess">
                R$
              </ThemedText>
            </View>
            <View style={styles.flex1}>
              <ThemedText type="smallBold">Dinheiro (em mãos)</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Confirmado pelos dois + comprovante
              </ThemedText>
            </View>
            <Ionicons name="checkmark-circle" size={20} color={theme.statusSuccess} />
          </View>

          <Pressable style={[styles.botaoTracejado, { borderColor: theme.textSecondary }]} onPress={cartaoEmBreve}>
            <Ionicons name="add" size={18} color={theme.textSecondary} />
            <ThemedText type="smallBold" themeColor="textSecondary">
              Adicionar cartão
            </ThemedText>
          </Pressable>
        </View>

        <View style={[styles.infoBox, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <Ionicons name="information-circle" size={20} color={theme.primary} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.flex1}>
            O Tô Dentro nunca guarda seu dinheiro. O pagamento vai direto pra pessoa — o app só ajuda a organizar quem já
            recebeu e quem ainda precisa pagar.
          </ThemedText>
        </View>
      </ScrollView>

      <Modal visible={modalAberto} animationType="slide" transparent onRequestClose={fecharModal}>
        <View style={styles.overlay}>
          <ThemedView style={styles.modalCard}>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <ThemedText type="subtitle" style={styles.modalTitulo}>
                  {editando ? 'Editar chave Pix' : 'Nova chave Pix'}
                </ThemedText>
                <Pressable onPress={fecharModal}>
                  <Ionicons name="close" size={22} color={theme.textSecondary} />
                </Pressable>
              </View>

              <View style={styles.field}>
                <ThemedText type="small" themeColor="textSecondary">
                  TIPO DE CHAVE
                </ThemedText>
                <View style={styles.chipsRow}>
                  {TIPOS_CHAVE.map((opcao) => (
                    <Pressable
                      key={opcao}
                      style={[styles.chip, { backgroundColor: tipo === opcao ? theme.primary : theme.backgroundSelected }]}
                      onPress={() => {
                        setTipo(opcao);
                        setValor('');
                      }}
                    >
                      <ThemedText type="smallBold" themeColor={tipo === opcao ? 'background' : 'textSecondary'}>
                        {LABEL_TIPO_CHAVE_PIX[opcao]}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.field}>
                <ThemedText type="small" themeColor="textSecondary">
                  CHAVE
                </ThemedText>
                <View style={[styles.box, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
                  <TextInput
                    value={valor}
                    onChangeText={(texto) => setValor(mascararChavePix(tipo, texto))}
                    placeholder={PLACEHOLDER_CHAVE[tipo]}
                    placeholderTextColor={theme.textSecondary}
                    keyboardType={tipo === 'cpf' || tipo === 'cnpj' || tipo === 'telefone' ? 'number-pad' : 'default'}
                    autoCapitalize="none"
                    style={[styles.input, { color: theme.text }]}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <ThemedText type="small" themeColor="textSecondary">
                  BANCO (OPCIONAL)
                </ThemedText>
                <View style={[styles.box, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
                  <TextInput
                    value={bancoNome}
                    onChangeText={setBancoNome}
                    placeholder="Nome do banco"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text }]}
                  />
                </View>
              </View>

              {editando && !editando.principal && (
                <Pressable style={styles.linkCentro} onPress={() => definirPrincipal(editando)}>
                  <ThemedText type="smallBold" themeColor="primary">
                    Definir como principal
                  </ThemedText>
                </Pressable>
              )}

              <Pressable
                style={[styles.button, { backgroundColor: theme.primary }, salvando && styles.disabled]}
                onPress={salvarChave}
                disabled={salvando}
              >
                <ThemedText type="default" themeColor="background" style={styles.buttonText}>
                  {salvando ? 'Salvando...' : 'Salvar chave Pix'}
                </ThemedText>
              </Pressable>

              {editando && (
                <Pressable style={styles.linkCentro} onPress={() => excluirChave(editando)}>
                  <ThemedText type="smallBold" themeColor="statusDanger">
                    Excluir chave
                  </ThemedText>
                </Pressable>
              )}
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 22,
  },
  body: {
    padding: Spacing.four,
    gap: Spacing.four,
  },
  field: {
    gap: Spacing.two,
  },
  loadingChaves: {
    paddingVertical: Spacing.four,
  },
  flex1: {
    flex: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linhaTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  cardPrincipal: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardClaro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  valorGrande: {
    fontSize: 16,
  },
  badgePrincipal: {
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
  botaoTracejado: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
  },
  infoBox: {
    flexDirection: 'row',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalCard: {
    borderTopLeftRadius: Spacing.five,
    borderTopRightRadius: Spacing.five,
    maxHeight: '85%',
  },
  modalBody: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitulo: {
    fontSize: 20,
    lineHeight: 26,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  box: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  input: {
    fontSize: 16,
  },
  linkCentro: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  button: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  disabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontWeight: '700',
  },
});

import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/services/supabaseClient';
import { mensagemErro } from '@/utils/erros';

type FormaPagamento = 'dinheiro' | 'pix';
type Dia = 'hoje' | 'amanha';

const HORA_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

type Categoria = {
  id: number;
  nome: string;
};

// Formato WKT que o Postgis (coluna geography do bico) espera receber via
// insert. Se o usuário negar a permissão de localização, o bico é criado
// sem coordenadas (só com o endereço em texto) — a busca por proximidade
// (bicos_proximos) simplesmente não vai encontrar esse bico depois.
//
// O aviso antes do prompt do sistema existe porque o app estava pedindo o GPS
// sem dizer pra quê, no meio de publicar um bico. Quem recusa aqui nem chega a
// ver o prompt nativo — que no iOS só aparece uma vez e, negado, só volta pelos
// Ajustes. A coordenada em si não é devolvida pra ninguém: desde a migration
// 0015 a coluna não é legível por outras contas e bicos_proximos só responde
// distância em metros.
async function obterLocalizacaoAtual(): Promise<string | null> {
  try {
    const permissaoAtual = await Location.getForegroundPermissionsAsync();

    if (!permissaoAtual.granted) {
      if (!permissaoAtual.canAskAgain) return null;

      const querPermitir = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Usar sua localização?',
          'Serve só pra mostrar este bico pra quem está perto. Ninguém vê o ponto exato — quem procura vê apenas a distância.',
          [
            { text: 'Agora não', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Permitir', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) }
        );
      });
      if (!querPermitir) return null;
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const posicao = await Location.getCurrentPositionAsync({});
    return `POINT(${posicao.coords.longitude} ${posicao.coords.latitude})`;
  } catch {
    return null;
  }
}

// Formulário de publicação de bico, aberto pelo botão "+" central da bottom
// tab bar. valor_oferecido é sempre por dia (não há opção de outra
// unidade); forma_pagamento pix só mostra um aviso, o QR Code em si é
// gerado depois, quando o contratante escolhe o candidato.
export default function CriarBicoScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [titulo, setTitulo] = useState('');
  const [categoriaId, setCategoriaId] = useState<number | null>(null);
  const [endereco, setEndereco] = useState('');
  const [dia, setDia] = useState<Dia>('hoje');
  const [hora, setHora] = useState('08:00');
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>('dinheiro');
  const [valor, setValor] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const categoriasQuery = useQuery({
    queryKey: ['categorias'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categorias').select('id, nome').order('id');
      if (error) throw error;
      return data as Categoria[];
    },
  });

  const calcularDataHoraDesejada = () => {
    const [horaStr, minutoStr] = hora.split(':');
    const horas = Number(horaStr);
    const minutos = Number(minutoStr);
    const data = new Date();
    if (dia === 'amanha') data.setDate(data.getDate() + 1);
    if (!Number.isNaN(horas) && !Number.isNaN(minutos)) {
      data.setHours(horas, minutos, 0, 0);
    }
    return data.toISOString();
  };

  const handlePublicar = async () => {
    setErro(null);

    const valorNumerico = Number(valor.replace(',', '.'));
    if (!titulo.trim()) {
      setErro('Dê um título para o serviço.');
      return;
    }
    if (categoriaId == null) {
      setErro('Escolha uma categoria.');
      return;
    }
    if (!valor || Number.isNaN(valorNumerico) || valorNumerico <= 0) {
      setErro('Informe um valor válido.');
      return;
    }
    if (!HORA_REGEX.test(hora.trim())) {
      setErro('Informe um horário válido (formato HH:MM).');
      return;
    }

    setEnviando(true);

    const { data: sessao } = await supabase.auth.getUser();
    if (!sessao.user) {
      setEnviando(false);
      setErro('Sessão expirada. Faça login novamente.');
      return;
    }

    const localizacaoAtual = await obterLocalizacaoAtual();

    const { error } = await supabase.from('bicos').insert({
      criado_por: sessao.user.id,
      categoria_id: categoriaId,
      titulo: titulo.trim(),
      endereco_texto: endereco.trim() || null,
      data_hora_desejada: calcularDataHoraDesejada(),
      valor_oferecido: valorNumerico,
      forma_pagamento: formaPagamento,
      localizacao: localizacaoAtual,
    });

    setEnviando(false);

    if (error) {
      setErro(mensagemErro(error, 'publicar o bico'));
      return;
    }

    queryClient.invalidateQueries({ queryKey: ['bicos-abertos'] });
    router.back();
  };

  return (
    <ThemedView style={styles.container}>
      <StatusBar style="light" />
      <View style={[styles.hero, { backgroundColor: theme.primary }]}>
        <SafeAreaView edges={['top']} style={styles.heroContent}>
          <Pressable style={[styles.backButton, { backgroundColor: theme.background }]} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={20} color={theme.primary} />
          </Pressable>
          <ThemedText type="subtitle" themeColor="background" style={styles.heroTitle}>
            Criar um bico
          </ThemedText>
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            TÍTULO DO SERVIÇO
          </ThemedText>
          <View style={[styles.box, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <TextInput
              value={titulo}
              onChangeText={setTitulo}
              placeholder="Ex: Servente de pedreiro"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text }]}
            />
          </View>
        </View>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            CATEGORIA
          </ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {categoriasQuery.data?.map((categoria) => (
              <Pressable
                key={categoria.id}
                style={[
                  styles.chip,
                  { backgroundColor: categoriaId === categoria.id ? theme.primary : theme.background },
                ]}
                onPress={() => setCategoriaId(categoria.id)}
              >
                <ThemedText type="smallBold" themeColor={categoriaId === categoria.id ? 'background' : 'text'}>
                  {categoria.nome}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.row}>
          <View style={[styles.field, styles.flex1]}>
            <ThemedText type="small" themeColor="textSecondary">
              LOCAL
            </ThemedText>
            <View style={[styles.box, styles.boxRow, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
              <Ionicons name="location-outline" size={16} color={theme.statusDanger} />
              <TextInput
                value={endereco}
                onChangeText={setEndereco}
                placeholder="Bairro, cidade"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text }]}
              />
            </View>
          </View>

          <View style={[styles.field, styles.flex1]}>
            <ThemedText type="small" themeColor="textSecondary">
              QUANDO
            </ThemedText>
            <View style={[styles.box, styles.boxRow, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
              <Ionicons name="time-outline" size={16} color={theme.textSecondary} />
              <Pressable onPress={() => setDia(dia === 'hoje' ? 'amanha' : 'hoje')}>
                <ThemedText type="default">{dia === 'hoje' ? 'Hoje' : 'Amanhã'}, </ThemedText>
              </Pressable>
              <TextInput
                value={hora}
                onChangeText={setHora}
                placeholder="08:00"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, styles.horaInput, { color: theme.text }]}
              />
            </View>
          </View>
        </View>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            PAGAMENTO
          </ThemedText>
          <View style={styles.row}>
            <Pressable
              style={[
                styles.pagamentoCard,
                styles.flex1,
                {
                  backgroundColor: theme.background,
                  borderColor: formaPagamento === 'dinheiro' ? theme.primary : theme.backgroundSelected,
                },
              ]}
              onPress={() => setFormaPagamento('dinheiro')}
            >
              <View style={[styles.pagamentoIcone, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name="cash-outline" size={18} color={theme.statusSuccess} />
              </View>
              <ThemedText type="smallBold">Dinheiro</ThemedText>
            </Pressable>

            <Pressable
              style={[
                styles.pagamentoCard,
                styles.flex1,
                {
                  backgroundColor: theme.background,
                  borderColor: formaPagamento === 'pix' ? theme.primary : theme.backgroundSelected,
                },
              ]}
              onPress={() => setFormaPagamento('pix')}
            >
              {formaPagamento === 'pix' && (
                <View style={[styles.checkBadge, { backgroundColor: theme.primary }]}>
                  <Ionicons name="checkmark" size={12} color={theme.background} />
                </View>
              )}
              <View style={[styles.pagamentoIcone, { backgroundColor: theme.primary }]}>
                <ThemedText type="smallBold" themeColor="background">
                  P
                </ThemedText>
              </View>
              <ThemedText type="smallBold" themeColor="primary">
                Pix
              </ThemedText>
            </Pressable>
          </View>

          {/* O texto antigo prometia "o QR Code será gerado quando você
              escolher o candidato" — não existe geração de QR em lugar nenhum,
              e a chave Pix do prestador nem chega em quem paga (a RLS de
              chaves_pix só deixa o dono ler a própria). Enquanto o Pix não for
              integrado de verdade, o texto diz o que realmente acontece. */}
          {formaPagamento === 'pix' && (
            <View style={[styles.hint, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="small" themeColor="primary">
                Pix selecionado — combine a chave com o prestador pelo chat depois de escolher.
              </ThemedText>
            </View>
          )}
        </View>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            VALOR
          </ThemedText>
          <View style={[styles.box, styles.boxRow, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              R$
            </ThemedText>
            <TextInput
              value={valor}
              onChangeText={setValor}
              placeholder="0,00"
              placeholderTextColor={theme.textSecondary}
              keyboardType="numeric"
              style={[styles.input, styles.valorInput, { color: theme.text }]}
            />
            <ThemedText type="small" themeColor="textSecondary">
              / por dia
            </ThemedText>
          </View>
        </View>

        {erro && (
          <ThemedText type="small" themeColor="statusDanger">
            {erro}
          </ThemedText>
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={[styles.footer, { backgroundColor: theme.backgroundElement }]}>
        <Pressable
          style={[styles.button, { backgroundColor: theme.primary }, enviando && styles.disabled]}
          onPress={handlePublicar}
          disabled={enviando}
        >
          <ThemedText type="default" themeColor="background" style={styles.buttonText}>
            {enviando ? 'Publicando...' : 'Publicar bico'}
          </ThemedText>
        </Pressable>
      </SafeAreaView>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
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
  body: {
    padding: Spacing.four,
    gap: Spacing.four,
  },
  field: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  flex1: {
    flex: 1,
  },
  box: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  boxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
  horaInput: {
    minWidth: 50,
  },
  valorInput: {
    fontSize: 20,
    fontWeight: '700',
  },
  chipsRow: {
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  pagamentoCard: {
    borderWidth: 2,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  pagamentoIcone: {
    width: 32,
    height: 32,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadge: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
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

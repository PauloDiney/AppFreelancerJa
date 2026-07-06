import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabBar } from '@/components/bottom-tab-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useUsuarioLogado } from '@/hooks/use-usuario-logado';
import { supabase } from '@/services/supabaseClient';
import { formatarDataCurta, formatarQuando, formatarValor, iniciais } from '@/utils/bico';

type FormaPagamento = 'dinheiro' | 'pix';
type TipoPagamento = 'aguardando' | 'recebido' | 'pago';
type Filtro = 'todos' | 'recebidos' | 'pagos' | 'pix';

type BicoPrestador = {
  id: string;
  titulo: string;
  valor_oferecido: number | null;
  forma_pagamento: FormaPagamento;
  status: 'em_andamento' | 'concluido';
  atualizado_em: string;
  profiles: { nome_completo: string | null } | null;
};

type BicoContratante = {
  id: string;
  titulo: string;
  valor_oferecido: number | null;
  forma_pagamento: FormaPagamento;
  atualizado_em: string;
  profiles: { nome_completo: string | null } | null;
};

type Comprovante = {
  bico_id: string;
  arquivo_url: string;
  observacao: string | null;
  criado_em: string;
};

type ItemPagamento = {
  id: string;
  titulo: string;
  contraparte: string;
  formaPagamento: FormaPagamento;
  valor: number | null;
  data: string;
  tipo: TipoPagamento;
  comprovante: Comprovante | null;
};

const EXTENSOES_IMAGEM = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'];

function nomeArquivoComprovante(comprovante: Comprovante) {
  if (comprovante.observacao) return comprovante.observacao;
  const semQuery = comprovante.arquivo_url.split('?')[0];
  return decodeURIComponent(semQuery.split('/').pop() ?? 'Comprovante');
}

function iconeComprovante(comprovante: Comprovante): keyof typeof Ionicons.glyphMap {
  const extensao = comprovante.arquivo_url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return EXTENSOES_IMAGEM.includes(extensao) ? 'image-outline' : 'document-text-outline';
}

function iconeTipo(tipo: TipoPagamento, formaPagamento: FormaPagamento): keyof typeof Ionicons.glyphMap {
  if (tipo === 'recebido') return formaPagamento === 'pix' ? 'arrow-down-circle' : 'cash';
  return 'card-outline';
}

// Tela "Pagamentos e comprovantes" (aberta a partir do menu do perfil):
// junta os bicos em que o usuário foi prestador (aguardando pagamento ou já
// recebido) com os bicos em que ele foi contratante e pagou, mais os
// comprovantes anexados a cada um — tudo numa linha do tempo só, mais
// recente primeiro, com o "aguardando pagamento" sempre fixado no topo.
export default function PagamentosScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const usuarioQuery = useUsuarioLogado();
  const usuarioId = usuarioQuery.data?.id;

  const prestadorQuery = useQuery({
    queryKey: ['pagamentos-prestador', usuarioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bicos')
        .select(
          'id, titulo, valor_oferecido, forma_pagamento, status, atualizado_em, profiles!bicos_criado_por_fkey(nome_completo)'
        )
        .eq('candidato_selecionado_id', usuarioId)
        .in('status', ['em_andamento', 'concluido'])
        .order('atualizado_em', { ascending: false });
      if (error) throw error;
      return data as unknown as BicoPrestador[];
    },
    enabled: !!usuarioId,
  });

  const contratanteQuery = useQuery({
    queryKey: ['pagamentos-contratante', usuarioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bicos')
        .select(
          'id, titulo, valor_oferecido, forma_pagamento, atualizado_em, profiles!bicos_candidato_selecionado_id_fkey(nome_completo)'
        )
        .eq('criado_por', usuarioId)
        .eq('status', 'concluido')
        .not('candidato_selecionado_id', 'is', null)
        .order('atualizado_em', { ascending: false });
      if (error) throw error;
      return data as unknown as BicoContratante[];
    },
    enabled: !!usuarioId,
  });

  const bicoIds = useMemo(
    () => [...(prestadorQuery.data ?? []).map((b) => b.id), ...(contratanteQuery.data ?? []).map((b) => b.id)],
    [prestadorQuery.data, contratanteQuery.data]
  );

  const comprovantesQuery = useQuery({
    queryKey: ['comprovantes-pagamentos', bicoIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comprovantes_pagamento')
        .select('bico_id, arquivo_url, observacao, criado_em')
        .in('bico_id', bicoIds)
        .order('criado_em', { ascending: false });
      if (error) throw error;
      return data as Comprovante[];
    },
    enabled: bicoIds.length > 0,
  });

  const comprovantePorBico = useMemo(() => {
    const mapa = new Map<string, Comprovante>();
    comprovantesQuery.data?.forEach((comprovante) => {
      if (!mapa.has(comprovante.bico_id)) mapa.set(comprovante.bico_id, comprovante);
    });
    return mapa;
  }, [comprovantesQuery.data]);

  const itens = useMemo<ItemPagamento[]>(() => {
    const doPrestador = (prestadorQuery.data ?? []).map((bico) => ({
      id: bico.id,
      titulo: bico.titulo,
      contraparte: bico.profiles?.nome_completo ?? 'Contratante',
      formaPagamento: bico.forma_pagamento,
      valor: bico.valor_oferecido,
      data: bico.atualizado_em,
      tipo: (bico.status === 'em_andamento' ? 'aguardando' : 'recebido') as TipoPagamento,
      comprovante: comprovantePorBico.get(bico.id) ?? null,
    }));

    const doContratante = (contratanteQuery.data ?? []).map((bico) => ({
      id: bico.id,
      titulo: bico.titulo,
      contraparte: bico.profiles?.nome_completo ?? 'Prestador',
      formaPagamento: bico.forma_pagamento,
      valor: bico.valor_oferecido,
      data: bico.atualizado_em,
      tipo: 'pago' as TipoPagamento,
      comprovante: comprovantePorBico.get(bico.id) ?? null,
    }));

    return [...doPrestador, ...doContratante].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
  }, [prestadorQuery.data, contratanteQuery.data, comprovantePorBico]);

  const filtrados = useMemo(() => {
    if (filtro === 'todos') return itens;
    if (filtro === 'recebidos') return itens.filter((item) => item.tipo === 'recebido' || item.tipo === 'aguardando');
    if (filtro === 'pagos') return itens.filter((item) => item.tipo === 'pago');
    return itens.filter((item) => item.formaPagamento === 'pix');
  }, [itens, filtro]);

  const { aguardando, resto } = useMemo(() => {
    const aguardando = filtrados.filter((item) => item.tipo === 'aguardando');
    const resto = filtrados.filter((item) => item.tipo !== 'aguardando');
    return { aguardando, resto };
  }, [filtrados]);

  const resumo = useMemo(() => {
    const agora = new Date();
    let recebidoMes = 0;
    let esteAno = 0;
    let aReceber = 0;

    itens.forEach((item) => {
      const dataItem = new Date(item.data);
      if (item.tipo === 'recebido') {
        if (dataItem.getFullYear() === agora.getFullYear()) esteAno += item.valor ?? 0;
        if (dataItem.getFullYear() === agora.getFullYear() && dataItem.getMonth() === agora.getMonth()) {
          recebidoMes += item.valor ?? 0;
        }
      }
      if (item.tipo === 'aguardando') aReceber += item.valor ?? 0;
    });

    const mesLabel = agora.toLocaleDateString('pt-BR', { month: 'long' });
    return { recebidoMes, esteAno, aReceber, mesLabel };
  }, [itens]);

  const abrirComprovante = (url: string) => {
    Linking.openURL(url);
  };

  const carregando = usuarioQuery.isLoading || prestadorQuery.isLoading || contratanteQuery.isLoading;

  const renderItem = (item: ItemPagamento) => {
    if (item.tipo === 'aguardando') {
      return (
        <Pressable
          key={item.id}
          style={[styles.cardDestaque, { backgroundColor: theme.backgroundElement, borderColor: theme.statusPending }]}
          onPress={() => router.push({ pathname: '/bico/[id]', params: { id: item.id } })}
        >
          <View style={[styles.avatar, { backgroundColor: theme.statusPending }]}>
            <ThemedText type="smallBold" themeColor="background">
              {iniciais(item.contraparte)}
            </ThemedText>
          </View>
          <View style={styles.flex1}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {item.titulo}
            </ThemedText>
            <ThemedText type="small" themeColor="statusPending">
              {item.formaPagamento === 'pix' ? 'Pix' : 'Dinheiro'} · aguardando pagamento
            </ThemedText>
          </View>
          <View style={styles.valorColuna}>
            <ThemedText type="smallBold">{formatarValor(item.valor)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatarQuando(item.data)}
            </ThemedText>
          </View>
        </Pressable>
      );
    }

    const positivo = item.tipo === 'recebido';
    const corValor: ThemeColor = positivo ? 'statusSuccess' : 'text';
    const iconeBg: ThemeColor = positivo ? 'statusSuccess' : 'backgroundElement';

    return (
      <Pressable
        key={item.id}
        style={[styles.cardClaro, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}
        onPress={() => router.push({ pathname: '/bico/[id]', params: { id: item.id } })}
      >
        <View style={styles.linhaTopo}>
          <View style={[styles.avatar, { backgroundColor: theme[iconeBg] }]}>
            {positivo ? (
              <Ionicons name={iconeTipo(item.tipo, item.formaPagamento)} size={18} color={theme.background} />
            ) : (
              <ThemedText type="smallBold" themeColor="primary">
                {iniciais(item.contraparte)}
              </ThemedText>
            )}
          </View>
          <View style={styles.flex1}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {item.titulo}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {item.tipo === 'pago' ? 'Você pagou' : item.contraparte} · {formatarDataCurta(item.data)} ·{' '}
              {item.formaPagamento === 'pix' ? 'Pix' : 'Dinheiro'}
            </ThemedText>
          </View>
          <View style={styles.valorColuna}>
            <ThemedText type="smallBold" themeColor={corValor}>
              {positivo ? '+ ' : '- '}
              {formatarValor(item.valor)}
            </ThemedText>
            <ThemedText type="small" themeColor={positivo ? 'statusSuccess' : 'textSecondary'}>
              {positivo ? 'Recebido' : 'Pago'}
            </ThemedText>
          </View>
        </View>

        {item.comprovante && (
          <>
            <View style={[styles.divisor, { borderTopColor: theme.backgroundSelected }]} />
            <View style={styles.linhaComprovante}>
              <Ionicons name={iconeComprovante(item.comprovante)} size={16} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.flex1}>
                {nomeArquivoComprovante(item.comprovante)}
              </ThemedText>
              <Pressable onPress={() => abrirComprovante(item.comprovante!.arquivo_url)}>
                <ThemedText type="smallBold" themeColor="primary">
                  Ver
                </ThemedText>
              </Pressable>
              <Pressable onPress={() => abrirComprovante(item.comprovante!.arquivo_url)}>
                <ThemedText type="smallBold" themeColor="primary">
                  Baixar
                </ThemedText>
              </Pressable>
            </View>
          </>
        )}
      </Pressable>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.hero, { backgroundColor: theme.primary }]}>
        <SafeAreaView edges={['top']} style={styles.heroContent}>
          <View style={styles.heroTopRow}>
            <Pressable style={[styles.backButton, { backgroundColor: 'rgba(255,255,255,0.25)' }]} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={20} color={theme.background} />
            </Pressable>
            <ThemedText type="subtitle" themeColor="background" style={styles.heroTitle}>
              Pagamentos
            </ThemedText>
          </View>

          <View style={[styles.resumoBox, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
            <ThemedText type="small" themeColor="backgroundSelected">
              RECEBIDO EM {resumo.mesLabel.toUpperCase()}
            </ThemedText>
            <ThemedText type="title" themeColor="background" style={styles.resumoValor}>
              {formatarValor(resumo.recebidoMes)}
            </ThemedText>
            <View style={styles.resumoSubRow}>
              <View style={styles.flex1}>
                <ThemedText type="small" themeColor="backgroundSelected">
                  A receber
                </ThemedText>
                <ThemedText type="smallBold" themeColor="statusPending">
                  {formatarValor(resumo.aReceber)}
                </ThemedText>
              </View>
              <View style={styles.flex1}>
                <ThemedText type="small" themeColor="backgroundSelected">
                  Este ano
                </ThemedText>
                <ThemedText type="smallBold" themeColor="background">
                  {formatarValor(resumo.esteAno)}
                </ThemedText>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.filtros}>
        {(
          [
            { key: 'todos', label: 'Tudo' },
            { key: 'recebidos', label: 'Recebidos' },
            { key: 'pagos', label: 'Pagos' },
            { key: 'pix', label: 'Pix' },
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
              Nenhum pagamento por aqui ainda.
            </ThemedText>
          )}
          {aguardando.map(renderItem)}
          {resto.map(renderItem)}
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
  resumoBox: {
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.half,
  },
  resumoValor: {
    fontSize: 36,
    lineHeight: 42,
  },
  resumoSubRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginTop: Spacing.two,
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
    gap: Spacing.three,
  },
  centerText: {
    textAlign: 'center',
    paddingTop: Spacing.five,
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
  valorColuna: {
    alignItems: 'flex-end',
    gap: Spacing.half,
  },
  cardDestaque: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
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
  divisor: {
    borderTopWidth: 1,
  },
  linhaComprovante: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});

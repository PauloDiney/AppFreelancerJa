import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/services/supabaseClient';
import { ErroAvatar, escolherEEnviarAvatar } from '@/utils/avatar';
import { mensagemErro } from '@/utils/erros';

type Perfil = {
  nome_completo: string | null;
  telefone: string | null;
  biografia: string | null;
  foto_url: string | null;
};

// Tela de edição do próprio perfil (nome, telefone, biografia, foto).
//
// A tela está partida em duas: esta busca os dados, e <FormularioPerfil> só é
// montado quando eles chegam, inicializando os campos direto no useState. Antes
// era um componente só que copiava a resposta pra dentro do estado num
// useEffect — o que dispara uma cascata de renders a cada carregamento (é o que
// a regra react-hooks/set-state-in-effect aponta) e deixava a tela num estado
// intermediário com todos os campos vazios.
export default function EditarPerfilScreen() {
  const theme = useTheme();

  const perfilQuery = useQuery({
    queryKey: ['editar-perfil'],
    retry: 1,
    queryFn: async () => {
      const { data: sessao } = await supabase.auth.getUser();
      if (!sessao.user) throw new Error('Sessão expirada.');
      // O telefone não vem junto do select de profiles de propósito: essa
      // coluna foi bloqueada por RLS pra qualquer authenticated (migration
      // 0011, pra ninguém conseguir ler o telefone de outro usuário) e só
      // pode ser lida pelo dono via essa RPC (meu_telefone). Não dá pra
      // "simplificar" isso de volta pra um select direto sem reabrir a
      // brecha de privacidade.
      const [{ data, error }, { data: telefone, error: erroTelefone }] = await Promise.all([
        supabase.from('profiles').select('nome_completo, biografia, foto_url').eq('id', sessao.user.id).single(),
        supabase.rpc('meu_telefone'),
      ]);
      if (error) throw error;
      if (erroTelefone) throw erroTelefone;
      return { usuarioId: sessao.user.id, perfil: { ...data, telefone } as Perfil };
    },
  });

  if (perfilQuery.isLoading) {
    return (
      <ThemedView style={styles.loading}>
        <ActivityIndicator color={theme.primary} />
      </ThemedView>
    );
  }

  if (perfilQuery.isError || !perfilQuery.data) {
    return (
      <ThemedView style={[styles.loading, styles.erroContainer]}>
        <ThemedText themeColor="statusDanger" style={styles.centerText}>
          {mensagemErro(perfilQuery.error as Error, 'carregar seu perfil')}
        </ThemedText>
        <Pressable style={[styles.button, { backgroundColor: theme.primary }]} onPress={() => perfilQuery.refetch()}>
          <ThemedText type="default" themeColor="background" style={styles.buttonText}>
            Tentar novamente
          </ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  // key no id: se a query passar a devolver outro usuário (troca de conta no
  // mesmo aparelho), o formulário remonta com os campos da conta certa em vez
  // de manter o que já estava digitado.
  return (
    <FormularioPerfil
      key={perfilQuery.data.usuarioId}
      usuarioId={perfilQuery.data.usuarioId}
      perfil={perfilQuery.data.perfil}
    />
  );
}

function FormularioPerfil({ usuarioId, perfil }: { usuarioId: string; perfil: Perfil }) {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [nome, setNome] = useState(perfil.nome_completo ?? '');
  const [telefone, setTelefone] = useState(perfil.telefone ?? '');
  const [biografia, setBiografia] = useState(perfil.biografia ?? '');
  const [fotoUrl, setFotoUrl] = useState<string | null>(perfil.foto_url);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const escolherFoto = async () => {
    setEnviandoFoto(true);
    try {
      const novaUrl = await escolherEEnviarAvatar(usuarioId);
      if (!novaUrl) return;
      setFotoUrl(novaUrl);
      queryClient.invalidateQueries({ queryKey: ['perfil-logado'] });
    } catch (erro) {
      Alert.alert(
        'Não foi possível trocar a foto',
        erro instanceof ErroAvatar ? erro.message : mensagemErro(erro as Error, 'enviar a foto')
      );
    } finally {
      setEnviandoFoto(false);
    }
  };

  const salvar = async () => {
    setSalvando(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        nome_completo: nome.trim() || null,
        telefone: telefone.trim() || null,
        biografia: biografia.trim() || null,
      })
      .eq('id', usuarioId);
    setSalvando(false);

    if (error) {
      Alert.alert('Não foi possível salvar', mensagemErro(error, 'salvar as alterações'));
      return;
    }

    queryClient.invalidateQueries({ queryKey: ['perfil-logado'] });
    queryClient.invalidateQueries({ queryKey: ['editar-perfil'] });
    router.back();
  };

  return (
    <ThemedView style={styles.container}>
      <StatusBar style="light" />
      <View style={[styles.hero, { backgroundColor: theme.primary }]}>
        <SafeAreaView edges={['top']} style={styles.heroContent}>
          <Pressable style={[styles.backButton, { backgroundColor: 'rgba(255,255,255,0.25)' }]} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={20} color={theme.background} />
          </Pressable>
          <ThemedText type="subtitle" themeColor="background" style={styles.heroTitle}>
            Editar perfil
          </ThemedText>
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Pressable style={styles.avatarWrapper} onPress={escolherFoto} disabled={enviandoFoto}>
          <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
            {enviandoFoto ? (
              <ActivityIndicator color={theme.primary} />
            ) : fotoUrl ? (
              <Image source={{ uri: fotoUrl }} style={styles.avatarImagem} />
            ) : (
              <Ionicons name="person" size={32} color={theme.textSecondary} />
            )}
          </View>
          <View style={[styles.avatarBadge, { backgroundColor: theme.primary }]}>
            <Ionicons name="camera" size={14} color={theme.background} />
          </View>
        </Pressable>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            NOME COMPLETO
          </ThemedText>
          <View style={[styles.box, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <TextInput
              value={nome}
              onChangeText={setNome}
              placeholder="Seu nome"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text }]}
            />
          </View>
        </View>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            TELEFONE
          </ThemedText>
          <View style={[styles.box, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <TextInput
              value={telefone}
              onChangeText={setTelefone}
              placeholder="(11) 90000-0000"
              placeholderTextColor={theme.textSecondary}
              keyboardType="phone-pad"
              style={[styles.input, { color: theme.text }]}
            />
          </View>
        </View>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            BIOGRAFIA
          </ThemedText>
          <View style={[styles.box, styles.boxMultiline, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <TextInput
              value={biografia}
              onChangeText={setBiografia}
              placeholder="Conte um pouco sobre você"
              placeholderTextColor={theme.textSecondary}
              multiline
              style={[styles.input, styles.inputMultiline, { color: theme.text }]}
            />
          </View>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={[styles.footer, { backgroundColor: theme.backgroundElement }]}>
        <Pressable
          style={[styles.button, { backgroundColor: theme.primary }, salvando && styles.disabled]}
          onPress={salvar}
          disabled={salvando}
        >
          <ThemedText type="default" themeColor="background" style={styles.buttonText}>
            {salvando ? 'Salvando...' : 'Salvar alterações'}
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
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  erroContainer: {
    gap: Spacing.four,
    paddingHorizontal: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
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
    alignItems: 'center',
  },
  avatarWrapper: {
    alignSelf: 'center',
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImagem: {
    width: 96,
    height: 96,
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    gap: Spacing.two,
    width: '100%',
  },
  box: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  boxMultiline: {
    minHeight: 96,
  },
  input: {
    fontSize: 16,
  },
  inputMultiline: {
    minHeight: 72,
    textAlignVertical: 'top',
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

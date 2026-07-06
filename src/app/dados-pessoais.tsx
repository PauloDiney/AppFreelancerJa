import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/services/supabaseClient';
import {
  LABEL_SEXO,
  Sexo,
  TipoCadastro,
  buscarEnderecoPorCep,
  dataParaISO,
  isoParaDataBR,
  mascararCEP,
  mascararCNPJ,
  mascararCPF,
  mascararData,
  somenteDigitos,
  validarCNPJ,
  validarCPF,
} from '@/utils/documentos';
import { mensagemErro } from '@/utils/erros';

type PerfilPublico = {
  nome_completo: string | null;
  foto_url: string | null;
  biografia: string | null;
  email: string | null;
};

type DadosPrivados = {
  telefone: string | null;
  tipo_cadastro: TipoCadastro;
  cpf: string | null;
  cnpj: string | null;
  data_nascimento: string | null;
  sexo: Sexo | null;
  cep: string | null;
  cidade: string | null;
  uf: string | null;
  bairro: string | null;
};

const OPCOES_SEXO: Sexo[] = ['masculino', 'feminino', 'outro', 'prefiro_nao_dizer'];

// Tela "Dados pessoais" (aberta a partir de Configurações → Conta): reúne os
// campos "públicos" do perfil (profiles, já liberados pra qualquer
// authenticated — ver migration 0011) com os campos sensíveis (telefone,
// CPF/CNPJ, nascimento, sexo, endereço), que só o dono lê, via a RPC
// meus_dados_pessoais (migration 0012). Editar-perfil continua existindo
// como o atalho rápido (foto + nome + telefone + bio) a partir do próprio
// perfil; esta tela é o cadastro completo.
export default function DadosPessoaisScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [usuarioId, setUsuarioId] = useState<string | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [tipoCadastro, setTipoCadastro] = useState<TipoCadastro>('pessoa_fisica');
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [sexo, setSexo] = useState<Sexo | null>(null);
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [cep, setCep] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [bairro, setBairro] = useState('');
  const [biografia, setBiografia] = useState('');
  const [buscandoCep, setBuscandoCep] = useState(false);

  const dadosQuery = useQuery({
    queryKey: ['dados-pessoais'],
    retry: 1,
    queryFn: async () => {
      const { data: sessao } = await supabase.auth.getUser();
      if (!sessao.user) throw new Error('Sessão expirada.');

      const [{ data: publico, error: erroPublico }, { data: privado, error: erroPrivado }] = await Promise.all([
        supabase.from('profiles').select('nome_completo, foto_url, biografia, email').eq('id', sessao.user.id).single(),
        supabase.rpc('meus_dados_pessoais').single(),
      ]);
      if (erroPublico) throw erroPublico;
      if (erroPrivado) throw erroPrivado;

      return {
        usuarioId: sessao.user.id,
        publico: publico as PerfilPublico,
        privado: privado as DadosPrivados,
      };
    },
  });

  useEffect(() => {
    if (!dadosQuery.data) return;
    const { usuarioId, publico, privado } = dadosQuery.data;

    setUsuarioId(usuarioId);
    setFotoUrl(publico.foto_url);
    setNome(publico.nome_completo ?? '');
    setBiografia(publico.biografia ?? '');
    setEmail(publico.email ?? '');

    setTipoCadastro(privado.tipo_cadastro);
    setCpf(privado.cpf ? mascararCPF(privado.cpf) : '');
    setCnpj(privado.cnpj ? mascararCNPJ(privado.cnpj) : '');
    setNascimento(isoParaDataBR(privado.data_nascimento));
    setSexo(privado.sexo);
    setTelefone(privado.telefone ?? '');
    setCep(privado.cep ? mascararCEP(privado.cep) : '');
    setCidade(privado.cidade ?? '');
    setUf(privado.uf ?? '');
    setBairro(privado.bairro ?? '');
  }, [dadosQuery.data]);

  const escolherFoto = async () => {
    if (!usuarioId) return;

    const permissao = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissao.status !== 'granted') {
      Alert.alert('Permissão necessária', 'Precisamos de acesso às suas fotos para trocar o avatar.');
      return;
    }

    const resultado = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (resultado.canceled) return;

    const asset = resultado.assets[0];
    const extensao = asset.mimeType?.split('/')[1] ?? 'jpg';
    const caminho = `${usuarioId}/avatar.${extensao}`;

    setEnviandoFoto(true);
    try {
      const resposta = await fetch(asset.uri);
      const arrayBuffer = await resposta.arrayBuffer();
      const { error: erroUpload } = await supabase.storage
        .from('avatars')
        .upload(caminho, arrayBuffer, { contentType: asset.mimeType ?? 'image/jpeg', upsert: true });
      if (erroUpload) throw erroUpload;

      const { data: urlPublica } = supabase.storage.from('avatars').getPublicUrl(caminho);
      const novaUrl = `${urlPublica.publicUrl}?t=${Date.now()}`;

      const { error: erroPerfil } = await supabase.from('profiles').update({ foto_url: novaUrl }).eq('id', usuarioId);
      if (erroPerfil) throw erroPerfil;

      setFotoUrl(novaUrl);
      queryClient.invalidateQueries({ queryKey: ['perfil-logado'] });
    } catch (erro) {
      Alert.alert('Não foi possível enviar a foto', mensagemErro(erro as Error, 'enviar a foto'));
    } finally {
      setEnviandoFoto(false);
    }
  };

  const aoMudarCep = async (texto: string) => {
    const mascarado = mascararCEP(texto);
    setCep(mascarado);
    if (somenteDigitos(mascarado).length !== 8) return;

    setBuscandoCep(true);
    try {
      const endereco = await buscarEnderecoPorCep(mascarado);
      if (endereco) {
        setCidade(endereco.cidade);
        setUf(endereco.uf);
        setBairro(endereco.bairro);
      }
    } catch {
      // Falha na busca de CEP não impede o usuário de preencher manualmente.
    } finally {
      setBuscandoCep(false);
    }
  };

  const cpfValido = tipoCadastro === 'pessoa_fisica' && validarCPF(cpf);
  const cnpjValido = tipoCadastro === 'empresa' && validarCNPJ(cnpj);
  const telefoneValido = somenteDigitos(telefone).length === 11;

  const salvar = async () => {
    if (!usuarioId) return;

    if (tipoCadastro === 'pessoa_fisica' && cpf.trim() && !validarCPF(cpf)) {
      Alert.alert('CPF inválido', 'Confira os números digitados.');
      return;
    }
    if (tipoCadastro === 'empresa' && cnpj.trim() && !validarCNPJ(cnpj)) {
      Alert.alert('CNPJ inválido', 'Confira os números digitados.');
      return;
    }

    let dataNascimentoISO: string | null = null;
    if (nascimento.trim()) {
      dataNascimentoISO = dataParaISO(nascimento);
      if (!dataNascimentoISO) {
        Alert.alert('Data de nascimento inválida', 'Use o formato dd/mm/aaaa.');
        return;
      }
    }

    setSalvando(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        nome_completo: nome.trim() || null,
        biografia: biografia.trim() || null,
        telefone: telefone.trim() || null,
        tipo_cadastro: tipoCadastro,
        cpf: tipoCadastro === 'pessoa_fisica' && cpf.trim() ? somenteDigitos(cpf) : null,
        cnpj: tipoCadastro === 'empresa' && cnpj.trim() ? somenteDigitos(cnpj) : null,
        data_nascimento: dataNascimentoISO,
        sexo,
        cep: cep.trim() ? somenteDigitos(cep) : null,
        cidade: cidade.trim() || null,
        uf: uf.trim() || null,
        bairro: bairro.trim() || null,
      })
      .eq('id', usuarioId);
    setSalvando(false);

    if (error) {
      Alert.alert('Não foi possível salvar', mensagemErro(error, 'salvar seus dados'));
      return;
    }

    queryClient.invalidateQueries({ queryKey: ['perfil-logado'] });
    queryClient.invalidateQueries({ queryKey: ['dados-pessoais'] });
    router.back();
  };

  if (dadosQuery.isLoading) {
    return (
      <ThemedView style={styles.loading}>
        <ActivityIndicator color={theme.primary} />
      </ThemedView>
    );
  }

  if (dadosQuery.isError) {
    return (
      <ThemedView style={[styles.loading, styles.erroContainer]}>
        <ThemedText themeColor="statusDanger" style={styles.centerText}>
          {mensagemErro(dadosQuery.error as Error, 'carregar seus dados')}
        </ThemedText>
        <Pressable style={[styles.button, { backgroundColor: theme.primary }]} onPress={() => dadosQuery.refetch()}>
          <ThemedText type="default" themeColor="background" style={styles.buttonText}>
            Tentar novamente
          </ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <Pressable style={[styles.backButton, { backgroundColor: theme.background }]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color={theme.text} />
        </Pressable>
        <ThemedText type="subtitle" style={styles.headerTitle}>
          Dados pessoais
        </ThemedText>
        <Pressable disabled={salvando} onPress={salvar}>
          <ThemedText type="smallBold" themeColor="primary">
            Salvar
          </ThemedText>
        </Pressable>
      </SafeAreaView>

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
        <ThemedText type="smallBold" themeColor="primary" style={styles.centerText}>
          Trocar foto
        </ThemedText>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            TIPO DE CADASTRO
          </ThemedText>
          <View style={styles.segmentado}>
            <Pressable
              style={[
                styles.segmentoItem,
                { backgroundColor: tipoCadastro === 'pessoa_fisica' ? theme.background : 'transparent' },
              ]}
              onPress={() => setTipoCadastro('pessoa_fisica')}
            >
              <ThemedText type="smallBold" themeColor={tipoCadastro === 'pessoa_fisica' ? 'text' : 'textSecondary'}>
                Pessoa física · CPF
              </ThemedText>
            </Pressable>
            <Pressable
              style={[styles.segmentoItem, { backgroundColor: tipoCadastro === 'empresa' ? theme.background : 'transparent' }]}
              onPress={() => setTipoCadastro('empresa')}
            >
              <ThemedText type="smallBold" themeColor={tipoCadastro === 'empresa' ? 'text' : 'textSecondary'}>
                Empresa · CNPJ
              </ThemedText>
            </Pressable>
          </View>
        </View>

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

        {tipoCadastro === 'pessoa_fisica' ? (
          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              CPF
            </ThemedText>
            <View style={[styles.box, styles.boxRow, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
              <TextInput
                value={cpf}
                onChangeText={(texto) => setCpf(mascararCPF(texto))}
                placeholder="000.000.000-00"
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                maxLength={14}
                style={[styles.input, styles.flex1, { color: theme.text }]}
              />
              {cpfValido && (
                <View style={styles.verificadoBadge}>
                  <Ionicons name="checkmark-circle" size={16} color={theme.statusSuccess} />
                  <ThemedText type="small" themeColor="statusSuccess">
                    Verificado
                  </ThemedText>
                </View>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              CNPJ
            </ThemedText>
            <View style={[styles.box, styles.boxRow, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
              <TextInput
                value={cnpj}
                onChangeText={(texto) => setCnpj(mascararCNPJ(texto))}
                placeholder="00.000.000/0000-00"
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                maxLength={18}
                style={[styles.input, styles.flex1, { color: theme.text }]}
              />
              {cnpjValido && (
                <View style={styles.verificadoBadge}>
                  <Ionicons name="checkmark-circle" size={16} color={theme.statusSuccess} />
                  <ThemedText type="small" themeColor="statusSuccess">
                    Verificado
                  </ThemedText>
                </View>
              )}
            </View>
          </View>
        )}

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            NASCIMENTO
          </ThemedText>
          <View style={[styles.box, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <TextInput
              value={nascimento}
              onChangeText={(texto) => setNascimento(mascararData(texto))}
              placeholder="dd/mm/aaaa"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              maxLength={10}
              style={[styles.input, { color: theme.text }]}
            />
          </View>
        </View>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            SEXO
          </ThemedText>
          <View style={styles.chipsRow}>
            {OPCOES_SEXO.map((opcao) => (
              <Pressable
                key={opcao}
                style={[styles.chip, { backgroundColor: sexo === opcao ? theme.primary : theme.backgroundSelected }]}
                onPress={() => setSexo(opcao)}
              >
                <ThemedText type="smallBold" themeColor={sexo === opcao ? 'background' : 'textSecondary'}>
                  {LABEL_SEXO[opcao]}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </View>

        <ThemedText type="smallBold" themeColor="statusPending" style={styles.secao}>
          CONTATO
        </ThemedText>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            CELULAR
          </ThemedText>
          <View style={[styles.box, styles.boxRow, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <TextInput
              value={telefone}
              onChangeText={setTelefone}
              placeholder="(11) 90000-0000"
              placeholderTextColor={theme.textSecondary}
              keyboardType="phone-pad"
              style={[styles.input, styles.flex1, { color: theme.text }]}
            />
            {telefoneValido && <Ionicons name="checkmark-circle" size={16} color={theme.statusSuccess} />}
          </View>
        </View>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            E-MAIL
          </ThemedText>
          <View style={[styles.box, styles.boxDesabilitado, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
            <ThemedText themeColor="textSecondary">{email || '—'}</ThemedText>
          </View>
        </View>

        <ThemedText type="smallBold" themeColor="statusPending" style={styles.secao}>
          ENDEREÇO
        </ThemedText>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            CEP
          </ThemedText>
          <View style={[styles.box, styles.boxRow, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <TextInput
              value={cep}
              onChangeText={aoMudarCep}
              placeholder="00000-000"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              maxLength={9}
              style={[styles.input, styles.flex1, { color: theme.text }]}
            />
            {buscandoCep && <ActivityIndicator size="small" color={theme.primary} />}
          </View>
        </View>

        <View style={styles.linhaDupla}>
          <View style={[styles.field, styles.flex1]}>
            <ThemedText type="small" themeColor="textSecondary">
              CIDADE
            </ThemedText>
            <View style={[styles.box, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
              <TextInput
                value={cidade}
                onChangeText={setCidade}
                placeholder="São Paulo"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text }]}
              />
            </View>
          </View>
          <View style={[styles.field, styles.ufField]}>
            <ThemedText type="small" themeColor="textSecondary">
              UF
            </ThemedText>
            <View style={[styles.box, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
              <TextInput
                value={uf}
                onChangeText={(texto) => setUf(texto.toUpperCase().slice(0, 2))}
                placeholder="SP"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="characters"
                maxLength={2}
                style={[styles.input, { color: theme.text }]}
              />
            </View>
          </View>
        </View>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            BAIRRO
          </ThemedText>
          <View style={[styles.box, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <TextInput
              value={bairro}
              onChangeText={setBairro}
              placeholder="Seu bairro"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text }]}
            />
          </View>
        </View>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            SOBRE MIM (BIO)
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

        <Pressable
          style={[styles.button, { backgroundColor: theme.primary }, salvando && styles.disabled]}
          onPress={salvar}
          disabled={salvando}
        >
          <ThemedText type="default" themeColor="background" style={styles.buttonText}>
            {salvando ? 'Salvando...' : 'Salvar alterações'}
          </ThemedText>
        </Pressable>
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
  erroContainer: {
    gap: Spacing.four,
    paddingHorizontal: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    flex: 1,
  },
  body: {
    padding: Spacing.four,
    gap: Spacing.three,
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
  },
  secao: {
    marginTop: Spacing.two,
  },
  segmentado: {
    flexDirection: 'row',
    gap: Spacing.one,
    borderRadius: Spacing.two,
  },
  segmentoItem: {
    flex: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
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
  boxDesabilitado: {
    opacity: 0.8,
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
  flex1: {
    flex: 1,
  },
  verificadoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
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
  linhaDupla: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  ufField: {
    width: 80,
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

import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/services/supabaseClient';

type Modo = 'entrar' | 'criar';

// Traduz os erros do Supabase Auth sem revelar se a conta existe: tanto
// "senha errada" quanto "usuário inexistente" voltam como invalid_credentials
// e viram a mesma frase. Antes a tela mostrava error.message cru, que
// distinguia os dois casos (e vinha em inglês).
function mensagemErroAuth(codigo: string | undefined) {
  switch (codigo) {
    case 'invalid_credentials':
      return 'E-mail ou senha incorretos.';
    case 'email_not_confirmed':
      return 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.';
    case 'weak_password':
      return 'Senha muito fraca. Use pelo menos 6 caracteres.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Muitas tentativas seguidas. Espere um pouco e tente de novo.';
    default:
      return 'Não foi possível continuar. Tente novamente.';
  }
}

// Tela de entrar/criar conta (alterna entre os dois modos na mesma UI).
export default function LoginScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [modo, setModo] = useState<Modo>('entrar');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const handleSubmit = async () => {
    setErro(null);

    if (!email.includes('@') || senha.length < 6) {
      setErro('Informe um e-mail válido e uma senha com pelo menos 6 caracteres.');
      return;
    }
    if (modo === 'criar' && nome.trim().length < 2) {
      setErro('Informe seu nome — é ele que aparece pra quem for te contratar.');
      return;
    }

    setCarregando(true);
    // nome_completo vai em options.data e cai em raw_user_meta_data, de onde o
    // trigger handle_new_user grava direto no profile (migration 0016) — mesmo
    // caminho que o telefone já usava. Sem isso, todo usuário novo nascia sem
    // nome e aparecia como "Sem nome"/"Alguém" pelo app inteiro.
    const { data, error } =
      modo === 'entrar'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
        : await supabase.auth.signUp({
            email: email.trim(),
            password: senha,
            options: { data: { nome_completo: nome.trim() } },
          });
    setCarregando(false);

    if (error) {
      setErro(mensagemErroAuth(error.code));
      return;
    }

    // signUp sem sessão de volta = o projeto exige confirmação de e-mail
    // antes de liberar login (configuração do Supabase Auth, não um erro).
    if (!data.session) {
      setErro('Confirme seu e-mail para continuar. Verifique sua caixa de entrada.');
      return;
    }

    router.replace('/home');
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={[styles.hero, { backgroundColor: theme.primary }]}>
        <SafeAreaView style={styles.heroContent}>
          <ThemedText type="title" themeColor="background" style={styles.centerText}>
            Estou Dentro
          </ThemedText>
          <ThemedText type="default" themeColor="background" style={styles.centerText}>
            Bicos e ajudas, perto de você.
          </ThemedText>
        </SafeAreaView>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.sheet, { backgroundColor: theme.backgroundElement }]}
      >
        <SafeAreaView edges={['bottom']} style={styles.sheetContent}>
          <View style={[styles.tabs, { backgroundColor: theme.backgroundSelected }]}>
            <Pressable
              style={[styles.tab, modo === 'entrar' && { backgroundColor: theme.background }]}
              onPress={() => setModo('entrar')}
            >
              <ThemedText type="smallBold" themeColor={modo === 'entrar' ? 'text' : 'textSecondary'}>
                Entrar
              </ThemedText>
            </Pressable>
            <Pressable
              style={[styles.tab, modo === 'criar' && { backgroundColor: theme.background }]}
              onPress={() => setModo('criar')}
            >
              <ThemedText type="smallBold" themeColor={modo === 'criar' ? 'text' : 'textSecondary'}>
                Criar conta
              </ThemedText>
            </Pressable>
          </View>

          {modo === 'criar' && (
            <View style={styles.field}>
              <ThemedText type="small" themeColor="textSecondary">
                NOME COMPLETO
              </ThemedText>
              <View
                style={[
                  styles.inputRow,
                  { backgroundColor: theme.background, borderColor: theme.backgroundSelected },
                ]}
              >
                <TextInput
                  value={nome}
                  onChangeText={setNome}
                  placeholder="Como quer ser chamado"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                  maxLength={120}
                  style={[styles.input, { color: theme.text }]}
                />
              </View>
            </View>
          )}

          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              E-MAIL
            </ThemedText>
            <View
              style={[
                styles.inputRow,
                { backgroundColor: theme.background, borderColor: theme.backgroundSelected },
              ]}
            >
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="voce@exemplo.com"
                placeholderTextColor={theme.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { color: theme.text }]}
              />
            </View>
          </View>

          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              SENHA
            </ThemedText>
            <View
              style={[
                styles.inputRow,
                { backgroundColor: theme.background, borderColor: theme.backgroundSelected },
              ]}
            >
              <TextInput
                value={senha}
                onChangeText={setSenha}
                placeholder="••••••••"
                placeholderTextColor={theme.textSecondary}
                secureTextEntry={!mostrarSenha}
                style={[styles.input, { color: theme.text }]}
              />
              <Pressable onPress={() => setMostrarSenha((v) => !v)}>
                <ThemedText type="smallBold" themeColor="primary">
                  {mostrarSenha ? 'Ocultar' : 'Mostrar'}
                </ThemedText>
              </Pressable>
            </View>
          </View>

          {erro && (
            <ThemedText type="small" themeColor="statusDanger">
              {erro}
            </ThemedText>
          )}

          <Pressable
            style={[styles.button, { backgroundColor: theme.primary }, carregando && styles.disabled]}
            onPress={handleSubmit}
            disabled={carregando}
          >
            <ThemedText type="default" themeColor="background" style={styles.buttonText}>
              {carregando ? 'Aguarde...' : modo === 'entrar' ? 'Entrar' : 'Criar conta'}
            </ThemedText>
          </Pressable>

        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hero: {
    flex: 1,
  },
  heroContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  sheet: {
    borderTopLeftRadius: Spacing.five,
    borderTopRightRadius: Spacing.five,
  },
  sheetContent: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
  },
  tabs: {
    flexDirection: 'row',
    borderRadius: Spacing.two,
    padding: Spacing.half,
  },
  tab: {
    flex: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  field: {
    gap: Spacing.one,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  input: {
    flex: 1,
    fontSize: 16,
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

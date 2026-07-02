import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/services/supabaseClient';

type Modo = 'entrar' | 'criar';

export default function LoginScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [modo, setModo] = useState<Modo>('entrar');
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

    setCarregando(true);
    const { data, error } =
      modo === 'entrar'
        ? await supabase.auth.signInWithPassword({ email, password: senha })
        : await supabase.auth.signUp({ email, password: senha });
    setCarregando(false);

    if (error) {
      setErro(error.message);
      return;
    }

    if (!data.session) {
      setErro('Confirme seu e-mail para continuar. Verifique sua caixa de entrada.');
      return;
    }

    router.replace('/home');
  };

  const handleGoogle = () => {
    setErro('Login com Google ainda não configurado neste projeto.');
  };

  return (
    <View style={styles.container}>
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

          {modo === 'entrar' && (
            <Pressable>
              <ThemedText type="small" themeColor="textSecondary" style={styles.forgotPassword}>
                Esqueci minha senha
              </ThemedText>
            </Pressable>
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

          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: theme.backgroundSelected }]} />
            <ThemedText type="small" themeColor="textSecondary">
              ou
            </ThemedText>
            <View style={[styles.dividerLine, { backgroundColor: theme.backgroundSelected }]} />
          </View>

          <Pressable
            style={[
              styles.googleButton,
              { borderColor: theme.backgroundSelected, backgroundColor: theme.background },
            ]}
            onPress={handleGoogle}
          >
            <ThemedText type="default" style={styles.buttonText}>
              Continuar com Google
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
  forgotPassword: {
    textAlign: 'right',
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
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  googleButton: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});

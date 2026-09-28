import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

import { criarArmazenamentoSessao } from '@/services/armazenamento-sessao';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY precisam estar definidos (veja .env.example).'
  );
}

// THIS_DEVICE_ONLY: o token não vai pro backup do iCloud nem é restaurado em
// outro aparelho. AFTER_FIRST_UNLOCK (e não WHEN_UNLOCKED): uma renovação de
// token que termine com a tela já bloqueada ainda consegue gravar — senão o
// refresh token novo se perderia e o usuário cairia deslogado.
const OPCOES_COFRE: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// No celular a sessão fica no Keychain/Keystore (ver armazenamento-sessao.ts).
// No web o SecureStore não existe e o AsyncStorage é o localStorage do
// navegador — mesmo comportamento de antes.
const armazenamento =
  Platform.OS === 'web'
    ? AsyncStorage
    : criarArmazenamentoSessao({
        cofre: {
          ler: (chave) => SecureStore.getItemAsync(chave, OPCOES_COFRE),
          gravar: (chave, valor) => SecureStore.setItemAsync(chave, valor, OPCOES_COFRE),
          apagar: (chave) => SecureStore.deleteItemAsync(chave, OPCOES_COFRE),
        },
        legado: AsyncStorage,
      });

// Cliente único do Supabase, usado em todo o app (telas, hooks, RPCs).
// A sessão fica persistida pra não deslogar entre aberturas do app.
// detectSessionInUrl é false porque este é um app mobile: não existe
// fluxo de redirect por URL (magic link/OAuth) como teria numa versão web.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: armazenamento,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// No Android/iOS o autoRefreshToken roda o laço de renovação o tempo todo;
// o guia do Supabase para Expo manda amarrá-lo ao estado do app. Assim a
// renovação (e a gravação no Keychain que vem com ela) só acontece com o app
// em primeiro plano.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (estado) => {
    if (estado === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

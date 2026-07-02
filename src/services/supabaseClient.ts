import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY precisam estar definidos (veja .env.example).'
  );
}

// Cliente único do Supabase, usado em todo o app (telas, hooks, RPCs).
// A sessão fica persistida no AsyncStorage pra não deslogar entre aberturas
// do app. detectSessionInUrl é false porque este é um app mobile: não existe
// fluxo de redirect por URL (magic link/OAuth) como teria numa versão web.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

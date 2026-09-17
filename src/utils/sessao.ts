import { removerTokenPushDesteAparelho } from '@/hooks/use-push-token';
import { supabase } from '@/services/supabaseClient';

// Ponto único de logout do app (/perfil e /configuracoes chamam daqui).
//
// A ordem importa: o token de push é apagado ANTES do signOut, porque depois
// dele a RLS de push_tokens já não reconhece o dono da linha e o delete não
// afeta nada. Um token órfão faria o aparelho continuar recebendo as mensagens
// de uma conta da qual o usuário já saiu.
//
// A limpeza do cache do React Query não está aqui de propósito: acontece no
// _layout, no evento SIGNED_OUT, pra cobrir também token expirado e sessão
// revogada — casos que nunca passam por um botão de sair.
export async function encerrarSessao() {
  await removerTokenPushDesteAparelho();
  await supabase.auth.signOut();
}

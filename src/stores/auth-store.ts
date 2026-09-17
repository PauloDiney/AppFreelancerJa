import { create } from 'zustand';

// Guarda o id do usuário logado num store global (fora do React Query),
// atualizado pelo _layout.tsx sempre que a sessão do Supabase muda. Existe
// separado do theme-store porque outras preferências por-usuário no futuro
// também vão precisar desse id sem re-buscar a sessão a cada tela.
//
// "carregando" começa true e só vira false depois da primeira resposta do
// Supabase: sem isso não dá pra distinguir "ainda não sei se tem sessão" de
// "não tem sessão", e o <Stack.Protected> do _layout chutaria todo mundo pro
// login por um frame antes da sessão salva ser lida do AsyncStorage.
type AuthStore = {
  usuarioId: string | null;
  carregando: boolean;
  definirUsuarioId: (usuarioId: string | null) => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  usuarioId: null,
  carregando: true,
  definirUsuarioId: (usuarioId) => set({ usuarioId, carregando: false }),
}));

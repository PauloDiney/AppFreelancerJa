import { create } from 'zustand';

// Guarda o id do usuário logado num store global (fora do React Query),
// atualizado pelo _layout.tsx sempre que a sessão do Supabase muda. Existe
// separado do theme-store porque outras preferências por-usuário no futuro
// também vão precisar desse id sem re-buscar a sessão a cada tela.
type AuthStore = {
  usuarioId: string | null;
  definirUsuarioId: (usuarioId: string | null) => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  usuarioId: null,
  definirUsuarioId: (usuarioId) => set({ usuarioId }),
}));

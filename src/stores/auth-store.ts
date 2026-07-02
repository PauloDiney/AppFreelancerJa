import { create } from 'zustand';

type AuthStore = {
  usuarioId: string | null;
  definirUsuarioId: (usuarioId: string | null) => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  usuarioId: null,
  definirUsuarioId: (usuarioId) => set({ usuarioId }),
}));

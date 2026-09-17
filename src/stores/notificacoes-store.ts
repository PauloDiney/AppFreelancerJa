import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { useAuthStore } from '@/stores/auth-store';

// Mesmo formato do theme-store: a escolha é por usuário (e não por aparelho)
// pra não vazar a preferência de um pro próximo que logar no mesmo celular.
// Antes o toggle de "Notificações" em /configuracoes era um useState solto que
// não persistia nada e não ligava nem desligava coisa alguma.
type NotificacoesStore = {
  ativas: Record<string, boolean>;
  definirAtivas: (usuarioId: string, ativas: boolean) => void;
};

export const useNotificacoesStore = create<NotificacoesStore>()(
  persist(
    (set) => ({
      ativas: {},
      definirAtivas: (usuarioId, ativas) =>
        set((state) => ({ ativas: { ...state.ativas, [usuarioId]: ativas } })),
    }),
    {
      name: 'estou-dentro-notificacoes',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

// Default é true: quem nunca mexeu no toggle recebe notificação (o sistema
// operacional ainda pede permissão antes de qualquer coisa chegar).
export function usePreferenciaNotificacoes() {
  const usuarioId = useAuthStore((state) => state.usuarioId);
  const ativas = useNotificacoesStore((state) => (usuarioId ? (state.ativas[usuarioId] ?? true) : true));
  const definirGlobal = useNotificacoesStore((state) => state.definirAtivas);

  return {
    ativas,
    definirAtivas: (valor: boolean) => {
      if (usuarioId) definirGlobal(usuarioId, valor);
    },
  };
}

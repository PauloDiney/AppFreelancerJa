import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { useAuthStore } from '@/stores/auth-store';

export type PreferenciaTema = 'claro' | 'escuro' | 'automatico';

type ThemeStore = {
  // Guardado por usuário (não por dispositivo) para a escolha de um não vazar pro próximo que logar.
  preferencias: Record<string, PreferenciaTema>;
  definirPreferencia: (usuarioId: string, preferencia: PreferenciaTema) => void;
};

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      preferencias: {},
      definirPreferencia: (usuarioId, preferencia) =>
        set((state) => ({ preferencias: { ...state.preferencias, [usuarioId]: preferencia } })),
    }),
    {
      name: 'estou-dentro-tema',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

export function usePreferenciaTema() {
  const usuarioId = useAuthStore((state) => state.usuarioId);
  const preferencia = useThemeStore((state) => (usuarioId ? (state.preferencias[usuarioId] ?? 'automatico') : 'automatico'));
  const definirPreferenciaGlobal = useThemeStore((state) => state.definirPreferencia);

  return {
    preferencia,
    definirPreferencia: (valor: PreferenciaTema) => {
      if (usuarioId) definirPreferenciaGlobal(usuarioId, valor);
    },
  };
}

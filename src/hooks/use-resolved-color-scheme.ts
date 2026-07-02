import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePreferenciaTema } from '@/stores/theme-store';

// Combina a preferência manual do usuário (Configurações > Aparência) com o
// esquema de cores do sistema operacional. Se a preferência for "automático"
// (ou não houver usuário logado ainda), cai pro esquema do sistema.
export function useResolvedColorScheme(): 'light' | 'dark' {
  const scheme = useColorScheme();
  const { preferencia } = usePreferenciaTema();

  if (preferencia === 'escuro') return 'dark';
  if (preferencia === 'claro') return 'light';
  return scheme === 'dark' ? 'dark' : 'light';
}

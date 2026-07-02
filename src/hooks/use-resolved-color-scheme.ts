import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePreferenciaTema } from '@/stores/theme-store';

export function useResolvedColorScheme(): 'light' | 'dark' {
  const scheme = useColorScheme();
  const { preferencia } = usePreferenciaTema();

  if (preferencia === 'escuro') return 'dark';
  if (preferencia === 'claro') return 'light';
  return scheme === 'dark' ? 'dark' : 'light';
}

import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/services/supabaseClient';

export function useUsuarioLogado() {
  return useQuery({
    queryKey: ['usuario-logado'],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    },
  });
}

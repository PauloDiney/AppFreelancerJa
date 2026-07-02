import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/services/supabaseClient';

// Centraliza a busca do usuário logado (usada em várias telas/telas-base
// como a bottom tab bar). Como todas usam a mesma queryKey, o React Query
// deduplica e cacheia — chamar esse hook em vários componentes ao mesmo
// tempo não dispara várias requisições.
export function useUsuarioLogado() {
  return useQuery({
    queryKey: ['usuario-logado'],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    },
  });
}

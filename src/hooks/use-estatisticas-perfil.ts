import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/services/supabaseClient';

export function useEstatisticasPerfil(usuarioId: string | undefined) {
  const bicosQuery = useQuery({
    queryKey: ['estatisticas-prestador', usuarioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bicos')
        .select('valor_oferecido')
        .eq('candidato_selecionado_id', usuarioId)
        .eq('status', 'concluido');
      if (error) throw error;
      return {
        totalBicos: data.length,
        totalGanhos: data.reduce((total, bico) => total + (bico.valor_oferecido ?? 0), 0),
      };
    },
    enabled: !!usuarioId,
  });

  // Uma nota só pro perfil, somando avaliações recebidas como prestador e como
  // contratante — pra quem avalia é a mesma pessoa sendo avaliada, não duas.
  const notaQuery = useQuery({
    queryKey: ['nota-perfil', usuarioId],
    queryFn: async () => {
      const { data, error } = await supabase.from('avaliacoes').select('nota').eq('avaliado_id', usuarioId);
      if (error) throw error;
      if (data.length === 0) return null;
      return data.reduce((total, avaliacao) => total + avaliacao.nota, 0) / data.length;
    },
    enabled: !!usuarioId,
  });

  return {
    totalBicos: bicosQuery.data?.totalBicos ?? 0,
    totalGanhos: bicosQuery.data?.totalGanhos ?? 0,
    nota: notaQuery.data ?? null,
    isLoading: bicosQuery.isLoading || notaQuery.isLoading,
  };
}

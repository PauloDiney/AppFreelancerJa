import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/services/supabaseClient';

export type BicoAberto = {
  id: string;
  titulo: string;
  valor_oferecido: number | null;
  endereco_texto: string | null;
  data_hora_desejada: string | null;
  criado_em: string;
  categoria_id: number | null;
  criado_por: string;
  profiles: {
    nome_completo: string | null;
    nota_media_como_contratante: number | null;
  } | null;
};

// Uma lista de colunas só pro feed de bicos abertos, usada por /home e
// /buscar. Antes cada tela tinha o seu próprio select com colunas diferentes
// mas a MESMA queryKey ('bicos-destaque'): quem carregasse primeiro ganhava o
// cache, e a home acabava recebendo linhas sem data_hora_desejada — fazendo os
// selos "URGENTE"/"HOJE" sumirem sem erro nenhum.
//
// A nota exibida é nota_media_como_contratante (e não ..._como_prestador, como
// as duas telas usavam): quem publica o bico aparece no card como contratante,
// que é o papel que /bico/[id] também mostra.
const COLUNAS =
  'id, titulo, valor_oferecido, endereco_texto, data_hora_desejada, criado_em, categoria_id, criado_por, profiles!bicos_criado_por_fkey(nome_completo, nota_media_como_contratante)';

export function useBicosAbertos(limite: number) {
  return useQuery({
    queryKey: ['bicos-abertos', limite],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bicos')
        .select(COLUNAS)
        .eq('status', 'aberto')
        .order('criado_em', { ascending: false })
        .limit(limite);
      if (error) throw error;
      return data as unknown as BicoAberto[];
    },
  });
}

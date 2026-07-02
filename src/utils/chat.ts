import { supabase } from '@/services/supabaseClient';

// Idempotente: se já existe uma conversa entre esses dois participantes pra
// esse bico, reaproveita ela em vez de criar uma duplicada (o par pode estar
// em qualquer ordem nas colunas participante_1/participante_2). A policy de
// RLS de INSERT em "conversas" só deixa criar quando um dos dois é o
// candidato_selecionado_id do bico — ver migration 0010.
export async function abrirConversa(bicoId: string, meuId: string, outroId: string) {
  const { data: existente, error: erroBusca } = await supabase
    .from('conversas')
    .select('id')
    .eq('bico_id', bicoId)
    .or(
      `and(participante_1_id.eq.${meuId},participante_2_id.eq.${outroId}),and(participante_1_id.eq.${outroId},participante_2_id.eq.${meuId})`
    )
    .maybeSingle();
  if (erroBusca) throw erroBusca;
  if (existente) return existente.id as string;

  const { data: nova, error: erroCriacao } = await supabase
    .from('conversas')
    .insert({ bico_id: bicoId, participante_1_id: meuId, participante_2_id: outroId })
    .select('id')
    .single();
  if (erroCriacao) throw erroCriacao;
  return nova.id as string;
}

export async function contarNaoLidas(usuarioId: string) {
  const { count, error } = await supabase
    .from('mensagens')
    .select('id', { count: 'exact', head: true })
    .is('lido_em', null)
    .neq('remetente_id', usuarioId);
  if (error) throw error;
  return count ?? 0;
}

export function formatarHoraMensagem(dataIso: string) {
  return new Date(dataIso).toLocaleTimeString('pt-BR', { hour: 'numeric', minute: '2-digit' });
}

export function formatarDataLista(dataIso: string) {
  const data = new Date(dataIso);
  const agora = new Date();

  if (data.toDateString() === agora.toDateString()) return formatarHoraMensagem(dataIso);

  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);
  if (data.toDateString() === ontem.toDateString()) return 'Ontem';

  const diffDias = Math.round((agora.getTime() - data.getTime()) / 86400000);
  if (diffDias < 7) return capitalizar(data.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''));
  return capitalizar(data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', ''));
}

function capitalizar(texto: string) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

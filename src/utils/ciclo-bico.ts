import type { QueryClient } from '@tanstack/react-query';

import { supabase } from '@/services/supabaseClient';

// Ações do ciclo de vida do bico. Cada uma é uma RPC do banco (migration
// 0019) que confere quem está chamando, trava o bico e grava tudo numa
// transação: o app só pede, quem decide se pode é o Postgres. Os erros voltam
// com código de domínio no hint — passe-os para mensagemErro().

export type MotivoCancelamento =
  | 'problema_de_agenda'
  | 'desacordo_de_preco'
  | 'prestador_indisponivel'
  | 'contratante_indisponivel'
  | 'nao_compareceu'
  | 'ambiente_inseguro'
  | 'outro';

export const MOTIVOS_CANCELAMENTO: { valor: MotivoCancelamento; label: string }[] = [
  { valor: 'problema_de_agenda', label: 'Problema de agenda' },
  { valor: 'desacordo_de_preco', label: 'Desacordo sobre o preço' },
  { valor: 'prestador_indisponivel', label: 'Prestador indisponível' },
  { valor: 'contratante_indisponivel', label: 'Contratante indisponível' },
  { valor: 'nao_compareceu', label: 'Não compareceu' },
  { valor: 'ambiente_inseguro', label: 'Ambiente inseguro' },
  { valor: 'outro', label: 'Outro motivo' },
];

export type MotivoDisputa =
  | 'servico_nao_realizado'
  | 'problema_de_pagamento'
  | 'comportamento_inseguro'
  | 'servico_diferente_do_combinado'
  | 'nao_compareceu'
  | 'outro';

export const MOTIVOS_DISPUTA: { valor: MotivoDisputa; label: string }[] = [
  { valor: 'servico_nao_realizado', label: 'Serviço não realizado' },
  { valor: 'problema_de_pagamento', label: 'Problema com o pagamento' },
  { valor: 'comportamento_inseguro', label: 'Comportamento inseguro' },
  { valor: 'servico_diferente_do_combinado', label: 'Diferente do combinado' },
  { valor: 'nao_compareceu', label: 'Não compareceu' },
  { valor: 'outro', label: 'Outro' },
];

export function labelMotivo(valor: string | null | undefined) {
  return (
    MOTIVOS_CANCELAMENTO.find((m) => m.valor === valor)?.label ??
    MOTIVOS_DISPUTA.find((m) => m.valor === valor)?.label ??
    'Motivo não informado'
  );
}

async function chamar(funcao: string, argumentos: Record<string, unknown>) {
  const { error } = await supabase.rpc(funcao, argumentos);
  if (error) throw error;
}

// O candidato é sempre quem está logado: o app não manda o próprio id.
export const candidatarSe = (bicoId: string) => chamar('candidatar_se', { p_bico_id: bicoId });

export const retirarCandidatura = (candidaturaId: string) =>
  chamar('retirar_candidatura', { p_candidatura_id: candidaturaId });

export const aceitarCandidatura = (candidaturaId: string) =>
  chamar('aceitar_candidatura', { p_candidatura_id: candidaturaId });

export const iniciarBico = (bicoId: string) => chamar('iniciar_bico', { p_bico_id: bicoId });

export const marcarBicoFinalizado = (bicoId: string) => chamar('marcar_bico_finalizado', { p_bico_id: bicoId });

export const confirmarConclusaoBico = (bicoId: string) => chamar('confirmar_conclusao_bico', { p_bico_id: bicoId });

export const cancelarBico = (bicoId: string, motivo: MotivoCancelamento, detalhes: string) =>
  chamar('cancelar_bico', { p_bico_id: bicoId, p_motivo: motivo, p_detalhes: detalhes.trim() || null });

export const abrirDisputa = (bicoId: string, motivo: MotivoDisputa, descricao: string) =>
  chamar('abrir_disputa', { p_bico_id: bicoId, p_motivo: motivo, p_descricao: descricao.trim() });

export const avaliarBico = (bicoId: string, nota: number, comentario: string) =>
  chamar('avaliar_bico', { p_bico_id: bicoId, p_nota: nota, p_comentario: comentario.trim() || null });

// Uma mudança de estado aparece em várias telas (detalhe, chat, perfil,
// histórico, pagamentos, feed): depois de qualquer ação, tudo que depende do
// status do bico é recarregado.
const CONSULTAS_DO_CICLO = [
  'bico',
  'ciclo-bico',
  'candidaturas',
  'minha-candidatura',
  'bicos-abertos',
  'bicos-em-andamento',
  'bicos-criados',
  'historico-bicos',
  'pagamentos-prestador',
  'pagamentos-contratante',
  'estatisticas-prestador',
  'nota-perfil',
  'conversa',
  'conversas',
  'minha-avaliacao',
  'minhas-avaliacoes-dadas',
];

export function atualizarDepoisDaAcao(queryClient: QueryClient) {
  CONSULTAS_DO_CICLO.forEach((chave) => queryClient.invalidateQueries({ queryKey: [chave] }));
}

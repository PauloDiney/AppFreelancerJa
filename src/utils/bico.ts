import { ThemeColor } from '@/constants/theme';

// Funções de formatação/exibição usadas pelas telas relacionadas a "bico"
// (feed, busca, detalhe, perfil). Não fazem chamada de rede — só transformam
// dados que as telas já buscaram.

// Estados do bico (migration 0019, docs/JOB_LIFECYCLE_DESIGN.md).
export type StatusBico =
  | 'aberto'
  | 'atribuido'
  | 'em_andamento'
  | 'aguardando_confirmacao'
  | 'concluido'
  | 'cancelado'
  | 'em_disputa';

// Já tem prestador e ainda não terminou: é o que as telas chamam de "ativo"
// ou "em andamento" (antes da Fase 2 só existia o em_andamento).
export const STATUS_ATIVOS: StatusBico[] = ['atribuido', 'em_andamento', 'aguardando_confirmacao', 'em_disputa'];

export function bicoAtivo(status: StatusBico) {
  return STATUS_ATIVOS.includes(status);
}

export function labelStatusBico(status: StatusBico) {
  switch (status) {
    case 'aberto':
      return 'Aguardando candidatos';
    case 'atribuido':
      return 'Prestador escolhido';
    case 'em_andamento':
      return 'Em andamento';
    case 'aguardando_confirmacao':
      return 'Aguardando confirmação';
    case 'em_disputa':
      return 'Em disputa';
    case 'concluido':
      return 'Concluído';
    case 'cancelado':
      return 'Cancelado';
  }
}

// Selo curto dos cards (perfil, histórico).
export function seloStatusBico(status: StatusBico): { texto: string; cor: ThemeColor } {
  switch (status) {
    case 'aberto':
      return { texto: 'ABERTO', cor: 'primary' };
    case 'atribuido':
      return { texto: 'A INICIAR', cor: 'statusPending' };
    case 'em_andamento':
      return { texto: 'EM ANDAMENTO', cor: 'statusPending' };
    case 'aguardando_confirmacao':
      return { texto: 'A CONFIRMAR', cor: 'statusPending' };
    case 'em_disputa':
      return { texto: 'EM DISPUTA', cor: 'statusDanger' };
    case 'concluido':
      return { texto: '✓ PAGO', cor: 'statusSuccess' };
    case 'cancelado':
      return { texto: 'CANCELADO', cor: 'textSecondary' };
  }
}

// Mesmo prazo de public.prazo_avaliacao() (14 dias depois da conclusão). O
// banco é quem decide; isto só evita mostrar um botão que vai dar erro.
export function prazoDeAvaliacaoAberto(concluidoEm: string | null) {
  if (!concluidoEm) return false;
  return Date.now() < new Date(concluidoEm).getTime() + 14 * 24 * 60 * 60 * 1000;
}

export function iniciais(nome: string | null) {
  if (!nome) return '?';
  const partes = nome.trim().split(/\s+/);
  const primeiras = partes.slice(0, 2).map((parte) => parte[0]?.toUpperCase() ?? '');
  return primeiras.join('') || '?';
}

export function tempoRelativo(dataIso: string) {
  const diffMin = Math.max(1, Math.round((Date.now() - new Date(dataIso).getTime()) / 60000));
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffHoras = Math.round(diffMin / 60);
  if (diffHoras < 24) return `há ${diffHoras}h`;
  return `há ${Math.round(diffHoras / 24)}d`;
}

// Regra de negócio do selo do card: "URGENTE" se faltam 3h ou menos pro
// horário desejado (e ainda não passou), senão "HOJE" se for no mesmo dia.
// Bicos passados ou sem data não recebem selo.
export function calcularBadge(dataHoraDesejada: string | null): { texto: string; cor: ThemeColor } | null {
  if (!dataHoraDesejada) return null;
  const alvo = new Date(dataHoraDesejada);
  const agora = new Date();
  const diffHoras = (alvo.getTime() - agora.getTime()) / (1000 * 60 * 60);
  if (diffHoras >= 0 && diffHoras <= 3) return { texto: 'URGENTE', cor: 'statusDanger' };
  if (alvo.toDateString() === agora.toDateString()) return { texto: 'HOJE', cor: 'statusPending' };
  return null;
}

export function formatarValor(valor: number | null) {
  return valor == null ? '—' : `R$ ${valor.toFixed(0)}`;
}

export function formatarQuando(dataIso: string | null) {
  if (!dataIso) return 'A combinar';
  const alvo = new Date(dataIso);
  const agora = new Date();
  const hora = alvo.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (alvo.toDateString() === agora.toDateString()) return `Hoje ${hora}`;
  const amanha = new Date(agora);
  amanha.setDate(agora.getDate() + 1);
  if (alvo.toDateString() === amanha.toDateString()) return `Amanhã ${hora}`;
  return `${alvo.toLocaleDateString('pt-BR')} ${hora}`;
}

export function formatarGanhos(valor: number) {
  if (valor >= 1000) return `R$ ${(valor / 1000).toFixed(1).replace('.', ',')}k`;
  return `R$ ${valor.toFixed(0)}`;
}

export function formatarDataCurta(dataIso: string) {
  return new Date(dataIso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
}

export function formatarMesAno(dataIso: string) {
  const data = new Date(dataIso);
  const mes = data.toLocaleDateString('pt-BR', { month: 'long' });
  return `${mes.toUpperCase()} ${data.getFullYear()}`;
}

export const AVATAR_PALETTE: { bg: string; text: ThemeColor }[] = [
  { bg: '#F5EFE4', text: 'primary' },
  { bg: '#DCEFE1', text: 'statusSuccess' },
  { bg: '#E1EAFB', text: 'primary' },
];

import { ThemeColor } from '@/constants/theme';

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

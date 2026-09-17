// Cores, espaçamentos e constantes de layout do app, em tema claro e escuro.
//
// O import de '@/global.css' saiu junto com o arquivo: definia variáveis CSS
// (--font-display etc.) que só fariam sentido com nativewind ou no build web,
// e eram lidas apenas pelo Fonts abaixo, que também não era mais usado.

import { Platform } from 'react-native';

// Paleta da marca "Estou Dentro": azul, branco, bege (neutras) + amarelo/vermelho/verde (status).
export const Colors = {
  light: {
    text: '#1A2233',
    background: '#FFFFFF',
    backgroundElement: '#F5EFE4', // bege
    backgroundSelected: '#E8DFC9',
    textSecondary: '#5B6472',
    primary: '#1E5FCC', // azul
    statusPending: '#F5A623', // amarelo
    statusDanger: '#E53935', // vermelho
    statusSuccess: '#2E9E5B', // verde
  },
  dark: {
    text: '#F5F1E8',
    background: '#0F172A', // azul bem escuro
    backgroundElement: '#1C2536',
    backgroundSelected: '#28344A',
    textSecondary: '#A9B0BD',
    primary: '#4C8DFF',
    statusPending: '#FBBF24',
    statusDanger: '#F87171',
    statusSuccess: '#4ADE80',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

// Ainda não usados em nenhuma tela — deixados prontos pra quando telas com
// scroll precisarem reservar espaço pra bottom tab bar (BottomTabInset) ou
// limitar a largura do conteúdo em telas largas/web (MaxContentWidth).
export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

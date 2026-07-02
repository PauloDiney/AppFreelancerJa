/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

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

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

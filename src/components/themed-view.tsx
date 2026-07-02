import { View, type ViewProps } from 'react-native';

import { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// <View> que já aplica a cor de fundo do tema atual. "type" escolhe qual
// cor do tema usar (default "background").
export type ThemedViewProps = ViewProps & {
  // Herdados do template do Expo: hoje só são retirados de otherProps (pra
  // não vazar pro DOM/View nativo), mas não têm efeito nenhum na cor
  // renderizada — quem precisar de uma cor pontual deve usar "style".
  lightColor?: string;
  darkColor?: string;
  type?: ThemeColor;
};

export function ThemedView({ style, lightColor, darkColor, type, ...otherProps }: ThemedViewProps) {
  const theme = useTheme();

  return <View style={[{ backgroundColor: theme[type ?? 'background'] }, style]} {...otherProps} />;
}

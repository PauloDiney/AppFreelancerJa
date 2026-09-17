import { View, type ViewProps } from 'react-native';

import { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// <View> que já aplica a cor de fundo do tema atual. "type" escolhe qual
// cor do tema usar (default "background"); pra uma cor pontual, use "style".
//
// As props lightColor/darkColor vinham do template do Expo e eram aceitas só
// pra serem descartadas — não tinham efeito nenhum na cor renderizada. Saíram.
export type ThemedViewProps = ViewProps & {
  type?: ThemeColor;
};

export function ThemedView({ style, type, ...otherProps }: ThemedViewProps) {
  const theme = useTheme();

  return <View style={[{ backgroundColor: theme[type ?? 'background'] }, style]} {...otherProps} />;
}

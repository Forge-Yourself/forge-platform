import { View, type ViewProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Horizontal stack. flexDirection 'row' already mirrors under RTL in React Native,
 * so screens never hardcode left/right.
 */
export function Row({ style, ...rest }: ViewProps) {
  const t = useTheme();
  return (
    <View
      {...rest}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: t.space[3] }, style]}
    />
  );
}

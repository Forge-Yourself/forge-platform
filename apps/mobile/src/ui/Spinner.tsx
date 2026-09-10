import { ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type SpinnerProps = {
  size?: 'small' | 'large';
  label?: string;
};

/** Loading indicator, themed with the accent color. */
export function Spinner({ size = 'small', label = 'Loading' }: SpinnerProps) {
  const t = useTheme();
  return (
    <ActivityIndicator
      accessibilityLabel={label}
      size={size}
      color={t.colors.accent}
    />
  );
}

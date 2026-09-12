import { View } from 'react-native';
import { useTheme, type Theme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type BannerVariant = 'info' | 'success' | 'warn' | 'danger';

export type BannerProps = {
  variant: BannerVariant;
  message: string;
};

const GLYPH: Record<BannerVariant, string> = {
  info: 'ℹ',
  success: '✓',
  warn: '⚠',
  danger: '✕',
};

function roles(t: Theme, variant: BannerVariant) {
  switch (variant) {
    case 'success':
      return { surface: t.colors.successSurface, text: t.colors.onSuccessSurface };
    case 'warn':
      return { surface: t.colors.warnSurface, text: t.colors.onWarnSurface };
    case 'danger':
      return { surface: t.colors.dangerSurface, text: t.colors.onDangerSurface };
    case 'info':
    default:
      return { surface: t.colors.accentSurface, text: t.colors.accentText };
  }
}

/** Info/success/warn/danger strip for form errors, offline notices, confirmations. */
export function Banner({ variant, message }: BannerProps) {
  const t = useTheme();
  const { surface, text } = roles(t, variant);
  const isAssertive = variant === 'warn' || variant === 'danger';

  return (
    <View
      accessibilityRole={isAssertive ? 'alert' : undefined}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space[2],
        padding: t.space[3],
        borderRadius: t.radius.md,
        backgroundColor: surface,
      }}
    >
      <Text style={{ fontSize: 16, color: text }}>{GLYPH[variant]}</Text>
      <Text style={{ flex: 1, fontSize: 14, color: text }}>{message}</Text>
    </View>
  );
}

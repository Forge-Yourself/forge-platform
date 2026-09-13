import { View } from 'react-native';
import { useTheme, type Theme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type BannerVariant = 'info' | 'success' | 'warn' | 'danger';

export type BannerProps = {
  variant: BannerVariant;
  message: string;
};

const GLYPH: Record<BannerVariant, IconName> = {
  info: 'alert',
  success: 'check',
  // A triangle, not the info circle: warn and info sat side by side on the AI result
  // screen wearing the same glyph, so tone was the only thing separating them.
  warn: 'warning',
  danger: 'close',
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
        alignItems: 'flex-start',
        gap: t.space[2],
        padding: t.space[3],
        borderRadius: t.radius.md,
        backgroundColor: surface,
      }}
    >
      <Icon name={GLYPH[variant]} size={17} color={text} strokeWidth={2.2} />
      <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: text }}>{message}</Text>
    </View>
  );
}

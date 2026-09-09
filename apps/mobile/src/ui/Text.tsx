import { fontFamily, type Typography } from '@forge/shared';
import { Text as RNText, type TextProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

type Variant = keyof Typography;
type Tone = 'primary' | 'secondary' | 'muted' | 'accent' | 'onPrimary' | 'onAccent';

const toneToRole = {
  primary: 'textPrimary',
  secondary: 'textSecondary',
  muted: 'textMuted',
  accent: 'accentText',
  onPrimary: 'onPrimary',
  onAccent: 'onAccent',
} as const;

export type ForgeTextProps = TextProps & {
  variant?: Variant;
  tone?: Tone;
  /** Sets, reps, weights and timers render in mono — it is how PT brains read numbers. */
  numeric?: boolean;
};

export function Text({
  variant = 'body',
  tone = 'primary',
  numeric = false,
  style,
  ...rest
}: ForgeTextProps) {
  const t = useTheme();
  return (
    <RNText
      {...rest}
      style={[
        t.typography[variant],
        {
          color: t.colors[toneToRole[tone]],
          fontFamily: numeric ? fontFamily.mono : fontFamily.sans,
        },
        style,
      ]}
    />
  );
}

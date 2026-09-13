import { View, type ViewProps } from 'react-native';
import { useTheme, type Theme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type TagTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger';

export type TagProps = ViewProps & {
  label: string;
  tone?: TagTone;
  /** Figures — week numbers, times, counts — render in mono like every other number. */
  numeric?: boolean;
};

function toneRoles(t: Theme, tone: TagTone) {
  switch (tone) {
    case 'accent':
      return { bg: t.colors.accentSurfaceSoft, fg: t.colors.onAccentSurfaceSoft };
    case 'success':
      return { bg: t.colors.successSurface, fg: t.colors.onSuccessSurface };
    case 'warn':
      return { bg: t.colors.warnSurface, fg: t.colors.onWarnSurface };
    case 'danger':
      return { bg: t.colors.dangerSurface, fg: t.colors.onDangerSurface };
    case 'neutral':
    default:
      return { bg: t.colors.surfaceSunken, fg: t.colors.textSecondary };
  }
}

/**
 * The status pill that sits at the end of a row — TODAY 9:00, PENDING, WEEK 3,
 * MINE, UNSIGNED. Every tinted-chip pairing here comes from the contrast-verified
 * surface/on-surface role pairs in packages/shared's semantic.ts; the tone names
 * are the only thing a screen chooses.
 */
export function Tag({ label, tone = 'neutral', numeric = false, style, ...rest }: TagProps) {
  const t = useTheme();
  const { bg, fg } = toneRoles(t, tone);

  return (
    <View
      {...rest}
      style={[
        {
          paddingHorizontal: 9,
          paddingVertical: 3,
          borderRadius: t.radius.pill,
          backgroundColor: bg,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      <Text
        numeric={numeric}
        numberOfLines={1}
        style={{ fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4, color: fg }}
      >
        {label}
      </Text>
    </View>
  );
}

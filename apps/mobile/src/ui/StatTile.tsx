import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type StatTileProps = {
  label: string;
  value: string;
  /** `accent` marks the one figure that is about to matter — the next session time. */
  tone?: 'neutral' | 'accent';
};

/** One figure in a row of three. Value is mono; label is the uppercase micro-rule. */
export function StatTile({ label, value, tone = 'neutral' }: StatTileProps) {
  const t = useTheme();
  const isAccent = tone === 'accent';
  const fg = isAccent ? t.colors.onAccentSurfaceSoft : t.colors.textPrimary;

  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        flex: 1,
        padding: t.space[3] + 1,
        borderRadius: t.radius.lg - 2,
        backgroundColor: isAccent ? t.colors.accentSurfaceSoft : t.colors.surfaceSunken,
        gap: 2,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontSize: 10.5,
          fontWeight: '700',
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: isAccent ? fg : t.colors.textMuted,
        }}
      >
        {label}
      </Text>
      <Text numeric numberOfLines={1} style={{ fontSize: 21, fontWeight: '700', color: fg }}>
        {value}
      </Text>
    </View>
  );
}

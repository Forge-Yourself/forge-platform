import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type LiveBadgeProps = {
  /** live: the mirror channel is joined. offline: no signal. idle: neither yet. */
  state: 'live' | 'offline' | 'idle';
  label: string;
};

/**
 * Session header status pill (prototype `session`: the OFFLINE pill at the
 * right of the header row). The same slot carries Live while the mirror
 * channel is joined, so a PT can see the client's phone is being heard.
 * Copy comes from the screen.
 */
export function LiveBadge({ state, label }: LiveBadgeProps) {
  const t = useTheme();
  const dot = state === 'live' ? t.colors.successAccent : state === 'offline' ? t.colors.warnAccent : t.colors.textMuted;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingVertical: 5,
        paddingHorizontal: 9,
        borderRadius: t.radius.pill,
        backgroundColor: state === 'offline' ? t.colors.accentSurfaceSoft : t.colors.surfaceRaised,
        flexShrink: 0,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
      <Text
        style={{
          fontSize: 9.5,
          fontWeight: '700',
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          color: state === 'offline' ? t.colors.onAccentSurfaceSoft : t.colors.textSecondary,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

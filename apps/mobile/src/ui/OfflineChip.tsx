import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type OfflineChipProps = { label: string; tone: 'offline' | 'syncing' | 'failed'; onPress: () => void };

/**
 * The offline / sync status strip (prototype shell: "OFFLINE · 3 TO SYNC"
 * under the status bar). Full width, one line, tappable into the sync queue.
 * Copy comes from the caller.
 */
export function OfflineChip({ label, tone, onPress }: OfflineChipProps) {
  const t = useTheme();
  const colors =
    tone === 'failed'
      ? { bg: t.colors.dangerSurface, fg: t.colors.onDangerSurface, dot: t.colors.dangerAccent }
      : tone === 'syncing'
        ? { bg: t.colors.surfaceRaised, fg: t.colors.textPrimary, dot: t.colors.accent }
        : { bg: t.colors.accentSurfaceSoft, fg: t.colors.onAccentSurfaceSoft, dot: t.colors.warnAccent };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderRadius: 10,
        backgroundColor: colors.bg,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.dot }} />
      <Text
        numberOfLines={1}
        style={{ flex: 1, fontSize: 11.5, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colors.fg }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

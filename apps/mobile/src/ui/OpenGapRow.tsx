import { Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type OpenGapRowProps = { label: string; actionLabel: string; onPress: () => void };

/** A dashed open stretch of published hours. Tapping starts a booking at its start. */
export function OpenGapRow({ label, actionLabel, onPress }: OpenGapRowProps) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${actionLabel}`}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: t.touchTarget,
        paddingHorizontal: 12,
        borderRadius: t.radius.md,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: t.colors.borderStrong,
      }}
    >
      <Text style={{ fontSize: 13, color: t.colors.textSecondary }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: '700', color: t.colors.accentText }}>{actionLabel}</Text>
    </Pressable>
  );
}

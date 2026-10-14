import { Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type TimeRangePillProps = { label: string; onPress?: () => void; variant?: 'range' | 'break' };

/** "06:00 – 12:00" as a tappable pill; a break is the same shape, muted and inert. */
export function TimeRangePill({ label, onPress, variant = 'range' }: TimeRangePillProps) {
  const t = useTheme();
  const isBreak = variant === 'break';
  return (
    <Pressable
      accessibilityRole={isBreak ? 'text' : 'button'}
      onPress={onPress}
      disabled={isBreak || !onPress}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: t.radius.pill,
        backgroundColor: isBreak ? 'transparent' : t.colors.surfaceSunken,
        borderWidth: isBreak ? 0 : 1,
        borderColor: t.colors.border,
      }}
    >
      <Text numeric style={{ fontSize: 13, color: isBreak ? t.colors.textMuted : t.colors.textPrimary }}>
        {label}
      </Text>
    </Pressable>
  );
}

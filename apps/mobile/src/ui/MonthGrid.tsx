import { monthCells } from '@forge/shared';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type MonthGridProps = {
  year: number;
  month0: number;
  /** Seven labels, Monday first. */
  dowLabels: string[];
  /** Day of month → dot colours (at most three are drawn). */
  dots: Record<number, string[]>;
  selected: number | null;
  today: number | null;
  onSelect: (day: number) => void;
};

/** A Monday-first month with state dots per day. Used by the schedule's Month view and the Exceptions tab. */
export function MonthGrid({ year, month0, dowLabels, dots, selected, today, onSelect }: MonthGridProps) {
  const t = useTheme();
  const cells = monthCells(year, month0);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row' }}>
        {dowLabels.map((d) => (
          <Text key={d} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: t.colors.textMuted }}>
            {d}
          </Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, row) => (
        <View key={row} style={{ flexDirection: 'row' }}>
          {cells.slice(row * 7, row * 7 + 7).map((day, i) =>
            day === null ? (
              <View key={i} style={{ flex: 1, height: 48 }} />
            ) : (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityState={{ selected: selected === day }}
                onPress={() => onSelect(day)}
                style={{
                  flex: 1,
                  height: 48,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  borderRadius: t.radius.md,
                  backgroundColor: selected === day ? t.colors.accentSurfaceSoft : 'transparent',
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: today === day ? '800' : '500',
                    color: selected === day ? t.colors.onAccentSurfaceSoft : t.colors.textPrimary,
                  }}
                >
                  {day}
                </Text>
                <View style={{ flexDirection: 'row', gap: 2, height: 5 }}>
                  {(dots[day] ?? []).slice(0, 3).map((c, k) => (
                    <View key={k} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c }} />
                  ))}
                </View>
              </Pressable>
            ),
          )}
        </View>
      ))}
    </View>
  );
}

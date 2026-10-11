import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type DayStripDay = { key: string; dow: string; date: string; count: number | null; disabled?: boolean };
export type DayStripProps = { days: DayStripDay[]; selected: string | null; onSelect: (key: string) => void };

/**
 * Seven equal cells with open-slot counts, so an empty day is visible before
 * tapping (design note). A plain row of flex cells, not a horizontal
 * ScrollView — that stretches chips vertically (RN pitfall in memory).
 */
export function DayStrip({ days, selected, onSelect }: DayStripProps) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {days.map((d) => {
        const on = d.key === selected;
        const empty = d.count === 0;
        return (
          <Pressable
            key={d.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: d.disabled }}
            disabled={d.disabled}
            onPress={() => onSelect(d.key)}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 8,
              gap: 2,
              borderRadius: t.radius.md,
              borderWidth: 1.5,
              borderColor: on ? t.colors.accent : t.colors.border,
              backgroundColor: on ? t.colors.accentSurfaceSoft : t.colors.surfaceRaised,
              opacity: d.disabled ? 0.45 : 1,
            }}
          >
            <Text style={{ fontSize: 11, color: on ? t.colors.onAccentSurfaceSoft : t.colors.textMuted }}>{d.dow}</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: on ? t.colors.onAccentSurfaceSoft : t.colors.textPrimary }}>{d.date}</Text>
            <Text numeric style={{ fontSize: 11, color: empty ? t.colors.textMuted : t.colors.accentText }}>
              {d.count === null ? ' ' : String(d.count)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

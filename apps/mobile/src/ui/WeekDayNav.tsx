import { type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/** Progress marker for a week chip. Absent on the builder, where nothing is elapsed yet. */
export type WeekNavState = 'done' | 'current' | 'upcoming';

export type WeekNavItem = {
  key: string;
  number: number;
  state?: WeekNavState;
  /** Screen-reader label, e.g. "Week 3". */
  a11yLabel: string;
};

export type DayNavItem = {
  key: string;
  /** Visible label — the PT's own day label, or "Day 2". */
  label: string;
  a11yLabel: string;
};

export type WeekDayNavProps = {
  weeks: WeekNavItem[];
  weekIndex: number;
  onSelectWeek: (index: number) => void;
  days: DayNavItem[];
  dayIndex: number;
  onSelectDay: (index: number) => void;
  /** Already-formatted, e.g. "4 weeks · 3 days/week · 12 exercises". */
  meta?: string | null;
  /** Builder only. Renders a dashed chip at the end of the day row. */
  addDayLabel?: string;
  onAddDay?: () => void;
  /** Builder only — the copy-week control, pinned to the end of the week row. */
  trailing?: ReactNode;
};

// Fixed, not min: a horizontal ScrollView's content container is a flex row whose
// default alignItems is 'stretch', so height-less chips grow to fill whatever the
// row is given — which is why the week numbers ballooned, and ballooned further on
// a week with no days, when the day row below collapsed and freed the space.
// Explicit heights plus alignItems:'center' make that impossible.
const WEEK_CHIP = 34;
const DAY_CHIP = 32;

/**
 * Week and day selection for a program — one compact bar shared by the PT's
 * builder and the client's read-only view, so the two cannot drift apart.
 *
 * The week chips carry the progress the client view used to draw as a separate
 * WeekStrip above them: elapsed weeks are filled, the live week is ringed. One
 * control, one place to look, roughly half the vertical space.
 */
export function WeekDayNav({
  weeks,
  weekIndex,
  onSelectWeek,
  days,
  dayIndex,
  onSelectDay,
  meta,
  addDayLabel,
  onAddDay,
  trailing,
}: WeekDayNavProps) {
  const t = useTheme();

  const weekChipStyle = (selected: boolean, state?: WeekNavState) => {
    if (selected) {
      return { backgroundColor: t.colors.accent, borderColor: t.colors.accent, color: t.colors.onAccent };
    }
    if (state === 'current') {
      return {
        backgroundColor: t.colors.accentSurfaceSoft,
        borderColor: t.colors.accent,
        color: t.colors.onAccentSurfaceSoft,
      };
    }
    if (state === 'done') {
      return {
        backgroundColor: t.colors.surfaceRaised,
        borderColor: t.colors.border,
        color: t.colors.textSecondary,
      };
    }
    return { backgroundColor: 'transparent', borderColor: t.colors.border, color: t.colors.textMuted };
  };

  const showDayRow = days.length > 0 || onAddDay !== undefined;

  return (
    <View style={{ paddingHorizontal: t.space[4], paddingTop: t.space[3], gap: t.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space[2] }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // flexGrow:0 keeps the scroller at its content height; without it the
          // scroller itself is what stretches inside the column.
          style={{ flexGrow: 0, flexShrink: 1 }}
          contentContainerStyle={{ gap: t.space[2], alignItems: 'center' }}
        >
          {weeks.map((w, wi) => {
            const selected = wi === weekIndex;
            const s = weekChipStyle(selected, w.state);
            return (
              <Pressable
                key={w.key}
                accessibilityRole="button"
                accessibilityLabel={w.a11yLabel}
                accessibilityState={{ selected }}
                onPress={() => onSelectWeek(wi)}
                style={{
                  width: WEEK_CHIP + 6,
                  height: WEEK_CHIP,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: t.radius.md,
                  borderWidth: selected || w.state === 'current' ? 1.5 : 1,
                  borderColor: s.borderColor,
                  backgroundColor: s.backgroundColor,
                }}
              >
                <Text numeric style={{ fontSize: 13, fontWeight: '700', lineHeight: 18, color: s.color }}>
                  {w.number}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {trailing ?? null}
      </View>

      {showDayRow ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: t.space[2], alignItems: 'center' }}
        >
          {days.map((d, di) => {
            const selected = di === dayIndex;
            return (
              <Pressable
                key={d.key}
                accessibilityRole="button"
                accessibilityLabel={d.a11yLabel}
                accessibilityState={{ selected }}
                onPress={() => onSelectDay(di)}
                style={{
                  height: DAY_CHIP,
                  paddingHorizontal: t.space[3],
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: t.radius.pill,
                  borderWidth: 1,
                  borderColor: selected ? t.colors.accent : t.colors.border,
                  backgroundColor: selected ? t.colors.accentSurfaceSoft : 'transparent',
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 13,
                    fontWeight: selected ? '700' : '500',
                    color: selected ? t.colors.onAccentSurfaceSoft : t.colors.textSecondary,
                  }}
                >
                  {d.label}
                </Text>
              </Pressable>
            );
          })}

          {onAddDay ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={addDayLabel}
              onPress={onAddDay}
              style={{
                height: DAY_CHIP,
                paddingHorizontal: t.space[3],
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: t.radius.pill,
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: t.colors.border,
              }}
            >
              <Text tone="muted" style={{ fontSize: 13, fontWeight: '600' }}>
                + {addDayLabel}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}

      {meta ? (
        <Text numeric tone="muted" style={{ fontSize: 11.5 }}>
          {meta}
        </Text>
      ) : null}
    </View>
  );
}

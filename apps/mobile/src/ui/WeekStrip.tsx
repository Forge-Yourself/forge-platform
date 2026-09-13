import { View } from 'react-native';
import type { WeekProgressState } from '@forge/shared';
import { useTheme } from '../theme/ThemeProvider';

export type WeekStripProps = {
  weeks: { weekNumber: number; state: WeekProgressState }[];
  /** Screen-reader summary, e.g. "Week 3 of 6". A bar row announces nothing on its own. */
  label: string;
};

/**
 * Completion at a glance: a filled bar per elapsed week, an outlined one for the
 * live week. Bars, never a percentage — the design annotation is explicit that
 * this is a glance, not a metric.
 *
 * It belongs to the program card it describes. It previously rendered as a second,
 * detached list below the roster, which repeated every program name and left the
 * strips with no visual tie to the rows they were about.
 */
export function WeekStrip({ weeks, label }: WeekStripProps) {
  const t = useTheme();

  // `border`, not `surfaceSunken`, for the weeks still ahead: on a card
  // (surfaceRaised) the sunken tone is darker than its own backdrop in dark mode,
  // so the unfilled bars disappeared and a 4-week strip read as 3 bars.
  const colorFor = (state: WeekProgressState) => {
    if (state === 'done') return t.colors.accent;
    if (state === 'current') return t.colors.accentSurfaceSoft;
    return t.colors.border;
  };

  return (
    <View accessible accessibilityLabel={label} style={{ flexDirection: 'row', gap: 5, width: '100%' }}>
      {weeks.map((week) => (
        <View
          key={week.weekNumber}
          style={{
            flex: 1,
            height: 5,
            borderRadius: 3,
            backgroundColor: colorFor(week.state),
            borderWidth: week.state === 'current' ? 1 : 0,
            borderColor: t.colors.accent,
          }}
        />
      ))}
    </View>
  );
}

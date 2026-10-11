import type { BookingState } from '@forge/shared';
import { Pressable, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { stateStyle } from '../lib/schedule/stateStyle';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type CalendarBlockProps = {
  state: BookingState;
  stateLabel: string;
  title: string;
  subtitle: string;
  note?: string;
  noteTone?: 'muted' | 'warn';
  onPress?: () => void;
  /** Week grid: block height is the booking length. */
  minHeight?: number;
  selected?: boolean;
};

/**
 * One booking on a schedule: a state bar on the leading edge, the person, the
 * state word (never colour alone), time · what, and an optional note line.
 * The PT's own training is hatched so it can't be read as a client.
 */
export function CalendarBlock({ state, stateLabel, title, subtitle, note, noteTone = 'muted', onPress, minHeight, selected }: CalendarBlockProps) {
  const t = useTheme();
  const s = stateStyle(state, t.colors);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${stateLabel}, ${subtitle}`}
      onPress={onPress}
      disabled={!onPress}
      style={{
        flexDirection: 'row',
        minHeight: minHeight ?? 64,
        borderRadius: t.radius.md,
        overflow: 'hidden',
        backgroundColor: s.bg,
        borderWidth: selected ? 2 : s.border === 'transparent' ? 0 : 1,
        borderColor: selected ? t.colors.accent : s.border,
        borderStyle: s.dashed ? 'dashed' : 'solid',
      }}
    >
      {s.hatch ? (
        <Svg style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
          <Defs>
            <Pattern id="forge-me-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <Rect width="6" height="12" fill={t.colors.surfaceRaised} />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#forge-me-hatch)" />
        </Svg>
      ) : null}
      <View style={{ width: 4, backgroundColor: s.bar }} />
      <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text
            numberOfLines={1}
            style={{ flex: 1, fontWeight: '700', color: s.fg, textDecorationLine: s.strike ? 'line-through' : 'none' }}
          >
            {title}
          </Text>
          <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: s.fg }}>{stateLabel}</Text>
        </View>
        <Text numberOfLines={1} style={{ fontSize: 13, color: s.fg }}>
          {subtitle}
        </Text>
        {note ? (
          <Text numberOfLines={1} style={{ fontSize: 12, color: noteTone === 'warn' ? t.colors.onWarnSurface : t.colors.textMuted }}>
            {note}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

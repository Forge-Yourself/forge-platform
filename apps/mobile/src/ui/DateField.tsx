import { parseCalendarDate, toCalendarDate, todayCalendarDate } from '@forge/shared';
import { useState } from 'react';
import { I18nManager, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon } from './Icon';
import { NavHeader } from './NavHeader';
import { Screen } from './Screen';
import { Text } from './Text';

export type DateFieldLabels = {
  /** Screen-reader name for the field's tap target, e.g. "Choose a date". */
  open: string;
  /** Title of the picker sheet. */
  title: string;
  clear: string;
  done: string;
  previousMonth: string;
  nextMonth: string;
  /** Tap target on the month title that opens the year list. */
  chooseYear: string;
};

export type DateFieldProps = {
  label: string;
  /** `YYYY-MM-DD`, or '' for not answered. */
  value: string;
  onChange: (next: string) => void;
  /** Shown in place of a date when `value` is empty. */
  placeholder?: string;
  error?: string;
  helperText?: string;
  /** Inclusive selectable bounds as `YYYY-MM-DD`. Days outside them are not tappable. */
  minDate?: string;
  maxDate?: string;
  /**
   * Opens on the year list rather than a month grid. Right for a date of birth,
   * where paging months back thirty years is not a real interaction; wrong for a
   * goal date a few weeks out.
   */
  startOnYear?: boolean;
  /** BCP-47 tag for the month and weekday names — pass the app's active language. */
  locale?: string;
  labels: DateFieldLabels;
};

const CELL_COUNT = 7;

function weekdayNames(locale: string | undefined): string[] {
  // 2024-01-07 is a Sunday, so day 7+i names weekday i with no locale-week logic.
  return Array.from({ length: CELL_COUNT }, (_, i) =>
    new Date(2024, 0, 7 + i).toLocaleDateString(locale, { weekday: 'narrow' }),
  );
}

function monthTitle(locale: string | undefined, year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

/** Day-of-month count, via the zeroth day of the following month. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function clamp(day: string, min: string | undefined, max: string | undefined): string {
  if (min && day < min) return min;
  if (max && day > max) return max;
  return day;
}

/**
 * A calendar date, chosen from a picker rather than typed.
 *
 * Both of the intake's dates were plain `TextField`s with a "YYYY-MM-DD"
 * placeholder, which asked a client on a phone to hand-type a format and gave no
 * sign when they got it wrong — `2026-13-40`, `14/09/2026` and `next June` all
 * went to the database as strings, and a malformed date_of_birth then showed the
 * PT no age at all, silently.
 *
 * Built from RN primitives rather than a native picker module: the app targets
 * iOS, Android AND web (`expo start --web`), it already hand-builds its inputs
 * (SignaturePad, NumericKeypad, SegmentedPill), and a new native dependency
 * would mean a rebuild mid-milestone for one field type.
 */
export function DateField({
  label,
  value,
  onChange,
  placeholder,
  error,
  helperText,
  minDate,
  maxDate,
  startOnYear = false,
  locale,
  labels,
}: DateFieldProps) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [showYears, setShowYears] = useState(false);

  const selected = parseCalendarDate(value);
  const anchor =
    selected ?? parseCalendarDate(clamp(todayCalendarDate(), minDate, maxDate)) ?? new Date();
  const [viewYear, setViewYear] = useState(anchor.getFullYear());
  const [viewMonth, setViewMonth] = useState(anchor.getMonth());

  const minYear = parseCalendarDate(minDate)?.getFullYear() ?? new Date().getFullYear() - 120;
  const maxYear = parseCalendarDate(maxDate)?.getFullYear() ?? new Date().getFullYear() + 10;

  const borderColor = error ? t.colors.dangerAccent : t.colors.borderStrong;
  const displayed = selected
    ? selected.toLocaleDateString(locale, { dateStyle: 'long' })
    : (placeholder ?? '');
  const message = error ?? helperText;
  const messageTone = error ? t.colors.dangerAccent : t.colors.textMuted;

  function openPicker() {
    // Re-anchor every time: the field may have been cleared, or the bounds moved
    // (target_date's minimum is "today") since the last open.
    const at =
      parseCalendarDate(value) ??
      parseCalendarDate(clamp(todayCalendarDate(), minDate, maxDate)) ??
      new Date();
    setViewYear(at.getFullYear());
    setViewMonth(at.getMonth());
    setShowYears(startOnYear && !parseCalendarDate(value));
    setOpen(true);
  }

  function stepMonth(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  function pick(day: number) {
    onChange(toCalendarDate(new Date(viewYear, viewMonth, day)));
    setOpen(false);
  }

  const leadingBlanks = new Date(viewYear, viewMonth, 1).getDay();
  const dayCount = daysInMonth(viewYear, viewMonth);
  const today = todayCalendarDate();

  // The glyph has to be swapped by hand under RTL: the row itself flips, but a
  // chevron drawn pointing left keeps pointing left wherever it lands.
  const prevIcon = I18nManager.isRTL ? 'chevron' : 'chevronBack';
  const nextIcon = I18nManager.isRTL ? 'chevronBack' : 'chevron';

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: t.colors.textMuted, marginBottom: t.space[1] + 2 }]}>
        {label.toUpperCase()}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${displayed || labels.open}`}
        onPress={openPicker}
        style={({ pressed }) => [
          styles.trigger,
          {
            borderRadius: t.radius.md,
            borderColor,
            backgroundColor: t.colors.surfaceRaised,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={{ flex: 1, fontSize: 15, color: selected ? t.colors.textPrimary : t.colors.textMuted }}
        >
          {displayed}
        </Text>
        <Icon name="calendar" size={18} color={t.colors.textSecondary} />
      </Pressable>

      {message ? (
        <Text style={[styles.message, { color: messageTone, marginTop: t.space[1] }]}>{message}</Text>
      ) : null}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <Screen padded={false}>
          <NavHeader
            title={labels.title}
            leading={<Button label={labels.done} variant="link" onPress={() => setOpen(false)} />}
            trailing={
              value ? (
                <Button
                  label={labels.clear}
                  variant="link"
                  tone="danger"
                  onPress={() => {
                    onChange('');
                    setOpen(false);
                  }}
                />
              ) : null
            }
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', padding: t.space[3] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.previousMonth}
              disabled={showYears}
              onPress={() => stepMonth(-1)}
              style={[
                styles.arrow,
                { minWidth: t.touchTarget, minHeight: t.touchTarget, opacity: showYears ? 0 : 1 },
              ]}
            >
              <Icon name={prevIcon} size={20} color={t.colors.textPrimary} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.chooseYear}
              onPress={() => setShowYears((v) => !v)}
              style={{ flex: 1, minHeight: t.touchTarget, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 16, fontWeight: '700' }}>
                {showYears ? String(viewYear) : monthTitle(locale, viewYear, viewMonth)}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.nextMonth}
              disabled={showYears}
              onPress={() => stepMonth(1)}
              style={[
                styles.arrow,
                { minWidth: t.touchTarget, minHeight: t.touchTarget, opacity: showYears ? 0 : 1 },
              ]}
            >
              <Icon name={nextIcon} size={20} color={t.colors.textPrimary} />
            </Pressable>
          </View>

          {showYears ? (
            <ScrollView contentContainerStyle={{ padding: t.space[4] }}>
              <View style={styles.grid}>
                {Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i).map((year) => {
                  const isCurrent = year === viewYear;
                  return (
                    <Pressable
                      key={year}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isCurrent }}
                      onPress={() => {
                        setViewYear(year);
                        setShowYears(false);
                      }}
                      style={styles.yearCell}
                    >
                      <Text
                        style={{
                          fontSize: 15,
                          fontWeight: isCurrent ? '800' : '500',
                          color: isCurrent ? t.colors.accentText : t.colors.textPrimary,
                        }}
                      >
                        {year}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          ) : (
            <View style={{ paddingHorizontal: t.space[4], paddingBottom: t.space[5] }}>
              <View style={styles.grid}>
                {weekdayNames(locale).map((name, i) => (
                  <View key={i} style={styles.cell}>
                    <Text tone="muted" style={{ fontSize: 12, fontWeight: '700' }}>
                      {name}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={styles.grid}>
                {Array.from({ length: leadingBlanks }, (_, i) => (
                  <View key={`blank-${i}`} style={styles.cell} />
                ))}
                {Array.from({ length: dayCount }, (_, i) => i + 1).map((day) => {
                  const iso = toCalendarDate(new Date(viewYear, viewMonth, day));
                  const outOfRange = (minDate && iso < minDate) || (maxDate && iso > maxDate);
                  const isSelected = iso === value;
                  const isToday = iso === today;
                  return (
                    <Pressable
                      key={day}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected, disabled: !!outOfRange }}
                      disabled={!!outOfRange}
                      onPress={() => pick(day)}
                      style={styles.cell}
                    >
                      <View
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 19,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: isSelected ? t.colors.accent : 'transparent',
                          borderWidth: !isSelected && isToday ? 1.5 : 0,
                          borderColor: t.colors.borderStrong,
                          opacity: outOfRange ? 0.3 : 1,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 15,
                            fontWeight: isSelected ? '800' : '500',
                            color: isSelected ? t.colors.onAccent : t.colors.textPrimary,
                          }}
                        >
                          {day}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        </Screen>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 14 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1.5,
  },
  message: { fontSize: 12, fontWeight: '500' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: '14.2857%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
    minHeight: 44,
  },
  yearCell: { width: '25%', paddingVertical: 12, alignItems: 'center' },
  arrow: { alignItems: 'center', justifyContent: 'center' },
});

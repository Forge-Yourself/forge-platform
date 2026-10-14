import { durationLabel, hhmm, minuteOfDay } from '@forge/shared';

/** HH:MM on the device's clock. Bookings are instants; the device shows its own wall time (plan Global Constraints). */
export function timeLabel(iso: string): string {
  return hhmm(minuteOfDay(new Date(iso)));
}

export function dayLabel(d: Date | string, locale: string): string {
  const date = typeof d === 'string' ? new Date(d.length === 10 ? d + 'T12:00:00' : d) : d;
  return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function dowLabel(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { weekday: 'short' });
}

/** "Wed 10 Sep, 22:30" — the exact deadline, not the rule (design, My bookings). */
export function deadlineLabel(d: Date, locale: string): string {
  return dayLabel(d, locale) + ', ' + hhmm(minuteOfDay(d));
}

/** "48m", "3h 10" — time left until something. */
export function untilLabel(ms: number): string {
  return durationLabel(Math.max(0, Math.round(ms / 60_000)));
}

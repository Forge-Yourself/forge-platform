const MIN = 60_000;
const HOUR = 60 * MIN;

/** Mirrors 0020: no-show unlocks this long after the start. */
export const NO_SHOW_GRACE_MIN = 15;

export function cancelDeadline(startsAt: string, cutoffHours: number): Date {
  return new Date(Date.parse(startsAt) - cutoffHours * HOUR);
}

/**
 * Mirrors cancel_booking / reschedule_booking: a booking is late once
 * `starts_at − cutoff <= now`, so a client may change it only strictly before.
 * The SQL side is tested in db/rls_assertions.sql at the same boundary.
 */
export function canClientChange(startsAt: string, cutoffHours: number, now: number): boolean {
  return cancelDeadline(startsAt, cutoffHours).getTime() > now;
}

export function noShowUnlocksAt(startsAt: string): Date {
  return new Date(Date.parse(startsAt) + NO_SHOW_GRACE_MIN * MIN);
}

export function canMarkNoShow(startsAt: string, now: number): boolean {
  return now >= noShowUnlocksAt(startsAt).getTime();
}

const pad = (n: number) => String(n).padStart(2, '0');

export function hhmm(min: number): string {
  return pad(Math.floor(min / 60)) + ':' + pad(min % 60);
}

export function parseHhmm(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Local wall-clock fields of the device. The app never converts zones (plan Global Constraints). */
export function minuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function localDayKey(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
}

export function durationLabel(min: number): string {
  if (min < 60) return min + 'm';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? h + 'h ' + m : h + 'h';
}

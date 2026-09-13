/**
 * Calendar dates, kept separate from instants.
 *
 * Several columns in this schema are `DATE`, not `TIMESTAMPTZ`: `programs.start_date`,
 * and `date_of_birth` / `target_date` / `expires_on` inside the intake and
 * certification payloads. A DATE is a day on a calendar — it has no time and no zone.
 *
 * JavaScript disagrees. `new Date('2026-09-14')` is specified to parse a bare
 * date-only string as UTC midnight, while every getter you would then reach for
 * (`getDate()`, `getMonth()`) and every `Date` you would compare it to is local. In
 * Beirut (UTC+2/+3) that puts "2026-09-14" at 03:00 local on the 14th, so between
 * midnight and 03:00 a program that starts today reads as not yet started, and
 * `toISOString().slice(0, 10)` on "now" returns yesterday. Lebanon-first makes that
 * the default case rather than an edge one.
 *
 * These two helpers are the whole fix: parse a calendar date AS a local calendar date,
 * and format one back the same way. Anything that touches a DATE column goes through
 * them; anything that touches a TIMESTAMPTZ keeps using Date directly, because there
 * the instant is the point.
 */

/**
 * Parses `YYYY-MM-DD` as local midnight on that calendar day. Returns null for
 * anything that is not a well-formed, real date — including `2026-02-30`, which the
 * Date constructor would silently roll forward to March 2nd.
 */
export function parseCalendarDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(year, month - 1, day);
  // Round-trip check: rejects 2026-13-01 and 2026-02-30 rather than accepting the
  // overflowed date the constructor happily produces.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Formats a Date as `YYYY-MM-DD` using its LOCAL calendar day, never UTC. */
export function toCalendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today as a calendar day, with the time of day discarded. */
export function todayCalendarDate(): string {
  return toCalendarDate(new Date());
}

/**
 * Shifts a calendar date by whole years, clamping Feb 29 to Feb 28 in a
 * non-leap target year rather than letting it roll into March.
 */
export function shiftCalendarYears(value: string, years: number): string {
  const date = parseCalendarDate(value);
  if (date === null) return value;
  const shifted = new Date(date.getFullYear() + years, date.getMonth(), date.getDate());
  if (shifted.getMonth() !== date.getMonth()) shifted.setDate(0);
  return toCalendarDate(shifted);
}

/**
 * Why a date the client typed is not acceptable, or null when it is fine.
 *
 * `malformed` covers both "not YYYY-MM-DD at all" and "well-shaped but not a
 * real day" (2026-02-30) — parseCalendarDate already refuses to roll the latter
 * forward, and to the client both are the same mistake.
 *
 * An empty string is NOT a problem: every date on the intake is optional, and
 * "not answered" is a valid state right up to submission.
 */
export type CalendarDateProblem = 'malformed' | 'before_min' | 'after_max';

export function checkCalendarDate(
  value: string | null | undefined,
  bounds: { min?: string; max?: string } = {},
): CalendarDateProblem | null {
  if (!value || value.trim() === '') return null;
  if (parseCalendarDate(value) === null) return 'malformed';

  // Both sides are zero-padded YYYY-MM-DD, so a string compare IS a date
  // compare — no second parse, and no timezone anywhere near it.
  const day = value.trim();
  if (bounds.min && day < bounds.min) return 'before_min';
  if (bounds.max && day > bounds.max) return 'after_max';
  return null;
}

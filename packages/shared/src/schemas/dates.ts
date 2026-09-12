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

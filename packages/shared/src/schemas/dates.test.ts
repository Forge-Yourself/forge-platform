import { describe, expect, it } from 'vitest';
import { parseCalendarDate, toCalendarDate } from './dates';

describe('parseCalendarDate', () => {
  it('parses a calendar date as local midnight, not UTC midnight', () => {
    const date = parseCalendarDate('2026-09-14');
    expect(date).not.toBeNull();
    // The whole point: the LOCAL calendar fields match what was written, whatever
    // offset the runtime is in. `new Date('2026-09-14')` fails this west of UTC.
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(8);
    expect(date?.getDate()).toBe(14);
    expect(date?.getHours()).toBe(0);
    expect(date?.getMinutes()).toBe(0);
  });

  it('returns null for empty, null and undefined', () => {
    expect(parseCalendarDate('')).toBeNull();
    expect(parseCalendarDate(null)).toBeNull();
    expect(parseCalendarDate(undefined)).toBeNull();
  });

  it('rejects anything that is not exactly YYYY-MM-DD', () => {
    expect(parseCalendarDate('14/09/2026')).toBeNull();
    expect(parseCalendarDate('2026-9-14')).toBeNull();
    expect(parseCalendarDate('2026-09-14T00:00:00Z')).toBeNull();
    expect(parseCalendarDate('not a date')).toBeNull();
  });

  it('rejects dates that do not exist rather than rolling them forward', () => {
    // `new Date(2026, 1, 30)` silently becomes March 2nd. A start date the PT
    // fat-fingered must fail, not quietly move.
    expect(parseCalendarDate('2026-02-30')).toBeNull();
    expect(parseCalendarDate('2026-13-01')).toBeNull();
    expect(parseCalendarDate('2026-00-10')).toBeNull();
  });

  it('accepts a real leap day and rejects a fake one', () => {
    expect(parseCalendarDate('2028-02-29')?.getDate()).toBe(29);
    expect(parseCalendarDate('2026-02-29')).toBeNull();
  });
});

describe('toCalendarDate', () => {
  it('formats a local date, zero-padding month and day', () => {
    expect(toCalendarDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toCalendarDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('uses the local day even late at night, when toISOString() would roll over', () => {
    // 23:30 local. East of UTC this instant is already "tomorrow" in UTC; west of it,
    // an early-morning instant is still "yesterday". Either way the calendar day the
    // user means is the local one — that is the assign screen's "Today" button.
    const lateTonight = new Date(2026, 8, 14, 23, 30);
    expect(toCalendarDate(lateTonight)).toBe('2026-09-14');

    const earlyMorning = new Date(2026, 8, 14, 0, 30);
    expect(toCalendarDate(earlyMorning)).toBe('2026-09-14');
  });

  it('round-trips with parseCalendarDate', () => {
    const original = '2026-07-04';
    const parsed = parseCalendarDate(original);
    expect(parsed).not.toBeNull();
    expect(toCalendarDate(parsed as Date)).toBe(original);
  });
});

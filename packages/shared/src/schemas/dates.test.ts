import { describe, expect, it } from 'vitest';
import {
  checkCalendarDate,
  parseCalendarDate,
  shiftCalendarYears,
  toCalendarDate,
  todayCalendarDate,
} from './dates';

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

describe('todayCalendarDate', () => {
  it('is the local calendar day, matching toCalendarDate(new Date())', () => {
    expect(todayCalendarDate()).toBe(toCalendarDate(new Date()));
  });
});

describe('shiftCalendarYears', () => {
  it('moves a date by whole years', () => {
    expect(shiftCalendarYears('2026-09-14', 10)).toBe('2036-09-14');
    expect(shiftCalendarYears('2026-09-14', -30)).toBe('1996-09-14');
  });

  it('clamps Feb 29 to Feb 28 rather than rolling into March', () => {
    expect(shiftCalendarYears('2028-02-29', 1)).toBe('2029-02-28');
    // …and keeps the 29th when the target year is also a leap year.
    expect(shiftCalendarYears('2028-02-29', 4)).toBe('2032-02-29');
  });

  it('passes a malformed value straight through rather than inventing a date', () => {
    expect(shiftCalendarYears('not a date', 1)).toBe('not a date');
  });
});

describe('checkCalendarDate', () => {
  it('treats an unanswered field as fine, not as an error', () => {
    expect(checkCalendarDate('')).toBeNull();
    expect(checkCalendarDate('   ')).toBeNull();
    expect(checkCalendarDate(null)).toBeNull();
    expect(checkCalendarDate(undefined)).toBeNull();
  });

  it('reports malformed for both bad shapes and impossible days', () => {
    expect(checkCalendarDate('14/09/2026')).toBe('malformed');
    expect(checkCalendarDate('next June')).toBe('malformed');
    expect(checkCalendarDate('2026-02-30')).toBe('malformed');
    expect(checkCalendarDate('2026-13-40')).toBe('malformed');
  });

  it('reports which bound was crossed', () => {
    const bounds = { min: '2026-01-01', max: '2026-12-31' };
    expect(checkCalendarDate('2025-12-31', bounds)).toBe('before_min');
    expect(checkCalendarDate('2027-01-01', bounds)).toBe('after_max');
    expect(checkCalendarDate('2026-06-15', bounds)).toBeNull();
  });

  it('treats both bounds as inclusive', () => {
    const bounds = { min: '2026-01-01', max: '2026-12-31' };
    expect(checkCalendarDate('2026-01-01', bounds)).toBeNull();
    expect(checkCalendarDate('2026-12-31', bounds)).toBeNull();
  });

  it('checks the shape before the bounds, so garbage is never a range error', () => {
    expect(checkCalendarDate('2026-02-30', { min: '2026-01-01' })).toBe('malformed');
  });
});

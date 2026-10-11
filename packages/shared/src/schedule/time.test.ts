import { describe, expect, it } from 'vitest';
import {
  addDays, cancelDeadline, canClientChange, canMarkNoShow, durationLabel, hhmm, localDayKey, minuteOfDay,
  noShowUnlocksAt, parseHhmm,
} from './time';

const START = '2026-10-20T10:00:00.000Z';

describe('cutoff', () => {
  it('puts the deadline cutoff hours before the start', () => {
    expect(cancelDeadline(START, 12).toISOString()).toBe('2026-10-19T22:00:00.000Z');
  });
  it('is already too late exactly at the deadline — same instant cancel_booking refuses (Review Focus 2)', () => {
    const deadline = Date.parse('2026-10-19T22:00:00.000Z');
    expect(canClientChange(START, 12, deadline - 1)).toBe(true);
    expect(canClientChange(START, 12, deadline)).toBe(false);
  });
  it('a zero cutoff allows changes until the start', () => {
    expect(canClientChange(START, 0, Date.parse(START) - 1)).toBe(true);
    expect(canClientChange(START, 0, Date.parse(START))).toBe(false);
  });
});

describe('no-show', () => {
  it('unlocks 15 minutes after the start', () => {
    expect(noShowUnlocksAt(START).toISOString()).toBe('2026-10-20T10:15:00.000Z');
    expect(canMarkNoShow(START, Date.parse('2026-10-20T10:14:59.999Z'))).toBe(false);
    expect(canMarkNoShow(START, Date.parse('2026-10-20T10:15:00.000Z'))).toBe(true);
  });
});

describe('clock helpers', () => {
  it('formats and parses HH:MM', () => {
    expect(hhmm(75)).toBe('01:15');
    expect(hhmm(0)).toBe('00:00');
    expect(parseHhmm('07:05')).toBe(425);
    expect(parseHhmm('24:00')).toBeNull();
    expect(parseHhmm('7:05')).toBeNull();
  });
  it('reads minutes and day keys from local fields', () => {
    expect(minuteOfDay(new Date(2026, 9, 5, 9, 42))).toBe(582);
    expect(localDayKey(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
    expect(localDayKey(addDays(new Date(2026, 9, 31, 12), 1))).toBe('2026-11-01');
  });
  it('labels durations the way the design does', () => {
    expect(durationLabel(150)).toBe('2h 30');
    expect(durationLabel(120)).toBe('2h');
    expect(durationLabel(45)).toBe('45m');
  });
});

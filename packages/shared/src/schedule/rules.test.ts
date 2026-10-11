import { describe, expect, it } from 'vitest';
import { copyMondayToWeekdays, DEFAULT_RULES, stepRule, toggleLength, validateHours, weeklyMinutes } from './rules';

describe('stepRule', () => {
  it('steps by the bound and clamps', () => {
    expect(stepRule(DEFAULT_RULES, 'bufferMin', 1).bufferMin).toBe(20);
    expect(stepRule({ ...DEFAULT_RULES, bufferMin: 60 }, 'bufferMin', 1).bufferMin).toBe(60);
    expect(stepRule({ ...DEFAULT_RULES, cutoffHours: 0 }, 'cutoffHours', -1).cutoffHours).toBe(0);
    expect(stepRule({ ...DEFAULT_RULES, windowWeeks: 12 }, 'windowWeeks', 1).windowWeeks).toBe(12);
  });
});

describe('toggleLength', () => {
  it('adds in order and never removes the last one', () => {
    expect(toggleLength([45, 90], 60)).toEqual([45, 60, 90]);
    expect(toggleLength([45, 60], 45)).toEqual([60]);
    expect(toggleLength([60], 60)).toEqual([60]);
  });
});

describe('validateHours — the same cases save_availability refuses (Review Focus 4)', () => {
  it('accepts touching ranges', () => {
    expect(validateHours([{ dow: 1, start: '06:00', end: '12:00' }, { dow: 1, start: '12:00', end: '14:00' }])).toEqual({ ok: true });
  });
  it('refuses a reversed range', () => {
    expect(validateHours([{ dow: 1, start: '12:00', end: '06:00' }])).toEqual({ ok: false, code: 'bad_range', dow: 1 });
  });
  it('refuses overlapping ranges on one day, including identical ones', () => {
    expect(validateHours([{ dow: 2, start: '06:00', end: '12:00' }, { dow: 2, start: '11:00', end: '14:00' }])).toEqual({
      ok: false, code: 'overlapping_hours', dow: 2,
    });
    expect(validateHours([{ dow: 3, start: '06:00', end: '07:00' }, { dow: 3, start: '06:00', end: '07:00' }])).toEqual({
      ok: false, code: 'overlapping_hours', dow: 3,
    });
  });
  it('allows the same range on different days', () => {
    expect(validateHours([{ dow: 1, start: '06:00', end: '12:00' }, { dow: 2, start: '06:00', end: '12:00' }])).toEqual({ ok: true });
  });
});

describe('weekly hours helpers', () => {
  it('totals the week', () => {
    expect(weeklyMinutes([{ dow: 1, start: '06:00', end: '12:00' }, { dow: 2, start: '15:00', end: '20:00' }])).toBe(660);
  });
  it('copies Monday onto Tuesday–Friday and leaves the weekend alone', () => {
    const out = copyMondayToWeekdays([
      { dow: 1, start: '06:00', end: '12:00' },
      { dow: 3, start: '09:00', end: '10:00' },
      { dow: 6, start: '09:00', end: '12:00' },
    ]);
    expect(out.filter((h) => h.dow === 3)).toEqual([{ dow: 3, start: '06:00', end: '12:00' }]);
    expect(out.filter((h) => h.dow === 6)).toEqual([{ dow: 6, start: '09:00', end: '12:00' }]);
    expect(out.length).toBe(6);
  });
});

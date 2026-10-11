import { describe, expect, it } from 'vitest';
import { bookingState, dayRows, monthCells, seriesProgress, slotCountsByDay } from './layout';

const W = [{ startMin: 360, endMin: 720 }];

describe('bookingState', () => {
  it('maps statuses to the six design states', () => {
    expect(bookingState('scheduled', false)).toBe('booked');
    expect(bookingState('checked_in', false)).toBe('checked');
    expect(bookingState('completed', false)).toBe('done');
    expect(bookingState('no_show', false)).toBe('noshow');
    expect(bookingState('cancelled', false)).toBe('cancelled');
  });
  it('draws own training as ME unless it was cancelled', () => {
    expect(bookingState('scheduled', true)).toBe('me');
    expect(bookingState('completed', true)).toBe('me');
    expect(bookingState('cancelled', true)).toBe('cancelled');
  });
});

describe('dayRows', () => {
  it('splits a window around a booking into open gaps', () => {
    const rows = dayRows(W, [{ startMin: 540, endMin: 600, item: 'a', occupies: true }], null);
    expect(rows).toEqual([
      { kind: 'gap', startMin: 360, endMin: 540 },
      { kind: 'block', startMin: 540, endMin: 600, item: 'a' },
      { kind: 'gap', startMin: 600, endMin: 720 },
    ]);
  });
  it('a cancelled booking is listed but leaves its time open', () => {
    const rows = dayRows(W, [{ startMin: 540, endMin: 600, item: 'x', occupies: false }], null);
    expect(rows.map((r) => r.kind)).toEqual(['gap', 'block']);
    expect(rows[0]).toEqual({ kind: 'gap', startMin: 360, endMin: 720 });
  });
  it('drops gaps already in the past and places the now line', () => {
    const rows = dayRows(W, [{ startMin: 540, endMin: 600, item: 'a', occupies: true }], 582);
    expect(rows).toEqual([
      { kind: 'block', startMin: 540, endMin: 600, item: 'a' },
      { kind: 'now', min: 582 },
      { kind: 'gap', startMin: 600, endMin: 720 },
    ]);
  });
  it('clips a gap that now cuts through to the next quarter hour', () => {
    expect(dayRows(W, [], 400)).toEqual([{ kind: 'now', min: 400 }, { kind: 'gap', startMin: 405, endMin: 720 }]);
  });
  it('drops gaps shorter than the minimum', () => {
    const rows = dayRows(W, [{ startMin: 360, endMin: 700, item: 'a', occupies: true }], null);
    expect(rows.filter((r) => r.kind === 'gap')).toEqual([]);
  });
  it('puts the now line last when the day is over', () => {
    expect(dayRows(W, [], 1300)).toEqual([{ kind: 'now', min: 1300 }]);
  });
});

describe('monthCells', () => {
  it('is Monday-first and trimmed to whole weeks', () => {
    const oct = monthCells(2026, 9); // 1 Oct 2026 is a Thursday
    expect(oct.length).toBe(35);
    expect(oct.slice(0, 4)).toEqual([null, null, null, 1]);
    expect(oct[33]).toBe(31);
    expect(oct[34]).toBeNull();
    expect(monthCells(2027, 1).length).toBe(28); // Feb 2027 starts on a Monday
  });
});

describe('slotCountsByDay', () => {
  it('counts openings per day', () => {
    expect(slotCountsByDay([{ date: '2026-10-19' }, { date: '2026-10-19' }, { date: '2026-10-21' }])).toEqual({
      '2026-10-19': 2,
      '2026-10-21': 1,
    });
  });
});

describe('seriesProgress', () => {
  it('counts what is left from this session on', () => {
    const rows = [
      { starts_at: '2026-10-01T07:00:00+00:00', status: 'completed' },
      { starts_at: '2026-10-08T07:00:00+00:00', status: 'scheduled' },
      { starts_at: '2026-10-15T07:00:00+00:00', status: 'scheduled' },
      { starts_at: '2026-10-22T07:00:00+00:00', status: 'cancelled' },
    ];
    expect(seriesProgress(rows, '2026-10-08T07:00:00+00:00')).toEqual({ total: 4, left: 2 });
  });
});

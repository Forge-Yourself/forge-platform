import { describe, expect, it } from 'vitest';
import { thisWeek, type FloorProgram } from './floor';

// Local noon, so no timezone puts "today" on another calendar day.
const TODAY = new Date(2026, 8, 17, 12, 0, 0); // Thu 17 Sep 2026

function program(clientId: string, startDate: string | null, clientName: string | null = clientId, durationWeeks = 4): FloorProgram {
  return {
    clientId,
    clientName,
    startDate,
    durationWeeks,
    weeks: [1, 2, 3, 4].map((n) => ({ weekNumber: n, dayIds: [`${clientId}-w${n}d1`, `${clientId}-w${n}d2`, `${clientId}-w${n}d3`] })),
  };
}

describe('thisWeek', () => {
  it('lists a client with open days in the current week', () => {
    // Started 7 Sep → 17 Sep is in week 2.
    const rows = thisWeek({ programs: [program('maya', '2026-09-07')], completedDayIds: ['maya-w2d1'], trainedTodayClientIds: [] }, TODAY);
    expect(rows).toEqual([{ clientId: 'maya', clientName: 'maya', week: 2, openDays: 2 }]);
  });
  it('drops a client whose week is done', () => {
    const rows = thisWeek(
      { programs: [program('maya', '2026-09-07')], completedDayIds: ['maya-w2d1', 'maya-w2d2', 'maya-w2d3'], trainedTodayClientIds: [] },
      TODAY,
    );
    expect(rows).toEqual([]);
  });
  it('drops a client who trained today', () => {
    expect(thisWeek({ programs: [program('maya', '2026-09-07')], completedDayIds: [], trainedTodayClientIds: ['maya'] }, TODAY)).toEqual([]);
  });
  it('lists nobody for a program not started, undated, or over', () => {
    const rows = thisWeek(
      {
        programs: [program('future', '2026-10-01'), program('undated', null), program('over', '2026-08-01')],
        completedDayIds: [],
        trainedTodayClientIds: [],
      },
      TODAY,
    );
    expect(rows).toEqual([]);
  });
  it('orders by open days, then name', () => {
    const rows = thisWeek(
      {
        programs: [program('b', '2026-09-07', 'Bassam'), program('a', '2026-09-07', 'Aya'), program('c', '2026-09-07', 'Carl')],
        completedDayIds: ['c-w2d1'],
        trainedTodayClientIds: [],
      },
      TODAY,
    );
    expect(rows.map((r) => r.clientName)).toEqual(['Aya', 'Bassam', 'Carl']);
  });
});

import { parseCalendarDate } from '../schemas/dates';
import { weekCompletion } from '../schemas/programs';

/** One client's active program, as the floor needs it: the day ids of each week. */
export type FloorProgram = {
  clientId: string;
  clientName: string | null;
  startDate: string | null;
  durationWeeks: number;
  weeks: readonly { weekNumber: number; dayIds: readonly string[] }[];
};

export type FloorInput = {
  programs: readonly FloorProgram[];
  /** program_day_id of every completed session for these clients. */
  completedDayIds: readonly string[];
  /** Clients with a session started today, any status — they have already trained. */
  trainedTodayClientIds: readonly string[];
};

export type WeekRow = { clientId: string; clientName: string | null; week: number; openDays: number };

const MS_PER_DAY = 86_400_000;

/**
 * The rail's This week section (M4d spec D9): active clients whose current
 * program week still has an undone day and who have not trained today. A
 * program not yet started, or past its last day, lists nobody. Most open days
 * first, then by name, so the list is stable.
 */
export function thisWeek(input: FloorInput, today: Date): WeekRow[] {
  const done = new Set(input.completedDayIds);
  const trained = new Set(input.trainedTodayClientIds);
  const rows: WeekRow[] = [];
  for (const p of input.programs) {
    if (trained.has(p.clientId)) continue;
    const start = parseCalendarDate(p.startDate);
    if (start === null) continue;
    if (today.getTime() >= start.getTime() + p.durationWeeks * 7 * MS_PER_DAY) continue;
    const { currentWeek } = weekCompletion({ duration_weeks: p.durationWeeks, start_date: p.startDate }, today);
    if (currentWeek === null) continue;
    const week = p.weeks.find((w) => w.weekNumber === currentWeek);
    if (!week) continue;
    const openDays = week.dayIds.filter((id) => !done.has(id)).length;
    if (openDays > 0) rows.push({ clientId: p.clientId, clientName: p.clientName, week: currentWeek, openDays });
  }
  return rows.sort((a, b) => b.openDays - a.openDays || (a.clientName ?? '').localeCompare(b.clientName ?? ''));
}

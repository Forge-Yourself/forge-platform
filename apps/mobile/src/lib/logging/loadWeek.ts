import { isNetworkError, programTreeSchema, weekCompletion, type ProgramTree } from '@forge/shared';
import { OFFLINE } from '../offline/cachedFetch';
import { supabase } from '../supabase';

export type DayOption = { id: string; dayNumber: number; label: string | null; done: boolean };
export type WeekLoad = { program: ProgramTree | null; week: number; days: DayOption[]; error: string | null };

export const EMPTY_WEEK: WeekLoad = { program: null, week: 1, days: [], error: null };

/** The active program's current week for one client, with done-day marks (M4a spec §5.2). */
export async function loadWeek(clientId: string): Promise<WeekLoad> {
  const { data: active, error } = await supabase
    .from('programs')
    .select('id, duration_weeks, start_date')
    .eq('client_id', clientId)
    .eq('state', 'active')
    .maybeSingle();
  if (error) return { ...EMPTY_WEEK, error: isNetworkError(error) ? OFFLINE : error.message };
  if (!active) return EMPTY_WEEK;
  const { data: raw } = await supabase.rpc('program_tree', { p_program_id: active.id });
  const parsed = programTreeSchema.safeParse(raw);
  if (!parsed.success) return EMPTY_WEEK;
  const current = weekCompletion({ duration_weeks: active.duration_weeks, start_date: active.start_date }).currentWeek ?? 1;
  const weekNode = parsed.data.weeks.find((w) => w.week_number === current) ?? parsed.data.weeks[0];
  const dayIds = (weekNode?.days ?? []).map((d) => d.id);
  let doneIds = new Set<string>();
  if (dayIds.length > 0) {
    const { data: done } = await supabase
      .from('workout_sessions')
      .select('program_day_id')
      .eq('client_id', clientId)
      .eq('status', 'completed')
      .in('program_day_id', dayIds);
    doneIds = new Set((done ?? []).map((r) => r.program_day_id).filter((id): id is string => id !== null));
  }
  return {
    program: parsed.data,
    week: weekNode?.week_number ?? current,
    days: (weekNode?.days ?? []).map((d) => ({ id: d.id, dayNumber: d.day_number, label: d.label, done: doneIds.has(d.id) })),
    error: null,
  };
}

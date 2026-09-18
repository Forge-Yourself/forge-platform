import type { CompleteSessionInput, Database, LogSetInput, PrType } from '@forge/shared';
import { supabase } from '../supabase';

export type WorkoutSessionRow = Database['public']['Tables']['workout_sessions']['Row'];
export type SetRow = Database['public']['Tables']['sets']['Row'];
export type LogSetResult = { set: SetRow; newPrs: PrType[] };

/**
 * Thin typed wrappers over the four 0015 RPCs. Every write in M4a goes through
 * here so M4b's outbox has exactly four call shapes to replay.
 */
export async function startWorkoutSession(
  clientId: string,
  programDayId: string | null,
): Promise<{ session: WorkoutSessionRow | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('start_workout_session', {
    p_client_id: clientId,
    ...(programDayId ? { p_program_day_id: programDayId } : {}),
  });
  if (error) return { session: null, error };
  return { session: data ?? null, error: null };
}

export async function logSet(
  sessionId: string,
  exerciseId: string,
  setNumber: number,
  input: LogSetInput,
  deviceId: string | null,
): Promise<{ result: LogSetResult | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('log_set', {
    p_id: input.id,
    p_session_id: sessionId,
    p_exercise_id: exerciseId,
    p_set_number: setNumber,
    // The generator marks these required because the SQL params carry no
    // DEFAULT, but log_set accepts NULL for either (a set needs at least one —
    // logSetInputSchema enforces that before we get here). PostgREST sends
    // JSON null; the cast is only for the generated type.
    p_weight_kg: input.weight_kg as number,
    p_reps: input.reps as number,
    ...(input.rpe !== null ? { p_rpe: input.rpe } : {}),
    ...(input.notes !== null ? { p_notes: input.notes } : {}),
    p_is_warmup: input.is_warmup,
    ...(deviceId ? { p_device_id: deviceId } : {}),
  });
  if (error) return { result: null, error };
  const row = data?.[0];
  if (!row) return { result: null, error: new Error('log_set returned no row') };
  // The RPC's own CHECK constraint on new_prs guarantees these values are
  // PrType members; the generated return type widens them to string[].
  return { result: { set: row.set_row, newPrs: (row.new_prs ?? []) as PrType[] }, error: null };
}

export async function deleteSet(id: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('delete_set', { p_id: id });
  return { error };
}

export async function completeWorkoutSession(
  sessionId: string,
  input: CompleteSessionInput,
): Promise<{ session: WorkoutSessionRow | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('complete_workout_session', {
    p_session_id: sessionId,
    ...(input.rating !== null ? { p_rating: input.rating } : {}),
    ...(input.notes !== null ? { p_notes: input.notes } : {}),
  });
  if (error) return { session: null, error };
  return { session: data ?? null, error: null };
}

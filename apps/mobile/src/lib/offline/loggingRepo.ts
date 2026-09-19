import type { CompleteSessionInput, LogSetInput, SessionRow, SetRow } from '@forge/shared';
import * as Crypto from 'expo-crypto';
import { engine } from './engine';

/**
 * The offline path of the four M4a writes (spec §5.1). Each call writes the
 * optimistic local row and the outbox entry in one atomic batch. The online
 * path is still lib/logging/sessionRpc.ts, called directly by the screens when
 * the switch is off.
 */

export async function queueStart(input: {
  clientId: string;
  programDayId: string | null;
  dayLabel: string | null;
  dayNumber: number | null;
  weekNumber: number | null;
  viewerId: string;
  isPtLed: boolean;
}): Promise<string> {
  // M4a D4 locally: reuse this client's in-progress session if it still has
  // queued work on this device. A local copy with nothing queued may be stale
  // (finished elsewhere); start fresh and let the server's D4 merge decide.
  const queued = new Set((await engine.entries()).map((e) => e.sessionId));
  const existing = (await engine.localSessionsInProgress()).find(
    (s) => s.client_id === input.clientId && queued.has(s.id),
  );
  if (existing) return existing.id;

  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  const row: SessionRow = {
    id,
    client_id: input.clientId,
    status: 'in_progress',
    started_at: now,
    created_at: now,
    updated_at: now,
    scheduled_date: now.slice(0, 10),
    is_pt_led: input.isPtLed,
    logged_by_user_id: input.viewerId,
    program_day_id: input.programDayId,
    day_label: input.programDayId ? input.dayLabel : null,
    day_number: input.programDayId ? input.dayNumber : null,
    week_number: input.programDayId ? input.weekNumber : null,
    booking_id: null,
    completed_at: null,
    duration_min: null,
    gym_id: null,
    pt_notes: null,
    rating: null,
    session_notes: null,
  };
  await engine.enqueue(
    { op: 'start', sessionId: id, args: { p_client_id: input.clientId, p_program_day_id: input.programDayId, p_id: id, p_started_at: now } },
    [{ table: 'sessions', key: id, value: row }],
  );
  return id;
}

export async function queueLogSet(
  sessionId: string,
  exerciseId: string,
  setNumber: number,
  input: LogSetInput,
  optimistic: SetRow,
  deviceId: string | null,
): Promise<void> {
  await engine.enqueue(
    {
      op: 'log_set',
      sessionId,
      args: {
        p_id: input.id,
        p_session_id: sessionId,
        p_exercise_id: exerciseId,
        p_set_number: setNumber,
        p_weight_kg: input.weight_kg,
        p_reps: input.reps,
        p_rpe: input.rpe,
        p_notes: input.notes,
        p_is_warmup: input.is_warmup,
        p_device_id: deviceId,
      },
    },
    [{ table: 'sets', key: optimistic.id, value: optimistic }],
  );
}

export async function queueDeleteSet(set: SetRow): Promise<void> {
  await engine.enqueue({ op: 'delete_set', sessionId: set.workout_session_id, args: { p_id: set.id } }, [
    { table: 'sets', key: set.id, value: null },
  ]);
}

export async function queueComplete(session: SessionRow, input: CompleteSessionInput): Promise<void> {
  const now = new Date();
  const started = new Date(session.started_at ?? session.created_at).getTime();
  const local: SessionRow = {
    ...session,
    status: 'completed',
    completed_at: now.toISOString(),
    duration_min: Math.max(1, Math.round((now.getTime() - started) / 60_000)),
    rating: input.rating,
  };
  await engine.enqueue(
    {
      op: 'complete',
      sessionId: session.id,
      args: { p_session_id: session.id, p_rating: input.rating, p_notes: input.notes, p_completed_at: now.toISOString() },
    },
    [{ table: 'sessions', key: session.id, value: local }],
  );
}

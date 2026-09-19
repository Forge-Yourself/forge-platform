import type { PrType, RpcError, Transport } from '@forge/shared';
import { supabase } from '../supabase';
import { completeWorkoutSession, deleteSet, logSet, startWorkoutSession } from '../logging/sessionRpc';

function toRpcError(error: Error): RpcError {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  return { code, message: error.message ?? '' };
}

const NO_ROW: RpcError = { code: 'P0001', message: 'the RPC returned no row' };

/** The four M4a RPCs as the engine sees them. Replays go through the same wrappers the online path uses. */
export const supabaseTransport: Transport = {
  async start(a) {
    const { session, error } = await startWorkoutSession(a.p_client_id, a.p_program_day_id, {
      id: a.p_id,
      startedAt: a.p_started_at,
    });
    if (error) return { ok: false, error: toRpcError(error) };
    return session ? { ok: true, data: session } : { ok: false, error: NO_ROW };
  },
  async logSet(a) {
    const { result, error } = await logSet(
      a.p_session_id,
      a.p_exercise_id,
      a.p_set_number,
      { id: a.p_id, weight_kg: a.p_weight_kg, reps: a.p_reps, rpe: a.p_rpe, notes: a.p_notes, is_warmup: a.p_is_warmup },
      a.p_device_id,
    );
    if (error) return { ok: false, error: toRpcError(error) };
    return result ? { ok: true, data: { set: result.set, newPrs: result.newPrs as PrType[] } } : { ok: false, error: NO_ROW };
  },
  async deleteSet(a) {
    const { error } = await deleteSet(a.p_id);
    return error ? { ok: false, error: toRpcError(error) } : { ok: true, data: null };
  },
  async complete(a) {
    const { session, error } = await completeWorkoutSession(
      a.p_session_id,
      { rating: a.p_rating, notes: a.p_notes },
      a.p_completed_at,
    );
    if (error) return { ok: false, error: toRpcError(error) };
    return session ? { ok: true, data: session } : { ok: false, error: NO_ROW };
  },
  async refreshAuth() {
    const { data, error } = await supabase.auth.refreshSession();
    return !error && data.session !== null;
  },
};

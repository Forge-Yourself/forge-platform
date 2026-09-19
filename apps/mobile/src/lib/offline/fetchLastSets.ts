import { isNetworkError, type SetRow } from '@forge/shared';
import { supabase } from '../supabase';
import { OFFLINE } from './cachedFetch';

export type LastSets = { last: Record<string, SetRow>; error: string | null };

/**
 * The most recent completed working set per exercise for one client, over
 * their last 20 completed sessions. The session screen's "Last:" line reads
 * this from the cache when it cannot ask the server.
 */
export async function fetchLastSets(clientId: string): Promise<LastSets> {
  const { data: recent, error } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(20);
  if (error) return { last: {}, error: isNetworkError(error) ? OFFLINE : error.message };
  const ids = (recent ?? []).map((r) => r.id);
  if (ids.length === 0) return { last: {}, error: null };
  const { data: sets, error: setsError } = await supabase
    .from('sets')
    .select('*')
    .in('workout_session_id', ids)
    .eq('is_warmup', false)
    .order('created_at', { ascending: false });
  if (setsError) return { last: {}, error: isNetworkError(setsError) ? OFFLINE : setsError.message };
  const last: Record<string, SetRow> = {};
  for (const s of sets ?? []) if (!last[s.exercise_id]) last[s.exercise_id] = s;
  return { last, error: null };
}

import { isNetworkError } from '@forge/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { cachedFetch, OFFLINE } from '../offline/cachedFetch';
import { engine } from '../offline/engine';
import { useOffline } from '../offline/offlineContext';
import { supabase } from '../supabase';
import type { WorkoutSessionRow } from './sessionRpc';

export type InProgressSession = WorkoutSessionRow & { clientName: string | null };

/** Display names for client rows: the claimed user's display_name, else the invite name, else the email. */
export async function clientNames(clientIds: readonly string[]): Promise<Record<string, string | null>> {
  if (clientIds.length === 0) return {};
  const { data: clients } = await supabase
    .from('clients')
    .select('id, invite_name, invite_email, client_user_id')
    .in('id', [...clientIds]);
  const userIds = (clients ?? []).map((c) => c.client_user_id).filter((id): id is string => id !== null);
  const { data: users } = userIds.length
    ? await supabase.from('users').select('id, display_name').in('id', userIds)
    : { data: [] as { id: string; display_name: string | null }[] };
  const byUser = new Map((users ?? []).map((u) => [u.id, u.display_name]));
  return Object.fromEntries(
    (clients ?? []).map((c) => [
      c.id,
      (c.client_user_id ? byUser.get(c.client_user_id) : null) ?? c.invite_name ?? c.invite_email ?? null,
    ]),
  );
}

export async function fetchInProgress(): Promise<{ session: InProgressSession | null; error: string | null }> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('*')
    .eq('status', 'in_progress')
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) return { session: null, error: isNetworkError(error) ? OFFLINE : error.message };
  if (!data) return { session: null, error: null };
  const names = await clientNames([data.client_id]);
  return {
    session: { ...data, clientName: names[data.client_id] ?? null },
    error: null,
  };
}

/**
 * The one in-progress session RLS shows the caller — a PT's Today banner names
 * the client; a client's names nobody. Focus-refetched because the session
 * screen underneath changes it. For a PT with several clients mid-session this
 * returns only the most recently started one; the banner is singular by
 * design (spec §5.1).
 */
export function useInProgressSession(): { session: InProgressSession | null; loading: boolean; error: string | null } {
  const offline = useOffline();
  const [state, setState] = useState<{ session: InProgressSession | null; loading: boolean; error: string | null }>({
    session: null,
    loading: true,
    error: null,
  });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void cachedFetch({ enabled: offline.effective, online: offline.online }, 'inprogress', fetchInProgress)
        .then(async (result) => {
          if (!offline.effective) return result;
          // A session started offline exists only locally until its start replays.
          // Only sessions with queued work count: a local copy of a server
          // session may be stale (finished on another device since).
          const queued = new Set((await engine.entries()).map((e) => e.sessionId));
          const local = (await engine.localSessionsInProgress())
            .filter((s) => queued.has(s.id))
            .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))[0];
          if (!local || (result.session && result.session.id === local.id)) return result;
          // The warmed client name (PITFALLS I3: a null name still renders).
          const name = await engine.getCache<{ name: string | null }>('clientName:' + local.client_id);
          return { session: { ...local, clientName: name?.value.name ?? null }, error: null };
        })
        .then((result) => {
          if (!cancelled) setState({ session: result.session, loading: false, error: result.error });
        });
      return () => {
        cancelled = true;
      };
    }, [offline.effective, offline.online]),
  );

  return state;
}

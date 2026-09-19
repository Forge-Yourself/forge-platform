import { isNetworkError } from '@forge/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { cachedFetch, OFFLINE } from '../offline/cachedFetch';
import { engine } from '../offline/engine';
import { useOffline } from '../offline/offlineContext';
import { supabase } from '../supabase';
import type { WorkoutSessionRow } from './sessionRpc';

export type InProgressSession = WorkoutSessionRow & { clientName: string | null };

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
  const { data: client } = await supabase
    .from('clients')
    .select('invite_name, invite_email, client_user_id')
    .eq('id', data.client_id)
    .maybeSingle();
  let name: string | null = null;
  if (client?.client_user_id) {
    const { data: u } = await supabase.from('users').select('display_name').eq('id', client.client_user_id).maybeSingle();
    name = u?.display_name ?? null;
  }
  return {
    session: { ...data, clientName: name ?? client?.invite_name ?? client?.invite_email ?? null },
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
          return { session: { ...local, clientName: null }, error: null };
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

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { supabase } from '../supabase';
import type { WorkoutSessionRow } from './sessionRpc';

export type InProgressSession = WorkoutSessionRow & { clientName: string | null };

async function fetchInProgress(): Promise<{ session: InProgressSession | null; error: string | null }> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('*')
    .eq('status', 'in_progress')
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) return { session: null, error: error.message };
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
  const [state, setState] = useState<{ session: InProgressSession | null; loading: boolean; error: string | null }>({
    session: null,
    loading: true,
    error: null,
  });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void fetchInProgress().then((result) => {
        if (!cancelled) setState({ session: result.session, loading: false, error: result.error });
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return state;
}

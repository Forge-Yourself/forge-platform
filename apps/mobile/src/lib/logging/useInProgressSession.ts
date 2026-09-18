import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { supabase } from '../supabase';
import type { WorkoutSessionRow } from './sessionRpc';

export type InProgressSession = WorkoutSessionRow & { clientName: string | null };

async function fetchInProgress(): Promise<InProgressSession | null> {
  const { data } = await supabase
    .from('workout_sessions')
    .select('*')
    .eq('status', 'in_progress')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
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
  return { ...data, clientName: name ?? client?.invite_name ?? client?.invite_email ?? null };
}

/**
 * The one in-progress session RLS shows the caller — a PT's Today banner names
 * the client; a client's names nobody. Focus-refetched because the session
 * screen underneath changes it.
 */
export function useInProgressSession(): { session: InProgressSession | null; loading: boolean } {
  const [state, setState] = useState<{ session: InProgressSession | null; loading: boolean }>({
    session: null,
    loading: true,
  });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void fetchInProgress().then((session) => {
        if (!cancelled) setState({ session, loading: false });
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return state;
}

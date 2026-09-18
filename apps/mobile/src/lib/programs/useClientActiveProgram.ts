import type { Database } from '@forge/shared';
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';

export type ClientActiveProgram = Pick<
  Database['public']['Tables']['programs']['Row'],
  'id' | 'name' | 'duration_weeks' | 'start_date'
>;

export type ClientActiveProgramData = {
  loading: boolean;
  error: string | null;
  program: ClientActiveProgram | null;
};

/**
 * The one active program for one client.
 *
 * The client-detail screen read this out of `useProgramList('assigned')`, which
 * calls program_summaries() for EVERY program the PT owns, then resolves every
 * client id to a display name across two more round trips, then filters the
 * result down to the single row whose key it already had. Three queries and a
 * whole roster to read one program — and the screen ignored the hook's
 * `loading` and `error` entirely, so a pending fetch and a failed one were both
 * indistinguishable from "this client has no program": the Week tile showed
 * "—" and the header quietly dropped the program name, permanently on failure.
 *
 * `maybeSingle` rather than `single`: a client with no active program is the
 * normal pre-assignment state, not an error. Two active programs for one client
 * cannot happen — assign_program archives the incumbent in the same transaction
 * (0007) — and if one somehow did, PostgREST's 406 arrives here as a real error
 * rather than being silently reduced to whichever row sorted first.
 */
export function useClientActiveProgram(clientId: string | undefined): ClientActiveProgramData {
  const [state, setState] = useState<ClientActiveProgramData>({
    loading: true,
    error: null,
    program: null,
  });

  // Inlined .then() so every setState stays inside this effect's own body — the
  // same react-hooks/set-state-in-effect constraint every other data hook in
  // this milestone documents (see useClientList.ts for the full reasoning).
  useEffect(() => {
    let cancelled = false;
    if (!clientId) {
      void Promise.resolve().then(() => {
        if (!cancelled) setState({ loading: false, error: null, program: null });
      });
      return () => {
        cancelled = true;
      };
    }
    void supabase
      .from('programs')
      .select('id, name, duration_weeks, start_date')
      .eq('client_id', clientId)
      .eq('state', 'active')
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setState({ loading: false, error: error?.message ?? null, program: data ?? null });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return state;
}

import { isNetworkError, type Database } from '@forge/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { cachedFetch, OFFLINE } from '../offline/cachedFetch';
import { useOffline } from '../offline/offlineContext';
import { supabase } from '../supabase';

export type ProgramSummary = Database['public']['Functions']['program_summaries']['Returns'][number];
export type ProgramListItem = ProgramSummary & { clientName: string | null };

export type ProgramListTab = 'assigned' | 'templates';

/**
 * One call for the rows, one for the client names.
 *
 * program_summaries() computes days/week and the exercise count server-side
 * (see 0009) rather than dragging every program's skeleton down to count its
 * leaves. Names come from a second plain query rather than a PostgREST embed
 * for the same reason useClientList documents: programs has two FKs that
 * resolve to people (author_user_id and client_id via clients), so an embed
 * needs a constraint-name hint that is easy to get wrong and hard to verify
 * without a live app.
 */
export async function fetchPrograms(): Promise<{ rows: ProgramListItem[]; error: string | null }> {
  const { data, error } = await supabase.rpc('program_summaries');
  if (error) return { rows: [], error: isNetworkError(error) ? OFFLINE : error.message };

  const summaries = data ?? [];
  const clientIds = [...new Set(summaries.map((p) => p.client_id).filter((id): id is string => id !== null))];

  let namesByClientId: Record<string, string> = {};
  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, invite_name, invite_email, client_user_id')
      .in('id', clientIds);

    const linkedUserIds = (clients ?? [])
      .map((c) => c.client_user_id)
      .filter((id): id is string => id !== null);

    let displayNames: Record<string, string> = {};
    if (linkedUserIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, display_name')
        .in('id', linkedUserIds);
      displayNames = Object.fromEntries((users ?? []).map((u) => [u.id, u.display_name]));
    }

    namesByClientId = Object.fromEntries(
      (clients ?? []).map((c) => [
        c.id,
        (c.client_user_id ? displayNames[c.client_user_id] : undefined) ??
          c.invite_name ??
          c.invite_email ??
          '',
      ]),
    );
  }

  return {
    rows: summaries.map((p) => ({
      ...p,
      clientName: p.client_id ? (namesByClientId[p.client_id] ?? null) : null,
    })),
    error: null,
  };
}

export type ProgramListData = {
  loading: boolean;
  error: string | null;
  items: ProgramListItem[];
  isEmpty: boolean;
  refetch: () => Promise<void>;
};

/**
 * `tab` filters in memory: a PT has a handful of programs, and the split
 * between assigned work and templates is one boolean on rows already in hand.
 * If that ever stops being true, the fix is a filter argument on
 * program_summaries(), not a rewrite of this hook's shape.
 *
 * Archived programs are hidden from the assigned tab — they are the displaced
 * predecessors that assign_program archived, and surfacing them would make
 * every reassignment look like clutter.
 */
export function useProgramList(tab: ProgramListTab): ProgramListData {
  const [state, setState] = useState<{
    rows: ProgramListItem[];
    loading: boolean;
    error: string | null;
  }>({ rows: [], loading: true, error: null });
  const offline = useOffline();

  // Refetch on every focus, not just on mount: the Programs and Today tabs stay
  // mounted underneath builder/assign/ai, so a plain mount effect never re-ran
  // and a renamed program, a new assignment or an instantiated template were
  // missing from the list until the tab was pulled to refresh. The list has no
  // pagination to lose, so refetch-on-focus is safe here (unlike the exercise
  // library — see customExerciseSignal.ts). Inlined rather than calling refetch,
  // so every setState stays inside a .then() the linter can see — see useClientList.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void cachedFetch({ enabled: offline.effective, online: offline.online }, 'programs', fetchPrograms).then((result) => {
        if (!cancelled) setState({ rows: result.rows, loading: false, error: result.error });
      });
      return () => {
        cancelled = true;
      };
    }, [offline.effective, offline.online]),
  );

  const refetch = useCallback(async (): Promise<void> => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const result = await cachedFetch({ enabled: offline.effective, online: offline.online }, 'programs', fetchPrograms);
    setState({ rows: result.rows, loading: false, error: result.error });
  }, [offline.effective, offline.online]);

  // Memoized because `items` is this hook's public identity: usePtDashboard
  // keys two useMemos on it, and a fresh array every render made both of them
  // recompute every render, which is the one thing a useMemo exists to stop.
  const items = useMemo(
    () =>
      state.rows.filter((p) =>
        tab === 'templates' ? p.is_template : !p.is_template && p.state !== 'archived',
      ),
    [state.rows, tab],
  );

  return {
    loading: state.loading,
    error: state.error,
    items,
    isEmpty: !state.loading && state.error === null && items.length === 0,
    refetch,
  };
}

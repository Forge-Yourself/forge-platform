import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { supabase } from '../supabase';
import type { WorkoutSessionRow } from './sessionRpc';

export type SessionHistoryItem = WorkoutSessionRow & { setCount: number };

export type SessionHistoryData = {
  loading: boolean;
  error: string | null;
  items: SessionHistoryItem[];
  isEmpty: boolean;
  refetch: () => Promise<void>;
};

/**
 * Sessions for one client (`clientId`), or for whatever RLS shows the caller
 * when clientId is undefined — for a signed-in client that is exactly their
 * own. Newest first. Refetches on focus: the session screen mutates what this
 * list shows (PITFALLS N12).
 */
async function fetchHistory(
  clientId: string | undefined,
  limit: number,
): Promise<{ rows: SessionHistoryItem[]; error: string | null }> {
  let q = supabase.from('workout_sessions').select('*').order('started_at', { ascending: false }).limit(limit);
  if (clientId) q = q.eq('client_id', clientId);
  const { data, error } = await q;
  if (error) return { rows: [], error: error.message };
  const rows = data ?? [];
  const ids = rows.map((r) => r.id);
  const counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: sets } = await supabase.from('sets').select('workout_session_id').in('workout_session_id', ids);
    for (const s of sets ?? []) counts[s.workout_session_id] = (counts[s.workout_session_id] ?? 0) + 1;
  }
  return { rows: rows.map((r) => ({ ...r, setCount: counts[r.id] ?? 0 })), error: null };
}

export function useSessionHistory(clientId: string | undefined, limit = 50): SessionHistoryData {
  const [state, setState] = useState<{ rows: SessionHistoryItem[]; loading: boolean; error: string | null }>({
    rows: [],
    loading: true,
    error: null,
  });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void fetchHistory(clientId, limit).then((result) => {
        if (!cancelled) setState({ rows: result.rows, loading: false, error: result.error });
      });
      return () => {
        cancelled = true;
      };
    }, [clientId, limit]),
  );

  const refetch = useCallback(async (): Promise<void> => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const result = await fetchHistory(clientId, limit);
    setState({ rows: result.rows, loading: false, error: result.error });
  }, [clientId, limit]);

  return {
    loading: state.loading,
    error: state.error,
    items: state.rows,
    isEmpty: !state.loading && state.error === null && state.rows.length === 0,
    refetch,
  };
}

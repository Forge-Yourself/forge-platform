import type { Database, Equipment, MovementPattern, MuscleGroup } from '@forge/shared';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

export type ExerciseSearchRow = Database['public']['Functions']['search_exercises']['Returns'][number];

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 250;

type Filters = {
  query: string;
  muscle: MuscleGroup | null;
  equipment: Equipment | null;
  pattern: MovementPattern | null;
};

async function fetchPage(
  filters: Filters,
  offset: number,
): Promise<{ rows: ExerciseSearchRow[]; total: number; error: string | null }> {
  const { data, error } = await supabase.rpc('search_exercises', {
    p_query: filters.query.trim() === '' ? undefined : filters.query.trim(),
    p_muscle: filters.muscle ?? undefined,
    p_equipment: filters.equipment ?? undefined,
    p_pattern: filters.pattern ?? undefined,
    p_limit: PAGE_SIZE,
    p_offset: offset,
  });

  if (error) {
    return { rows: [], total: 0, error: error.message };
  }

  const rows = data ?? [];
  // total_count is a window function over the unpaged result, so every row
  // carries the same figure — the search placeholder needs the true total,
  // not the length of this page.
  return { rows, total: rows[0]?.total_count ?? 0, error: null };
}

export type ExerciseSearchData = {
  loading: boolean;
  error: string | null;
  items: ExerciseSearchRow[];
  /** Matches across every page, which is what the search placeholder counts. */
  total: number;
  /** The library itself is empty — the empty state, not the no-match state. */
  isEmpty: boolean;
  /** The library has content, but nothing matches the current filters. */
  isNoMatch: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
};

/**
 * Server-side search over the exercise library.
 *
 * Unlike useClientList, which fetches a roster once and filters it in memory,
 * this re-queries on every filter change: the library is 205 rows today and
 * 2,000+ once the licensed import lands, so server-side is the correct shape
 * from day one rather than a rewrite later.
 *
 * Parameters are primitives rather than a filters object on purpose — an
 * object literal from the caller would be a new identity every render and
 * would re-fire the effect forever.
 *
 * Visibility (the global library plus the caller's own custom rows) is RLS's
 * job via exercises_select. search_exercises is deliberately invoker-rights
 * so that policy applies, and this hook never re-implements it.
 */
export function useExerciseSearch(
  query: string,
  muscle: MuscleGroup | null,
  equipment: Equipment | null,
  pattern: MovementPattern | null,
): ExerciseSearchData {
  const [state, setState] = useState<{
    rows: ExerciseSearchRow[];
    total: number;
    loading: boolean;
    error: string | null;
  }>({ rows: [], total: 0, loading: true, error: null });

  const hasFilters =
    query.trim() !== '' || muscle !== null || equipment !== null || pattern !== null;

  // The fetch is inlined here rather than calling refetch below, so every
  // setState stays inside a .then() the linter can see in this effect's own
  // body — calling out to a separately-defined callback from an effect trips
  // react-hooks/set-state-in-effect (same reasoning as useClientList).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetchPage({ query, muscle, equipment, pattern }, 0).then((result) => {
        if (!cancelled) {
          setState({
            rows: result.rows,
            total: result.total,
            loading: false,
            error: result.error,
          });
        }
      });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, muscle, equipment, pattern]);

  const refetch = useCallback(async (): Promise<void> => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const result = await fetchPage({ query, muscle, equipment, pattern }, 0);
    setState({ rows: result.rows, total: result.total, loading: false, error: result.error });
  }, [query, muscle, equipment, pattern]);

  const loadMore = useCallback(async (): Promise<void> => {
    let offset = 0;
    setState((prev) => {
      offset = prev.rows.length;
      return prev;
    });
    const result = await fetchPage({ query, muscle, equipment, pattern }, offset);
    if (result.error) {
      setState((prev) => ({ ...prev, error: result.error }));
      return;
    }
    setState((prev) =>
      prev.rows.length === offset
        ? { ...prev, rows: [...prev.rows, ...result.rows], total: result.total }
        : prev,
    );
  }, [query, muscle, equipment, pattern]);

  const settled = !state.loading && state.error === null;

  return {
    loading: state.loading,
    error: state.error,
    items: state.rows,
    total: state.total,
    isEmpty: settled && state.rows.length === 0 && !hasFilters,
    isNoMatch: settled && state.rows.length === 0 && hasFilters,
    hasMore: state.rows.length < state.total,
    loadMore,
    refetch,
  };
}

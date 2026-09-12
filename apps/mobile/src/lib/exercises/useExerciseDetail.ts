import type { Database } from '@forge/shared';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

export type ExerciseRow = Database['public']['Tables']['exercises']['Row'];

/**
 * One logged set of this movement by this client. Always empty at M3 — the
 * `sets` table has no writer until M4 adds logging — but the shape is fixed
 * here so M4 fills it in without the detail screen changing at all.
 */
export type ExerciseHistoryEntry = {
  performedAt: string;
  weightKg: number | null;
  reps: number | null;
};

async function fetchExercise(
  exerciseId: string,
): Promise<{ exercise: ExerciseRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from('exercises')
    .select('*')
    .eq('id', exerciseId)
    .maybeSingle();

  if (error) return { exercise: null, error: error.message };
  return { exercise: data, error: null };
}

export type ExerciseDetailData = {
  loading: boolean;
  error: string | null;
  exercise: ExerciseRow | null;
  /** Empty at M3 by construction; see ExerciseHistoryEntry. */
  history: ExerciseHistoryEntry[];
  refetch: () => Promise<void>;
};

/**
 * The exercise-detail screen's data: the row itself, plus (from M4) this
 * client's own history with the movement — "it is what decides today's load"
 * per the detail annotation. The clientId parameter is accepted now so the
 * screen's call site does not have to change when that history becomes real.
 */
export function useExerciseDetail(
  exerciseId: string | undefined,
  _clientId?: string,
): ExerciseDetailData {
  const [state, setState] = useState<{
    exercise: ExerciseRow | null;
    loading: boolean;
    error: string | null;
  }>({ exercise: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    if (!exerciseId) {
      void Promise.resolve().then(() => {
        if (!cancelled) setState({ exercise: null, loading: false, error: null });
      });
      return () => {
        cancelled = true;
      };
    }
    void fetchExercise(exerciseId).then((result) => {
      if (!cancelled) {
        setState({ exercise: result.exercise, loading: false, error: result.error });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [exerciseId]);

  const refetch = useCallback(async (): Promise<void> => {
    if (!exerciseId) return;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const result = await fetchExercise(exerciseId);
    setState({ exercise: result.exercise, loading: false, error: result.error });
  }, [exerciseId]);

  return { ...state, history: [], refetch };
}

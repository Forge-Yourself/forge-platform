import { programTreeSchema } from '@forge/shared';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';
import type { ProgramDay } from './sessionModel';
import type { SetRow, WorkoutSessionRow } from './sessionRpc';

export type ExerciseName = { name: string; name_ar: string | null };

export type SessionData = {
  loading: boolean;
  error: string | null;
  session: WorkoutSessionRow | null;
  sets: SetRow[];
  day: ProgramDay | null;
  /** Display name for the client (PT view) — null when the viewer is the client. */
  clientName: string | null;
  names: Record<string, ExerciseName>;
  /** Most recent completed working set per exercise, from earlier sessions. */
  lastByExercise: Record<string, SetRow>;
  refetch: () => Promise<void>;
  /** Optimistic local edits between refetches. */
  applySet: (set: SetRow) => void;
  removeSet: (id: string) => void;
  ensureNames: (exerciseIds: string[]) => Promise<void>;
};

type Loaded = Omit<SessionData, 'refetch' | 'applySet' | 'removeSet' | 'ensureNames'>;

const EMPTY: Loaded = {
  loading: false, error: null, session: null, sets: [], day: null, clientName: null, names: {}, lastByExercise: {},
};

async function fetchNames(ids: string[]): Promise<Record<string, ExerciseName>> {
  if (ids.length === 0) return {};
  const { data } = await supabase.from('exercises').select('id, name, name_ar').in('id', ids);
  return Object.fromEntries((data ?? []).map((e) => [e.id, { name: e.name, name_ar: e.name_ar }]));
}

async function fetchSession(sessionId: string): Promise<Loaded> {
  const { data: session, error } = await supabase.from('workout_sessions').select('*').eq('id', sessionId).maybeSingle();
  if (error) return { ...EMPTY, error: error.message };
  if (!session) return { ...EMPTY, error: 'not_found' };

  const [{ data: sets }, dayRow, { data: clientRow }] = await Promise.all([
    supabase.from('sets').select('*').eq('workout_session_id', sessionId).order('created_at', { ascending: true }),
    session.program_day_id
      ? supabase.from('program_days').select('id, program_id').eq('id', session.program_day_id).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
    supabase.from('clients').select('id, invite_name, invite_email, client_user_id').eq('id', session.client_id).maybeSingle(),
  ]);

  let day: ProgramDay | null = null;
  if (dayRow) {
    const { data: rawTree } = await supabase.rpc('program_tree', { p_program_id: dayRow.program_id });
    const parsed = programTreeSchema.safeParse(rawTree);
    if (parsed.success) {
      for (const week of parsed.data.weeks) {
        const found = week.days.find((d) => d.id === dayRow.id);
        if (found) {
          day = found;
          break;
        }
      }
    }
  }

  let clientName: string | null = null;
  if (clientRow) {
    if (clientRow.client_user_id) {
      const { data: u } = await supabase.from('users').select('display_name').eq('id', clientRow.client_user_id).maybeSingle();
      clientName = u?.display_name ?? null;
    }
    clientName = clientName ?? clientRow.invite_name ?? clientRow.invite_email ?? null;
  }

  const setRows = sets ?? [];
  const exerciseIds = [
    ...new Set([
      ...setRows.map((s) => s.exercise_id),
      ...(day?.blocks.flatMap((b) => b.exercises.map((e) => e.exercise_id)) ?? []),
    ]),
  ];
  const names = await fetchNames(exerciseIds);

  // "Last:" — sets has no FK to sessions, so two queries: recent completed
  // session ids for this client, then their sets on these exercises.
  const lastByExercise: Record<string, SetRow> = {};
  if (exerciseIds.length > 0) {
    const { data: recent } = await supabase
      .from('workout_sessions')
      .select('id')
      .eq('client_id', session.client_id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(20);
    const recentIds = (recent ?? []).map((r) => r.id);
    if (recentIds.length > 0) {
      const { data: prior } = await supabase
        .from('sets')
        .select('*')
        .in('workout_session_id', recentIds)
        .in('exercise_id', exerciseIds)
        .eq('is_warmup', false)
        .order('created_at', { ascending: false });
      for (const s of prior ?? []) {
        if (!lastByExercise[s.exercise_id]) lastByExercise[s.exercise_id] = s;
      }
    }
  }

  return { loading: false, error: null, session, sets: setRows, day, clientName, names, lastByExercise };
}

export function useSession(sessionId: string | undefined): SessionData {
  const [state, setState] = useState<Loaded>({ ...EMPTY, loading: true });

  useEffect(() => {
    let cancelled = false;
    if (!sessionId) {
      void Promise.resolve().then(() => {
        if (!cancelled) setState({ ...EMPTY, error: 'not_found' });
      });
      return () => {
        cancelled = true;
      };
    }
    void fetchSession(sessionId).then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const refetch = useCallback(async () => {
    if (!sessionId) return;
    const result = await fetchSession(sessionId);
    setState(result);
  }, [sessionId]);

  const applySet = useCallback((set: SetRow) => {
    setState((prev) => {
      const i = prev.sets.findIndex((s) => s.id === set.id);
      const sets = i === -1 ? [...prev.sets, set] : prev.sets.map((s) => (s.id === set.id ? set : s));
      return { ...prev, sets };
    });
  }, []);

  const removeSet = useCallback((id: string) => {
    setState((prev) => ({ ...prev, sets: prev.sets.filter((s) => s.id !== id) }));
  }, []);

  const ensureNames = useCallback(async (exerciseIds: string[]) => {
    const fetched = await fetchNames(exerciseIds);
    setState((prev) => ({ ...prev, names: { ...prev.names, ...fetched } }));
  }, []);

  return { ...state, refetch, applySet, removeSet, ensureNames };
}

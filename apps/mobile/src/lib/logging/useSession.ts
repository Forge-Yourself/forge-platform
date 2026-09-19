import { isNetworkError, programTreeSchema, type PrType } from '@forge/shared';
import { useCallback, useEffect, useState } from 'react';
import { OFFLINE } from '../offline/cachedFetch';
import { engine } from '../offline/engine';
import type { LastSets } from '../offline/fetchLastSets';
import { useOffline } from '../offline/offlineContext';
import { supabase } from '../supabase';
import type { WeekLoad } from './loadWeek';
import type { ProgramDay } from './sessionModel';
import type { SetRow, WorkoutSessionRow } from './sessionRpc';

export type ExerciseName = { name: string; name_ar: string | null };

/** The client's heaviest set on an exercise — the "Best" tile and the PR moment's struck-through line. */
export type BestSet = { weightKg: number; reps: number | null; achievedAt: string };

/** One record this session set, from exercise_prs (the server is the authority on what counts). */
export type SessionPr = { exerciseId: string; prType: PrType; value: number; setId: string };

export type SessionData = {
  loading: boolean;
  error: string | null;
  session: WorkoutSessionRow | null;
  sets: SetRow[];
  day: ProgramDay | null;
  /**
   * Display name of the session's client, resolved for every viewer; the
   * screen decides whether to show it (PT header) or the program name
   * (client header).
   */
  clientName: string | null;
  names: Record<string, ExerciseName>;
  /** Most recent completed working set per exercise, from earlier sessions. */
  lastByExercise: Record<string, SetRow>;
  bestByExercise: Record<string, BestSet>;
  sessionPrs: SessionPr[];
  refetch: () => Promise<void>;
  /** Optimistic local edits between refetches. */
  applySet: (set: SetRow) => void;
  removeSet: (id: string) => void;
  /** Fold a log_set PR result into bestByExercise / sessionPrs without a refetch. */
  applyPrs: (set: SetRow, types: readonly PrType[]) => void;
  ensureNames: (exerciseIds: string[]) => Promise<void>;
};

type Loaded = Omit<SessionData, 'refetch' | 'applySet' | 'removeSet' | 'applyPrs' | 'ensureNames'>;

const EMPTY: Loaded = {
  loading: false, error: null, session: null, sets: [], day: null, clientName: null, names: {}, lastByExercise: {},
  bestByExercise: {}, sessionPrs: [],
};

async function fetchNames(ids: string[]): Promise<Record<string, ExerciseName>> {
  if (ids.length === 0) return {};
  const { data } = await supabase.from('exercises').select('id, name, name_ar').in('id', ids);
  return Object.fromEntries((data ?? []).map((e) => [e.id, { name: e.name, name_ar: e.name_ar }]));
}

async function fetchSession(sessionId: string): Promise<Loaded> {
  const { data: session, error } = await supabase.from('workout_sessions').select('*').eq('id', sessionId).maybeSingle();
  if (error) return { ...EMPTY, error: isNetworkError(error) ? OFFLINE : error.message };
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
    // If the program is unreadable (archived by a reassignment, RLS), day
    // stays null and the session renders like freestyle; the header must
    // prefer the session row's own snapshot (day_label / week_number /
    // day_number, 0015) over day.label for exactly this case.
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

  // Records: every weight PR row for these exercises (heaviest first, so the
  // first per exercise is the best), plus whatever this session's own sets set.
  const bestByExercise: Record<string, BestSet> = {};
  let sessionPrs: SessionPr[] = [];
  if (exerciseIds.length > 0) {
    const setIds = setRows.map((s) => s.id);
    const [{ data: weightPrs }, { data: mine }] = await Promise.all([
      supabase
        .from('exercise_prs')
        .select('exercise_id, value, set_id, achieved_at')
        .eq('client_id', session.client_id)
        .eq('pr_type', 'weight')
        .in('exercise_id', exerciseIds)
        .order('value', { ascending: false }),
      setIds.length > 0
        ? supabase.from('exercise_prs').select('exercise_id, pr_type, value, set_id').in('set_id', setIds)
        : Promise.resolve({ data: [] as { exercise_id: string; pr_type: string; value: number; set_id: string | null }[] }),
    ]);
    const bestRows = new Map<string, { value: number; set_id: string | null; achieved_at: string }>();
    for (const row of weightPrs ?? []) if (!bestRows.has(row.exercise_id)) bestRows.set(row.exercise_id, row);
    const bestSetIds = [...bestRows.values()].map((r) => r.set_id).filter((id): id is string => id !== null);
    const { data: bestSets } =
      bestSetIds.length > 0
        ? await supabase.from('sets').select('id, reps').in('id', bestSetIds)
        : { data: [] as { id: string; reps: number | null }[] };
    const repsBySet = new Map((bestSets ?? []).map((r) => [r.id, r.reps]));
    for (const [exerciseId, row] of bestRows) {
      bestByExercise[exerciseId] = {
        weightKg: Number(row.value),
        reps: row.set_id ? (repsBySet.get(row.set_id) ?? null) : null,
        achievedAt: row.achieved_at,
      };
    }
    sessionPrs = (mine ?? [])
      .filter((r): r is typeof r & { set_id: string } => r.set_id !== null)
      .map((r) => ({ exerciseId: r.exercise_id, prType: r.pr_type as PrType, value: Number(r.value), setId: r.set_id }));
  }

  return {
    loading: false,
    error: null,
    session,
    sets: setRows,
    day,
    clientName,
    names,
    lastByExercise,
    bestByExercise,
    sessionPrs,
  };
}

/**
 * A session built only from the device: local rows plus the warmed cache
 * (spec §5.4). Records are not warmed, so the Best tile and this session's PR
 * list stay empty until the server answers.
 */
async function localLoaded(sessionId: string): Promise<Loaded | null> {
  const session = await engine.localSession(sessionId);
  if (!session) return null;
  const sets = await engine.localSets(session.id);
  const week = await engine.getCache<WeekLoad>('week:' + session.client_id);
  let day: ProgramDay | null = null;
  for (const w of week?.value.program?.weeks ?? []) {
    const found = w.days.find((d) => d.id === session.program_day_id);
    if (found) {
      day = found;
      break;
    }
  }
  const names: Record<string, ExerciseName> = {};
  for (const block of day?.blocks ?? []) {
    for (const e of block.exercises) names[e.exercise_id] = { name: e.exercise_name, name_ar: e.exercise_name_ar ?? null };
  }
  const last = await engine.getCache<LastSets>('last:' + session.client_id);
  const clientName = (await engine.getCache<{ name: string | null }>('clientName:' + session.client_id))?.value.name ?? null;
  return {
    ...EMPTY,
    session,
    sets,
    day,
    clientName,
    names,
    lastByExercise: last?.value.last ?? {},
  };
}

async function loadSession(sessionId: string, offline: { effective: boolean; online: boolean }): Promise<Loaded> {
  if (!offline.effective) return fetchSession(sessionId);
  const id = await engine.resolveSessionId(sessionId);
  const server = offline.online ? await fetchSession(id) : null;
  if (server && server.error === null && server.session) {
    // A Finish still in the outbox: the device's completed row wins over the
    // server's in_progress, or the screen would flip back to logging.
    const local = await engine.localSession(id);
    const session = local?.status === 'completed' && server.session.status === 'in_progress' ? local : server.session;
    // Keep an in-progress session on the device so a kill plus an offline reopen still has it.
    if (session.status === 'in_progress') {
      await engine.applyServerSession(session);
      for (const s of server.sets) await engine.applyServerSet(s);
    }
    return { ...server, session, sets: await engine.overlaySets(id, server.sets) };
  }
  // Offline, or a session whose start has not replayed yet (the server says not_found).
  return (await localLoaded(id)) ?? server ?? { ...EMPTY, error: 'not_found' };
}

export function useSession(sessionId: string | undefined): SessionData {
  const offline = useOffline();
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
    void loadSession(sessionId, { effective: offline.effective, online: offline.online }).then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, offline.effective, offline.online]);

  // Deliberately does not flip loading: the completed-state re-read after
  // Finish (spec §5.3) must not flash a skeleton over a screen that is
  // already showing the session.
  const refetch = useCallback(async () => {
    if (!sessionId) return;
    const result = await loadSession(sessionId, { effective: offline.effective, online: offline.online });
    setState(result);
  }, [sessionId, offline.effective, offline.online]);

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

  const applyPrs = useCallback((set: SetRow, types: readonly PrType[]) => {
    if (types.length === 0) return;
    setState((prev) => {
      const bestByExercise =
        types.includes('weight') && set.weight_kg !== null
          ? {
              ...prev.bestByExercise,
              [set.exercise_id]: { weightKg: set.weight_kg, reps: set.reps, achievedAt: set.created_at },
            }
          : prev.bestByExercise;
      const added: SessionPr[] = types.map((prType) => ({
        exerciseId: set.exercise_id,
        prType,
        value:
          prType === 'weight' ? (set.weight_kg ?? 0) : prType === 'reps' ? (set.reps ?? 0) : (set.weight_kg ?? 0) * (set.reps ?? 0),
        setId: set.id,
      }));
      return { ...prev, bestByExercise, sessionPrs: [...prev.sessionPrs, ...added] };
    });
  }, []);

  const ensureNames = useCallback(async (exerciseIds: string[]) => {
    const fetched = await fetchNames(exerciseIds);
    setState((prev) => ({ ...prev, names: { ...prev.names, ...fetched } }));
  }, []);

  return { ...state, refetch, applySet, removeSet, applyPrs, ensureNames };
}

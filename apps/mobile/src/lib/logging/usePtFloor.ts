import { isNetworkError, thisWeek, type FloorProgram, type WeekRow } from '@forge/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { cachedFetch, OFFLINE } from '../offline/cachedFetch';
import { useOffline } from '../offline/offlineContext';
import { supabase } from '../supabase';
import { restStore } from './restStore';
import { clientNames } from './useInProgressSession';

export type LiveRow = {
  sessionId: string;
  clientId: string;
  clientName: string | null;
  startedAt: string | null;
  weekNumber: number | null;
  dayNumber: number | null;
  dayLabel: string | null;
};

type FloorLoad = { live: LiveRow[]; week: WeekRow[]; error: string | null };
const EMPTY: FloorLoad = { live: [], week: [], error: null };

// Every query result is checked through here — a dropped `error` is a dropped
// error, and cachedFetch would happily persist the partial data it left behind.
function asFloorError(error: { code?: string | null; message?: string | null }): FloorLoad {
  return { ...EMPTY, error: isNetworkError(error) ? OFFLINE : (error.message ?? 'unknown error') };
}

async function fetchFloor(ptUserId: string): Promise<FloorLoad> {
  // sessions and clients don't depend on each other — fetch together.
  const [sessionsRes, clientsRes] = await Promise.all([
    supabase
      .from('workout_sessions')
      .select('id, client_id, started_at, week_number, day_number, day_label')
      .eq('status', 'in_progress')
      .order('started_at', { ascending: true }),
    supabase.from('clients').select('id').eq('pt_user_id', ptUserId).eq('state', 'active'),
  ]);
  if (sessionsRes.error) return asFloorError(sessionsRes.error);
  if (clientsRes.error) return asFloorError(clientsRes.error);
  const sessions = sessionsRes.data;
  const clientIds = (clientsRes.data ?? []).map((c) => c.id);

  const names = await clientNames([...new Set([...(sessions ?? []).map((s) => s.client_id), ...clientIds])]);
  const live: LiveRow[] = (sessions ?? []).map((s) => ({
    sessionId: s.id,
    clientId: s.client_id,
    clientName: names[s.client_id] ?? null,
    startedAt: s.started_at,
    weekNumber: s.week_number,
    dayNumber: s.day_number,
    dayLabel: s.day_label,
  }));
  if (clientIds.length === 0) return { live, week: [], error: null };

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  // programs and today's sessions both depend only on clientIds, not on each
  // other — fetch together too.
  const [programsRes, todayRes] = await Promise.all([
    supabase
      .from('programs')
      .select('id, client_id, start_date, duration_weeks')
      .eq('state', 'active')
      .in('client_id', clientIds),
    supabase.from('workout_sessions').select('client_id').gte('started_at', midnight.toISOString()).in('client_id', clientIds),
  ]);
  if (programsRes.error) return asFloorError(programsRes.error);
  if (todayRes.error) return asFloorError(todayRes.error);
  const programs = programsRes.data;
  const today = todayRes.data;

  const programIds = (programs ?? []).map((p) => p.id);
  // program_days carries two FKs to program_weeks (the single-column week_id
  // one and a composite week_id+program_id one), so the embed is ambiguous to
  // PostgREST without a hint — fk_pd_week is the one we want (0018 note, plan
  // Task 12 step 4).
  const weeksRes = programIds.length
    ? await supabase
        .from('program_weeks')
        .select('program_id, week_number, program_days!fk_pd_week(id)')
        .in('program_id', programIds)
    : { data: [] as { program_id: string; week_number: number; program_days: { id: string }[] }[], error: null };
  if (weeksRes.error) return asFloorError(weeksRes.error);
  const weeks = weeksRes.data;
  // done depends on dayIds, which depends on weeks — this leg stays sequential.
  const dayIds = (weeks ?? []).flatMap((w) => w.program_days.map((d) => d.id));
  const doneRes = dayIds.length
    ? await supabase.from('workout_sessions').select('program_day_id').eq('status', 'completed').in('program_day_id', dayIds)
    : { data: [] as { program_day_id: string | null }[], error: null };
  if (doneRes.error) return asFloorError(doneRes.error);
  const done = doneRes.data;

  const floorPrograms: FloorProgram[] = (programs ?? [])
    .filter((p): p is typeof p & { client_id: string } => p.client_id !== null)
    .map((p) => ({
      clientId: p.client_id,
      clientName: names[p.client_id] ?? null,
      startDate: p.start_date,
      durationWeeks: p.duration_weeks,
      weeks: (weeks ?? [])
        .filter((w) => w.program_id === p.id)
        .map((w) => ({ weekNumber: w.week_number, dayIds: w.program_days.map((d) => d.id) })),
    }));
  const week = thisWeek(
    {
      programs: floorPrograms,
      completedDayIds: (done ?? []).map((d) => d.program_day_id).filter((id): id is string => id !== null),
      trainedTodayClientIds: (today ?? []).map((r) => r.client_id),
    },
    new Date(),
  ).filter((r) => !live.some((l) => l.clientId === r.clientId));
  return { live, week, error: null };
}

/**
 * The console rail and the phone switcher (M4d spec §8.3, D9): live sessions,
 * then clients with program days left this week. Refetched on focus (N12);
 * only the newest load may land (O1). Offline it reads the warmed cache
 * (M4b rules); This week is empty when there is nothing cached.
 */
export function usePtFloor(enabled: boolean) {
  const auth = useAuth();
  const offline = useOffline();
  const [state, setState] = useState<FloorLoad & { loading: boolean }>({ ...EMPTY, loading: enabled });
  const seq = useRef(0);
  const ptUserId = auth.user?.id ?? '';

  const load = useCallback(async () => {
    if (!enabled || ptUserId === '') return;
    const mine = ++seq.current;
    const result = await cachedFetch({ enabled: offline.effective, online: offline.online }, 'floor:' + ptUserId, () =>
      fetchFloor(ptUserId),
    );
    if (mine !== seq.current) return;
    if (result.error === null) restStore.keepOnly(result.live.map((l) => l.sessionId));
    setState({ ...result, loading: false });
  }, [enabled, ptUserId, offline.effective, offline.online]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { ...state, refetch: load };
}

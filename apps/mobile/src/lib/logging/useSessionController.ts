import {
  completeSessionInputSchema,
  displayNumbers,
  displayToKg,
  formatElapsed,
  formatWeight,
  kgToDisplay,
  logSetInputSchema,
  LOGGING_LIMITS,
  sessionVolume,
  unitLabel,
  type EngineEvent,
  type PrType,
  type UnitSystem,
} from '@forge/shared';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { engine } from '../offline/engine';
import { queueComplete, queueDeleteSet, queueLogSet } from '../offline/loggingRepo';
import { useOffline } from '../offline/offlineContext';
import { useSessionChannel } from '../offline/useSessionChannel';
import { takePickedExercise } from '../programs/exercisePicker';
import { mapLoggingError } from './loggingErrors';
import {
  buildExerciseList,
  DEFAULT_REST_SEC,
  initialExerciseIndex,
  nextSetNumber,
  prefillFor,
  setsFor,
  type SessionExercise,
} from './sessionModel';
import { completeWorkoutSession, deleteSet, logSet, type SetRow } from './sessionRpc';
import { newUlid } from './ulid';
import { useRest } from './useRest';
import { useSession, type BestSet } from './useSession';

export type Draft = {
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  notes: string;
  isWarmup: boolean;
};
export type KeypadTarget = 'weight' | 'reps' | 'rpe' | null;
export type PendingSet = { id: string; error: string | null; queued?: boolean };
/** `ok: true` covers a queued offline write too — the caller doesn't need to know the difference. */
export type SubmitSetResult = { ok: boolean; error?: string };
export type PrView = {
  value: string;
  unit: string;
  detail: string;
  exercise: string;
  previous: { struck: string; delta: string } | null;
  since: string | null;
  extras: string[];
};

/**
 * An ad-hoc exercise whose name has not been resolved yet arrives from
 * buildExerciseList with an empty name (the models stay copy-free). The
 * placeholder belongs to the screen.
 */
export function nameOf(ex: SessionExercise): string {
  return ex.name === '' ? '…' : ex.name;
}

/** A weight in the viewer's unit without the unit — "102.5". Mono cells carry the unit in their label. */
export function shownNumber(kg: number, unit: UnitSystem): string {
  const v = kgToDisplay(kg, unit);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function haptic(kind: 'success' | 'light') {
  // PITFALLS W4: expo-haptics is a native-only no-op contract, not a web one.
  if (Platform.OS === 'web') return;
  if (kind === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}
/**
 * Everything the session screen knows and does, without a pixel of layout
 * (M4d spec §5). The phone layout, the completed summary and the iPad console
 * all render from this one object, so the M4a/M4b rules (outbox, PR moment,
 * late sets, rest after a working set) live in exactly one place.
 */
export function useSessionController(sessionId: string) {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const unit = (auth.user?.unit_system as UnitSystem | undefined) ?? 'metric';
  const data = useSession(sessionId);
  const offline = useOffline();
  // Joined on both states: a late set (D6) must show on a summary the PT is reading.
  const channel = useSessionChannel(
    data.session?.id ?? null,
    {
      onSet: data.applySet,
      onDelete: data.removeSet,
      onSession: () => void data.refetch(),
    },
    offline.effective,
    offline.online,
  );
  const live = channel.joined;
  const devices = channel.devices;
  useKeepAwake();

  const [exerciseIndex, setExerciseIndex] = useState<number | null>(null);
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft>({
    weightKg: null,
    reps: null,
    rpe: null,
    notes: '',
    isWarmup: false,
  });
  const [draftKey, setDraftKey] = useState<string>('');
  const [keypad, setKeypad] = useState<KeypadTarget>(null);
  const [keypadText, setKeypadText] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [pending, setPending] = useState<Record<string, PendingSet>>({});
  const [pr, setPr] = useState<PrView | null>(null);
  const [timerOpen, setTimerOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [editing, setEditing] = useState<SetRow | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishDraft, setFinishDraft] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  // Lazy initialiser: React Compiler's purity rule rejects a bare Date.now()
  // in the render body.
  const [clock, setClock] = useState(() => Date.now());

  const session = data.session;
  // The rest lives in the shared store, keyed by session: it survives a reload,
  // a switch on the console and the app going to the background. The zero cue
  // is the driver's (spec §6.1), because the rest that ends need not be the
  // client on screen.
  const rest = useRest(session?.id ?? null);
  const inProgress = session?.status === 'in_progress';
  const viewerId = auth.user?.id ?? '';
  const viewerIsClient = auth.user?.role === 'client';

  const exercises = useMemo(
    () => buildExerciseList(data.day, data.sets, data.names, extraIds),
    [data.day, data.sets, data.names, extraIds],
  );
  // What the screen prints as the set number (spec D10): client-time order, so
  // two devices logging "set 3" at once never both show 3.
  const displayNo = useMemo(() => displayNumbers(data.sets), [data.sets]);
  // The library picker is online-only; an offline session logs the programmed day.
  const pickerOff = offline.effective && !offline.online;

  // Pick the starting exercise once the list exists (adjust-state-during-render, id-guarded).
  if (exerciseIndex === null && !data.loading && exercises.length > 0) {
    setExerciseIndex(initialExerciseIndex(exercises, data.sets));
  }
  const current: SessionExercise | null =
    exerciseIndex !== null ? (exercises[exerciseIndex] ?? exercises[0] ?? null) : null;
  const currentPos = current ? exercises.indexOf(current) : -1;

  // Seed the draft whenever the current exercise (or its set count) changes.
  const key = current ? current.exerciseId + ':' + nextSetNumber(data.sets, current.exerciseId) : '';
  if (current && key !== draftKey) {
    const p = prefillFor(current, data.sets, data.lastByExercise[current.exerciseId] ?? null);
    setDraft({ weightKg: p.weightKg, reps: p.reps, rpe: p.rpe, notes: '', isWarmup: false });
    setDraftKey(key);
  }

  useEffect(() => {
    if (!inProgress) return;
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [inProgress]);

  // Take a picked exercise on return from the picker (N12 pattern from the builder).
  useFocusEffect(
    useCallback(() => {
      const picked = takePickedExercise();
      if (!picked) return;
      setExtraIds((prev) => (prev.includes(picked.id) ? prev : [...prev, picked.id]));
      void data.ensureNames([picked.id]).then(() => {
        const idx = exercises.findIndex((e) => e.exerciseId === picked.id);
        setExerciseIndex(idx === -1 ? exercises.length : idx);
      });
    }, [data, exercises]),
  );

  function openPicker() {
    if (!session || pickerOff) return;
    setListOpen(false);
    router.push({ pathname: '/(app)/sessions/[id]/pick-exercise', params: { id: session.id } });
  }

  function openKeypad(target: Exclude<KeypadTarget, null>) {
    setKeypad(target);
    setKeypadText('');
  }

  function keypadCommit() {
    const n = keypadText === '' ? null : Number(keypadText);
    if (keypad === 'weight') {
      setDraft((d) => ({
        ...d,
        weightKg:
          n === null ? null : Math.min(displayToKg(n, unit), LOGGING_LIMITS.weight_kg.max),
      }));
    } else if (keypad === 'reps') {
      setDraft((d) => ({
        ...d,
        reps: n === null ? null : Math.min(Math.round(n), LOGGING_LIMITS.reps.max),
      }));
    } else if (keypad === 'rpe') {
      // RPE is logged in half steps between 1 and 10 (logSetInputSchema).
      setDraft((d) => ({
        ...d,
        rpe:
          n === null
            ? null
            : Math.min(LOGGING_LIMITS.rpe.max, Math.max(LOGGING_LIMITS.rpe.min, Math.round(n * 2) / 2)),
      }));
    }
    setKeypad(null);
  }

  function prLine(type: PrType, set: SetRow): string {
    if (type === 'weight') return t('logging.pr.weight', { value: formatWeight(set.weight_kg, unit) });
    if (type === 'reps') return t('logging.pr.reps', { value: set.reps ?? 0 });
    return t('logging.pr.volume', {
      value: formatWeight((set.weight_kg ?? 0) * (set.reps ?? 0), unit),
    });
  }

  function sinceLine(best: BestSet): string {
    const at = new Date(best.achievedAt);
    const date = at.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
    // `clock`, not Date.now(): day precision is plenty and the compiler rejects impure calls here.
    const days = Math.floor((clock - at.getTime()) / 86_400_000);
    return days < 1 ? t('logging.pr.sinceToday', { date }) : t('logging.pr.since', { date, count: days });
  }

  function buildPrView(set: SetRow, types: readonly PrType[], prev: BestSet | null, exercise: string): PrView {
    const weighted = set.weight_kg !== null;
    const detail =
      !weighted || set.reps === null
        ? ''
        : set.rpe === null
          ? t('logging.pr.detail', { reps: set.reps })
          : t('logging.pr.detailRpe', { reps: set.reps, rpe: set.rpe });
    const isWeightPr = types.includes('weight') && weighted;
    const previous =
      isWeightPr && prev && set.weight_kg !== null
        ? {
            struck:
              prev.reps === null
                ? shownNumber(prev.weightKg, unit)
                : shownNumber(prev.weightKg, unit) + ' × ' + String(prev.reps),
            delta: '+' + formatWeight(set.weight_kg - prev.weightKg, unit),
          }
        : null;
    return {
      value: weighted ? shownNumber(set.weight_kg ?? 0, unit) : String(set.reps ?? 0),
      unit: weighted ? unitLabel(unit) : t('logging.pr.repsUnit'),
      detail,
      exercise,
      previous,
      since: previous && prev ? sinceLine(prev) : null,
      extras: types.filter((ty) => !(ty === 'weight' && isWeightPr)).map((ty) => prLine(ty, set)),
    };
  }

  /** Lock-screen copy for the rest that follows `set`: "Next: 100 kg × 8", with the client for a PT. */
  function restLabels(set: { weight_kg: number | null; reps: number | null }, exerciseName: string) {
    const summary =
      set.weight_kg === null
        ? t('logging.session.repsOnly', { reps: set.reps ?? 0 })
        : `${shownNumber(set.weight_kg, unit)} ${unitLabel(unit)} × ${set.reps ?? '—'}`;
    return { clientName: viewerIsClient ? null : data.clientName, exerciseName, nextLabel: summary };
  }

  async function submitSet(existing: SetRow | null, values: Draft): Promise<SubmitSetResult> {
    if (!session || !current) return { ok: false, error: t('logging.session.errorGeneric') };
    const id = existing?.id ?? newUlid();
    const setNumber =
      existing?.set_number ?? (values.isWarmup ? 0 : nextSetNumber(data.sets, current.exerciseId));
    const input = logSetInputSchema.safeParse({
      id,
      weight_kg: values.weightKg,
      reps: values.reps,
      rpe: values.rpe,
      notes: values.notes.trim() === '' ? null : values.notes.trim(),
      is_warmup: values.isWarmup,
    });
    if (!input.success) {
      const error = t('logging.session.errorGeneric');
      setPending((p) => ({ ...p, [id]: { id, error } }));
      return { ok: false, error };
    }
    const exerciseId = existing?.exercise_id ?? current.exerciseId;
    const exerciseName = nameOf(exercises.find((e) => e.exerciseId === exerciseId) ?? current);
    const prevBest = data.bestByExercise[exerciseId] ?? null;
    // Optimistic row so the list moves at the tap, not at the round trip.
    const optimistic: SetRow = existing
      ? {
          ...existing,
          weight_kg: input.data.weight_kg,
          reps: input.data.reps,
          rpe: input.data.rpe,
          notes: input.data.notes,
          is_warmup: input.data.is_warmup,
        }
      : {
          id,
          workout_session_id: session.id,
          exercise_id: exerciseId,
          set_number: setNumber,
          weight_kg: input.data.weight_kg,
          reps: input.data.reps,
          rpe: input.data.rpe,
          notes: input.data.notes,
          distance_m: null,
          duration_sec: null,
          tempo_actual: null,
          is_warmup: input.data.is_warmup,
          is_drop_set: false,
          is_failure: false,
          is_synced: false,
          synced_at: null,
          conflict_resolved: false,
          device_id: null,
          logged_by_user_id: viewerId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
    data.applySet(optimistic);
    setPending((p) => ({ ...p, [id]: { id, error: null } }));
    haptic('light');
    if (!existing) setNoteOpen(false);

    if (offline.effective) {
      // Always through the outbox with the switch on (plan correction §5.3). The
      // PR moment arrives with the engine's set_synced event below.
      await queueLogSet(session.id, exerciseId, setNumber, input.data, optimistic, Platform.OS);
      setPending((p) => ({ ...p, [id]: { id, error: null, queued: true } }));
      offline.drainNow();
      if (!existing && !input.data.is_warmup) {
        rest.start(
          current.restSec ?? DEFAULT_REST_SEC,
          setNumber + 1,
          current.targetSets,
          restLabels(optimistic, exerciseName),
        );
      }
      return { ok: true };
    }

    const { result, error } = await logSet(session.id, exerciseId, setNumber, input.data, Platform.OS);
    if (error || !result) {
      const message = mapLoggingError(error, t);
      setPending((p) => ({ ...p, [id]: { id, error: message } }));
      return { ok: false, error: message };
    }
    data.applySet(result.set);
    setPending((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== id)));

    if (!existing) {
      // The server is the authority — it scanned every prior set. detectPrs is
      // the tested TS mirror of the rule, not a second opinion at runtime.
      const hits = result.newPrs;
      if (hits.length > 0) {
        setPr(buildPrView(result.set, hits, prevBest, exerciseName));
        data.applyPrs(result.set, hits);
        haptic('success');
      }
      // Spec §6.2: rest follows a working set. A warm-up rolls straight into
      // the next one — nobody waits 90s after an empty-bar set.
      if (!input.data.is_warmup) {
        rest.start(
          current.restSec ?? DEFAULT_REST_SEC,
          setNumber + 1,
          current.targetSets,
          restLabels(result.set, exerciseName),
        );
      }
    }
    return { ok: true };
  }

  /** Voice → the same submitSet as a tap, so outbox, PR moment and rest behave identically (spec §7.3). */
  function logVoice(values: { weightKg: number | null; reps: number | null; rpe: number | null }): Promise<SubmitSetResult> {
    return submitSet(null, { ...draft, weightKg: values.weightKg, reps: values.reps, rpe: values.rpe });
  }

  async function removeSet(set: SetRow) {
    data.removeSet(set.id);
    if (offline.effective) {
      await queueDeleteSet(set);
      offline.drainNow();
      return;
    }
    const { error } = await deleteSet(set.id);
    if (error) {
      data.applySet(set);
      setPending((p) => ({ ...p, [set.id]: { id: set.id, error: mapLoggingError(error, t) } }));
    }
  }

  /** Prototype `summary`: "The note is pre-written from the session; the PT edits rather than composes." */
  function draftNote(): string {
    const working = data.sets.filter((s) => !s.is_warmup);
    const base = t('logging.finish.draft', {
      count: working.length,
      volume: formatWeight(sessionVolume(data.sets), unit),
    });
    const weightPrs = data.sessionPrs.filter((p) => p.prType === 'weight');
    if (weightPrs.length === 0) return base;
    const first = weightPrs[0];
    const ex = exercises.find((e) => e.exerciseId === first.exerciseId);
    return (
      base +
      ' ' +
      t('logging.finish.draftPr', {
        exercise: ex ? nameOf(ex) : '',
        value: formatWeight(first.value, unit),
      })
    );
  }

  async function finish(rating: number | null, notes: string | null) {
    if (!session) return;
    const input = completeSessionInputSchema.safeParse({ rating, notes });
    if (!input.success) {
      setFinishError(t('logging.finish.error'));
      return;
    }
    if (offline.effective) {
      await queueComplete(session, input.data);
      offline.drainNow();
      setFinishOpen(false);
      rest.clear();
      await data.refetch();
      return;
    }
    setFinishing(true);
    setFinishError(null);
    const { error } = await completeWorkoutSession(session.id, input.data);
    setFinishing(false);
    if (error) {
      setFinishError(mapLoggingError(error, t));
      return;
    }
    setFinishOpen(false);
    rest.clear();
    await data.refetch();
  }

  // Engine events (switch on): a queued set reached the server (and maybe set a
  // record), the session was merged into one another device started, or a
  // write was refused. The handler reads this render's values through a ref,
  // so the subscription is made once per switch state, not on every render.
  const onEngineEvent = useRef<(e: EngineEvent) => void>(() => {});
  useEffect(() => {
    onEngineEvent.current = (e: EngineEvent) => {
      if (e.type === 'set_synced' && e.set.workout_session_id === session?.id) {
        data.applySet(e.set);
        setPending((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== e.set.id)));
        const hits = e.newPrs as PrType[];
        if (hits.length > 0 && !e.set.is_warmup) {
          const ex = exercises.find((x) => x.exerciseId === e.set.exercise_id);
          setPr(buildPrView(e.set, hits, data.bestByExercise[e.set.exercise_id] ?? null, ex ? nameOf(ex) : ''));
          data.applyPrs(e.set, hits);
          haptic('success');
        }
      }
      if (e.type === 'session_rewritten' && (e.from === sessionId || e.from === session?.id)) {
        router.replace({ pathname: '/(app)/sessions/[id]', params: { id: e.to } });
      }
      if (e.type === 'failed' && e.entry.op === 'log_set' && e.entry.sessionId === session?.id) {
        const setId = e.entry.args.p_id;
        setPending((p) => ({ ...p, [setId]: { id: setId, error: mapLoggingError(e.entry.lastError, t) } }));
      }
    };
  });
  useEffect(() => {
    if (!offline.effective) return;
    return engine.subscribe((e) => onEngineEvent.current(e));
  }, [offline.effective]);

  // PITFALLS N1 + N15: the screen owns its Back, and a cold deep link has no
  // frame to pop to.
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.dismissTo('/');
  }, []);

  // The session row's own snapshot columns, never day.label: the program can be
  // unreadable (archived by a reassignment, or RLS) while the session is not,
  // and 0015 snapshots exactly for that case.
  const dayTitle = !session
    ? ''
    : session.week_number === null
      ? t('logging.history.freestyle')
      : session.day_label
        ? t('logging.history.dayLabelNamed', { label: session.day_label, week: session.week_number })
        : t('logging.history.dayLabel', { week: session.week_number, day: session.day_number ?? 1 });
  const title = viewerIsClient ? dayTitle : (data.clientName ?? dayTitle);
  const weightLabel = unitLabel(unit).toUpperCase();

  // ── In progress: prototype `session` ─────────────────────────────────────
  const elapsed = session?.started_at
    ? formatElapsed(Math.floor((clock - new Date(session.started_at).getTime()) / 1000))
    : '0:00';
  const subtitle = viewerIsClient
    ? t('logging.session.elapsed', { time: elapsed })
    : t('logging.session.subtitle', { day: dayTitle, time: elapsed });

  const allSets = current ? setsFor(data.sets, current.exerciseId) : [];
  const warmups = allSets.filter((s) => s.is_warmup);
  const workingSets = allSets.filter((s) => !s.is_warmup);
  const setNo = current ? nextSetNumber(data.sets, current.exerciseId) : 1;
  const planned = current?.targetSets ?? 0;
  const futureRows = Math.max(0, planned - setNo);
  const last = current ? (data.lastByExercise[current.exerciseId] ?? null) : null;
  const best = current ? (data.bestByExercise[current.exerciseId] ?? null) : null;
  const next = currentPos >= 0 ? (exercises[currentPos + 1] ?? null) : null;

  const reps =
    current?.targetRepsMin != null && current.targetRepsMax != null && current.targetRepsMax !== current.targetRepsMin
      ? `${current.targetRepsMin}–${current.targetRepsMax}`
      : String(current?.targetRepsMin ?? current?.targetRepsMax ?? '');
  const rx = current?.programmed
    ? [
        current.targetSets !== null && reps !== ''
          ? t('logging.session.rxSetsReps', { sets: current.targetSets, reps })
          : current.targetSets !== null
            ? t('logging.session.rxSets', { sets: current.targetSets })
            : null,
        current.targetRpe !== null ? t('logging.session.rxRpe', { rpe: current.targetRpe }) : null,
      ]
        .filter(Boolean)
        .join(' ') + (current.tempo ? ' · ' + t('logging.session.rxTempo', { tempo: current.tempo }) : '')
    : t('logging.session.addedToday');

  function setLine(s: SetRow): string {
    if (s.weight_kg === null) return t('logging.session.repsOnly', { reps: s.reps ?? 0 });
    const weight = shownNumber(s.weight_kg, unit);
    return s.rpe === null
      ? t('logging.session.setSummary', { weight, reps: s.reps ?? 0 })
      : t('logging.session.setSummaryRpe', { weight, reps: s.reps ?? 0, rpe: s.rpe });
  }

  const canLog = draft.weightKg !== null || draft.reps !== null;
  const logLabel = draft.isWarmup ? t('logging.session.logWarmup') : t('logging.session.logSetN', { n: setNo });
  const restCaption =
    rest.total !== null && rest.setNumber <= rest.total
      ? t('logging.session.restCaption', { n: rest.setNumber, total: rest.total })
      : t('logging.session.restCaptionSimple', { n: rest.setNumber });

  return {
    unit, data, offline, live, devices, session, inProgress, viewerId, viewerIsClient,
    exercises, displayNo, pickerOff, current, currentPos, setExerciseIndex,
    draft, setDraft, keypad, setKeypad, keypadText, setKeypadText, openKeypad, keypadCommit,
    noteOpen, setNoteOpen, pending, pr, setPr, timerOpen, setTimerOpen, listOpen, setListOpen,
    voiceOpen, setVoiceOpen, logVoice,
    editing, setEditing, finishOpen, setFinishOpen, finishDraft, setFinishDraft, finishing, finishError,
    clock, rest, openPicker, submitSet, removeSet, draftNote, finish, buildPrView, goBack,
    dayTitle, title, weightLabel, elapsed, subtitle, allSets, warmups, workingSets, setNo,
    futureRows, last, best, next, reps, rx, setLine, canLog, logLabel, restCaption,
  };
}

export type SessionController = ReturnType<typeof useSessionController>;

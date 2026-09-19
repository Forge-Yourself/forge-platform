import {
  completeSessionInputSchema,
  displayToKg,
  formatElapsed,
  formatWeight,
  kgToDisplay,
  logSetInputSchema,
  LOGGING_LIMITS,
  palette,
  sessionVolume,
  unitLabel,
  type PrType,
  type UnitSystem,
} from '@forge/shared';
import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../../../lib/auth/AuthProvider';
import { FinishSessionSheet } from '../../../../lib/logging/FinishSessionSheet';
import { mapLoggingError } from '../../../../lib/logging/loggingErrors';
import {
  buildExerciseList,
  DEFAULT_REST_SEC,
  initialExerciseIndex,
  isExerciseDone,
  nextSetNumber,
  prefillFor,
  setsFor,
  workingCount,
  type SessionExercise,
} from '../../../../lib/logging/sessionModel';
import {
  completeWorkoutSession,
  deleteSet,
  logSet,
  type SetRow,
} from '../../../../lib/logging/sessionRpc';
import { newUlid } from '../../../../lib/logging/ulid';
import { useRestTimer } from '../../../../lib/logging/useRestTimer';
import { useSession, type BestSet } from '../../../../lib/logging/useSession';
import { takePickedExercise } from '../../../../lib/programs/exercisePicker';
import { useTheme } from '../../../../theme/ThemeProvider';
import {
  Button,
  EmptyState,
  Icon,
  NavHeader,
  NumericKeypad,
  PrMoment,
  RestStrip,
  RestTimer,
  Row,
  Screen,
  SegmentedPill,
  Skeleton,
  Tag,
  Text,
  TextField,
  Toggle,
} from '../../../../ui';

const timerCue = require('../../../../../assets/sounds/timer-done.wav');

type Draft = {
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  notes: string;
  isWarmup: boolean;
};
type KeypadTarget = 'weight' | 'reps' | 'rpe' | null;
type PendingSet = { id: string; error: string | null };
type PrView = {
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
function nameOf(ex: SessionExercise): string {
  return ex.name === '' ? '…' : ex.name;
}

/** A weight in the viewer's unit without the unit — "102.5". Mono cells carry the unit in their label. */
function shownNumber(kg: number, unit: UnitSystem): string {
  const v = kgToDisplay(kg, unit);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function haptic(kind: 'success' | 'light') {
  // PITFALLS W4: expo-haptics is a native-only no-op contract, not a web one.
  if (Platform.OS === 'web') return;
  if (kind === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/**
 * One route, both personas, state-driven (spec §5.3): `in_progress` renders
 * prototype `session`, `completed` renders prototype `summary`. Rights come from
 * the RPCs and RLS, never from the role string — the screen only hides
 * affordances a request would refuse anyway (a client sees Coach sets read-only).
 */
export default function SessionScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const params = useLocalSearchParams<{ id: string }>();
  const unit = (auth.user?.unit_system as UnitSystem | undefined) ?? 'metric';
  const data = useSession(params.id);
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
  const [editing, setEditing] = useState<SetRow | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishDraft, setFinishDraft] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  // Lazy initialiser: React Compiler's purity rule rejects a bare Date.now()
  // in the render body.
  const [clock, setClock] = useState(() => Date.now());
  const player = useAudioPlayer(timerCue);

  const onRestZero = useCallback(() => {
    try {
      void player.seekTo(0).catch(() => undefined);
      player.play();
    } catch {
      /* cue optional; the haptic is the signal */
    }
    haptic('success');
  }, [player]);
  const rest = useRestTimer(onRestZero);

  const session = data.session;
  const inProgress = session?.status === 'in_progress';
  const viewerId = auth.user?.id ?? '';
  const viewerIsClient = auth.user?.role === 'client';

  const exercises = useMemo(
    () => buildExerciseList(data.day, data.sets, data.names, extraIds),
    [data.day, data.sets, data.names, extraIds],
  );

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
    if (!session) return;
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

  async function submitSet(existing: SetRow | null, values: Draft) {
    if (!session || !current) return;
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
      setPending((p) => ({ ...p, [id]: { id, error: t('logging.session.errorGeneric') } }));
      return;
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

    const { result, error } = await logSet(session.id, exerciseId, setNumber, input.data, Platform.OS);
    if (error || !result) {
      setPending((p) => ({ ...p, [id]: { id, error: mapLoggingError(error, t) } }));
      return;
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
        rest.start(current.restSec ?? DEFAULT_REST_SEC, setNumber + 1, current.targetSets);
      }
    }
  }

  async function removeSet(set: SetRow) {
    data.removeSet(set.id);
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

  // PITFALLS N1 + N15: the screen owns its Back, and a cold deep link has no
  // frame to pop to.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.dismissTo('/');
  };
  const back = <Button label={t('common.back')} variant="link" icon="chevronBack" onPress={goBack} />;

  // ── Loading / not found ──────────────────────────────────────────────────
  if (data.loading) {
    return (
      <Screen padded={false}>
        <NavHeader leading={back} divider={false} />
        <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
          <Skeleton height={120} />
          <Skeleton height={56} />
        </View>
      </Screen>
    );
  }
  if (data.error || !session) {
    return (
      <Screen padded={false}>
        <NavHeader leading={back} divider={false} />
        <EmptyState
          icon="alert"
          tone="danger"
          title={t('logging.session.notFound')}
          body={t('logging.session.notFoundBody')}
          actionLabel={t('common.back')}
          actionVariant="ghost"
          onAction={() => router.dismissTo('/')}
        />
      </Screen>
    );
  }

  // The session row's own snapshot columns, never day.label: the program can be
  // unreadable (archived by a reassignment, or RLS) while the session is not,
  // and 0015 snapshots exactly for that case.
  const dayTitle =
    session.week_number === null
      ? t('logging.history.freestyle')
      : session.day_label
        ? t('logging.history.dayLabelNamed', { label: session.day_label, week: session.week_number })
        : t('logging.history.dayLabel', {
            week: session.week_number,
            day: session.day_number ?? 1,
          });
  const title = viewerIsClient ? dayTitle : (data.clientName ?? dayTitle);
  const weightLabel = unitLabel(unit).toUpperCase();

  // ── Completed: prototype `summary` ───────────────────────────────────────
  if (!inProgress) {
    const working = data.sets.filter((s) => !s.is_warmup);
    const durationSec =
      session.started_at && session.completed_at
        ? Math.floor((new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 1000)
        : null;
    const volumeKg = sessionVolume(data.sets);
    const note = viewerIsClient ? session.session_notes : session.pt_notes;
    const otherNote = viewerIsClient ? session.pt_notes : session.session_notes;
    const prSetIds = [...new Set(data.sessionPrs.map((p) => p.setId))];
    const firstPrSet = data.sets.find((s) => s.id === prSetIds[0]) ?? null;
    const firstPrExercise = firstPrSet ? exercises.find((e) => e.exerciseId === firstPrSet.exercise_id) : null;
    const done = exercises.filter((ex) => ex.programmed || workingCount(data.sets, ex.exerciseId) > 0);

    return (
      <Screen padded={false}>
        <ScrollView contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 18, paddingBottom: 20 }}>
          <View style={{ alignItems: 'center', gap: 6, marginBottom: 22 }}>
            <View
              style={{
                width: 58,
                height: 58,
                borderRadius: 19,
                backgroundColor: palette.success,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="check" size={28} color={palette.white} strokeWidth={2.6} />
            </View>
            <Text
              accessibilityRole="header"
              style={{ fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginTop: 6, textAlign: 'center' }}
            >
              {t('logging.summary.title')}
            </Text>
            <Text style={{ fontSize: 13.5, color: theme.colors.textSecondary, textAlign: 'center' }}>
              {viewerIsClient ? dayTitle : `${data.clientName ?? '—'} · ${dayTitle}`}
            </Text>
            {session.completed_at ? (
              <Text numeric style={{ fontSize: 12, color: theme.colors.textMuted }}>
                {new Date(session.completed_at).toLocaleString(i18n.language, {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            ) : null}
          </View>

          <Row style={{ gap: 8, alignItems: 'stretch', marginBottom: 18 }}>
            <SummaryStat value={durationSec === null ? '—' : formatElapsed(durationSec)} label={t('logging.summary.durationK')} />
            <SummaryStat value={String(working.length)} label={t('logging.summary.setsK')} />
            <SummaryStat
              value={Math.round(kgToDisplay(volumeKg, unit)).toLocaleString(i18n.language)}
              label={t('logging.summary.volumeK', { unit: weightLabel })}
            />
          </Row>

          {firstPrSet && prSetIds.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setPr(
                  buildPrView(
                    firstPrSet,
                    data.sessionPrs.filter((p) => p.setId === firstPrSet.id).map((p) => p.prType),
                    null,
                    firstPrExercise ? nameOf(firstPrExercise) : '',
                  ),
                )
              }
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 11,
                paddingVertical: 14,
                paddingHorizontal: 13,
                borderRadius: 12,
                borderWidth: 1.5,
                borderColor: theme.colors.accent,
                backgroundColor: theme.colors.accentSurfaceSoft,
                marginBottom: 20,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 9,
                  backgroundColor: theme.colors.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="flame" size={15} color={theme.colors.onAccent} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13.5, fontWeight: '700', color: theme.colors.onAccentSurfaceSoft }}>
                  {t('logging.pr.heading', { count: prSetIds.length })}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>
                  {(firstPrExercise ? nameOf(firstPrExercise) + ' · ' : '') +
                    (firstPrSet.weight_kg === null
                      ? t('logging.session.repsOnly', { reps: firstPrSet.reps ?? 0 })
                      : t('logging.session.setSummary', {
                          weight: formatWeight(firstPrSet.weight_kg, unit),
                          reps: firstPrSet.reps ?? 0,
                        }))}
                </Text>
              </View>
              <Icon name="chevron" size={16} color={theme.colors.onAccentSurfaceSoft} />
            </Pressable>
          ) : null}

          <Kicker>{t('logging.summary.whatWasDone')}</Kicker>
          {done.length === 0 ? (
            <Text tone="secondary" style={{ marginBottom: 20 }}>
              {t('logging.summary.noSets')}
            </Text>
          ) : (
            <View
              style={{
                gap: 1,
                backgroundColor: theme.colors.border,
                borderRadius: 12,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: theme.colors.border,
                marginBottom: 20,
              }}
            >
              {done.map((ex) => {
                const rows = setsFor(data.sets, ex.exerciseId).filter((s) => !s.is_warmup);
                const complete = isExerciseDone(ex, data.sets);
                const top = rows.reduce<SetRow | null>(
                  (best, s) => (best === null || (s.weight_kg ?? 0) > (best.weight_kg ?? 0) ? s : best),
                  null,
                );
                const spec = rows.length === 0
                  ? t('logging.summary.specSkipped')
                  : !complete
                  ? t('logging.summary.specPartial', { done: rows.length, total: ex.targetSets ?? rows.length })
                  : top?.weight_kg !== null && top?.weight_kg !== undefined
                    ? t('logging.summary.specDone', {
                        sets: rows.length,
                        reps: top.reps ?? 0,
                        weight: formatWeight(top.weight_kg, unit),
                      })
                    : t('logging.summary.specDoneNoWeight', { sets: rows.length, reps: top?.reps ?? 0 });
                return (
                  <Row
                    key={ex.exerciseId}
                    style={{ gap: 10, paddingVertical: 12, paddingHorizontal: 13, backgroundColor: theme.colors.surfaceRaised }}
                  >
                    <View
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 6,
                        backgroundColor: complete ? palette.success : theme.colors.border,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {complete ? (
                        <Icon name="check" size={12} color={palette.white} strokeWidth={2.8} />
                      ) : (
                        <Icon name="minus" size={12} color={theme.colors.textSecondary} strokeWidth={2.4} />
                      )}
                    </View>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontWeight: '600' }}>
                      {nameOf(ex)}
                    </Text>
                    <Text numeric style={{ fontSize: 12.5, color: theme.colors.textSecondary }}>
                      {spec}
                    </Text>
                  </Row>
                );
              })}
            </View>
          )}

          {note || otherNote || session.rating !== null ? (
            <>
              <Kicker>
                {viewerIsClient || !data.clientName
                  ? t('logging.summary.notes')
                  : t('logging.summary.noteFor', { name: data.clientName.split(' ')[0] })}
              </Kicker>
              <View
                style={{
                  minHeight: 76,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  borderWidth: 1.5,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surfaceRaised,
                  gap: 8,
                }}
              >
                {note ? (
                  <Text style={{ fontSize: 13.5, lineHeight: 21, color: theme.colors.textSecondary }}>{note}</Text>
                ) : null}
                {otherNote ? (
                  <Text style={{ fontSize: 13.5, lineHeight: 21, color: theme.colors.textSecondary }}>
                    {otherNote}
                  </Text>
                ) : null}
                {session.rating !== null ? (
                  <Text
                    numeric
                    accessibilityLabel={t('logging.summary.ratingA11y', { rating: session.rating })}
                    style={{ color: theme.colors.accentText }}
                  >
                    {'●'.repeat(session.rating)}
                    {'○'.repeat(5 - session.rating)}
                  </Text>
                ) : null}
              </View>
            </>
          ) : null}
        </ScrollView>

        {/* The artboard's "Send summary to <client>" is M9 comms; until then Done is
            the one exit, pinned rather than at the end of the scroll (PITFALLS N2). */}
        <View
          style={{
            paddingHorizontal: 18,
            paddingTop: 10,
            paddingBottom: 18,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
          }}
        >
          <Button label={t('common.done')} size="lg" onPress={goBack} />
        </View>

        {pr ? (
          <PrMoment
            visible
            kicker={t('logging.pr.kicker')}
            {...pr}
            keepGoingLabel={t('common.done')}
            onClose={() => setPr(null)}
          />
        ) : null}
      </Screen>
    );
  }

  // ── In progress: prototype `session` ─────────────────────────────────────
  const elapsed = session.started_at
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

  const doneRow = (s: SetRow) => {
    const mine = s.logged_by_user_id === viewerId;
    const editable = !viewerIsClient || mine;
    const p = pending[s.id];
    return (
      <View key={s.id} style={{ gap: 4 }}>
        <SetRowView
          n={s.is_warmup ? t('logging.session.warmupShort') : String(s.set_number)}
          weight={s.weight_kg === null ? '—' : shownNumber(s.weight_kg, unit)}
          reps={s.reps === null ? '—' : String(s.reps)}
          rpe={s.rpe === null ? '—' : String(s.rpe)}
          labels={{ weight: weightLabel, reps: t('logging.session.cellReps'), rpe: t('logging.session.rpe') }}
          state="done"
          error={!!p?.error}
          coach={!mine && viewerIsClient ? t('logging.session.coachTag') : null}
          a11yCheck={editable ? t('logging.session.editSetN', { n: s.set_number }) : undefined}
          onCheck={editable ? () => setEditing(s) : undefined}
        />
        {p?.error ? (
          <Row style={{ justifyContent: 'space-between', paddingHorizontal: 4 }}>
            <Text variant="caption" style={{ color: theme.colors.dangerAccent, flex: 1 }}>
              {p.error}
            </Text>
            <Button
              label={t('common.retry')}
              variant="link"
              onPress={() =>
                void submitSet(s, {
                  weightKg: s.weight_kg,
                  reps: s.reps,
                  rpe: s.rpe,
                  notes: s.notes ?? '',
                  isWarmup: s.is_warmup,
                })
              }
            />
          </Row>
        ) : null}
      </View>
    );
  };

  const canLog = draft.weightKg !== null || draft.reps !== null;
  const logLabel = draft.isWarmup ? t('logging.session.logWarmup') : t('logging.session.logSetN', { n: setNo });
  const restCaption =
    rest.total !== null && rest.setNumber <= rest.total
      ? t('logging.session.restCaption', { n: rest.setNumber, total: rest.total })
      : t('logging.session.restCaptionSimple', { n: rest.setNumber });

  return (
    <Screen padded={false}>
      {/* Prototype `session` header: back, who and where, elapsed. The artboard's
          OFFLINE pill arrives with the M4b outbox. */}
      <Row style={{ gap: 10, paddingTop: 6, paddingHorizontal: 12, paddingBottom: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={goBack}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevronBack" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={{ fontSize: 15, fontWeight: '700' }}>
            {title}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 11.5, color: theme.colors.textMuted }}>
            {subtitle}
          </Text>
        </View>
      </Row>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        {!current ? (
          <EmptyState
            icon="dumbbell"
            title={t('logging.session.noExercises')}
            body={t('logging.session.noExercisesBody')}
            actionLabel={t('logging.session.addExercise')}
            onAction={openPicker}
          />
        ) : (
          <>
            <Row style={{ alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
              {current.slot ? (
                <Text numeric style={{ fontSize: 11, fontWeight: '700', color: theme.colors.accentText }}>
                  {current.slot}
                </Text>
              ) : null}
              <Text
                numberOfLines={2}
                style={{ flex: 1, fontSize: 19, fontWeight: '800', letterSpacing: -0.3 }}
              >
                {nameOf(current)}
              </Text>
            </Row>
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary, marginBottom: 14 }}>{rx}</Text>

            {viewerIsClient ? (
              current.cue ? (
                <View
                  style={{
                    backgroundColor: theme.colors.surfaceSunken,
                    borderRadius: 12,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    marginBottom: 14,
                  }}
                >
                  <MicroLabel>{t('logging.session.coachCue')}</MicroLabel>
                  <Text style={{ fontSize: 13.5, lineHeight: 20, marginTop: 5 }}>{current.cue}</Text>
                </View>
              ) : null
            ) : (
              <Row style={{ gap: 8, marginBottom: 14, alignItems: 'stretch' }}>
                <InfoTile
                  label={t('logging.session.lastSession')}
                  value={last ? setLine(last) : t('logging.session.firstTimeShort')}
                />
                <InfoTile
                  label={t('logging.session.best')}
                  value={
                    best
                      ? t(best.reps === null ? 'logging.session.bestNoReps' : 'logging.session.bestValue', {
                          weight: shownNumber(best.weightKg, unit),
                          reps: best.reps ?? 0,
                          date: new Date(best.achievedAt).toLocaleDateString(i18n.language, {
                            day: 'numeric',
                            month: 'short',
                          }),
                        })
                      : '—'
                  }
                />
              </Row>
            )}

            <View style={{ gap: 7 }}>
              {warmups.map(doneRow)}
              {workingSets.map(doneRow)}
              <SetRowView
                n={draft.isWarmup ? t('logging.session.warmupShort') : String(setNo)}
                weight={draft.weightKg === null ? '—' : shownNumber(draft.weightKg, unit)}
                reps={draft.reps === null ? '—' : String(draft.reps)}
                rpe={draft.rpe === null ? '—' : String(draft.rpe)}
                labels={{ weight: weightLabel, reps: t('logging.session.cellReps'), rpe: t('logging.session.rpe') }}
                state="current"
                onCell={openKeypad}
                cellA11y={{
                  weight: t('logging.session.weight'),
                  reps: t('logging.session.reps'),
                  rpe: t('logging.session.rpe'),
                }}
                a11yCheck={logLabel}
                onCheck={canLog ? () => void submitSet(null, draft) : undefined}
              />
              {Array.from({ length: futureRows }, (_, i) => (
                <SetRowView
                  key={'planned-' + String(i)}
                  n={String(setNo + i + 1)}
                  weight={current.targetWeightKg === null ? '—' : shownNumber(current.targetWeightKg, unit)}
                  reps={reps === '' ? '—' : reps}
                  rpe={current.targetRpe === null ? '—' : String(current.targetRpe)}
                  labels={{ weight: weightLabel, reps: t('logging.session.cellReps'), rpe: t('logging.session.rpe') }}
                  state="planned"
                />
              ))}
            </View>

            {/* Warm-ups come before working sets; the artboard has no slot for
                marking one, so the toggle only shows until the first working set. */}
            {workingSets.length === 0 ? (
              <View style={{ marginTop: 10 }}>
                <Toggle
                  label={t('logging.session.warmup')}
                  value={draft.isWarmup}
                  onValueChange={(v) => setDraft((d) => ({ ...d, isWarmup: v }))}
                />
              </View>
            ) : null}

            {noteOpen ? (
              <View style={{ marginTop: 10 }}>
                <TextField
                  label={t('logging.session.note')}
                  placeholder={t('logging.session.notePlaceholder')}
                  value={draft.notes}
                  onChangeText={(v) => setDraft((d) => ({ ...d, notes: v }))}
                  maxLength={LOGGING_LIMITS.set_notes}
                />
              </View>
            ) : null}

            {rest.active ? (
              <View style={{ marginTop: 12 }}>
                <RestStrip
                  phase={rest.phase}
                  remaining={rest.remaining}
                  progress={rest.progress}
                  caption={restCaption}
                  plus30Label={t('logging.timer.plus30')}
                  skipLabel={t('logging.timer.skipShort')}
                  expandLabel={t('logging.session.openTimer')}
                  onExpand={() => setTimerOpen(true)}
                  onPlus30={rest.plus30}
                  onSkip={rest.clear}
                />
              </View>
            ) : null}

            {/* PT mode only: the client view "drops the editing affordances". */}
            {!viewerIsClient ? (
              <Row style={{ gap: 8, marginTop: 12 }}>
                <GhostTile label={t('logging.session.swap')} onPress={openPicker} />
                <GhostTile
                  label={noteOpen ? t('logging.session.hideNote') : t('logging.session.addNote')}
                  onPress={() => setNoteOpen((v) => !v)}
                />
              </Row>
            ) : null}
          </>
        )}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: 18,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        }}
      >
        {current ? (
          <Row style={{ justifyContent: 'space-between', marginBottom: 5 }}>
            <Pressable
              accessibilityRole="button"
              disabled={!next}
              onPress={() => setExerciseIndex(currentPos + 1)}
              style={{ flex: 1, minHeight: 36, justifyContent: 'center' }}
            >
              <Text numberOfLines={1} style={{ fontSize: 12.5, color: theme.colors.textMuted }}>
                {next ? t('logging.session.nextUp', { name: nameOf(next) }) : t('logging.session.lastExercise')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('logging.session.allExercises')}
              onPress={() => setListOpen(true)}
              style={{ minHeight: 36, paddingStart: 12, flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Text numeric style={{ fontSize: 11.5, fontWeight: '700', color: theme.colors.textMuted }}>
                {t('logging.session.position', { n: currentPos + 1, total: exercises.length })}
              </Text>
              <Icon name="chevronDown" size={14} color={theme.colors.textMuted} />
            </Pressable>
          </Row>
        ) : null}
        <Row style={{ gap: 8 }}>
          {current ? (
            <View style={{ flex: 1 }}>
              <Button label={logLabel} size="lg" disabled={!canLog} onPress={() => void submitSet(null, draft)} />
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Button label={t('logging.session.addExercise')} size="lg" onPress={openPicker} />
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setFinishDraft(viewerIsClient ? '' : draftNote());
              setFinishOpen(true);
            }}
            style={({ pressed }) => ({
              minHeight: 56,
              paddingHorizontal: 16,
              borderRadius: 11,
              borderWidth: 1.5,
              borderColor: theme.colors.border,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary }}>
              {t('logging.session.end')}
            </Text>
          </Pressable>
        </Row>
      </View>

      {/* Keypad sheet */}
      <Modal
        visible={keypad !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setKeypad(null)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            onPress={() => setKeypad(null)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.45)',
            }}
          />
          <View
            style={{
              padding: theme.space[4],
              gap: theme.space[3],
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
            }}
          >
            <Text variant="label" tone="muted">
              {keypad === 'weight'
                ? t('logging.session.weight') + ' · ' + unitLabel(unit)
                : keypad === 'rpe'
                  ? t('logging.session.rpe')
                  : t('logging.session.reps')}
            </Text>
            <Text numeric style={{ fontSize: 40, fontWeight: '700' }}>
              {keypadText === '' ? '—' : keypadText}
            </Text>
            <NumericKeypad
              onKey={(d) => setKeypadText((v) => (v.length >= 6 ? v : v + d))}
              onDelete={() => setKeypadText((v) => v.slice(0, -1))}
              extraKey={
                keypad === 'weight' || keypad === 'rpe'
                  ? {
                      label: '.',
                      onPress: () =>
                        setKeypadText((v) => (v.includes('.') || v === '' ? v : v + '.')),
                    }
                  : undefined
              }
            />
            <Button label={t('common.done')} size="lg" onPress={keypadCommit} />
          </View>
        </View>
      </Modal>

      {/* Exercise list sheet — the artboard's "2 OF 5" opens it. */}
      <Modal visible={listOpen} animationType="slide" transparent onRequestClose={() => setListOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            onPress={() => setListOpen(false)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}
          />
          <View
            style={{
              padding: theme.space[4],
              paddingBottom: theme.space[6],
              gap: theme.space[2],
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              maxHeight: '80%',
            }}
          >
            <Text variant="h3" accessibilityRole="header">
              {t('logging.session.allExercises')}
            </Text>
            <ScrollView contentContainerStyle={{ gap: 6 }}>
              {exercises.map((ex, i) => {
                const n = workingCount(data.sets, ex.exerciseId);
                const complete = isExerciseDone(ex, data.sets);
                const selected = i === currentPos;
                return (
                  <Pressable
                    key={ex.exerciseId}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setExerciseIndex(i);
                      setListOpen(false);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      minHeight: 52,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      borderWidth: 1.5,
                      borderColor: selected ? theme.colors.accent : theme.colors.border,
                      backgroundColor: selected ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
                    }}
                  >
                    <Text numeric style={{ width: 24, fontSize: 11, fontWeight: '700', color: theme.colors.accentText }}>
                      {ex.slot ?? '+'}
                    </Text>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '600' }}>
                      {nameOf(ex)}
                    </Text>
                    <Text
                      numeric
                      style={{
                        fontSize: 12.5,
                        fontWeight: '700',
                        color: complete ? theme.colors.successAccent : theme.colors.textMuted,
                      }}
                    >
                      {ex.targetSets !== null ? `${n}/${ex.targetSets}` : String(n)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Button label={t('logging.session.addExercise')} variant="ghost" icon="plus" onPress={openPicker} />
          </View>
        </View>
      </Modal>

      {/* Edit sheet */}
      <Modal
        visible={editing !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setEditing(null)}
      >
        {editing ? (
          <EditSetSheet
            set={editing}
            unit={unit}
            onSave={(values) => {
              const s = editing;
              setEditing(null);
              void submitSet(s, values);
            }}
            onDelete={() => {
              const s = editing;
              setEditing(null);
              void removeSet(s);
            }}
            onDismiss={() => setEditing(null)}
          />
        ) : null}
      </Modal>

      {/* Full-screen rest timer (prototype `timer`), opened from the strip. */}
      <Modal visible={timerOpen && rest.active} animationType="fade" onRequestClose={() => setTimerOpen(false)}>
        {rest.active && current ? (
          <RestTimer
            phase={rest.phase}
            remaining={rest.remaining}
            progress={rest.progress}
            labels={{
              kicker:
                rest.total !== null && rest.setNumber <= rest.total
                  ? t('logging.timer.rest', { n: rest.setNumber, total: rest.total })
                  : t('logging.timer.restSimple'),
              exercise: nameOf(current),
              hint:
                rest.phase === 'complete'
                  ? t('logging.timer.hintComplete')
                  : t('logging.timer.hintRunning', {
                      summary: canLog
                        ? `${draft.weightKg === null ? '—' : shownNumber(draft.weightKg, unit)} ${unitLabel(unit)} × ${draft.reps ?? '—'}`
                        : '—',
                    }),
              state: {
                running: t('logging.timer.running'),
                paused: t('logging.timer.paused'),
                complete: t('logging.timer.complete'),
              },
              pause: t('logging.timer.pause'),
              resume: t('logging.timer.resume'),
              plus30: t('logging.timer.plus30'),
              skip: t('logging.timer.skip'),
              back: t('logging.timer.back'),
            }}
            onToggle={rest.togglePause}
            onPlus30={rest.plus30}
            onSkip={() => {
              rest.clear();
              setTimerOpen(false);
            }}
            onDone={() => {
              rest.clear();
              setTimerOpen(false);
            }}
          />
        ) : null}
      </Modal>

      {pr ? (
        <PrMoment
          visible
          kicker={t('logging.pr.kicker')}
          {...pr}
          keepGoingLabel={t('logging.pr.keepGoing')}
          onClose={() => setPr(null)}
        />
      ) : null}

      <FinishSessionSheet
        key={finishOpen ? 'open' : 'closed'}
        visible={finishOpen}
        submitting={finishing}
        error={finishError}
        initialNotes={finishDraft}
        onConfirm={(r, n) => void finish(r, n)}
        onDismiss={() => setFinishOpen(false)}
      />
    </Screen>
  );
}

/** The prototype's 11/700 uppercase section rule on the summary. */
function Kicker({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: theme.colors.textMuted,
        marginBottom: 9,
      }}
    >
      {children}
    </Text>
  );
}

/** 9.5/700 tracked label used on the LAST SESSION / BEST / COACH CUE tiles. */
function MicroLabel({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text style={{ fontSize: 9.5, fontWeight: '700', letterSpacing: 1.1, color: theme.colors.textMuted }}>
      {children}
    </Text>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        flex: 1,
        backgroundColor: theme.colors.surfaceSunken,
        borderRadius: 10,
        paddingVertical: 9,
        paddingHorizontal: 11,
      }}
    >
      <MicroLabel>{label}</MicroLabel>
      <Text numeric numberOfLines={1} style={{ fontSize: 14, fontWeight: '700', marginTop: 3 }}>
        {value}
      </Text>
    </View>
  );
}

function SummaryStat({ value, label }: { value: string; label: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        flex: 1,
        alignItems: 'center',
        paddingVertical: 13,
        paddingHorizontal: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surfaceRaised,
      }}
    >
      <Text numeric numberOfLines={1} style={{ fontSize: 20, fontWeight: '700', lineHeight: 22 }}>
        {value}
      </Text>
      <Text
        numberOfLines={1}
        style={{ fontSize: 9.5, fontWeight: '600', letterSpacing: 1, color: theme.colors.textMuted, marginTop: 6 }}
      >
        {label}
      </Text>
    </View>
  );
}

function GhostTile({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 44,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary }}>{label}</Text>
    </Pressable>
  );
}

type CellKey = 'weight' | 'reps' | 'rpe';

/**
 * Prototype `session` set row: set number, three mono cells, check. One row per
 * set, 44pt targets. `done` rows open the edit sheet from the check; the
 * `current` row's cells open the keypad and its check logs the set; `planned`
 * rows show the prescription, muted and inert. The artboard's mic button is
 * voice logging, M4d.
 */
function SetRowView({
  n,
  weight,
  reps,
  rpe,
  labels,
  state,
  error = false,
  coach = null,
  onCell,
  cellA11y,
  a11yCheck,
  onCheck,
}: {
  n: string;
  weight: string;
  reps: string;
  rpe: string;
  labels: Record<CellKey, string>;
  state: 'done' | 'current' | 'planned';
  error?: boolean;
  coach?: string | null;
  onCell?: (key: CellKey) => void;
  cellA11y?: Record<CellKey, string>;
  a11yCheck?: string;
  onCheck?: () => void;
}) {
  const theme = useTheme();
  const isCurrent = state === 'current';
  const valueColor = state === 'planned' ? theme.colors.textMuted : theme.colors.textPrimary;
  const cells: { key: CellKey; value: string }[] = [
    { key: 'weight', value: weight },
    { key: 'reps', value: reps },
    { key: 'rpe', value: rpe },
  ];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingVertical: 9,
        paddingHorizontal: 10,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: error ? theme.colors.dangerAccent : isCurrent ? theme.colors.accent : theme.colors.border,
        backgroundColor: isCurrent ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
      }}
    >
      <View style={{ width: 20 }}>
        <Text
          numeric
          style={{
            fontSize: 12,
            fontWeight: '700',
            color: isCurrent ? theme.colors.onAccentSurfaceSoft : theme.colors.textMuted,
          }}
        >
          {n}
        </Text>
      </View>
      {cells.map((c) => {
        const body = (
          <>
            <Text numeric numberOfLines={1} style={{ fontSize: 17, fontWeight: '700', lineHeight: 19, color: valueColor }}>
              {c.value}
            </Text>
            <Text style={{ fontSize: 8.5, fontWeight: '600', letterSpacing: 1, color: theme.colors.textMuted, marginTop: 2 }}>
              {labels[c.key]}
            </Text>
          </>
        );
        return isCurrent && onCell ? (
          <Pressable
            key={c.key}
            accessibilityRole="button"
            accessibilityLabel={`${cellA11y?.[c.key] ?? labels[c.key]}: ${c.value}`}
            onPress={() => onCell(c.key)}
            style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' }}
          >
            {body}
          </Pressable>
        ) : (
          <View key={c.key} style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' }}>
            {body}
          </View>
        );
      })}
      {coach ? <Tag label={coach} tone="neutral" /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11yCheck}
        disabled={!onCheck}
        onPress={onCheck}
        style={{
          width: 44,
          height: 44,
          borderRadius: 11,
          borderWidth: 1.5,
          borderColor: state === 'done' ? palette.success : isCurrent ? theme.colors.accent : theme.colors.border,
          backgroundColor: state === 'done' ? palette.success : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isCurrent && !onCheck ? 0.5 : 1,
        }}
      >
        {state === 'done' ? (
          <Icon name="check" size={18} color={palette.white} strokeWidth={2.6} />
        ) : isCurrent ? (
          <Icon name="check" size={18} color={theme.colors.accentText} strokeWidth={2.2} />
        ) : null}
      </Pressable>
    </View>
  );
}

function EditSetSheet({
  set,
  unit,
  onSave,
  onDelete,
  onDismiss,
}: {
  set: SetRow;
  unit: UnitSystem;
  onSave: (values: Draft) => void;
  onDelete: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [values, setValues] = useState<Draft>({
    weightKg: set.weight_kg,
    reps: set.reps,
    rpe: set.rpe,
    notes: set.notes ?? '',
    isWarmup: set.is_warmup,
  });
  const shown = values.weightKg === null ? '' : String(kgToDisplay(values.weightKg, unit));
  const rpeItems = [
    { label: t('logging.session.rpeSkip'), value: '' },
    ...[6, 7, 8, 9, 10].map((n) => ({ label: String(n), value: String(n) })),
  ];
  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
        onPress={onDismiss}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.45)',
        }}
      />
      <View
        style={{
          padding: theme.space[5],
          gap: theme.space[3],
          backgroundColor: theme.colors.surface,
          borderTopLeftRadius: theme.radius.xl,
          borderTopRightRadius: theme.radius.xl,
        }}
      >
        <Text variant="h3">{t('logging.session.editSet')}</Text>
        <Row style={{ gap: theme.space[3], alignItems: 'flex-start' }}>
          {/* TextField is Omit<TextInputProps, 'style'> — the flex lives on a wrapper. */}
          <View style={{ flex: 1 }}>
            <TextField
              label={t('logging.session.weight') + ' · ' + unitLabel(unit)}
              keyboardType="decimal-pad"
              value={shown}
              onChangeText={(v) =>
                setValues((d) => ({ ...d, weightKg: v === '' ? null : displayToKg(Number(v), unit) }))
              }
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label={t('logging.session.reps')}
              keyboardType="number-pad"
              value={values.reps === null ? '' : String(values.reps)}
              onChangeText={(v) =>
                setValues((d) => ({ ...d, reps: v === '' ? null : Math.round(Number(v)) }))
              }
            />
          </View>
        </Row>
        <SegmentedPill
          items={rpeItems}
          selected={values.rpe === null ? '' : String(values.rpe)}
          onChange={(v) => setValues((d) => ({ ...d, rpe: v === '' ? null : Number(v) }))}
        />
        <Toggle
          label={t('logging.session.warmup')}
          value={values.isWarmup}
          onValueChange={(v) => setValues((d) => ({ ...d, isWarmup: v }))}
        />
        <TextField
          label={t('logging.session.note')}
          value={values.notes}
          onChangeText={(v) => setValues((d) => ({ ...d, notes: v }))}
          maxLength={LOGGING_LIMITS.set_notes}
        />
        <Button label={t('common.save')} size="lg" onPress={() => onSave(values)} />
        <Button
          label={t('logging.session.deleteSet')}
          variant="ghost"
          tone="danger"
          onPress={onDelete}
        />
        <Button label={t('common.cancel')} variant="link" onPress={onDismiss} />
      </View>
    </View>
  );
}

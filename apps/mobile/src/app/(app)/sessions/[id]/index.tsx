import {
  completeSessionInputSchema,
  displayToKg,
  formatElapsed,
  formatWeight,
  kgToDisplay,
  logSetInputSchema,
  LOGGING_LIMITS,
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
  nextSetNumber,
  prefillFor,
  setsFor,
  type SessionExercise,
} from '../../../../lib/logging/sessionModel';
import {
  completeWorkoutSession,
  deleteSet,
  logSet,
  type SetRow,
} from '../../../../lib/logging/sessionRpc';
import { newUlid } from '../../../../lib/logging/ulid';
import { useSession } from '../../../../lib/logging/useSession';
import { takePickedExercise } from '../../../../lib/programs/exercisePicker';
import { useTheme } from '../../../../theme/ThemeProvider';
import {
  Button,
  Card,
  EmptyState,
  FooterBar,
  NavHeader,
  NumericKeypad,
  PrBanner,
  RestTimer,
  Row,
  Screen,
  SectionLabel,
  SegmentedPill,
  SetStepper,
  Skeleton,
  StatTile,
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
type KeypadTarget = 'weight' | 'reps' | null;
type PendingSet = { id: string; error: string | null };

/**
 * An ad-hoc exercise whose name has not been resolved yet arrives from
 * buildExerciseList with an empty name (the models stay copy-free). The
 * placeholder belongs to the screen.
 */
function nameOf(ex: SessionExercise): string {
  return ex.name === '' ? '…' : ex.name;
}

/**
 * One route, both personas, state-driven (spec §5.3): `in_progress` renders the
 * logging UI, `completed` the read-only summary. Rights come from the RPCs and
 * RLS, never from the role string — the screen only hides affordances a
 * request would refuse anyway (a client sees Coach sets read-only).
 */
export default function SessionScreen() {
  const { t } = useTranslation();
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
  const [prLines, setPrLines] = useState<string[]>([]);
  const [rest, setRest] = useState<{
    startedAt: number;
    seconds: number;
    setNumber: number;
    total: number | null;
  } | null>(null);
  const [editing, setEditing] = useState<SetRow | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  // Lazy initialiser: React Compiler's purity rule rejects a bare Date.now()
  // in the render body (RestTimer does the same).
  const [clock, setClock] = useState(() => Date.now());
  const player = useAudioPlayer(timerCue);

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

  function haptic(kind: 'success' | 'light') {
    // PITFALLS W4: expo-haptics is a native-only no-op contract, not a web one.
    if (Platform.OS === 'web') return;
    if (kind === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function stepWeight(delta: number) {
    const shown = draft.weightKg === null ? 0 : kgToDisplay(draft.weightKg, unit);
    const next = Math.max(0, shown + delta);
    setDraft((d) => ({ ...d, weightKg: displayToKg(next, unit) }));
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
        setPrLines(hits.map((h) => prLine(h, result.set)));
        haptic('success');
      }
      // Spec §6.2: rest follows a working set. A warm-up rolls straight into
      // the next one — nobody waits 90s after an empty-bar set.
      if (!input.data.is_warmup) {
        // Lazy updater, not a bare object: React Compiler's purity rule refuses
        // Date.now() anywhere it can reach from a render path, and an updater
        // is only ever run outside one (same reason `clock` uses useState(() => …)).
        setRest(() => ({
          startedAt: Date.now(),
          seconds: current.restSec ?? DEFAULT_REST_SEC,
          setNumber: setNumber + 1,
          total: current.targetSets,
        }));
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
    await data.refetch();
  }

  function summary(set: SetRow): string {
    if (set.weight_kg === null) return t('logging.session.repsOnly', { reps: set.reps ?? 0 });
    const weight = formatWeight(set.weight_kg, unit);
    return set.rpe === null
      ? t('logging.session.setSummary', { weight, reps: set.reps ?? 0 })
      : t('logging.session.setSummaryRpe', { weight, reps: set.reps ?? 0, rpe: set.rpe });
  }

  // PITFALLS N1 + N15: the screen owns its Back, and a cold deep link has no
  // frame to pop to.
  const back = (
    <Button
      label={t('common.back')}
      variant="link"
      icon="chevronBack"
      onPress={() => {
        if (router.canGoBack()) router.back();
        else router.dismissTo('/');
      }}
    />
  );

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
  const elapsedSec = session.started_at
    ? Math.floor((clock - new Date(session.started_at).getTime()) / 1000)
    : 0;

  // ── Completed: read-only summary ─────────────────────────────────────────
  if (!inProgress) {
    const working = data.sets.filter((s) => !s.is_warmup);
    return (
      <Screen padded={false}>
        <NavHeader leading={back} title={title} divider />
        <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4] }}>
          <Text variant="caption" tone="muted">
            {t('logging.summary.completedAt', {
              date: session.completed_at ? new Date(session.completed_at).toLocaleString() : '—',
            })}
          </Text>
          <Row style={{ gap: theme.space[2] }}>
            <StatTile
              label={t('logging.summary.duration')}
              value={session.duration_min === null ? '—' : String(session.duration_min) + 'm'}
            />
            <StatTile label={t('logging.summary.sets')} value={String(working.length)} />
            <StatTile
              label={t('logging.summary.volume')}
              value={formatWeight(sessionVolume(data.sets), unit)}
            />
          </Row>
          {exercises.length === 0 ? <Text tone="secondary">{t('logging.summary.noSets')}</Text> : null}
          {exercises.map((ex) => {
            const rows = setsFor(data.sets, ex.exerciseId);
            if (rows.length === 0) return null;
            return (
              <Card key={ex.exerciseId} style={{ gap: theme.space[2] }}>
                <Text variant="bodyBold">{nameOf(ex)}</Text>
                {rows.map((s) => (
                  <Row key={s.id} style={{ justifyContent: 'space-between' }}>
                    <Text tone="secondary">
                      {s.is_warmup
                        ? t('logging.session.warmup')
                        : t('logging.session.setN', { n: s.set_number })}
                    </Text>
                    <Row style={{ gap: theme.space[2] }}>
                      {s.logged_by_user_id !== viewerId && viewerIsClient ? (
                        <Tag label={t('logging.session.coachTag')} tone="neutral" />
                      ) : null}
                      <Text numeric>{summary(s)}</Text>
                    </Row>
                  </Row>
                ))}
              </Card>
            );
          })}
          {session.rating !== null ? (
            <Text numeric>
              {'●'.repeat(session.rating)}
              {'○'.repeat(5 - session.rating)}
            </Text>
          ) : null}
          {session.pt_notes || session.session_notes ? (
            <View style={{ gap: theme.space[1] }}>
              <SectionLabel>{t('logging.summary.notes')}</SectionLabel>
              {session.pt_notes ? <Text>{session.pt_notes}</Text> : null}
              {session.session_notes ? <Text>{session.session_notes}</Text> : null}
            </View>
          ) : null}
        </ScrollView>
      </Screen>
    );
  }

  // ── In progress: logging ─────────────────────────────────────────────────
  const currentSets = current ? setsFor(data.sets, current.exerciseId) : [];
  const setNo = current ? nextSetNumber(data.sets, current.exerciseId) : 1;
  const last = current ? (data.lastByExercise[current.exerciseId] ?? null) : null;
  const shownWeight = draft.weightKg === null ? '—' : String(kgToDisplay(draft.weightKg, unit));
  const stepLabels = [
    { label: '−5', delta: -5 },
    { label: '−1', delta: -1 },
    { label: '+1', delta: 1 },
    { label: '+5', delta: 5 },
  ];
  const rpeItems = [
    { label: t('logging.session.rpeSkip'), value: '' },
    ...[6, 7, 8, 9, 10].map((n) => ({ label: String(n), value: String(n) })),
  ];

  return (
    <Screen padded={false}>
      <NavHeader
        leading={back}
        title={
          <Text variant="bodyBold" numberOfLines={1}>
            {title}
          </Text>
        }
        trailing={
          <Button
            label={t('logging.session.finish')}
            variant="link"
            tone="accent"
            onPress={() => setFinishOpen(true)}
          />
        }
        divider
      />
      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            padding: theme.space[4],
            gap: theme.space[4],
            paddingBottom: theme.space[8],
          }}
        >
          <Row style={{ justifyContent: 'space-between' }}>
            <Text numeric tone="secondary">
              {formatElapsed(elapsedSec)}
            </Text>
          </Row>

          {/* Exercise rail. Height + alignItems + flexGrow 0 are the RN
              horizontal-chip-row rule; without them the chips stretch. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: theme.space[2], alignItems: 'center', height: 40 }}
            style={{ flexGrow: 0 }}
          >
            {exercises.map((ex, i) => (
              <Pressable
                key={ex.exerciseId}
                accessibilityRole="button"
                accessibilityState={{ selected: i === exerciseIndex }}
                onPress={() => setExerciseIndex(i)}
                style={{
                  paddingHorizontal: theme.space[3],
                  height: 34,
                  borderRadius: theme.radius.pill,
                  justifyContent: 'center',
                  backgroundColor:
                    i === exerciseIndex ? theme.colors.accent : theme.colors.surfaceRaised,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Text
                  variant="caption"
                  style={{
                    color: i === exerciseIndex ? theme.colors.onAccent : theme.colors.textPrimary,
                  }}
                >
                  {nameOf(ex)}
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('logging.session.addExercise')}
              onPress={() =>
                router.push({
                  pathname: '/(app)/sessions/[id]/pick-exercise',
                  params: { id: session.id },
                })
              }
              style={{
                paddingHorizontal: theme.space[3],
                height: 34,
                borderRadius: theme.radius.pill,
                justifyContent: 'center',
                borderWidth: 1.5,
                borderColor: theme.colors.accent,
              }}
            >
              <Text variant="caption" tone="accent">
                + {t('logging.session.addExercise')}
              </Text>
            </Pressable>
          </ScrollView>

          {!current ? (
            <EmptyState
              icon="dumbbell"
              title={t('logging.session.noExercises')}
              body={t('logging.session.noExercisesBody')}
              actionLabel={t('logging.session.addExercise')}
              onAction={() =>
                router.push({
                  pathname: '/(app)/sessions/[id]/pick-exercise',
                  params: { id: session.id },
                })
              }
            />
          ) : (
            <>
              {/* Focus card */}
              <Card style={{ gap: theme.space[3] }}>
                <Text variant="h3">{nameOf(current)}</Text>
                <Text variant="caption" tone="muted">
                  {current.targetSets !== null
                    ? t('logging.session.setOf', { n: setNo, total: current.targetSets })
                    : t('logging.session.setN', { n: setNo })}
                </Text>
                <Row style={{ gap: theme.space[3], alignItems: 'flex-end' }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('logging.session.weight')}
                    onPress={() => openKeypad('weight')}
                    style={{ flex: 1 }}
                  >
                    <Text variant="label" tone="muted">
                      {t('logging.session.weight')} · {unitLabel(unit)}
                    </Text>
                    <Text numeric style={{ fontSize: 40, fontWeight: '700', lineHeight: 46 }}>
                      {shownWeight}
                    </Text>
                  </Pressable>
                  <Text numeric style={{ fontSize: 28, lineHeight: 46 }} tone="muted">
                    ×
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('logging.session.reps')}
                    onPress={() => openKeypad('reps')}
                    style={{ flex: 1 }}
                  >
                    <Text variant="label" tone="muted">
                      {t('logging.session.reps')}
                    </Text>
                    <Text numeric style={{ fontSize: 40, fontWeight: '700', lineHeight: 46 }}>
                      {draft.reps ?? '—'}
                    </Text>
                  </Pressable>
                </Row>
                <Text variant="caption" tone="secondary">
                  {last
                    ? t('logging.session.last', { summary: summary(last) })
                    : t('logging.session.firstTime')}
                </Text>
                <SetStepper steps={stepLabels} onStep={stepWeight} />
                <View style={{ gap: theme.space[1] }}>
                  <Text variant="label" tone="muted">
                    {t('logging.session.rpe')}
                  </Text>
                  <SegmentedPill
                    items={rpeItems}
                    selected={draft.rpe === null ? '' : String(draft.rpe)}
                    onChange={(v) => setDraft((d) => ({ ...d, rpe: v === '' ? null : Number(v) }))}
                  />
                </View>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Toggle
                    label={t('logging.session.warmup')}
                    value={draft.isWarmup}
                    onValueChange={(v) => setDraft((d) => ({ ...d, isWarmup: v }))}
                  />
                  <Button
                    label={t('logging.session.note')}
                    variant="link"
                    icon="edit"
                    onPress={() => setNoteOpen((v) => !v)}
                  />
                </Row>
                {noteOpen ? (
                  <TextField
                    label={t('logging.session.note')}
                    placeholder={t('logging.session.notePlaceholder')}
                    value={draft.notes}
                    onChangeText={(v) => setDraft((d) => ({ ...d, notes: v }))}
                    maxLength={LOGGING_LIMITS.set_notes}
                  />
                ) : null}
              </Card>

              {/* Sets this session */}
              {currentSets.length > 0 ? (
                <View style={{ gap: theme.space[2] }}>
                  <SectionLabel>{t('logging.session.previousSets')}</SectionLabel>
                  {currentSets.map((s) => {
                    const mine = s.logged_by_user_id === viewerId;
                    const editable = !viewerIsClient || mine;
                    const p = pending[s.id];
                    return (
                      <Pressable
                        key={s.id}
                        accessibilityRole="button"
                        disabled={!editable}
                        onPress={() => setEditing(s)}
                        style={{
                          padding: theme.space[3],
                          borderRadius: theme.radius.md,
                          backgroundColor: theme.colors.surfaceRaised,
                          borderWidth: 1,
                          borderColor: p?.error ? theme.colors.dangerAccent : theme.colors.border,
                          gap: theme.space[1],
                        }}
                      >
                        <Row style={{ justifyContent: 'space-between' }}>
                          <Text tone="secondary">
                            {s.is_warmup
                              ? t('logging.session.warmup')
                              : t('logging.session.setN', { n: s.set_number })}
                          </Text>
                          <Row style={{ gap: theme.space[2] }}>
                            {!mine && viewerIsClient ? (
                              <Tag label={t('logging.session.coachTag')} tone="neutral" />
                            ) : null}
                            <Text numeric variant="bodyBold">
                              {summary(s)}
                            </Text>
                          </Row>
                        </Row>
                        {p?.error ? (
                          <Row style={{ justifyContent: 'space-between' }}>
                            <Text
                              variant="caption"
                              style={{ color: theme.colors.dangerAccent, flex: 1 }}
                            >
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
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
        <PrBanner lines={prLines} onDismiss={() => setPrLines([])} />
      </View>

      {current ? (
        <FooterBar>
          <Button
            label={t('logging.session.logSet')}
            size="lg"
            disabled={draft.weightKg === null && draft.reps === null}
            onPress={() => void submitSet(null, draft)}
          />
        </FooterBar>
      ) : null}

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
                : t('logging.session.reps')}
            </Text>
            <Text numeric style={{ fontSize: 40, fontWeight: '700' }}>
              {keypadText === '' ? '—' : keypadText}
            </Text>
            <NumericKeypad
              onKey={(d) => setKeypadText((v) => (v.length >= 6 ? v : v + d))}
              onDelete={() => setKeypadText((v) => v.slice(0, -1))}
              extraKey={
                keypad === 'weight'
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

      {/* Rest timer */}
      <Modal visible={rest !== null} animationType="fade" onRequestClose={() => setRest(null)}>
        {rest && current ? (
          <RestTimer
            seconds={rest.seconds}
            startedAt={rest.startedAt}
            labels={{
              kicker: rest.total
                ? t('logging.timer.rest', { n: rest.setNumber, total: rest.total })
                : t('logging.timer.restSimple'),
              exercise: nameOf(current),
              hint: t('logging.timer.hintRunning', {
                summary:
                  draft.weightKg === null && draft.reps === null
                    ? '—'
                    : `${shownWeight} ${unitLabel(unit)} × ${draft.reps ?? '—'}`,
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
            onZero={() => {
              try {
                void player.seekTo(0).catch(() => undefined);
                player.play();
              } catch {
                /* cue optional; the haptic is the signal */
              }
              haptic('success');
            }}
            onDone={() => setRest(null)}
            onSkip={() => setRest(null)}
          />
        ) : null}
      </Modal>

      <FinishSessionSheet
        visible={finishOpen}
        submitting={finishing}
        error={finishError}
        onConfirm={(r, n) => void finish(r, n)}
        onDismiss={() => setFinishOpen(false)}
      />
    </Screen>
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

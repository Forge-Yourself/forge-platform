import { saveProgramPayloadSchema } from '@forge/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../../../lib/auth/AuthProvider';
import { useAsyncSubmit } from '../../../../lib/forms/useAsyncSubmit';
import { useCreditBalance } from '../../../../lib/ai/useCreditBalance';
import {
  blockTag,
  draftToPayload,
  formatRepsCell,
  formatRest,
  parseIntCell,
  parseRepsCell,
  parseRpeCell,
  slotFor,
  treeToDraft,
  type DraftBlock,
  type ProgramDraft,
} from '../../../../lib/programs/draftModel';
import { takePickedExercise } from '../../../../lib/programs/exercisePicker';
import { copyProgramWeek, saveProgram } from '../../../../lib/programs/programActions';
import { useProgramTree } from '../../../../lib/programs/useProgramTree';
import { useTheme } from '../../../../theme/ThemeProvider';
import {
  Banner,
  BuilderBlock,
  BuilderRow,
  Button,
  NumericKeypad,
  Row,
  Screen,
  Skeleton,
  Text,
  TextField,
  type BuilderCellKey,
} from '../../../../ui';

const TEMPO_PRESETS = ['2-0-2', '3-1-1', '3-0-1', '2-1-2'];

type EditingCell = { blockIndex: number; rowIndex: number; key: BuilderCellKey } | null;

/**
 * The program builder — the one genuinely dense screen in v1, and the reason
 * the spec replaced drag-and-drop with a list picker plus copy-week.
 *
 * It is a local-draft editor: the whole tree loads once, every edit is local
 * state, and Save is one save_program() call. A failed save never clears that
 * local state — losing an hour of programming to a dropped connection is not
 * a failure mode this screen is allowed to have.
 */
export default function ProgramBuilder() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const params = useLocalSearchParams<{ id: string }>();
  const programId = params.id;

  const { loading, error, tree, refetch } = useProgramTree(programId);
  const credits = useCreditBalance(auth.user?.id);

  const [draft, setDraft] = useState<ProgramDraft>({ weeks: [] });
  const [seededId, setSeededId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [weekIndex, setWeekIndex] = useState(0);
  const [dayIndex, setDayIndex] = useState(0);
  const [editing, setEditing] = useState<EditingCell>(null);
  const [buffer, setBuffer] = useState('');
  const [pendingBlockIndex, setPendingBlockIndex] = useState<number | null>(null);
  const [copyWeekOpen, setCopyWeekOpen] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  const { submitting, error: saveError, setError, run } = useAsyncSubmit();

  // Seed the local draft from server state by adjusting state during render
  // behind an id guard, not in an effect — the same pattern the intake wizard
  // uses, and for the same lint reason.
  if (tree && tree.id !== seededId) {
    setSeededId(tree.id);
    setDraft(treeToDraft(tree));
    setDirty(false);
    setWeekIndex(0);
    setDayIndex(0);
  }

  const week = draft.weeks[weekIndex];
  const day = week?.days[dayIndex];

  const mutate = (fn: (current: ProgramDraft) => ProgramDraft) => {
    setDraft((current) => fn(current));
    setDirty(true);
  };

  const mutateDay = (fn: (blocks: DraftBlock[]) => DraftBlock[]) => {
    mutate((current) => ({
      weeks: current.weeks.map((w, wi) =>
        wi !== weekIndex
          ? w
          : {
              ...w,
              days: w.days.map((d, di) => (di !== dayIndex ? d : { ...d, blocks: fn(d.blocks) })),
            },
      ),
    }));
  };

  // The library hands back a pick through a module singleton rather than route
  // params, so this screen keeps its unsaved draft across the round trip.
  useFocusEffect(
    useCallback(() => {
      const picked = takePickedExercise();
      if (!picked || pendingBlockIndex === null) return;
      const blockIndex = pendingBlockIndex;
      setPendingBlockIndex(null);
      mutateDay((blocks) =>
        blocks.map((block, bi) =>
          bi !== blockIndex
            ? block
            : {
                ...block,
                exercises: [
                  ...block.exercises,
                  {
                    exercise_id: picked.id,
                    exercise_name: picked.name,
                    sort_order: block.exercises.length,
                    target_sets: null,
                    target_reps_min: null,
                    target_reps_max: null,
                    target_rpe: null,
                    rest_sec: null,
                    tempo_prescribed: null,
                  },
                ],
              },
        ),
      );
      // mutateDay closes over the current week/day indices, which is exactly
      // what we want: the pick lands in the day the PT was editing.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingBlockIndex, weekIndex, dayIndex]),
  );

  function cellValue(key: BuilderCellKey, blockIndex: number, rowIndex: number): string {
    const exercise = day?.blocks[blockIndex]?.exercises[rowIndex];
    if (!exercise) return '';
    if (key === 'sets') return exercise.target_sets === null ? '' : String(exercise.target_sets);
    if (key === 'reps') return formatRepsCell(exercise.target_reps_min, exercise.target_reps_max);
    if (key === 'rpe') return exercise.target_rpe === null ? '' : String(exercise.target_rpe);
    return exercise.tempo_prescribed ?? '';
  }

  function openCell(blockIndex: number, rowIndex: number, key: BuilderCellKey) {
    setEditing({ blockIndex, rowIndex, key });
    setBuffer(cellValue(key, blockIndex, rowIndex));
  }

  function commitBuffer(value: string) {
    if (!editing) return;
    const { blockIndex, rowIndex, key } = editing;
    mutateDay((blocks) =>
      blocks.map((block, bi) =>
        bi !== blockIndex
          ? block
          : {
              ...block,
              exercises: block.exercises.map((ex, ri) => {
                if (ri !== rowIndex) return ex;
                if (key === 'sets') return { ...ex, target_sets: parseIntCell(value) };
                if (key === 'rpe') return { ...ex, target_rpe: parseRpeCell(value) };
                if (key === 'tempo') {
                  return { ...ex, tempo_prescribed: value.trim() === '' ? null : value.trim() };
                }
                const reps = parseRepsCell(value);
                return { ...ex, target_reps_min: reps.min, target_reps_max: reps.max };
              }),
            },
      ),
    );
  }

  function closeCell() {
    commitBuffer(buffer);
    setEditing(null);
    setBuffer('');
  }

  function nextCell() {
    if (!editing) return;
    const order: BuilderCellKey[] = ['sets', 'reps', 'rpe', 'tempo'];
    const nextKey = order[(order.indexOf(editing.key) + 1) % order.length];
    commitBuffer(buffer);
    const target = { ...editing, key: nextKey as BuilderCellKey };
    setEditing(target);
    setBuffer(cellValue(target.key, target.blockIndex, target.rowIndex));
  }

  function addBlock() {
    mutateDay((blocks) => [
      ...blocks,
      {
        sort_order: blocks.length,
        block_type: 'working',
        label: null,
        rest_between_sec: null,
        exercises: [],
      },
    ]);
  }

  function addDay() {
    mutate((current) => ({
      weeks: current.weeks.map((w, wi) => {
        if (wi !== weekIndex) return w;
        const used = new Set(w.days.map((d) => d.day_number));
        const nextDay = [1, 2, 3, 4, 5, 6, 7].find((n) => !used.has(n));
        if (nextDay === undefined) return w;
        return {
          ...w,
          days: [...w.days, { day_number: nextDay, label: null, notes: null, blocks: [] }],
        };
      }),
    }));
  }

  async function handleSave() {
    setError(null);
    const payload = saveProgramPayloadSchema.safeParse(draftToPayload(draft));
    if (!payload.success) {
      setError(t('builder.saveError'));
      return;
    }
    await run(async () => {
      try {
        await saveProgram(programId, payload.data);
        setDirty(false);
        await refetch();
      } catch {
        // Deliberately leaves `draft` untouched: a failed save must never
        // cost the PT the work still sitting in front of them.
        setError(t('builder.saveError'));
      }
    });
  }

  async function handleCopyWeek(toWeekNumber: number) {
    if (!week) return;
    await run(async () => {
      try {
        await copyProgramWeek(programId, week.week_number, toWeekNumber);
        setCopyWeekOpen(false);
        await refetch();
        setSeededId(null);
      } catch {
        setError(t('builder.copyWeek.error'));
      }
    });
  }

  function leave() {
    if (dirty) {
      setConfirmLeaveOpen(true);
      return;
    }
    router.back();
  }

  if (loading) {
    return (
      <Screen>
        <View style={{ gap: theme.space[3] }}>
          <Skeleton height={32} />
          <Skeleton height={44} />
          <Skeleton height={120} />
        </View>
      </Screen>
    );
  }

  if (error || !tree) {
    return (
      <Screen>
        <View style={{ gap: theme.space[3] }}>
          <Banner variant="danger" message={t('builder.offlineError.body')} />
          <Button label={t('builder.offlineError.retry')} variant="ghost" onPress={() => void refetch()} />
          <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Button label={t('common.back')} variant="ghost" onPress={leave} />
        <Text variant="h3" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
          {tree.name}
        </Text>
        <Button
          label={submitting ? t('builder.saving') : t('builder.save')}
          disabled={!dirty || submitting}
          onPress={() => void handleSave()}
        />
      </Row>

      {saveError ? <Banner variant="danger" message={saveError} /> : null}

      <Row style={{ gap: theme.space[2], alignItems: 'center', marginTop: theme.space[3] }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2] }}>
          {draft.weeks.map((w, wi) => {
            const selected = wi === weekIndex;
            return (
              <Pressable
                key={w.week_number}
                accessibilityRole="button"
                accessibilityLabel={t('builder.weekLabel', { week: w.week_number })}
                accessibilityState={{ selected }}
                onPress={() => {
                  setWeekIndex(wi);
                  setDayIndex(0);
                  setEditing(null);
                }}
                style={{
                  minWidth: 44,
                  minHeight: 38,
                  paddingHorizontal: theme.space[3],
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: theme.radius.pill,
                  borderWidth: 1,
                  borderColor: selected ? theme.colors.accent : theme.colors.border,
                  backgroundColor: selected ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
                }}
              >
                <Text numeric variant="caption" style={{ fontWeight: '700' }}>
                  {w.week_number}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('builder.copyWeek.action')}
          onPress={() => setCopyWeekOpen(true)}
          style={{
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surfaceRaised,
          }}
        >
          <Text style={{ fontSize: 16 }}>⧉</Text>
        </Pressable>
      </Row>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2], paddingVertical: theme.space[3] }}>
        {(week?.days ?? []).map((d, di) => {
          const selected = di === dayIndex;
          return (
            <Pressable
              key={d.day_number}
              accessibilityRole="button"
              accessibilityLabel={t('builder.dayLabel', { day: d.day_number })}
              accessibilityState={{ selected }}
              onPress={() => {
                setDayIndex(di);
                setEditing(null);
              }}
              style={{
                minHeight: 38,
                paddingHorizontal: theme.space[3],
                justifyContent: 'center',
                borderRadius: theme.radius.pill,
                borderWidth: 1,
                borderColor: selected ? theme.colors.accent : theme.colors.border,
                backgroundColor: selected ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
              }}
            >
              <Text variant="caption" style={{ fontWeight: '600' }}>
                {d.label ?? t('builder.dayLabel', { day: d.day_number })}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('builder.addDay')}
          onPress={addDay}
          style={{
            minHeight: 38,
            paddingHorizontal: theme.space[3],
            justifyContent: 'center',
            borderRadius: theme.radius.pill,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: theme.colors.border,
          }}
        >
          <Text variant="caption" tone="muted">
            + {t('builder.addDay')}
          </Text>
        </Pressable>
      </ScrollView>

      <ScrollView contentContainerStyle={{ gap: theme.space[3], paddingBottom: theme.space[10] }}>
        {day === undefined || day.blocks.length === 0 ? (
          <View style={{ gap: theme.space[3], alignItems: 'center', paddingVertical: theme.space[8] }}>
            <Text variant="h3">{t('builder.empty.title')}</Text>
            <Text tone="secondary">{t('builder.empty.body')}</Text>
            <Button label={t('builder.addBlock')} onPress={addBlock} />
          </View>
        ) : (
          <>
            {day.blocks.map((block, blockIndex) => (
              <BuilderBlock
                key={blockIndex}
                tag={blockTag(blockIndex)}
                title={block.label ?? t('builder.blockTypeLabels.' + block.block_type)}
                rest={
                  block.rest_between_sec === null
                    ? null
                    : t('builder.restLabel', { rest: formatRest(block.rest_between_sec) })
                }
              >
                {block.exercises.map((exercise, rowIndex) => (
                  <BuilderRow
                    key={exercise.exercise_id + ':' + rowIndex}
                    slot={slotFor(blockIndex, rowIndex)}
                    name={exercise.exercise_name}
                    activeCellKey={
                      editing && editing.blockIndex === blockIndex && editing.rowIndex === rowIndex
                        ? editing.key
                        : null
                    }
                    cells={[
                      { key: 'sets', label: t('builder.cells.sets'), value: cellValue('sets', blockIndex, rowIndex) },
                      { key: 'reps', label: t('builder.cells.reps'), value: cellValue('reps', blockIndex, rowIndex) },
                      { key: 'rpe', label: t('builder.cells.rpe'), value: cellValue('rpe', blockIndex, rowIndex) },
                      { key: 'tempo', label: t('builder.cells.tempo'), value: cellValue('tempo', blockIndex, rowIndex) },
                    ]}
                    onCellPress={(key) => openCell(blockIndex, rowIndex, key)}
                    removeLabel={t('builder.removeExercise')}
                    onRemove={() =>
                      mutateDay((blocks) =>
                        blocks.map((b, bi) =>
                          bi !== blockIndex
                            ? b
                            : { ...b, exercises: b.exercises.filter((_, ri) => ri !== rowIndex) },
                        ),
                      )
                    }
                  />
                ))}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('builder.addExercise')}
                  onPress={() => {
                    setPendingBlockIndex(blockIndex);
                    router.push({
                      pathname: '/(app)/(tabs)/library',
                      params: { returnTo: 'builder', clientId: tree.client_id ?? '' },
                    });
                  }}
                  style={{
                    minHeight: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderStyle: 'dashed',
                    borderColor: theme.colors.border,
                    marginTop: theme.space[2],
                  }}
                >
                  <Text variant="caption" tone="muted">
                    + {t('builder.addExercise')}
                  </Text>
                </Pressable>
              </BuilderBlock>
            ))}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('builder.addBlock')}
              onPress={addBlock}
              style={{
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: theme.colors.border,
              }}
            >
              <Text variant="caption" tone="muted">
                + {t('builder.addBlock')}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <Row
        style={{
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: theme.space[3],
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
        }}
      >
        <View>
          <Text numeric variant="h3">
            {credits.balance ?? 0}
          </Text>
          <Text variant="caption" tone="muted">
            {t('credits.balanceLabel')}
          </Text>
        </View>
        <Button
          label={'✦ ' + t('ai.draftAction')}
          onPress={() =>
            router.push({
              pathname: '/(app)/programs/ai',
              params: { clientId: tree.client_id ?? '' },
            })
          }
        />
      </Row>

      {editing ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: theme.space[4],
            gap: theme.space[3],
            backgroundColor: theme.colors.surfaceRaised,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="label" tone="muted">
              {t('builder.cells.' + editing.key)}
            </Text>
            <Text numeric style={{ fontSize: 28, fontWeight: '700' }}>
              {buffer === '' ? '—' : buffer}
            </Text>
          </Row>

          {editing.key === 'tempo' ? (
            <View style={{ gap: theme.space[2] }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                {TEMPO_PRESETS.map((preset) => (
                  <Pressable
                    key={preset}
                    accessibilityRole="button"
                    accessibilityLabel={preset}
                    onPress={() => setBuffer(preset)}
                    style={{
                      minHeight: 44,
                      paddingHorizontal: theme.space[3],
                      justifyContent: 'center',
                      borderRadius: theme.radius.pill,
                      borderWidth: 1,
                      borderColor: buffer === preset ? theme.colors.accent : theme.colors.border,
                    }}
                  >
                    <Text numeric variant="caption" style={{ fontWeight: '700' }}>
                      {preset}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextField
                label={t('builder.keypad.tempoCustom')}
                value={buffer}
                onChangeText={setBuffer}
                autoCapitalize="none"
              />
            </View>
          ) : (
            <NumericKeypad
              onKey={(digit) => setBuffer((prev) => prev + digit)}
              onDelete={() => setBuffer((prev) => prev.slice(0, -1))}
              extraKey={
                editing.key === 'rpe'
                  ? { label: '.', onPress: () => setBuffer((prev) => (prev.includes('.') ? prev : prev + '.')) }
                  : editing.key === 'reps'
                    ? { label: '-', onPress: () => setBuffer((prev) => (prev.includes('-') ? prev : prev + '-')) }
                    : undefined
              }
            />
          )}

          <Row style={{ gap: theme.space[2] }}>
            <View style={{ flex: 1 }}>
              <Button label={t('builder.keypad.next')} variant="ghost" onPress={nextCell} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={t('builder.keypad.done')} onPress={closeCell} />
            </View>
          </Row>
        </View>
      ) : null}

      <Modal
        visible={copyWeekOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCopyWeekOpen(false)}
      >
        <Screen>
          <ScrollView contentContainerStyle={{ gap: theme.space[4] }}>
            <Text variant="h2">{t('builder.copyWeek.title', { week: week?.week_number ?? 1 })}</Text>
            {/* The warning is stated before the tap, not after it. */}
            <Banner variant="warn" message={t('builder.copyWeek.body')} />
            {draft.weeks
              .filter((w) => w.week_number !== week?.week_number)
              .map((target) => (
                <Button
                  key={target.week_number}
                  label={t('builder.copyWeek.targetLabel', { week: target.week_number })}
                  variant="ghost"
                  disabled={submitting}
                  onPress={() => void handleCopyWeek(target.week_number)}
                />
              ))}
            <Button label={t('builder.copyWeek.cancel')} variant="ghost" onPress={() => setCopyWeekOpen(false)} />
          </ScrollView>
        </Screen>
      </Modal>

      <Modal
        visible={confirmLeaveOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setConfirmLeaveOpen(false)}
      >
        <Screen>
          <View style={{ gap: theme.space[4] }}>
            <Text variant="h2">{t('builder.unsaved.title')}</Text>
            <Text tone="secondary">{t('builder.unsaved.body')}</Text>
            <Button
              label={t('builder.unsaved.confirm')}
              onPress={() => {
                setConfirmLeaveOpen(false);
                router.back();
              }}
            />
            <Button
              label={t('builder.unsaved.cancel')}
              variant="ghost"
              onPress={() => setConfirmLeaveOpen(false)}
            />
          </View>
        </Screen>
      </Modal>
    </Screen>
  );
}

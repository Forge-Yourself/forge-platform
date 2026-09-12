import {
  AI_EXPERIENCE_LEVELS,
  AI_GOALS,
  EQUIPMENT,
  formatSetSpec,
  type AiExperienceLevel,
  type AiGoal,
  type AiProgramDraftResponse,
  type Equipment,
} from '@forge/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { CreditSheet } from '../../../lib/ai/CreditSheet';
import { ProgramDraftError, requestProgramDraft } from '../../../lib/ai/requestProgramDraft';
import { useCreditBalance } from '../../../lib/ai/useCreditBalance';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { useClientList } from '../../../lib/clients/useClientList';
import { useAsyncSubmit } from '../../../lib/forms/useAsyncSubmit';
import { createProgramFromDraft } from '../../../lib/programs/programActions';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Banner,
  Button,
  Card,
  Row,
  Screen,
  Spinner,
  Text,
  TextField,
} from '../../../ui';

type Phase = 'prompt' | 'generating' | 'result';

/** The 12s budget the route holds itself to, used only to pace the checklist. */
const BUDGET_MS = 12_000;
const STEP_KEYS = ['ai.generating.step1', 'ai.generating.step2', 'ai.generating.step3', 'ai.generating.step4'];

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: 44,
        paddingHorizontal: theme.space[3],
        justifyContent: 'center',
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
      }}
    >
      <Text variant="caption" style={{ fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The AI draft flow: prompt, generating, result — the prototype's three
 * states, with one correction. The generating copy says "Usually under 12
 * seconds. Keep this screen open." rather than promising a notification:
 * the call is synchronous by design (EP-15's 12s budget is what makes a
 * Vercel route viable) and notifications are M9.
 *
 * Nothing is persisted until "Review in builder". Until that tap the draft
 * lives in this screen's state and nowhere else, which is exactly what makes
 * "AI never auto-publishes" true rather than merely intended.
 */
export default function AiDraft() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const params = useLocalSearchParams<{ clientId?: string }>();
  const clientId = params.clientId && params.clientId !== '' ? params.clientId : undefined;

  const credits = useCreditBalance(auth.user?.id);
  // The copy addresses the client by name ("before anything reaches Maya"),
  // so resolve it from the roster the PT already has rather than widening
  // program_tree() to carry a name it otherwise has no use for.
  const clients = useClientList(auth.user?.id, '', 'all');
  const clientName = clients.items.find((c) => c.id === clientId)?.displayName ?? '';

  const [phase, setPhase] = useState<Phase>('prompt');
  const [goal, setGoal] = useState<AiGoal>('strength');
  const [equipment, setEquipment] = useState<Equipment[]>(['barbell', 'dumbbell']);
  const [experience, setExperience] = useState<AiExperienceLevel>('intermediate');
  const [avoid, setAvoid] = useState('');
  const [draft, setDraft] = useState<AiProgramDraftResponse | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const { submitting, error, setError, run } = useAsyncSubmit();

  // An elapsed-time estimate, NOT server progress: the route reports nothing
  // until it returns. It exists so the four steps feel like they are moving;
  // the last one never ticks until the response actually lands.
  useEffect(() => {
    if (phase !== 'generating') return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 400);
    return () => clearInterval(timer);
  }, [phase]);

  const stepsDone = Math.min(STEP_KEYS.length - 1, Math.floor((elapsed / BUDGET_MS) * STEP_KEYS.length));

  async function handleGenerate() {
    setError(null);
    if (!clientId) {
      setError(t('ai.errors.forbidden'));
      return;
    }
    // credits.state, not creditState(balance ?? 0): the hook reports 'loading'
    // until the wallet lands, and a null balance is not the same answer as zero.
    if (credits.state === 'empty') {
      setSheetOpen(true);
      return;
    }

    setPhase('generating');
    setElapsed(0);
    await run(async () => {
      try {
        const response = await requestProgramDraft({
          clientId,
          goal,
          equipment,
          experience,
          avoid: avoid.trim() === '' ? undefined : avoid.trim(),
          weeks: 4,
        });
        setDraft(response);
        setPhase('result');
        await credits.refetch();
        if (response.lowBalance) setSheetOpen(true);
      } catch (err: unknown) {
        const failure =
          err instanceof ProgramDraftError
            ? err.failure
            : { errorKey: 'ai.errors.generic', charged: false };
        setError(t(failure.errorKey));
        setPhase('prompt');
        if (failure.errorKey === 'ai.errors.insufficientCredits') setSheetOpen(true);
        await credits.refetch();
      }
    });
  }

  async function handleReviewInBuilder() {
    if (!draft || !clientId) return;
    await run(async () => {
      try {
        const programId = await createProgramFromDraft(clientId, draft.generationId, draft.draft);
        router.replace({ pathname: '/(app)/programs/[id]/builder', params: { id: programId } });
      } catch {
        setError(t('ai.errors.generic'));
      }
    });
  }

  const draftRows =
    draft?.draft.weeks[0]?.days.flatMap((day) => day.blocks.flatMap((block) => block.exercises)) ?? [];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: theme.space[4] }} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          {/* Only in the prompt phase: once a draft exists, leaving is the Discard
              flow at the bottom, which confirms first. */}
          {phase === 'prompt' ? (
            <Button label={t('common.back')} variant="ghost" size="md" onPress={() => router.back()} />
          ) : null}
          <Text variant="h2">✦ {t('ai.draftAction')}</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text numeric variant="h3">
              {credits.state === 'loading' ? '—' : (credits.balance ?? 0)}
            </Text>
            <Text variant="caption" tone="muted">
              {t('credits.balanceLabel')}
            </Text>
          </View>
        </Row>

        {error ? <Banner variant="danger" message={error} /> : null}

        {phase === 'prompt' ? (
          <>
            <Text tone="secondary">{t('ai.intro', { name: clientName })}</Text>

            <View style={{ gap: theme.space[2] }}>
              <Text variant="label" tone="muted">
                {t('ai.goalLabel')}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                {AI_GOALS.map((value) => (
                  <Chip
                    key={value}
                    label={t('ai.goalLabels.' + value)}
                    selected={goal === value}
                    onPress={() => setGoal(value)}
                  />
                ))}
              </View>
            </View>

            <View style={{ gap: theme.space[2] }}>
              <Text variant="label" tone="muted">
                {t('ai.equipmentLabel')}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                {EQUIPMENT.map((value) => (
                  <Chip
                    key={value}
                    label={t('library.equipmentLabels.' + value)}
                    selected={equipment.includes(value)}
                    onPress={() =>
                      setEquipment((prev) =>
                        prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value],
                      )
                    }
                  />
                ))}
              </View>
            </View>

            <View style={{ gap: theme.space[2] }}>
              <Text variant="label" tone="muted">
                {t('ai.experienceLabel')}
              </Text>
              <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
                {AI_EXPERIENCE_LEVELS.map((value) => (
                  <Chip
                    key={value}
                    label={t('ai.experienceLabels.' + value)}
                    selected={experience === value}
                    onPress={() => setExperience(value)}
                  />
                ))}
              </View>
            </View>

            <TextField
              label={t('ai.avoidLabel')}
              placeholder={t('ai.avoidPlaceholder')}
              value={avoid}
              onChangeText={setAvoid}
              multiline
            />

            <Button
              label={t('ai.creditCost')}
              size="lg"
              disabled={submitting || equipment.length === 0 || credits.state === 'loading'}
              onPress={() => void handleGenerate()}
            />
          </>
        ) : null}

        {phase === 'generating' ? (
          <View style={{ gap: theme.space[4], alignItems: 'center', paddingVertical: theme.space[8] }}>
            <Spinner />
            <Text variant="h3">{t('ai.generating.title')}</Text>
            <Text tone="secondary" style={{ textAlign: 'center' }}>
              {t('ai.generating.body')}
            </Text>
            <View style={{ gap: theme.space[2], alignSelf: 'stretch' }}>
              {STEP_KEYS.map((key, index) => (
                <Row key={key} style={{ gap: theme.space[2], alignItems: 'center' }}>
                  <Text numeric tone={index < stepsDone ? 'accent' : 'muted'}>
                    {index < stepsDone ? '✓' : '·'}
                  </Text>
                  <Text tone={index < stepsDone ? 'primary' : 'muted'} style={{ flex: 1 }}>
                    {t(key, { name: clientName })}
                  </Text>
                </Row>
              ))}
            </View>
          </View>
        ) : null}

        {phase === 'result' && draft ? (
          <>
            <Banner variant="warn" message={t('ai.result.warning')} />
            <Text variant="bodyBold">{draft.draft.summary}</Text>

            <Card>
              {draftRows.map((exercise, index) => (
                <View key={exercise.exercise_id + ':' + index} style={{ gap: 2, paddingVertical: theme.space[2] }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text variant="bodyBold" style={{ flex: 1 }} numberOfLines={1}>
                      {exercise.exercise_name}
                    </Text>
                    <Text numeric tone="secondary">
                      {formatSetSpec(exercise)}
                    </Text>
                  </Row>
                  {/* The rationale is the whole point of the review moment —
                      and it is deliberately never persisted with the program. */}
                  <Text variant="caption" tone="secondary" style={{ fontSize: 12.5 }}>
                    {exercise.why}
                  </Text>
                </View>
              ))}
            </Card>

            <Button
              label={t('ai.result.reviewInBuilder')}
              size="lg"
              disabled={submitting}
              onPress={() => void handleReviewInBuilder()}
            />
            <Button
              label={t('ai.result.redraft')}
              variant="ghost"
              disabled={submitting}
              onPress={() => {
                setDraft(null);
                setPhase('prompt');
              }}
            />
            <Button
              label={t('ai.result.discard')}
              variant="ghost"
              onPress={() => setDiscardOpen(true)}
            />
          </>
        ) : null}
      </ScrollView>

      <CreditSheet
        visible={sheetOpen}
        balance={credits.balance ?? 0}
        onDismiss={() => setSheetOpen(false)}
      />

      {discardOpen ? (
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
          <Text variant="h3">{t('ai.result.discardTitle')}</Text>
          <Text tone="secondary">{t('ai.result.discardBody')}</Text>
          <Button
            label={t('ai.result.discardConfirm')}
            onPress={() => {
              setDiscardOpen(false);
              setDraft(null);
              router.back();
            }}
          />
          <Button
            label={t('ai.result.discardCancel')}
            variant="ghost"
            onPress={() => setDiscardOpen(false)}
          />
        </View>
      ) : null}
    </Screen>
  );
}

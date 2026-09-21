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
import { Animated, Easing, Modal, Pressable, ScrollView, View } from 'react-native';
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
  FooterBar,
  Icon,
  NavHeader,
  Row,
  Screen,
  SectionLabel,
  Tag,
  Text,
  TextField,
} from '../../../ui';

type Phase = 'prompt' | 'generating' | 'result';

/** The 12s budget the route holds itself to, used only to pace the checklist. */
const BUDGET_MS = 12_000;
const STEP_KEYS = ['ai.generating.step1', 'ai.generating.step2', 'ai.generating.step3', 'ai.generating.step4'];

/**
 * A rotating ember arc, not the platform spinner.
 *
 * This is the one screen where the wait is the content: twelve seconds of a
 * synchronous call, with a four-step checklist ticking underneath. A 20pt
 * ActivityIndicator above an 18pt heading reads as a screen that is stuck; a
 * 56pt ring reads as work in progress.
 */
function LoadingRing() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [spin] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  return (
    <Animated.View
      accessible
      accessibilityLabel={t('common.loading')}
      style={{
        width: 56,
        height: 56,
        borderRadius: 28,
        borderWidth: 3,
        borderColor: theme.colors.border,
        borderTopColor: theme.colors.accent,
        transform: [
          { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
        ],
      }}
    />
  );
}

/** Pill chip for goal and equipment — multi-value sets where the label sizes the target. */
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: 44,
        paddingHorizontal: 15,
        justifyContent: 'center',
        borderRadius: theme.radius.pill,
        borderWidth: 1.5,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
      }}
    >
      <Text
        style={{
          fontSize: 13.5,
          fontWeight: '600',
          color: selected ? theme.colors.onAccentSurfaceSoft : theme.colors.textSecondary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Experience is three mutually exclusive levels, so it renders as one segmented
 * row of equal-width rectangles rather than three pills of different widths —
 * the shape says "pick one of these three", which pills do not.
 */
function LevelRow({
  values,
  selected,
  labelFor,
  onSelect,
}: {
  values: readonly AiExperienceLevel[];
  selected: AiExperienceLevel;
  labelFor: (value: AiExperienceLevel) => string;
  onSelect: (value: AiExperienceLevel) => void;
}) {
  const theme = useTheme();
  return (
    <Row style={{ gap: 6 }}>
      {values.map((value) => {
        const isSelected = value === selected;
        return (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityLabel={labelFor(value)}
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(value)}
            style={{
              flex: 1,
              minHeight: 46,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 4,
              borderRadius: theme.radius.md,
              borderWidth: 1.5,
              borderColor: isSelected ? theme.colors.accent : theme.colors.border,
              backgroundColor: isSelected ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: isSelected ? theme.colors.onAccentSurfaceSoft : theme.colors.textSecondary,
              }}
            >
              {labelFor(value)}
            </Text>
          </Pressable>
        );
      })}
    </Row>
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
 *
 * Each phase owns the footer: the cost sits under the prompt, and Redraft /
 * Review sit under the result. Both used to be the last two of five stacked
 * buttons at the end of the scroll body.
 */
export default function AiDraft() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const params = useLocalSearchParams<{ clientId?: string }>();
  // Seeded from the route when the builder opens this screen for one client;
  // chosen on-screen when Today's "Draft with AI" tile opens it with none.
  // Without this, Generate could only ever fail with "not this client's trainer".
  const [clientId, setClientId] = useState<string | undefined>(
    params.clientId && params.clientId !== '' ? params.clientId : undefined,
  );
  const pickClient = params.clientId === undefined || params.clientId === '';

  const credits = useCreditBalance(auth.user?.id);
  // The copy addresses the client by name ("before anything reaches Maya"),
  // so resolve it from the roster the PT already has rather than widening
  // program_tree() to carry a name it otherwise has no use for.
  const clients = useClientList(auth.user?.id, '', 'all');
  // The self row is held out of `items`, so put it back with its own label —
  // otherwise a PT arriving here from their own record would see the no-client
  // copy and no way to pick themselves.
  const draftable =
    clients.selfItem !== null
      ? [{ ...clients.selfItem, displayName: t('me.label') }, ...clients.items]
      : clients.items;
  const clientName = draftable.find((c) => c.id === clientId)?.displayName ?? '';
  const activeClients = draftable.filter((c) => c.state === 'active');

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
      setError(t('ai.errors.noClient'));
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
    <Screen padded={false}>
      <NavHeader
        title={
          <Row style={{ gap: 6 }}>
            <Icon name="sparkle" size={15} color={theme.colors.accentText} />
            <Text accessibilityRole="header" numberOfLines={1} style={{ fontSize: 15, fontWeight: '700' }}>
              {t('ai.draftAction')}
            </Text>
          </Row>
        }
        leading={
          // Only in the prompt phase: once a draft exists, leaving is the Discard
          // flow at the bottom, which confirms first.
          phase === 'prompt' ? (
            <Button label={t('common.cancel')} variant="link" onPress={() => router.back()} />
          ) : undefined
        }
        trailing={
          <Tag
            numeric
            tone="accent"
            accessibilityLabel={t('credits.balanceLabel')}
            label={credits.state === 'loading' ? '—' : String(credits.balance ?? 0)}
          />
        }
      />

      {phase === 'prompt' ? (
        <>
          <ScrollView
            contentContainerStyle={{ padding: theme.space[4], gap: theme.space[5] }}
            keyboardShouldPersistTaps="handled"
          >
            {error ? <Banner variant="danger" message={error} /> : null}

            <Text tone="secondary" style={{ fontSize: 13.5, lineHeight: 21 }}>
              {clientName === '' ? t('ai.introNoClient') : t('ai.intro', { name: clientName })}
            </Text>

            {pickClient ? (
              <View style={{ gap: theme.space[2] }}>
                <SectionLabel>{t('ai.clientLabel')}</SectionLabel>
                {activeClients.length === 0 && !clients.loading ? (
                  <Text tone="muted" style={{ fontSize: 13 }}>
                    {t('ai.clientEmpty')}
                  </Text>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                    {activeClients.map((c) => (
                      <Chip
                        key={c.id}
                        label={c.displayName}
                        selected={clientId === c.id}
                        onPress={() => {
                          setError(null);
                          setClientId(c.id);
                        }}
                      />
                    ))}
                  </View>
                )}
              </View>
            ) : null}

            <View style={{ gap: theme.space[2] }}>
              <SectionLabel>{t('ai.goalLabel')}</SectionLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
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
              <SectionLabel>{t('ai.equipmentLabel')}</SectionLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
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
              <SectionLabel>{t('ai.experienceLabel')}</SectionLabel>
              <LevelRow
                values={AI_EXPERIENCE_LEVELS}
                selected={experience}
                labelFor={(value) => t('ai.experienceLabels.' + value)}
                onSelect={setExperience}
              />
            </View>

            <TextField
              label={t('ai.avoidLabel')}
              placeholder={t('ai.avoidPlaceholder')}
              value={avoid}
              onChangeText={setAvoid}
              multiline
            />
          </ScrollView>

          <FooterBar>
            <Button
              label={t('ai.creditCost')}
              icon="sparkle"
              size="lg"
              disabled={equipment.length === 0 || credits.state === 'loading'}
              loading={submitting}
              onPress={() => void handleGenerate()}
            />
          </FooterBar>
        </>
      ) : null}

      {phase === 'generating' ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.space[4],
            padding: theme.space[6],
          }}
        >
          <LoadingRing />
          <Text variant="h3">{t('ai.generating.title')}</Text>
          <Text tone="secondary" style={{ textAlign: 'center', maxWidth: 260, lineHeight: 20 }}>
            {t('ai.generating.body')}
          </Text>
          <View style={{ gap: 9, marginTop: theme.space[1], width: '100%', maxWidth: 260 }}>
            {STEP_KEYS.map((key, index) => {
              const done = index < stepsDone;
              return (
                <Row key={key} style={{ gap: 9 }}>
                  <View
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 8,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: done ? theme.colors.accent : theme.colors.surfaceSunken,
                    }}
                  >
                    {done ? (
                      <Icon name="check" size={10} color={theme.colors.onAccent} strokeWidth={3} />
                    ) : null}
                  </View>
                  <Text
                    style={{ flex: 1, fontSize: 13, fontWeight: '500' }}
                    tone={done ? 'primary' : 'muted'}
                  >
                    {t(key, { name: clientName })}
                  </Text>
                </Row>
              );
            })}
          </View>
        </View>
      ) : null}

      {phase === 'result' && draft ? (
        <>
          <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[3] }}>
            {error ? <Banner variant="danger" message={error} /> : null}
            <Banner variant="warn" message={t('ai.result.warning')} />

            <Text style={{ fontSize: 20, fontWeight: '800', letterSpacing: -0.3 }}>
              {draft.draft.summary}
            </Text>

            {draftRows.map((exercise, index) => (
              <View
                key={exercise.exercise_id + ':' + index}
                style={{
                  padding: theme.space[3] + 2,
                  borderRadius: theme.radius.lg - 2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surfaceRaised,
                  gap: 5,
                }}
              >
                <Row style={{ gap: theme.space[2] }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 14.5, fontWeight: '700' }}>
                    {exercise.exercise_name}
                  </Text>
                  <Text numeric style={{ fontSize: 13, fontWeight: '700' }}>
                    {formatSetSpec(exercise)}
                  </Text>
                </Row>
                {/* The rationale is the whole point of the review moment —
                    and it is deliberately never persisted with the program. */}
                <Text tone="muted" style={{ fontSize: 12, lineHeight: 18 }}>
                  {exercise.why}
                </Text>
              </View>
            ))}

            <Button
              label={t('ai.result.discard')}
              variant="link"
              tone="danger"
              onPress={() => setDiscardOpen(true)}
              style={{ alignSelf: 'center', marginTop: theme.space[2] }}
            />
          </ScrollView>

          <FooterBar>
            <Row style={{ gap: theme.space[2] }}>
              <Button
                label={t('ai.result.redraft')}
                variant="ghost"
                size="lg"
                disabled={submitting}
                onPress={() => {
                  setDraft(null);
                  setPhase('prompt');
                }}
              />
              <Button
                label={t('ai.result.reviewInBuilder')}
                size="lg"
                loading={submitting}
                onPress={() => void handleReviewInBuilder()}
                style={{ flex: 1 }}
              />
            </Row>
          </FooterBar>
        </>
      ) : null}

      <CreditSheet
        visible={sheetOpen}
        balance={credits.balance ?? 0}
        onDismiss={() => setSheetOpen(false)}
      />

      <Modal
        visible={discardOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setDiscardOpen(false)}
      >
        {/* The dismiss target is a SIBLING behind the sheet, not its ancestor.
            Nested, React Native's responder negotiation walked every press that
            no child claimed — the sheet's padding, its title, its body copy —
            up to this Pressable and silently cancelled the confirmation. And
            because Pressable sets `accessible` and groups its children,
            VoiceOver announced the entire sheet as one "Cancel" button, leaving
            the destructive Discard control unreachable. This is the only
            transparent Modal in the app; the four pageSheet ones are unaffected. */}
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('ai.result.discardCancel')}
            onPress={() => setDiscardOpen(false)}
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
            <Text variant="h3">{t('ai.result.discardTitle')}</Text>
            <Text tone="secondary">{t('ai.result.discardBody')}</Text>
            <Button
              label={t('ai.result.discardConfirm')}
              tone="danger"
              size="lg"
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
        </View>
      </Modal>
    </Screen>
  );
}

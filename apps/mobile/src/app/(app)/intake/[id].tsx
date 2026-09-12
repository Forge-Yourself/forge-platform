import type { IntakeResponses } from '@forge/shared';
import { evaluateParq, intakeCompletion, PARQ_QUESTIONS } from '@forge/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAsyncSubmit } from '../../../lib/forms/useAsyncSubmit';
import { useIntakeForm } from '../../../lib/intake/useIntakeForm';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Banner,
  Button,
  ChipRow,
  FormScreen,
  Row,
  SectionCard,
  ListRow,
  SegmentedPill,
  Spinner,
  StepProgress,
  Text,
  TextField,
  YesNoCard,
} from '../../../ui';

const TOTAL_STEPS = 5;
const DIETARY_OPTIONS = ['vegetarian', 'vegan', 'halal', 'kosher', 'gluten_free', 'dairy_free', 'nut_allergy'] as const;

function emptyResponses(): IntakeResponses {
  return {
    parq: Object.fromEntries(PARQ_QUESTIONS.map((q) => [q, undefined])) as never,
    goals: {},
    history: {},
    anthropometrics: {},
    dietary: {},
  };
}

/** The three free-typed number fields, tracked as raw text — see NumericField below. */
type NumericFieldKey = 'years_training' | 'height_cm' | 'weight_kg';
type NumericText = Record<NumericFieldKey, string>;

const EMPTY_NUMERIC_TEXT: NumericText = { years_training: '', height_cm: '', weight_kg: '' };

/** Digits and at most one decimal point. Everything else never reaches state. */
function sanitizeDecimal(input: string): string {
  const cleaned = input.replace(/[^0-9.]/g, '');
  const [whole, ...fraction] = cleaned.split('.');
  return fraction.length > 0 ? `${whole}.${fraction.join('')}` : whole;
}

/**
 * Raw text -> the number to store, or undefined for "not answered".
 *
 * `allowZero` mirrors the schemas exactly: historyResponsesSchema has
 * `years_training: z.number().nonnegative()` (a beginner really has trained zero
 * years), anthropometricsResponsesSchema has `height_cm`/`weight_kg` as
 * `.positive()` (nobody weighs nothing). A value the schema would reject is stored
 * as undefined rather than written through to be rejected later at submit.
 */
function parseDecimal(input: string, allowZero: boolean): number | undefined {
  if (input.trim() === '') return undefined;
  const value = Number(input);
  if (!Number.isFinite(value)) return undefined;
  if (allowZero ? value < 0 : value <= 0) return undefined;
  return value;
}

/**
 * The client's resumable 5-step intake. Two modes: `resume` (shown once on
 * opening a row that already has saved progress, per the annotation) and
 * `wizard` (the step-by-step form). A brand-new `pending` row skips straight
 * to the wizard — there's nothing to resume yet.
 */
export default function Intake() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const { loading, error, row, saveProgress, submit } = useIntakeForm(params.id);
  const { submitting, error: submitError, setError: setSubmitError, run } = useAsyncSubmit();

  const [mode, setMode] = useState<'resume' | 'wizard' | null>(null);
  const [step, setStep] = useState(1);
  const [responses, setResponses] = useState<IntakeResponses>(emptyResponses());
  /**
   * The number fields are edited as TEXT and only parsed into `responses` on the way
   * through. Deriving the input's value from the parsed number instead made two
   * things impossible: `Number('')` is 0 and `Number.isFinite(0)` is true, so clearing
   * a field stored a literal zero rather than "not answered"; and typing "72." parsed
   * to 72 and repainted the field as "72", swallowing the decimal point, so no client
   * could ever enter 72.5 kg. Same separation the program builder's cell buffer uses.
   */
  const [numericText, setNumericText] = useState<NumericText>(EMPTY_NUMERIC_TEXT);
  // Tracks which row.id the setState calls below have already seeded
  // from, so they run exactly once per fetched row.
  const [seededRowId, setSeededRowId] = useState<string | null>(null);

  // Adjusting state during render (react.dev's own pattern for "initialize
  // state from a prop that arrives asynchronously") rather than a useEffect —
  // an effect body calling setState synchronously for a derived value like
  // this trips react-hooks/set-state-in-effect. React re-renders immediately
  // when state changes during render, before the browser/native paints, so
  // this doesn't flash the unseeded state.
  if (row && row.id !== seededRowId) {
    const seeded = { ...emptyResponses(), ...((row.responses as Partial<IntakeResponses>) ?? {}) };
    setSeededRowId(row.id);
    setResponses(seeded);
    setNumericText({
      years_training: seeded.history?.years_training?.toString() ?? '',
      height_cm: seeded.anthropometrics?.height_cm?.toString() ?? '',
      weight_kg: seeded.anthropometrics?.weight_kg?.toString() ?? '',
    });
    setMode(row.state === 'in_progress' ? 'resume' : 'wizard');
  }

  if (loading || mode === null) {
    return (
      <FormScreen>
        <Spinner />
      </FormScreen>
    );
  }

  if (error || !row) {
    return (
      <FormScreen>
        <Banner variant="danger" message={error ?? 'Not found'} />
      </FormScreen>
    );
  }

  const completion = intakeCompletion(responses);
  const stepIds = ['parq', 'goals', 'history', 'anthropometrics', 'dietary'] as const;

  function goToFirstIncompleteStep() {
    const firstIncomplete = stepIds.findIndex((id) => !completion.stepStatus[id]);
    setStep(firstIncomplete === -1 ? TOTAL_STEPS : firstIncomplete + 1);
    setMode('wizard');
  }

  async function handleSaveAndExit() {
    setSubmitError(null);
    await run(async () => {
      try {
        await saveProgress(currentSectionPartial());
        router.replace('/');
      } catch {
        setSubmitError(t('intake.submitError'));
      }
    });
  }

  function currentSectionPartial(): Partial<IntakeResponses> {
    switch (step) {
      case 1:
        return { parq: responses.parq };
      case 2:
        return { goals: responses.goals };
      case 3:
        return { history: responses.history };
      case 4:
        return { anthropometrics: responses.anthropometrics };
      case 5:
        return { dietary: responses.dietary };
      default:
        return {};
    }
  }

  async function handleContinue() {
    setSubmitError(null);
    await run(async () => {
      try {
        await saveProgress(currentSectionPartial());
        if (step < TOTAL_STEPS) {
          setStep(step + 1);
        }
      } catch {
        setSubmitError(t('intake.submitError'));
      }
    });
  }

  async function handleSubmit() {
    if (!row) return;
    const intakeId = row.id;
    setSubmitError(null);
    await run(async () => {
      try {
        await saveProgress(currentSectionPartial());
        await submit({ ...responses, dietary: responses.dietary });
        router.push({ pathname: '/(app)/intake/[id]/waiver', params: { id: intakeId } });
      } catch {
        setSubmitError(t('intake.submitError'));
      }
    });
  }

  const parqComplete = PARQ_QUESTIONS.every((q) => responses.parq[q] !== undefined);

  if (mode === 'resume') {
    return (
      <FormScreen
        footer={
          <Button label={t('intake.resume.continueButton')} onPress={goToFirstIncompleteStep} size="lg" />
        }
      >
        <Text variant="h1" style={{ marginBottom: theme.space[2] }}>
          {t('intake.resume.title')}
        </Text>
        <Text tone="secondary" style={{ marginBottom: theme.space[5] }}>
          {t('intake.resume.privacyNote')}
        </Text>
        <Text variant="label" tone="muted" style={{ marginBottom: theme.space[2] }}>
          {t('intake.resume.checklistNote')}
        </Text>
        <SectionCard>
          {stepIds.map((id, i) => (
            <ListRow
              key={id}
              title={t(`intake.steps.${id}`)}
              trailing={<Text tone={completion.stepStatus[id] ? 'accent' : 'muted'}>{completion.stepStatus[id] ? '✓' : '—'}</Text>}
              isLast={i === stepIds.length - 1}
            />
          ))}
        </SectionCard>
      </FormScreen>
    );
  }

  return (
    <FormScreen
      footer={
        <Row style={{ gap: theme.space[3] }}>
          {step > 1 ? (
            <Button label={t('common.back')} variant="ghost" onPress={() => setStep(step - 1)} style={{ flex: 1 }} />
          ) : null}
          <Button
            label={
              submitting
                ? t('intake.submitting')
                : step === TOTAL_STEPS
                  ? t('intake.submit')
                  : t('intake.continue')
            }
            onPress={() => void (step === TOTAL_STEPS ? handleSubmit() : handleContinue())}
            disabled={submitting || (step === 1 && !parqComplete)}
            style={{ flex: 2 }}
          />
        </Row>
      }
    >
      <StepProgress
        segments={TOTAL_STEPS}
        progress={step / TOTAL_STEPS}
        label={t('intake.stepOf', { step, total: TOTAL_STEPS })}
      />
      <Text variant="label" tone="muted" style={{ marginTop: theme.space[2], marginBottom: theme.space[4] }}>
        {t('intake.stepOf', { step, total: TOTAL_STEPS })}
      </Text>

      {submitError ? <Banner variant="danger" message={submitError} /> : null}

      {step === 1 ? (
        <>
          <Text tone="secondary" style={{ marginBottom: theme.space[4] }}>
            {t('intake.parq.intro')}
          </Text>
          {PARQ_QUESTIONS.map((q) => (
            <YesNoCard
              key={q}
              question={t(`intake.parq.${q}`)}
              value={responses.parq[q] ?? null}
              yesLabel={t('intake.parq.yes')}
              noLabel={t('intake.parq.no')}
              flagged={evaluateParq(responses.parq).includes(q)}
              flaggedNote={t('intake.parq.flaggedNote')}
              onChange={(value) =>
                setResponses((prev) => ({ ...prev, parq: { ...prev.parq, [q]: value } }))
              }
            />
          ))}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <TextField
            label={t('intake.goals.primaryGoalLabel')}
            placeholder={t('intake.goals.primaryGoalPlaceholder')}
            value={responses.goals?.primary_goal ?? ''}
            onChangeText={(v) => setResponses((prev) => ({ ...prev, goals: { ...prev.goals, primary_goal: v } }))}
          />
          <TextField
            label={t('intake.goals.targetDateLabel')}
            placeholder="YYYY-MM-DD"
            value={responses.goals?.target_date ?? ''}
            onChangeText={(v) => setResponses((prev) => ({ ...prev, goals: { ...prev.goals, target_date: v } }))}
          />
          <TextField
            label={t('intake.goals.motivationLabel')}
            value={responses.goals?.motivation ?? ''}
            onChangeText={(v) => setResponses((prev) => ({ ...prev, goals: { ...prev.goals, motivation: v } }))}
            multiline
          />
        </>
      ) : null}

      {step === 3 ? (
        <>
          <TextField
            label={t('intake.history.yearsTrainingLabel')}
            value={numericText.years_training}
            onChangeText={(v) => {
              const text = sanitizeDecimal(v);
              setNumericText((prev) => ({ ...prev, years_training: text }));
              setResponses((prev) => ({
                ...prev,
                history: { ...prev.history, years_training: parseDecimal(text, true) },
              }));
            }}
            keyboardType="decimal-pad"
          />
          <TextField
            label={t('intake.history.injuriesLabel')}
            value={responses.history?.injuries ?? ''}
            onChangeText={(v) => setResponses((prev) => ({ ...prev, history: { ...prev.history, injuries: v } }))}
            multiline
          />
          <TextField
            label={t('intake.history.previousProgramsLabel')}
            value={responses.history?.previous_programs ?? ''}
            onChangeText={(v) =>
              setResponses((prev) => ({ ...prev, history: { ...prev.history, previous_programs: v } }))
            }
            multiline
          />
        </>
      ) : null}

      {step === 4 ? (
        <>
          <TextField
            label={t('intake.anthropometrics.dateOfBirthLabel')}
            placeholder="YYYY-MM-DD"
            value={responses.anthropometrics?.date_of_birth ?? ''}
            onChangeText={(v) =>
              setResponses((prev) => ({ ...prev, anthropometrics: { ...prev.anthropometrics, date_of_birth: v } }))
            }
          />
          <Text variant="label" tone="muted" style={{ marginBottom: theme.space[2] }}>
            {t('intake.anthropometrics.sexLabel')}
          </Text>
          <SegmentedPill
            items={[
              { value: 'male', label: t('intake.anthropometrics.sexMale') },
              { value: 'female', label: t('intake.anthropometrics.sexFemale') },
            ]}
            selected={responses.anthropometrics?.sex ?? ''}
            onChange={(v) =>
              setResponses((prev) => ({
                ...prev,
                anthropometrics: { ...prev.anthropometrics, sex: v as 'male' | 'female' },
              }))
            }
          />
          <TextField
            label={t('intake.anthropometrics.heightLabel')}
            value={numericText.height_cm}
            onChangeText={(v) => {
              const text = sanitizeDecimal(v);
              setNumericText((prev) => ({ ...prev, height_cm: text }));
              setResponses((prev) => ({
                ...prev,
                anthropometrics: { ...prev.anthropometrics, height_cm: parseDecimal(text, false) },
              }));
            }}
            keyboardType="decimal-pad"
          />
          <TextField
            label={t('intake.anthropometrics.weightLabel')}
            value={numericText.weight_kg}
            onChangeText={(v) => {
              const text = sanitizeDecimal(v);
              setNumericText((prev) => ({ ...prev, weight_kg: text }));
              setResponses((prev) => ({
                ...prev,
                anthropometrics: { ...prev.anthropometrics, weight_kg: parseDecimal(text, false) },
              }));
            }}
            keyboardType="decimal-pad"
          />
        </>
      ) : null}

      {step === 5 ? (
        <>
          <Text variant="label" tone="muted" style={{ marginBottom: theme.space[2] }}>
            {t('intake.dietary.restrictionsLabel')}
          </Text>
          <ChipRow
            options={DIETARY_OPTIONS.map((o) => t(`intake.dietary.restriction_${o}`))}
            selected={(responses.dietary?.restrictions ?? []).map((r) => t(`intake.dietary.restriction_${r}`))}
            onToggle={(label) => {
              const option = DIETARY_OPTIONS.find((o) => t(`intake.dietary.restriction_${o}`) === label);
              if (!option) return;
              setResponses((prev) => {
                const current = prev.dietary?.restrictions ?? [];
                const next = current.includes(option)
                  ? current.filter((r) => r !== option)
                  : [...current, option];
                return { ...prev, dietary: { ...prev.dietary, restrictions: next } };
              });
            }}
          />
          <TextField
            label={t('intake.dietary.notesLabel')}
            value={responses.dietary?.notes ?? ''}
            onChangeText={(v) => setResponses((prev) => ({ ...prev, dietary: { ...prev.dietary, notes: v } }))}
            multiline
          />
        </>
      ) : null}

      <Button
        label={t('intake.saveAndExit')}
        variant="ghost"
        onPress={() => void handleSaveAndExit()}
        disabled={submitting}
        style={{ marginTop: theme.space[5] }}
      />
    </FormScreen>
  );
}

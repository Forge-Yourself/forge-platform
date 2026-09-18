import type { IntakeNumericField, IntakeResponses } from '@forge/shared';
import {
  checkCalendarDate,
  checkNumericField,
  evaluateParq,
  intakeCompletion,
  intakeDateBounds,
  intakeResponsesSchema,
  INTAKE_LIMITS,
  PARQ_QUESTIONS,
} from '@forge/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useAsyncSubmit } from '../../../lib/forms/useAsyncSubmit';
import { useIntakeForm } from '../../../lib/intake/useIntakeForm';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Banner,
  Button,
  ChipRow,
  DateField,
  FormScreen,
  Icon,
  ListRow,
  NavHeader,
  Row,
  SectionCard,
  SectionLabel,
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

/** The three free-typed number fields, tracked as raw text — see parseNumeric below. */
type NumericText = Record<IntakeNumericField, string>;

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
 * The accept/reject rule is `checkNumericField` in @forge/shared, built from the
 * same INTAKE_LIMITS the zod schemas are, and the same one `numericError` below
 * renders a message for. This function used to carry its own copy of the bounds —
 * a bare `allowZero` flag — and silently stored undefined for anything it
 * disliked, so a client who typed 1750 for their height saw the field keep the
 * digits, saw no complaint, and had nothing recorded.
 */
function parseNumeric(input: string, field: IntakeNumericField): number | undefined {
  if (input.trim() === '' || checkNumericField(input, field) !== null) return undefined;
  return Number(input.trim());
}

/**
 * The client's resumable 5-step intake. Two modes: `resume` (shown once on
 * opening a row that already has saved progress, per the annotation) and
 * `wizard` (the step-by-step form). A brand-new `pending` row skips straight
 * to the wizard — there's nothing to resume yet.
 */
export default function Intake() {
  const { t, i18n } = useTranslation();
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
    // "Welcome back / what you've saved so far" only earns its place when something
    // really is saved. saveProgress() flips the row to in_progress on the first
    // Save & exit even if the client answered nothing, so state alone would show a
    // resume checklist with five empty rows.
    const saved = intakeCompletion(seeded).answered > 0;
    setMode(row.state === 'in_progress' && saved ? 'resume' : 'wizard');
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

    /**
     * The safeParse-before-write every other form in this app already does —
     * invite.tsx, library/custom.tsx, profile-edit.tsx, settings, sign-in,
     * sign-up, forgot-password, reset-password, the builder and
     * CertificationsEditor. This screen was the one exception: the seven zod
     * schemas in packages/shared/src/schemas/intake.ts had exactly one consumer
     * repo-wide, and it was intake.test.ts. The server gate added in migration
     * 0013 is the real one; this is what turns its 23514 into a message about
     * the form rather than a generic failure.
     */
    const parsed = intakeResponsesSchema.safeParse(responses);
    if (!parsed.success) {
      setSubmitError(t('intake.validation.formIncomplete'));
      return;
    }

    await run(async () => {
      try {
        await saveProgress(currentSectionPartial());
        await submit(parsed.data);
        // replace, not push: the form is submitted now, so it must not sit behind
        // the waiver as a back target that would re-open an already-submitted form.
        router.replace({ pathname: '/(app)/intake/[id]/waiver', params: { id: intakeId } });
      } catch {
        setSubmitError(t('intake.submitError'));
      }
    });
  }

  const parqComplete = PARQ_QUESTIONS.every((q) => responses.parq[q] !== undefined);

  const dateBounds = intakeDateBounds();

  /**
   * Every unresolved inline problem on the step currently shown.
   *
   * Before this, dateError()/numericError() fed the fields' `error` prop and
   * NOTHING else: Continue stayed enabled, and parseNumeric returned undefined
   * for anything checkNumericField disliked, so a client typed 1750 cm, saw the
   * red line, tapped Continue, and saveProgress wrote a `responses` object with
   * height_cm simply absent — the value visible on screen, gone from the record,
   * with no way to tell it had been dropped. Blocking is what makes the message
   * mean something; clearing the field is always available, since empty is a
   * valid "not answered" for every field here except PAR-Q.
   */
  function stepProblems(current: number): string[] {
    const problems =
      current === 2
        ? [dateError(responses.goals?.target_date, dateBounds.target_date)]
        : current === 3
          ? [numericError('years_training')]
          : current === 4
            ? [
                dateError(responses.anthropometrics?.date_of_birth, dateBounds.date_of_birth),
                numericError('height_cm'),
                numericError('weight_kg'),
              ]
            : [];
    return problems.filter((message): message is string => message !== undefined);
  }

  const stepBlocked = stepProblems(step).length > 0;

  const pickerLabels = {
    open: t('common.datePicker.open'),
    title: t('common.datePicker.title'),
    clear: t('common.datePicker.clear'),
    done: t('common.datePicker.done'),
    previousMonth: t('common.datePicker.previousMonth'),
    nextMonth: t('common.datePicker.nextMonth'),
    chooseYear: t('common.datePicker.chooseYear'),
  };

  /** The inline message under a number field, or undefined while it is acceptable. */
  function numericError(field: IntakeNumericField): string | undefined {
    const problem = checkNumericField(numericText[field], field);
    if (problem === null) return undefined;
    if (problem === 'not_a_number') return t('intake.validation.notANumber');
    const { min, max } = INTAKE_LIMITS[field];
    return problem === 'below_min'
      ? t('intake.validation.belowMin', { min })
      : t('intake.validation.aboveMax', { max });
  }

  /**
   * The picker cannot produce an out-of-range date, but a row saved before these
   * bounds existed can hold one — and a target date set months ago is legitimately
   * in the past now. Both need saying out loud rather than being quietly dropped.
   */
  function dateError(
    value: string | undefined,
    bounds: { min: string; max: string },
  ): string | undefined {
    const problem = checkCalendarDate(value, bounds);
    if (problem === null) return undefined;
    if (problem === 'malformed') return t('common.dateValidation.malformed');
    return problem === 'before_min'
      ? t('common.dateValidation.beforeMin', { min: bounds.min })
      : t('common.dateValidation.afterMax', { max: bounds.max });
  }

  if (mode === 'resume') {
    return (
      <FormScreen
        header={
          <NavHeader
            leading={
              <Button label={t('common.back')} icon="chevronBack" variant="link" onPress={() => router.back()} />
            }
            divider={false}
          />
        }
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
        <SectionLabel>{t('intake.resume.checklistNote')}</SectionLabel>
        <SectionCard>
          {stepIds.map((id, i) => (
            <ListRow
              key={id}
              title={t(`intake.steps.${id}`)}
              trailing={
                completion.stepStatus[id] ? (
                  <Icon name="check" size={17} color={theme.colors.successAccent} strokeWidth={2.4} />
                ) : (
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: theme.colors.border,
                    }}
                  />
                )
              }
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
        /* Back / Continue / "Save & exit", all sticky — the same three-control footer
           pt-profile.tsx uses for its Skip. "Save & exit" lived at the bottom of the
           scroll body, which put the only way out of step 1 below the fold: the
           client saw a PAR-Q and a Continue and nothing else. */
        <View style={{ gap: theme.space[2] }}>
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
              disabled={submitting || (step === 1 && !parqComplete) || stepBlocked}
              style={{ flex: 2 }}
            />
          </Row>
          <Button
            label={t('intake.saveAndExit')}
            variant="link"
            onPress={() => void handleSaveAndExit()}
            // Blocked too, and for the same reason: Save & exit runs the same
            // saveProgress() and would drop the rejected value just as silently.
            // Clearing the field is one tap and always valid, so this traps
            // nobody.
            disabled={submitting || stepBlocked}
            style={{ alignSelf: 'center' }}
          />
        </View>
      }
    >
      <StepProgress
        segments={TOTAL_STEPS}
        progress={step / TOTAL_STEPS}
        label={t('intake.stepOf', { step, total: TOTAL_STEPS })}
      />
      <SectionLabel>{t('intake.stepOf', { step, total: TOTAL_STEPS })}</SectionLabel>

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
          <DateField
            label={t('intake.goals.targetDateLabel')}
            placeholder={t('common.datePicker.open')}
            value={responses.goals?.target_date ?? ''}
            onChange={(v) =>
              setResponses((prev) => ({ ...prev, goals: { ...prev.goals, target_date: v || undefined } }))
            }
            minDate={dateBounds.target_date.min}
            maxDate={dateBounds.target_date.max}
            error={dateError(responses.goals?.target_date, dateBounds.target_date)}
            locale={i18n.language}
            labels={pickerLabels}
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
                history: { ...prev.history, years_training: parseNumeric(text, 'years_training') },
              }));
            }}
            keyboardType="decimal-pad"
            error={numericError('years_training')}
            helperText={t('intake.history.yearsTrainingHelper', INTAKE_LIMITS.years_training)}
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
          <DateField
            label={t('intake.anthropometrics.dateOfBirthLabel')}
            placeholder={t('common.datePicker.open')}
            value={responses.anthropometrics?.date_of_birth ?? ''}
            onChange={(v) =>
              setResponses((prev) => ({
                ...prev,
                anthropometrics: { ...prev.anthropometrics, date_of_birth: v || undefined },
              }))
            }
            minDate={dateBounds.date_of_birth.min}
            maxDate={dateBounds.date_of_birth.max}
            // A birthday is reached by year first — paging months back three decades is not an interaction.
            startOnYear
            error={dateError(responses.anthropometrics?.date_of_birth, dateBounds.date_of_birth)}
            locale={i18n.language}
            labels={pickerLabels}
          />
          <SectionLabel>{t('intake.anthropometrics.sexLabel')}</SectionLabel>
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
                anthropometrics: { ...prev.anthropometrics, height_cm: parseNumeric(text, 'height_cm') },
              }));
            }}
            keyboardType="decimal-pad"
            error={numericError('height_cm')}
            helperText={t('intake.anthropometrics.heightHelper', INTAKE_LIMITS.height_cm)}
          />
          <TextField
            label={t('intake.anthropometrics.weightLabel')}
            value={numericText.weight_kg}
            onChangeText={(v) => {
              const text = sanitizeDecimal(v);
              setNumericText((prev) => ({ ...prev, weight_kg: text }));
              setResponses((prev) => ({
                ...prev,
                anthropometrics: { ...prev.anthropometrics, weight_kg: parseNumeric(text, 'weight_kg') },
              }));
            }}
            keyboardType="decimal-pad"
            error={numericError('weight_kg')}
            helperText={t('intake.anthropometrics.weightHelper', INTAKE_LIMITS.weight_kg)}
          />
        </>
      ) : null}

      {step === 5 ? (
        <>
          <SectionLabel>{t('intake.dietary.restrictionsLabel')}</SectionLabel>
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
    </FormScreen>
  );
}

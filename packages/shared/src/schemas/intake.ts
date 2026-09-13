import { z } from 'zod';
import { checkCalendarDate, parseCalendarDate, shiftCalendarYears, todayCalendarDate } from './dates';

/**
 * The seven fixed PAR-Q ids. Mirrored byte-for-byte by the ARRAY literal in
 * `submit_intake()` (supabase/migrations/0005_m2_clients_intake.sql) — that
 * SQL is the actual source of truth for what gets flagged (it derives
 * `red_flags` server-side and is never trusted to agree with this file by
 * accident), but both lists have to be kept in sync by hand since there's no
 * shared source between SQL and TypeScript for a fixed literal array.
 */
export const PARQ_QUESTIONS = [
  'parq_heart',
  'parq_chest_pain',
  'parq_dizziness',
  'parq_chronic_condition',
  'parq_medication',
  'parq_musculoskeletal',
  'parq_supervised',
] as const;
export type ParqQuestionId = (typeof PARQ_QUESTIONS)[number];

/**
 * The v1 intake template — byte-identical in shape to the JSONB literal
 * `invite_client()` writes into `intake_forms.sections`. Pinned together by
 * `template_version = '1.0'`: a future template change is a new version,
 * never an edit in place to this array.
 */
export const INTAKE_TEMPLATE_V1 = [
  { id: 'parq', title: 'PAR-Q' },
  { id: 'goals', title: 'Goals' },
  { id: 'history', title: 'Training history' },
  { id: 'anthropometrics', title: 'Anthropometrics' },
  { id: 'dietary', title: 'Dietary restrictions' },
] as const;
export type IntakeSectionId = (typeof INTAKE_TEMPLATE_V1)[number]['id'];

/**
 * Only PAR-Q is required — "nothing is required except PAR-Q" per the
 * prototype's intake annotation. It's a seven-question safety screen, so
 * every question must be an explicit boolean, not merely optional-and-absent.
 */
export const parqResponsesSchema = z.object(
  Object.fromEntries(PARQ_QUESTIONS.map((q) => [q, z.boolean()])) as Record<
    ParqQuestionId,
    z.ZodBoolean
  >,
);
export type ParqResponses = z.infer<typeof parqResponsesSchema>;

/**
 * Bounds for the intake's three free-typed numbers, shared by the zod schemas
 * below and by the form's inline validation, so the range the client is told
 * about and the range the schema accepts cannot drift apart.
 *
 * These are sanity rails, not clinical limits: wide enough that no real client
 * is turned away, narrow enough to catch the unit slip (a height typed in
 * metres, a weight typed in pounds-as-kilos) and the stray extra digit.
 */
export const INTAKE_LIMITS = {
  years_training: { min: 0, max: 80 },
  height_cm: { min: 50, max: 280 },
  weight_kg: { min: 20, max: 400 },
} as const;

export type IntakeNumericField = keyof typeof INTAKE_LIMITS;

/**
 * A birthday earlier than this is a typo, not a client. Deliberately NOT a
 * minimum-age rule: whether Forge accepts minors, and with what guardian
 * consent, is a product and compliance decision (EP-20) and not something this
 * field should invent by refusing a 15-year-old's real birthday.
 */
export const DATE_OF_BIRTH_EARLIEST = '1900-01-01';

/** A goal more than this far out is a typed year, not a plan. */
export const TARGET_DATE_MAX_YEARS_AHEAD = 10;

/** The selectable window for each of the intake's two dates, as of today. */
export function intakeDateBounds(): {
  date_of_birth: { min: string; max: string };
  target_date: { min: string; max: string };
} {
  const today = todayCalendarDate();
  return {
    // Born today at the latest — a future birthday is always a mistake.
    date_of_birth: { min: DATE_OF_BIRTH_EARLIEST, max: today },
    // A target date is a date to train towards, so today is the earliest useful one.
    target_date: { min: today, max: shiftCalendarYears(today, TARGET_DATE_MAX_YEARS_AHEAD) },
  };
}

/**
 * Why a typed number is not acceptable, or null when it is fine (or empty —
 * every field on the intake but PAR-Q is optional).
 */
export type NumericFieldProblem = 'not_a_number' | 'below_min' | 'above_max';

export function checkNumericField(text: string, field: IntakeNumericField): NumericFieldProblem | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return 'not_a_number';
  const { min, max } = INTAKE_LIMITS[field];
  if (value < min) return 'below_min';
  if (value > max) return 'above_max';
  return null;
}

/**
 * A `DATE` column's value, validated as a real calendar day inside `bounds`.
 * Bare `z.string()` let "not a date at all" through to the database and on to
 * intakeSummary(), where a garbage date_of_birth silently showed the PT no age.
 */
function calendarDateSchema(bounds: () => { min: string; max: string }) {
  return z.string().refine((value) => checkCalendarDate(value, bounds()) === null, {
    message: 'Enter a real date inside the allowed range',
  });
}

export const goalsResponsesSchema = z
  .object({
    primary_goal: z.string().trim().min(1).max(200),
    target_date: calendarDateSchema(() => intakeDateBounds().target_date),
    motivation: z.string().max(500),
  })
  .partial();

export const historyResponsesSchema = z
  .object({
    years_training: z.number().min(INTAKE_LIMITS.years_training.min).max(INTAKE_LIMITS.years_training.max),
    injuries: z.string().max(500),
    previous_programs: z.string().max(500),
  })
  .partial();

export const anthropometricsResponsesSchema = z
  .object({
    date_of_birth: calendarDateSchema(() => intakeDateBounds().date_of_birth),
    sex: z.enum(['male', 'female']),
    height_cm: z.number().min(INTAKE_LIMITS.height_cm.min).max(INTAKE_LIMITS.height_cm.max),
    weight_kg: z.number().min(INTAKE_LIMITS.weight_kg.min).max(INTAKE_LIMITS.weight_kg.max),
  })
  .partial();

/**
 * Matches EP-08's dietary tags list from Forge_Architecture.html (veg, vegan,
 * halal, kosher, GF, DF, nut-allergy) so M8's nutrition work reads the same
 * values without a migration.
 */
export const dietaryRestrictionSchema = z.enum([
  'vegetarian',
  'vegan',
  'halal',
  'kosher',
  'gluten_free',
  'dairy_free',
  'nut_allergy',
]);

export const dietaryResponsesSchema = z
  .object({
    restrictions: z.array(dietaryRestrictionSchema),
    notes: z.string().max(500),
  })
  .partial();

export const intakeResponsesSchema = z.object({
  parq: parqResponsesSchema,
  goals: goalsResponsesSchema.optional(),
  history: historyResponsesSchema.optional(),
  anthropometrics: anthropometricsResponsesSchema.optional(),
  dietary: dietaryResponsesSchema.optional(),
});
export type IntakeResponses = z.infer<typeof intakeResponsesSchema>;

/**
 * Pure client-side twin of `submit_intake()`'s SQL loop — drives the inline
 * "you answered yes" warn treatment as the client fills the form. Never the
 * source of truth for what the PT sees; that's always server-derived.
 */
export function evaluateParq(responses: Partial<Record<ParqQuestionId, boolean>>): ParqQuestionId[] {
  return PARQ_QUESTIONS.filter((q) => responses[q] === true);
}

/**
 * Is this one field actually answered?
 *
 * Deliberately not a truthiness test: `years_training: 0` is a real answer from a
 * beginner and `parq_heart: false` is the answer that matters most, so only
 * undefined/null, the empty string and the empty array count as unanswered.
 */
function hasAnswer(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * `stepStatus` marks a section complete when it actually holds an answer — not
 * when its top-level key merely exists.
 *
 * Key presence was the original rule, and it made the resume checklist lie: the
 * intake screen seeds its state from `emptyResponses()`, which sets every section
 * to `{}` so the typed shape is whole, so all five sections were "complete" before
 * the client had typed anything. A client who saved and exited at step 1 came back
 * to five ticks, and `goToFirstIncompleteStep()` found no incomplete step and
 * dropped them on step 5 with the PAR-Q never asked.
 *
 * PAR-Q is the one section with a stricter rule than "at least one field": it is a
 * seven-question safety screen and a partially answered one is not a screen, so it
 * counts only once every question has a boolean — the same gate the wizard's own
 * Continue button uses.
 */
export function intakeCompletion(responses: Partial<IntakeResponses>): {
  answered: number;
  total: number;
  stepStatus: Record<IntakeSectionId, boolean>;
} {
  const parq = responses.parq;
  const parqComplete = parq !== undefined && PARQ_QUESTIONS.every((q) => typeof parq[q] === 'boolean');

  const stepStatus = Object.fromEntries(
    INTAKE_TEMPLATE_V1.map((section) => {
      if (section.id === 'parq') return [section.id, parqComplete];
      const values = responses[section.id];
      return [section.id, values !== undefined && Object.values(values).some(hasAnswer)];
    }),
  ) as Record<IntakeSectionId, boolean>;

  return {
    answered: Object.values(stepStatus).filter(Boolean).length,
    total: INTAKE_TEMPLATE_V1.length,
    stepStatus,
  };
}

export type IntakeSummary = {
  ageYears: number | null;
  sex: 'male' | 'female' | null;
  height: number | null;
  weight: number | null;
  primaryGoal: string | null;
  flagCount: number;
};

const CM_PER_INCH = 2.54;
const LB_PER_KG = 2.20462;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function ageFromDob(dob: string | undefined): number | null {
  if (!dob) return null;
  // A DATE, so parse it as a local calendar day — see schemas/dates.ts. Mixing a
  // UTC-parsed birthday with the local getDate()/getMonth() below put the age a
  // day out either side of a birthday, depending on the device's offset.
  const birth = parseCalendarDate(dob);
  if (birth === null) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

/**
 * The client-detail essentials card the PT sees without opening the full
 * intake review. `redFlags` is optional so a caller with only
 * `intake_progress()`'s pre-submit counts (no flags yet) can still render a
 * partial summary; once submitted, pass `intake_forms.red_flags`.
 */
export function intakeSummary(
  responses: Partial<IntakeResponses>,
  unitSystem: 'metric' | 'imperial',
  redFlags?: readonly string[],
): IntakeSummary {
  const anthro = responses.anthropometrics;
  const heightCm = anthro?.height_cm ?? null;
  const weightKg = anthro?.weight_kg ?? null;

  return {
    ageYears: ageFromDob(anthro?.date_of_birth),
    sex: anthro?.sex ?? null,
    height: heightCm === null ? null : round1(unitSystem === 'imperial' ? heightCm / CM_PER_INCH : heightCm),
    weight: weightKg === null ? null : round1(unitSystem === 'imperial' ? weightKg * LB_PER_KG : weightKg),
    primaryGoal: responses.goals?.primary_goal ?? null,
    flagCount: redFlags?.length ?? 0,
  };
}

import { z } from 'zod';
import { parseCalendarDate } from './dates';

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

export const goalsResponsesSchema = z
  .object({
    primary_goal: z.string().trim().min(1).max(200),
    target_date: z.string(),
    motivation: z.string().max(500),
  })
  .partial();

export const historyResponsesSchema = z
  .object({
    years_training: z.number().nonnegative(),
    injuries: z.string().max(500),
    previous_programs: z.string().max(500),
  })
  .partial();

export const anthropometricsResponsesSchema = z
  .object({
    date_of_birth: z.string(),
    sex: z.enum(['male', 'female']),
    height_cm: z.number().positive(),
    weight_kg: z.number().positive(),
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
 * `stepStatus` marks a section complete once its top-level key exists in
 * `responses`, regardless of how thoroughly that section's own fields were
 * filled — "step count is the honest signal of remaining work" per the
 * annotation, not a percentage of fields answered. Matches the shape
 * `intake_progress()`'s SQL returns (state + counts, never content).
 */
export function intakeCompletion(responses: Partial<IntakeResponses>): {
  answered: number;
  total: number;
  stepStatus: Record<IntakeSectionId, boolean>;
} {
  const stepStatus = Object.fromEntries(
    INTAKE_TEMPLATE_V1.map((section) => [section.id, responses[section.id] !== undefined]),
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

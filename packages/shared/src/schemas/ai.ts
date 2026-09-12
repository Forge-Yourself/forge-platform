import { z } from 'zod';
import { blockTypeSchema, type SaveProgramPayload } from './programs';
import { equipmentSchema } from './exercises';

/** The three inputs the AI prompt screen asks for, plus a free-text exclusion. */
export const AI_GOALS = [
  'strength',
  'hypertrophy',
  'fat_loss',
  'endurance',
  'general_fitness',
  'rehab_return',
] as const;
export type AiGoal = (typeof AI_GOALS)[number];

export const AI_EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type AiExperienceLevel = (typeof AI_EXPERIENCE_LEVELS)[number];

/**
 * Body of POST /api/ai/program-draft. `avoid` is the free-text exclusion
 * ("No overhead pressing — left shoulder.") and is the one field the model is
 * told to respect absolutely. `.strict()` so a caller cannot smuggle in a
 * model id, a credit count, or anything else the route decides for itself.
 */
export const aiProgramDraftRequestSchema = z
  .object({
    clientId: z.string().uuid(),
    goal: z.enum(AI_GOALS),
    equipment: z.array(equipmentSchema).min(1).max(16),
    experience: z.enum(AI_EXPERIENCE_LEVELS),
    avoid: z.string().trim().max(500).optional(),
    weeks: z.number().int().min(1).max(8).default(4),
  })
  .strict();
export type AiProgramDraftRequest = z.infer<typeof aiProgramDraftRequestSchema>;

/**
 * What the model itself must return — the schema handed to zodOutputFormat()
 * in apps/web/lib/ai. Two deliberate properties:
 *
 *   1. Exercises are named by SLUG, never by free text or by UUID. The route
 *      sends a catalogue of allowed slugs and resolves them afterwards, so
 *      the model cannot invent a movement the library does not have.
 *   2. There is no sort_order anywhere. Order is the array order, and the
 *      route assigns sort_order from the index — which is what makes it
 *      impossible for AI output to trip uq_pb_day_sort / uq_pe_block_sort.
 *
 * Every .describe() below is prompt surface, not a comment: the model reads
 * them. Edit them as carefully as you would edit the system prompt.
 */
export const aiDraftExerciseSchema = z.object({
  exerciseSlug: z.string().describe('The slug of an exercise, copied exactly from the catalogue. Never invent a slug.'),
  why: z
    .string()
    .max(200)
    .describe('One sentence for the trainer on why this movement is here and how it progresses.'),
  targetSets: z.number().int().min(1).max(10),
  targetRepsMin: z.number().int().min(1).max(100),
  targetRepsMax: z.number().int().min(1).max(100),
  targetRpe: z.number().min(1).max(10).nullable().describe('RPE 1-10, or null for a warm-up or cool-down movement.'),
  restSec: z.number().int().min(0).max(600),
  tempoPrescribed: z
    .string()
    .max(20)
    .nullable()
    .describe('Tempo as eccentric-pause-concentric, e.g. "3-1-1", or null when tempo is not prescribed.'),
});

export const aiDraftBlockSchema = z.object({
  blockType: blockTypeSchema.describe('Use "superset" when the exercises in this block alternate, otherwise "working", "warmup" or "cooldown".'),
  label: z.string().max(100).describe('A short name a trainer would use, e.g. "Main lift", "Superset", "Finisher".'),
  restBetweenSec: z.number().int().min(0).max(600).nullable(),
  exercises: z.array(aiDraftExerciseSchema).min(1).max(8),
});

export const aiDraftDaySchema = z.object({
  dayNumber: z.number().int().min(1).max(7).describe('Training day within the week, 1-7. Days need not be consecutive.'),
  label: z.string().max(100).describe('The session focus, e.g. "Lower body", "Push".'),
  blocks: z.array(aiDraftBlockSchema).min(1).max(6),
});

export const aiDraftWeekSchema = z.object({
  weekNumber: z.number().int().min(1).max(8),
  label: z.string().max(100).describe('e.g. "Base", "Build", "Deload".'),
  days: z.array(aiDraftDaySchema).min(1).max(7),
});

export const aiDraftModelSchema = z.object({
  summary: z
    .string()
    .max(200)
    .describe('One line the trainer reads first, e.g. "3 days/week · 18 exercises · no overhead press".'),
  weeks: z.array(aiDraftWeekSchema).min(1).max(8).describe('Every week of the program, in order, with progression across them.'),
});
export type AiDraftModelOutput = z.infer<typeof aiDraftModelSchema>;

/**
 * The resolved draft the route returns: the model's output with every slug
 * turned into a real exercise_id/name and sort_order filled in from array
 * order. Field names switch to snake_case here because from this point on the
 * shape is a save_program payload with two presentation-only extras
 * (exercise_name, why) that draftToSaveProgramPayload() strips.
 */
export const resolvedDraftExerciseSchema = z.object({
  sort_order: z.number().int(),
  exercise_id: z.string().uuid(),
  exercise_name: z.string(),
  why: z.string(),
  target_sets: z.number().int().nullable(),
  target_reps_min: z.number().int().nullable(),
  target_reps_max: z.number().int().nullable(),
  target_rpe: z.number().nullable(),
  rest_sec: z.number().int().nullable(),
  tempo_prescribed: z.string().nullable(),
});

export const resolvedDraftBlockSchema = z.object({
  sort_order: z.number().int(),
  block_type: z.string(),
  label: z.string().nullable(),
  rest_between_sec: z.number().int().nullable(),
  exercises: z.array(resolvedDraftExerciseSchema),
});

export const resolvedDraftDaySchema = z.object({
  day_number: z.number().int(),
  label: z.string().nullable(),
  blocks: z.array(resolvedDraftBlockSchema),
});

export const resolvedDraftWeekSchema = z.object({
  week_number: z.number().int(),
  label: z.string().nullable(),
  days: z.array(resolvedDraftDaySchema),
});

export const resolvedDraftSchema = z.object({
  summary: z.string(),
  weeks: z.array(resolvedDraftWeekSchema),
});
export type ResolvedDraft = z.infer<typeof resolvedDraftSchema>;

/**
 * The 200 body of POST /api/ai/program-draft. `balance` is the balance AFTER
 * the charge, and `lowBalance` is the server's own verdict on it so the app
 * never has to re-derive the threshold from a number it was handed.
 */
export const aiProgramDraftResponseSchema = z.object({
  generationId: z.string().uuid(),
  balance: z.number().int().min(0),
  lowBalance: z.boolean(),
  draft: resolvedDraftSchema,
});
export type AiProgramDraftResponse = z.infer<typeof aiProgramDraftResponseSchema>;

/** The error body every non-2xx from that route returns. */
export const aiProgramDraftErrorSchema = z.object({
  error: z.string(),
  charged: z.boolean().optional(),
});

/**
 * Turns a reviewed draft into exactly what save_program() takes, dropping the
 * two presentation-only fields. The per-exercise `why` is deliberately never
 * persisted: it exists to justify the draft at the review moment, and a
 * rationale frozen into a program the PT has since edited would be a lie.
 */
export function draftToSaveProgramPayload(draft: ResolvedDraft): SaveProgramPayload {
  return {
    weeks: draft.weeks.map((week) => ({
      week_number: week.week_number,
      label: week.label,
      days: week.days.map((day) => ({
        day_number: day.day_number,
        label: day.label,
        notes: null,
        blocks: day.blocks.map((block) => ({
          sort_order: block.sort_order,
          block_type: (blockTypeSchema.safeParse(block.block_type).data ?? 'working'),
          label: block.label,
          rest_between_sec: block.rest_between_sec,
          exercises: block.exercises.map((ex) => ({
            sort_order: ex.sort_order,
            exercise_id: ex.exercise_id,
            target_sets: ex.target_sets,
            target_reps_min: ex.target_reps_min,
            target_reps_max: ex.target_reps_max,
            target_weight_kg: null,
            target_rpe: ex.target_rpe,
            rest_sec: ex.rest_sec,
            tempo_prescribed: ex.tempo_prescribed,
            prescribed_duration_sec: null,
            prescribed_distance_m: null,
            notes: null,
          })),
        })),
      })),
    })),
  };
}

/**
 * The credit packs the low-balance sheet renders. Priced in cents, tiers
 * mirroring chk_acp_tier. M3 renders these with an inert CTA — RevenueCat
 * purchase lands at M6, and ai_credit_packs has no writer until then.
 */
export const AI_CREDIT_PACKS = [
  { tier: 'starter', credits: 20, priceCents: 500, currency: 'USD' },
  { tier: 'standard', credits: 50, priceCents: 1000, currency: 'USD', bestValue: true },
  { tier: 'power', credits: 150, priceCents: 2500, currency: 'USD' },
] as const;
export type AiCreditPack = (typeof AI_CREDIT_PACKS)[number];

/** The balance at or below which the low-credit sheet appears (D36: <= 3). */
export const AI_LOW_BALANCE_THRESHOLD = 3;

export type CreditState = 'ok' | 'low' | 'empty';

/**
 * The wallet state machine from the architecture doc's D36, as a function:
 * zero is the upsell prompt, <= 3 is the low warning, anything above is
 * silent. Never a hard block either way — hand-building a program is always
 * free, which is what the sheet's own copy says.
 */
export function creditState(balance: number): CreditState {
  if (balance <= 0) return 'empty';
  if (balance <= AI_LOW_BALANCE_THRESHOLD) return 'low';
  return 'ok';
}

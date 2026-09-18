import { z } from 'zod';
import { ULID_REGEX } from './ulid';

/**
 * Bounds for the two free-typed numbers on the logging screen, shared by the
 * zod schema, the keypad's inline validation and log_set()'s own checks in
 * 0015 (weight 0–500, reps 0–200). Sanity rails, not records: they catch a
 * unit slip and an extra digit, nothing else.
 */
export const LOGGING_LIMITS = {
  weight_kg: { min: 0, max: 500 },
  reps: { min: 0, max: 200 },
  rpe: { min: 1, max: 10 },
  set_notes: 280,
  session_notes: 1000,
} as const;

/** Mirrors chk_epr_type. */
export const PR_TYPES = ['weight', 'reps', 'volume'] as const;
export type PrType = (typeof PR_TYPES)[number];

/** The client-side shape handed to log_set. Storage is kg; the screen converts. */
export const logSetInputSchema = z
  .object({
    id: z.string().regex(ULID_REGEX),
    weight_kg: z.number().min(LOGGING_LIMITS.weight_kg.min).max(LOGGING_LIMITS.weight_kg.max).nullable(),
    reps: z.number().int().min(LOGGING_LIMITS.reps.min).max(LOGGING_LIMITS.reps.max).nullable(),
    // chk_sets_rpe is 1..10 in NUMERIC(3,1); the pill offers 6..10 and the
    // edit sheet the rest, always in halves.
    rpe: z
      .number()
      .min(LOGGING_LIMITS.rpe.min)
      .max(LOGGING_LIMITS.rpe.max)
      .refine((v) => Number.isInteger(v * 2), { message: 'rpe must be a half step' })
      .nullable(),
    notes: z.string().max(LOGGING_LIMITS.set_notes).nullable(),
    is_warmup: z.boolean(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.weight_kg === null && v.reps === null) {
      ctx.addIssue({ code: 'custom', message: 'a set needs a weight or a rep count', path: ['reps'] });
    }
  });
export type LogSetInput = z.infer<typeof logSetInputSchema>;

/** Mirrors chk_ws_rating (1..5). */
export const completeSessionInputSchema = z
  .object({
    rating: z.number().int().min(1).max(5).nullable(),
    notes: z.string().max(LOGGING_LIMITS.session_notes).nullable(),
  })
  .strict();
export type CompleteSessionInput = z.infer<typeof completeSessionInputSchema>;

/** "M:SS" under an hour, "H:MM:SS" past it — the header clock and the summary. */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return (h > 0 ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
}

export type SetForMath = { weight_kg: number | null; reps: number | null; is_warmup: boolean };

/** Total working volume in kg·reps. A set without a weight contributes nothing. */
export function sessionVolume(sets: ReadonlyArray<SetForMath>): number {
  let total = 0;
  for (const s of sets) {
    if (s.is_warmup || s.weight_kg === null || s.reps === null) continue;
    total += s.weight_kg * s.reps;
  }
  return total;
}

/**
 * The PR rule, identical to log_set() in 0015 (PITFALLS R1 — a rule in two
 * languages is tested on both sides). `prior` is every OTHER working set the
 * client has logged on this exercise; the SQL side scans the same rows.
 */
export function detectPrs(candidate: SetForMath, prior: ReadonlyArray<SetForMath>): PrType[] {
  if (candidate.is_warmup) return [];
  let bestWeight = 0;
  let bestReps = 0;
  let bestVolume = 0;
  for (const s of prior) {
    if (s.is_warmup) continue;
    if (s.weight_kg !== null) bestWeight = Math.max(bestWeight, s.weight_kg);
    if (s.reps !== null) bestReps = Math.max(bestReps, s.reps);
    if (s.weight_kg !== null && s.reps !== null) bestVolume = Math.max(bestVolume, s.weight_kg * s.reps);
  }
  const hits: PrType[] = [];
  if (candidate.weight_kg !== null && candidate.weight_kg > bestWeight) hits.push('weight');
  if (candidate.reps !== null && candidate.reps > bestReps) hits.push('reps');
  if (
    candidate.weight_kg !== null &&
    candidate.reps !== null &&
    candidate.weight_kg * candidate.reps > bestVolume
  ) {
    hits.push('volume');
  }
  return hits;
}

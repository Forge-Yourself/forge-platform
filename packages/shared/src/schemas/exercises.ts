import { z } from 'zod';

/**
 * The four exercise enums, mirroring db/schema.sql's chk_exercises_muscle_group,
 * chk_exercises_equipment, chk_exercises_movement and chk_exercises_difficulty
 * CHECK constraints exactly. db/exercises/build_import_sql.mjs keeps a third
 * copy for the library importer and refuses to emit a file that uses a value
 * outside them — three lists, hand-synced, because there is no shared source
 * between SQL, TypeScript and the generator for a fixed literal set.
 */
export const MUSCLE_GROUPS = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms',
  'quadriceps', 'hamstrings', 'glutes', 'calves', 'abs', 'obliques',
  'traps', 'lats', 'hip_flexors', 'adductors', 'abductors',
  'full_body', 'cardio', 'other',
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const EQUIPMENT = [
  'barbell', 'dumbbell', 'kettlebell', 'machine', 'cable',
  'bodyweight', 'resistance_band', 'smith_machine', 'trx',
  'medicine_ball', 'foam_roller', 'bench', 'pull_up_bar',
  'cardio_machine', 'other', 'none',
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const MOVEMENT_PATTERNS = [
  'push', 'pull', 'squat', 'hinge', 'lunge', 'carry',
  'rotation', 'isometric', 'plyometric', 'cardio', 'stretch', 'other',
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const muscleGroupSchema = z.enum(MUSCLE_GROUPS);
export const equipmentSchema = z.enum(EQUIPMENT);
export const movementPatternSchema = z.enum(MOVEMENT_PATTERNS);
export const difficultySchema = z.enum(DIFFICULTIES);

/**
 * Arguments for `search_exercises()` (supabase/migrations/0007_m3_programming.sql).
 * Every filter is independently optional and they compose — "type press then
 * tap Barbell and watch the list narrow" per the library annotation. Visibility
 * (global library + own custom rows) is RLS's job, never a filter here.
 */
export const exerciseSearchSchema = z
  .object({
    query: z.string().trim().max(100).optional(),
    muscle: muscleGroupSchema.optional(),
    equipment: equipmentSchema.optional(),
    pattern: movementPatternSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();
export type ExerciseSearchInput = z.infer<typeof exerciseSearchSchema>;

/**
 * Payload for `create_custom_exercise()`. Only name/muscle/equipment are
 * required — "this stays a 30-second job" per the custom-exercise annotation.
 * `.strict()` so a caller reaching for is_custom or created_by_user_id (both
 * forced server-side, and neither a parameter of the RPC) fails validation
 * instead of being silently ignored.
 */
export const createCustomExerciseSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    muscleGroup: muscleGroupSchema,
    equipment: equipmentSchema,
    movementPattern: movementPatternSchema.default('other'),
    difficulty: difficultySchema.optional(),
    instructions: z.string().trim().max(2000).optional(),
    coachingCues: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
    demoVideoUrl: z.string().trim().url().max(500).optional(),
  })
  .strict();
export type CreateCustomExerciseInput = z.infer<typeof createCustomExerciseSchema>;

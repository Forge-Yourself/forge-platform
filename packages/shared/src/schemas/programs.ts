import { z } from 'zod';

/** Mirrors db/schema.sql's chk_programs_state CHECK constraint exactly. */
export const PROGRAM_STATES = ['draft', 'active', 'completed', 'archived'] as const;
export type ProgramState = (typeof PROGRAM_STATES)[number];

/** Mirrors chk_pb_block_type. 'superset' is the A1/A2 case the builder draws. */
export const BLOCK_TYPES = [
  'warmup',
  'working',
  'cooldown',
  'superset',
  'circuit',
  'straight',
  'emom',
  'amrap',
  'drop_set',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Mirrors chk_programs_periodization. */
export const PERIODIZATIONS = ['linear', 'undulating', 'block', 'conjugate', 'custom'] as const;
export type Periodization = (typeof PERIODIZATIONS)[number];

export const programStateSchema = z.enum(PROGRAM_STATES);
export const blockTypeSchema = z.enum(BLOCK_TYPES);
export const periodizationSchema = z.enum(PERIODIZATIONS);

/**
 * One prescribed exercise. Every numeric is nullish because an empty builder
 * cell is a real state — the PT fills SETS and REPS first and comes back for
 * RPE later. Bounds mirror the column types and CHECKs in db/schema.sql
 * (target_rpe NUMERIC(3,1) CHECK 1..10, SMALLINT counts, chk_pe_reps).
 */
export const programExercisePayloadSchema = z
  .object({
    exercise_id: z.string().uuid(),
    sort_order: z.number().int().min(0).max(32767),
    target_sets: z.number().int().min(1).max(99).nullish(),
    target_reps_min: z.number().int().min(1).max(999).nullish(),
    target_reps_max: z.number().int().min(1).max(999).nullish(),
    target_weight_kg: z.number().min(0).max(99999.99).nullish(),
    target_rpe: z.number().min(1).max(10).nullish(),
    rest_sec: z.number().int().min(0).max(32767).nullish(),
    tempo_prescribed: z.string().trim().max(20).nullish(),
    prescribed_duration_sec: z.number().int().min(0).max(32767).nullish(),
    prescribed_distance_m: z.number().min(0).max(999999.99).nullish(),
    notes: z.string().trim().max(1000).nullish(),
  })
  .strict()
  .superRefine((ex, ctx) => {
    // Mirrors chk_pe_reps. Caught here so a fat-fingered 12-8 fails before a
    // ~160-row round trip, not as a constraint violation after it.
    if (
      ex.target_reps_min != null &&
      ex.target_reps_max != null &&
      ex.target_reps_min > ex.target_reps_max
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'target_reps_min must be less than or equal to target_reps_max',
        path: ['target_reps_max'],
      });
    }
  });
export type ProgramExercisePayload = z.infer<typeof programExercisePayloadSchema>;

export const programBlockPayloadSchema = z
  .object({
    sort_order: z.number().int().min(0).max(32767),
    block_type: blockTypeSchema.default('working'),
    label: z.string().trim().max(100).nullish(),
    rest_between_sec: z.number().int().min(0).max(32767).nullish(),
    exercises: z.array(programExercisePayloadSchema),
  })
  .strict();
export type ProgramBlockPayload = z.infer<typeof programBlockPayloadSchema>;

export const programDayPayloadSchema = z
  .object({
    day_number: z.number().int().min(1).max(7),
    label: z.string().trim().max(100).nullish(),
    notes: z.string().trim().max(2000).nullish(),
    blocks: z.array(programBlockPayloadSchema),
  })
  .strict();
export type ProgramDayPayload = z.infer<typeof programDayPayloadSchema>;

export const programWeekPayloadSchema = z
  .object({
    week_number: z.number().int().min(1).max(52),
    label: z.string().trim().max(100).nullish(),
    days: z.array(programDayPayloadSchema),
  })
  .strict();
export type ProgramWeekPayload = z.infer<typeof programWeekPayloadSchema>;

function hasDuplicates<T>(values: T[]): boolean {
  return new Set(values).size !== values.length;
}

/**
 * The whole tree that save_program(p_program_id, p_payload) consumes in one
 * call (supabase/migrations/0007_m3_programming.sql). The uniqueness
 * refinements below mirror uq_pw_program_week, uq_pd_week_day, uq_pb_day_sort
 * and uq_pe_block_sort — those DB constraints are DEFERRABLE and so only fail
 * at COMMIT, by which point a 160-row save has already crossed the wire.
 * These exist to catch a malformed builder state before that round trip.
 */
export const saveProgramPayloadSchema = z
  .object({ weeks: z.array(programWeekPayloadSchema) })
  .strict()
  .superRefine((payload, ctx) => {
    if (hasDuplicates(payload.weeks.map((w) => w.week_number))) {
      ctx.addIssue({ code: 'custom', message: 'duplicate week_number', path: ['weeks'] });
    }

    payload.weeks.forEach((week, wi) => {
      if (hasDuplicates(week.days.map((d) => d.day_number))) {
        ctx.addIssue({
          code: 'custom',
          message: 'duplicate day_number within a week',
          path: ['weeks', wi, 'days'],
        });
      }

      week.days.forEach((day, di) => {
        if (hasDuplicates(day.blocks.map((b) => b.sort_order))) {
          ctx.addIssue({
            code: 'custom',
            message: 'duplicate block sort_order within a day',
            path: ['weeks', wi, 'days', di, 'blocks'],
          });
        }

        day.blocks.forEach((block, bi) => {
          if (hasDuplicates(block.exercises.map((e) => e.sort_order))) {
            ctx.addIssue({
              code: 'custom',
              message: 'duplicate exercise sort_order within a block',
              path: ['weeks', wi, 'days', di, 'blocks', bi, 'exercises'],
            });
          }
        });
      });
    });
  });
export type SaveProgramPayload = z.infer<typeof saveProgramPayloadSchema>;

/**
 * The read-side sibling: what program_tree() returns. Deliberately NOT strict
 * — a column added server-side should not break every client — but every
 * field the app actually renders is required, so a rename or a dropped field
 * surfaces as a typed error at the boundary instead of as `undefined` three
 * screens later. NUMERIC columns arrive from PostgREST as strings, hence
 * z.coerce.number() on the three of them.
 */
export const programTreeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  state: z.string(),
  duration_weeks: z.number().int(),
  periodization: z.string().nullable(),
  is_template: z.boolean(),
  template_source_id: z.string().uuid().nullable(),
  is_ai_generated: z.boolean(),
  ai_generation_id: z.string().uuid().nullable(),
  client_id: z.string().uuid().nullable(),
  start_date: z.string().nullable(),
  weeks: z.array(
    z.object({
      id: z.string().uuid(),
      week_number: z.number().int(),
      label: z.string().nullable(),
      days: z.array(
        z.object({
          id: z.string().uuid(),
          day_number: z.number().int(),
          label: z.string().nullable(),
          notes: z.string().nullable(),
          blocks: z.array(
            z.object({
              id: z.string().uuid(),
              sort_order: z.number().int(),
              block_type: z.string(),
              label: z.string().nullable(),
              rest_between_sec: z.number().int().nullable(),
              exercises: z.array(
                z.object({
                  id: z.string().uuid(),
                  sort_order: z.number().int(),
                  exercise_id: z.string().uuid(),
                  exercise_name: z.string(),
                  exercise_name_ar: z.string().nullable(),
                  target_sets: z.number().int().nullable(),
                  target_reps_min: z.number().int().nullable(),
                  target_reps_max: z.number().int().nullable(),
                  target_weight_kg: z.coerce.number().nullable(),
                  target_rpe: z.coerce.number().nullable(),
                  rest_sec: z.number().int().nullable(),
                  tempo_prescribed: z.string().nullable(),
                  prescribed_duration_sec: z.number().int().nullable(),
                  prescribed_distance_m: z.coerce.number().nullable(),
                  notes: z.string().nullable(),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type ProgramTree = z.infer<typeof programTreeSchema>;

/** The minimum shape programStats needs — a tree and a save payload both fit. */
type CountableTree = {
  weeks: ReadonlyArray<{
    days: ReadonlyArray<{ blocks: ReadonlyArray<{ exercises: ReadonlyArray<unknown> }> }>;
  }>;
};

/**
 * The program-list row meta: "4 weeks · 3 days/week · 21 exercises".
 * daysPerWeek is the MAX across weeks, not the mean — a deload week with two
 * sessions should not make a 3-day program read as "2.7 days/week".
 */
export function programStats(tree: CountableTree): {
  weeks: number;
  daysPerWeek: number;
  exerciseCount: number;
} {
  let exerciseCount = 0;
  let daysPerWeek = 0;

  for (const week of tree.weeks) {
    daysPerWeek = Math.max(daysPerWeek, week.days.length);
    for (const day of week.days) {
      for (const block of day.blocks) {
        exerciseCount += block.exercises.length;
      }
    }
  }

  return { weeks: tree.weeks.length, daysPerWeek, exerciseCount };
}

export type WeekProgressState = 'done' | 'current' | 'upcoming';

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * The week strip under an assigned program row — "completion at a glance —
 * mono, no percentages" per the program-list annotation.
 *
 * At M3 this is derived from the calendar alone: there are no logged sessions
 * to count until M4 adds logging, so a week reads 'done' because it has
 * passed, not because it was trained. When M4 lands, this is the function
 * that grows a second input; the shape it returns should not have to change.
 */
export function weekCompletion(
  program: { duration_weeks: number; start_date?: string | null },
  today: Date = new Date(),
): { weeks: { weekNumber: number; state: WeekProgressState }[]; currentWeek: number | null } {
  const total = Math.max(0, program.duration_weeks);
  const start = program.start_date ? new Date(program.start_date) : null;
  const started =
    start !== null && !Number.isNaN(start.getTime()) && start.getTime() <= today.getTime();

  // 1-based: on the start date itself the client is in week 1.
  const currentWeek = started
    ? Math.min(total, Math.floor((today.getTime() - start.getTime()) / MS_PER_WEEK) + 1)
    : null;

  const weeks = Array.from({ length: total }, (_, i) => {
    const weekNumber = i + 1;
    let state: WeekProgressState = 'upcoming';
    if (currentWeek !== null) {
      if (weekNumber < currentWeek) state = 'done';
      else if (weekNumber === currentWeek) state = 'current';
    }
    return { weekNumber, state };
  });

  return { weeks, currentWeek };
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/**
 * The one-line prescription an AI draft row and the client's read-only view
 * both render: "4 × 6-8 @ RPE 7.5", "3 × 45s", "400m". Returns an em dash
 * when nothing has been prescribed yet — an empty builder row is a real
 * state, not an error.
 */
export function formatSetSpec(ex: {
  target_sets?: number | null;
  target_reps_min?: number | null;
  target_reps_max?: number | null;
  target_weight_kg?: number | null;
  target_rpe?: number | null;
  prescribed_duration_sec?: number | null;
  prescribed_distance_m?: number | null;
}): string {
  const parts: string[] = [];
  const sets = ex.target_sets;

  const reps =
    ex.target_reps_min != null &&
    ex.target_reps_max != null &&
    ex.target_reps_min !== ex.target_reps_max
      ? ex.target_reps_min + '-' + ex.target_reps_max
      : (ex.target_reps_min ?? ex.target_reps_max ?? null);

  if (reps !== null) {
    parts.push(sets != null ? sets + ' × ' + reps : String(reps));
  } else if (ex.prescribed_duration_sec != null) {
    const dur = ex.prescribed_duration_sec + 's';
    parts.push(sets != null ? sets + ' × ' + dur : dur);
  } else if (ex.prescribed_distance_m != null) {
    const dist = trimNumber(ex.prescribed_distance_m) + 'm';
    parts.push(sets != null ? sets + ' × ' + dist : dist);
  } else if (sets != null) {
    parts.push(sets + ' sets');
  }

  if (ex.target_rpe != null) {
    parts.push('@ RPE ' + trimNumber(ex.target_rpe));
  } else if (ex.target_weight_kg != null) {
    parts.push('@ ' + trimNumber(ex.target_weight_kg) + 'kg');
  }

  return parts.length > 0 ? parts.join(' ') : '—';
}

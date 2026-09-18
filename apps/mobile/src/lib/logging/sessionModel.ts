import type { ProgramTree } from '@forge/shared';
import type { SetRow } from './sessionRpc';

export type ProgramDay = ProgramTree['weeks'][number]['days'][number];
export type ProgramDayExercise = ProgramDay['blocks'][number]['exercises'][number];

/** One row in the exercise rail: prescription if programmed, name always. */
export type SessionExercise = {
  exerciseId: string;
  name: string;
  nameAr: string | null;
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetWeightKg: number | null;
  targetRpe: number | null;
  restSec: number | null;
  programmed: boolean;
};

export const DEFAULT_REST_SEC = 90;

/**
 * Program day exercises in block order, then anything logged ad hoc (a set
 * whose exercise is not in the day). `names` resolves ad-hoc exercise ids; an
 * unresolved id gets an empty name until ensureNames resolves it — the screen
 * renders the placeholder, models stay copy-free.
 */
export function buildExerciseList(
  day: ProgramDay | null,
  sets: readonly SetRow[],
  names: Record<string, { name: string; name_ar: string | null }>,
  extraIds: readonly string[] = [],
): SessionExercise[] {
  const out: SessionExercise[] = [];
  const seen = new Set<string>();
  for (const block of day?.blocks ?? []) {
    for (const ex of block.exercises) {
      if (seen.has(ex.exercise_id)) continue;
      seen.add(ex.exercise_id);
      out.push({
        exerciseId: ex.exercise_id,
        name: ex.exercise_name,
        nameAr: ex.exercise_name_ar ?? null,
        targetSets: ex.target_sets,
        targetRepsMin: ex.target_reps_min,
        targetRepsMax: ex.target_reps_max,
        targetWeightKg: ex.target_weight_kg,
        targetRpe: ex.target_rpe,
        restSec: ex.rest_sec ?? block.rest_between_sec ?? null,
        programmed: true,
      });
    }
  }
  const adHoc = [...sets.map((s) => s.exercise_id), ...extraIds];
  for (const id of adHoc) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      exerciseId: id,
      name: names[id]?.name ?? '',
      nameAr: names[id]?.name_ar ?? null,
      targetSets: null,
      targetRepsMin: null,
      targetRepsMax: null,
      targetWeightKg: null,
      targetRpe: null,
      restSec: null,
      programmed: false,
    });
  }
  return out;
}

export function setsFor(sets: readonly SetRow[], exerciseId: string): SetRow[] {
  return sets
    .filter((s) => s.exercise_id === exerciseId)
    .sort((a, b) => a.set_number - b.set_number || a.created_at.localeCompare(b.created_at));
}

/**
 * Working sets are numbered from 1; warm-ups are set 0 and do not advance the
 * count. Max + 1, not length + 1, so a deleted middle set does not produce a
 * duplicate number.
 */
export function nextSetNumber(sets: readonly SetRow[], exerciseId: string): number {
  const working = setsFor(sets, exerciseId).filter((s) => !s.is_warmup);
  return working.reduce((max, s) => Math.max(max, s.set_number), 0) + 1;
}

/**
 * What the focus card shows before the user touches anything: the previous
 * set this session, else the programme target, else the last time on this
 * exercise, else empty. One tap logs the fast path.
 */
export function prefillFor(
  exercise: SessionExercise,
  sets: readonly SetRow[],
  last: SetRow | null,
): { weightKg: number | null; reps: number | null; rpe: number | null } {
  const prev = setsFor(sets, exercise.exerciseId).filter((s) => !s.is_warmup).at(-1);
  if (prev) return { weightKg: prev.weight_kg, reps: prev.reps, rpe: prev.rpe };
  if (exercise.programmed && (exercise.targetWeightKg !== null || exercise.targetRepsMin !== null)) {
    return {
      weightKg: exercise.targetWeightKg ?? last?.weight_kg ?? null,
      reps: exercise.targetRepsMin ?? exercise.targetRepsMax ?? last?.reps ?? null,
      rpe: exercise.targetRpe,
    };
  }
  if (last) return { weightKg: last.weight_kg, reps: last.reps, rpe: null };
  return { weightKg: null, reps: null, rpe: null };
}

/** The first exercise with fewer working sets than prescribed, else the first. */
export function initialExerciseIndex(list: readonly SessionExercise[], sets: readonly SetRow[]): number {
  const i = list.findIndex((ex) => {
    const done = setsFor(sets, ex.exerciseId).filter((s) => !s.is_warmup).length;
    return ex.targetSets === null ? done === 0 : done < ex.targetSets;
  });
  return i === -1 ? 0 : i;
}

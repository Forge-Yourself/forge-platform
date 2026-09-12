import type { ProgramTree, SaveProgramPayload } from '@forge/shared';

/**
 * The builder's working copy of a program.
 *
 * It mirrors SaveProgramPayload one-for-one except that each exercise also
 * carries its name, so the builder can render a row without a second lookup.
 * toPayload() drops that name again — save_program() resolves names from
 * exercise_id, and a stale copied name in the database would be a lie waiting
 * to happen.
 */
export type DraftExercise = {
  exercise_id: string;
  exercise_name: string;
  sort_order: number;
  target_sets: number | null;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_rpe: number | null;
  rest_sec: number | null;
  tempo_prescribed: string | null;
};

export type DraftBlock = {
  sort_order: number;
  block_type: string;
  label: string | null;
  rest_between_sec: number | null;
  exercises: DraftExercise[];
};

export type DraftDay = {
  day_number: number;
  label: string | null;
  notes: string | null;
  blocks: DraftBlock[];
};

export type DraftWeek = {
  week_number: number;
  label: string | null;
  days: DraftDay[];
};

export type ProgramDraft = { weeks: DraftWeek[] };

export function treeToDraft(tree: ProgramTree): ProgramDraft {
  return {
    weeks: tree.weeks.map((week) => ({
      week_number: week.week_number,
      label: week.label,
      days: week.days.map((day) => ({
        day_number: day.day_number,
        label: day.label,
        notes: day.notes,
        blocks: day.blocks.map((block) => ({
          sort_order: block.sort_order,
          block_type: block.block_type,
          label: block.label,
          rest_between_sec: block.rest_between_sec,
          exercises: block.exercises.map((ex) => ({
            exercise_id: ex.exercise_id,
            exercise_name: ex.exercise_name,
            sort_order: ex.sort_order,
            target_sets: ex.target_sets,
            target_reps_min: ex.target_reps_min,
            target_reps_max: ex.target_reps_max,
            target_rpe: ex.target_rpe,
            rest_sec: ex.rest_sec,
            tempo_prescribed: ex.tempo_prescribed,
          })),
        })),
      })),
    })),
  };
}

/**
 * Sort orders are renumbered from array position on the way out rather than
 * tracked as the PT reorders. Nothing else can then produce the duplicate
 * that uq_pb_day_sort / uq_pe_block_sort would reject at COMMIT.
 */
export function draftToPayload(draft: ProgramDraft): SaveProgramPayload {
  return {
    weeks: draft.weeks.map((week) => ({
      week_number: week.week_number,
      label: week.label,
      days: week.days.map((day) => ({
        day_number: day.day_number,
        label: day.label,
        notes: day.notes,
        blocks: day.blocks.map((block, blockIndex) => ({
          sort_order: blockIndex,
          block_type: block.block_type as SaveProgramPayload['weeks'][number]['days'][number]['blocks'][number]['block_type'],
          label: block.label,
          rest_between_sec: block.rest_between_sec,
          exercises: block.exercises.map((ex, exIndex) => ({
            exercise_id: ex.exercise_id,
            sort_order: exIndex,
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

/** Block tags run A, B, C… and a row's slot is its block tag plus its index. */
export function blockTag(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

export function slotFor(blockIndex: number, rowIndex: number): string {
  return blockTag(blockIndex) + String(rowIndex + 1);
}

/** "REST 3:00" — seconds rendered the way a PT reads a clock. */
export function formatRest(seconds: number | null): string | null {
  if (seconds === null) return null;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins + ':' + String(secs).padStart(2, '0');
}

/**
 * The REPS cell round-trip. A plain number is a fixed target ("6"); a dash
 * makes it a range ("6-8"), which is why the keypad drawer offers "-" as its
 * extra key on this cell. Anything unparseable clears the cell rather than
 * guessing at intent.
 */
export function formatRepsCell(min: number | null, max: number | null): string {
  if (min === null && max === null) return '';
  if (min !== null && max !== null && min !== max) return min + '-' + max;
  return String(min ?? max);
}

export function parseRepsCell(input: string): { min: number | null; max: number | null } {
  const trimmed = input.trim();
  if (trimmed === '') return { min: null, max: null };

  const [rawMin, rawMax] = trimmed.split('-');
  const min = Number(rawMin);
  if (!Number.isFinite(min) || min <= 0) return { min: null, max: null };

  if (rawMax === undefined || rawMax === '') return { min, max: min };
  const max = Number(rawMax);
  if (!Number.isFinite(max) || max < min) return { min, max: min };

  return { min, max };
}

export function parseIntCell(input: string): number | null {
  const value = Number(input.trim());
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

export function parseRpeCell(input: string): number | null {
  const value = Number(input.trim());
  if (!Number.isFinite(value)) return null;
  if (value < 1 || value > 10) return null;
  return Math.round(value * 10) / 10;
}

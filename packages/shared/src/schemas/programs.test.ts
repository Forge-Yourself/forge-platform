import { describe, expect, it } from 'vitest';
import {
  BLOCK_TYPES,
  blockTypeSchema,
  formatSetSpec,
  PERIODIZATIONS,
  periodizationSchema,
  PROGRAM_STATES,
  programStateSchema,
  programStats,
  saveProgramPayloadSchema,
  weekCompletion,
} from './programs';

const EXERCISE_ID = '11111111-1111-4111-8111-111111111111';

function exercise(sortOrder: number, overrides: Record<string, unknown> = {}) {
  return { exercise_id: EXERCISE_ID, sort_order: sortOrder, target_sets: 3, ...overrides };
}

function payload(weeks: unknown[]) {
  return { weeks };
}

function week(weekNumber: number, days: unknown[]) {
  return { week_number: weekNumber, days };
}

function day(dayNumber: number, blocks: unknown[]) {
  return { day_number: dayNumber, blocks };
}

function block(sortOrder: number, exercises: unknown[]) {
  return { sort_order: sortOrder, exercises };
}

describe('program enums', () => {
  it('accepts every value in chk_programs_state', () => {
    expect([...PROGRAM_STATES]).toEqual(['draft', 'active', 'completed', 'archived']);
    for (const value of PROGRAM_STATES) {
      expect(programStateSchema.safeParse(value).success).toBe(true);
    }
    expect(programStateSchema.safeParse('paused').success).toBe(false);
  });

  it('accepts every value in chk_pb_block_type', () => {
    expect(BLOCK_TYPES).toHaveLength(9);
    for (const value of BLOCK_TYPES) {
      expect(blockTypeSchema.safeParse(value).success).toBe(true);
    }
    expect(blockTypeSchema.safeParse('giant_set').success).toBe(false);
  });

  it('accepts every value in chk_programs_periodization', () => {
    for (const value of PERIODIZATIONS) {
      expect(periodizationSchema.safeParse(value).success).toBe(true);
    }
    expect(periodizationSchema.safeParse('wave').success).toBe(false);
  });
});

describe('saveProgramPayloadSchema', () => {
  it('accepts a minimal one-week, one-day, one-block program', () => {
    const result = saveProgramPayloadSchema.safeParse(
      payload([week(1, [day(1, [block(0, [exercise(0)])])])]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a week with no days — an empty week is a real builder state', () => {
    expect(saveProgramPayloadSchema.safeParse(payload([week(1, [])])).success).toBe(true);
  });

  it('defaults an unspecified block_type to working', () => {
    const parsed = saveProgramPayloadSchema.parse(
      payload([week(1, [day(1, [block(0, [exercise(0)])])])]),
    );
    expect(parsed.weeks[0]?.days[0]?.blocks[0]?.block_type).toBe('working');
  });

  it('rejects a duplicate week_number (uq_pw_program_week)', () => {
    const result = saveProgramPayloadSchema.safeParse(payload([week(1, []), week(1, [])]));
    expect(result.success).toBe(false);
  });

  it('rejects a duplicate day_number within a week (uq_pd_week_day)', () => {
    const result = saveProgramPayloadSchema.safeParse(payload([week(1, [day(1, []), day(1, [])])]));
    expect(result.success).toBe(false);
  });

  it('rejects a duplicate block sort_order within a day (uq_pb_day_sort)', () => {
    const result = saveProgramPayloadSchema.safeParse(
      payload([week(1, [day(1, [block(0, []), block(0, [])])])]),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a duplicate exercise sort_order within a block (uq_pe_block_sort)', () => {
    const result = saveProgramPayloadSchema.safeParse(
      payload([week(1, [day(1, [block(0, [exercise(0), exercise(0)])])])]),
    );
    expect(result.success).toBe(false);
  });

  it('allows the same sort_order in two different blocks', () => {
    const result = saveProgramPayloadSchema.safeParse(
      payload([week(1, [day(1, [block(0, [exercise(0)]), block(1, [exercise(0)])])])]),
    );
    expect(result.success).toBe(true);
  });

  it('rejects an inverted rep range (chk_pe_reps)', () => {
    const result = saveProgramPayloadSchema.safeParse(
      payload([
        week(1, [day(1, [block(0, [exercise(0, { target_reps_min: 12, target_reps_max: 8 })])])]),
      ]),
    );
    expect(result.success).toBe(false);
  });

  it('accepts an equal min and max rep count', () => {
    const result = saveProgramPayloadSchema.safeParse(
      payload([
        week(1, [day(1, [block(0, [exercise(0, { target_reps_min: 8, target_reps_max: 8 })])])]),
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('rejects an RPE outside chk_pe_rpe', () => {
    const over = saveProgramPayloadSchema.safeParse(
      payload([week(1, [day(1, [block(0, [exercise(0, { target_rpe: 11 })])])])]),
    );
    const under = saveProgramPayloadSchema.safeParse(
      payload([week(1, [day(1, [block(0, [exercise(0, { target_rpe: 0.5 })])])])]),
    );
    expect(over.success).toBe(false);
    expect(under.success).toBe(false);
  });

  it('rejects a day_number outside chk_pd_day and a week_number outside chk_pw_week', () => {
    expect(saveProgramPayloadSchema.safeParse(payload([week(1, [day(8, [])])])).success).toBe(false);
    expect(saveProgramPayloadSchema.safeParse(payload([week(53, [])])).success).toBe(false);
  });

  it('rejects a field outside the granted set', () => {
    expect(saveProgramPayloadSchema.safeParse({ weeks: [], program_id: EXERCISE_ID }).success).toBe(false);
  });

  it('accepts explicit nulls for every optional prescription cell', () => {
    const result = saveProgramPayloadSchema.safeParse(
      payload([
        week(1, [
          day(1, [
            block(0, [
              {
                exercise_id: EXERCISE_ID,
                sort_order: 0,
                target_sets: null,
                target_reps_min: null,
                target_reps_max: null,
                target_weight_kg: null,
                target_rpe: null,
                rest_sec: null,
                tempo_prescribed: null,
                prescribed_duration_sec: null,
                prescribed_distance_m: null,
                notes: null,
              },
            ]),
          ]),
        ]),
      ]),
    );
    expect(result.success).toBe(true);
  });
});

describe('programStats', () => {
  it('counts weeks, the busiest week, and every exercise', () => {
    const tree = {
      weeks: [
        { days: [{ blocks: [{ exercises: [1, 2, 3] }] }, { blocks: [{ exercises: [1] }] }] },
        { days: [{ blocks: [{ exercises: [1, 2] }, { exercises: [1] }] }] },
      ],
    };
    expect(programStats(tree)).toEqual({ weeks: 2, daysPerWeek: 2, exerciseCount: 7 });
  });

  it('returns zeros for an empty program', () => {
    expect(programStats({ weeks: [] })).toEqual({ weeks: 0, daysPerWeek: 0, exerciseCount: 0 });
  });
});

describe('weekCompletion', () => {
  const today = new Date('2026-09-12T12:00:00Z');

  it('marks every week upcoming when there is no start date', () => {
    const result = weekCompletion({ duration_weeks: 4, start_date: null }, today);
    expect(result.currentWeek).toBeNull();
    expect(result.weeks.map((w) => w.state)).toEqual(['upcoming', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('puts the client in week 1 on the start date itself', () => {
    const result = weekCompletion({ duration_weeks: 4, start_date: '2026-09-12' }, today);
    expect(result.currentWeek).toBe(1);
    expect(result.weeks[0]?.state).toBe('current');
  });

  it('marks elapsed weeks done and the live one current', () => {
    const result = weekCompletion({ duration_weeks: 4, start_date: '2026-09-01' }, today);
    expect(result.currentWeek).toBe(2);
    expect(result.weeks.map((w) => w.state)).toEqual(['done', 'current', 'upcoming', 'upcoming']);
  });

  it('treats a future start date as not yet started', () => {
    const result = weekCompletion({ duration_weeks: 2, start_date: '2026-12-01' }, today);
    expect(result.currentWeek).toBeNull();
  });

  it('clamps the current week to the program duration once it has run out', () => {
    const result = weekCompletion({ duration_weeks: 2, start_date: '2026-01-01' }, today);
    expect(result.currentWeek).toBe(2);
    expect(result.weeks.map((w) => w.state)).toEqual(['done', 'current']);
  });
});

describe('formatSetSpec', () => {
  it('formats a rep range', () => {
    expect(formatSetSpec({ target_sets: 4, target_reps_min: 6, target_reps_max: 8 })).toBe('4 × 6-8');
  });

  it('collapses an equal min and max to a single rep count', () => {
    expect(formatSetSpec({ target_sets: 4, target_reps_min: 6, target_reps_max: 6 })).toBe('4 × 6');
  });

  it('appends RPE and trims a whole-number one', () => {
    expect(formatSetSpec({ target_sets: 4, target_reps_min: 6, target_rpe: 7 })).toBe('4 × 6 @ RPE 7');
    expect(formatSetSpec({ target_sets: 4, target_reps_min: 6, target_rpe: 7.5 })).toBe('4 × 6 @ RPE 7.5');
  });

  it('falls back to weight when there is no RPE', () => {
    expect(formatSetSpec({ target_sets: 3, target_reps_min: 5, target_weight_kg: 60 })).toBe('3 × 5 @ 60kg');
  });

  it('formats duration and distance prescriptions', () => {
    expect(formatSetSpec({ target_sets: 3, prescribed_duration_sec: 45 })).toBe('3 × 45s');
    expect(formatSetSpec({ prescribed_distance_m: 400 })).toBe('400m');
  });

  it('formats a sets-only prescription', () => {
    expect(formatSetSpec({ target_sets: 5 })).toBe('5 sets');
  });

  it('returns an em dash for an empty row', () => {
    expect(formatSetSpec({})).toBe('—');
  });
});

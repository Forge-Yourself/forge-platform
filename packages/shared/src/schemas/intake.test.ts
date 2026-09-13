import { describe, expect, it } from 'vitest';
import { todayCalendarDate } from './dates';
import {
  anthropometricsResponsesSchema,
  checkNumericField,
  evaluateParq,
  historyResponsesSchema,
  intakeDateBounds,
  INTAKE_LIMITS,
  goalsResponsesSchema,
  intakeCompletion,
  intakeResponsesSchema,
  intakeSummary,
  INTAKE_TEMPLATE_V1,
  PARQ_QUESTIONS,
  parqResponsesSchema,
  type ParqQuestionId,
} from './intake';

/**
 * `Object.fromEntries` on its own infers a plain `{ [k: string]: boolean }`,
 * which doesn't structurally satisfy the exact 7-required-key `ParqResponses`
 * type zod infers — this cast is the same one `intake.ts` itself uses to
 * build the schema's field map.
 */
function allParq(value: boolean): Record<ParqQuestionId, boolean> {
  return Object.fromEntries(PARQ_QUESTIONS.map((q) => [q, value])) as Record<ParqQuestionId, boolean>;
}

describe('PARQ_QUESTIONS', () => {
  it('has exactly the seven fixed PAR-Q ids the submit_intake RPC also checks', () => {
    expect(PARQ_QUESTIONS).toEqual([
      'parq_heart',
      'parq_chest_pain',
      'parq_dizziness',
      'parq_chronic_condition',
      'parq_medication',
      'parq_musculoskeletal',
      'parq_supervised',
    ]);
  });
});

describe('INTAKE_TEMPLATE_V1', () => {
  it('has the five sections in the fixed order the design brief names', () => {
    expect(INTAKE_TEMPLATE_V1.map((s) => s.id)).toEqual([
      'parq',
      'goals',
      'history',
      'anthropometrics',
      'dietary',
    ]);
  });
});

describe('evaluateParq', () => {
  it('flags nothing when every answer is false', () => {
    const allFalse = allParq(false);
    expect(evaluateParq(allFalse)).toEqual([]);
  });

  it('flags every question independently when answered true', () => {
    for (const q of PARQ_QUESTIONS) {
      const responses = Object.fromEntries(PARQ_QUESTIONS.map((k) => [k, k === q]));
      expect(evaluateParq(responses)).toEqual([q]);
    }
  });

  it('flags all seven when every answer is true', () => {
    const allTrue = allParq(true);
    expect(evaluateParq(allTrue)).toEqual([...PARQ_QUESTIONS]);
  });

  it('treats a missing answer as not flagged', () => {
    expect(evaluateParq({})).toEqual([]);
  });
});

describe('parqResponsesSchema', () => {
  it('requires all seven questions to be booleans', () => {
    const allFalse = allParq(false);
    expect(parqResponsesSchema.safeParse(allFalse).success).toBe(true);
  });

  it('rejects a missing question', () => {
    const { parq_heart: _drop, ...rest } = allParq(false);
    expect(parqResponsesSchema.safeParse(rest).success).toBe(false);
  });
});

describe('intakeResponsesSchema', () => {
  const allFalse = allParq(false);

  it('accepts PAR-Q alone — nothing else is required', () => {
    const result = intakeResponsesSchema.safeParse({ parq: allFalse });
    expect(result.success).toBe(true);
  });

  it('rejects a response object with no parq section at all', () => {
    expect(intakeResponsesSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a fully filled response object', () => {
    const result = intakeResponsesSchema.safeParse({
      parq: allFalse,
      goals: { primary_goal: 'Lose fat', target_date: '2026-12-01', motivation: 'Wedding' },
      history: { years_training: 2, injuries: 'Left knee, 2023', previous_programs: 'Couch to 5k' },
      anthropometrics: { date_of_birth: '1994-03-02', sex: 'female', height_cm: 168, weight_kg: 64 },
      dietary: { restrictions: ['vegetarian', 'nut_allergy'], notes: 'No shellfish' },
    });
    expect(result.success).toBe(true);
  });
});

describe('goalsResponsesSchema', () => {
  it('accepts an empty object — every field in this section is optional', () => {
    expect(goalsResponsesSchema.safeParse({}).success).toBe(true);
  });
});

describe('intakeCompletion', () => {
  it('reports 0 of 5 sections on an empty parq-only response with nothing else', () => {
    const allFalse = allParq(false);
    const result = intakeCompletion({ parq: allFalse });
    expect(result.answered).toBe(1);
    expect(result.total).toBe(5);
    expect(result.stepStatus).toEqual({
      parq: true,
      goals: false,
      history: false,
      anthropometrics: false,
      dietary: false,
    });
  });

  it('reports 0 of 5 when every section key is present but empty', () => {
    // The exact shape the intake screen seeds from emptyResponses(). Counting key
    // presence here showed a client who had answered nothing five green ticks.
    const result = intakeCompletion({
      parq: Object.fromEntries(PARQ_QUESTIONS.map((q) => [q, undefined])) as never,
      goals: {},
      history: {},
      anthropometrics: {},
      dietary: {},
    });
    expect(result.answered).toBe(0);
    expect(result.stepStatus).toEqual({
      parq: false,
      goals: false,
      history: false,
      anthropometrics: false,
      dietary: false,
    });
  });

  it('leaves PAR-Q incomplete until all seven questions are answered', () => {
    const partial = { ...allParq(false), parq_supervised: undefined } as never;
    expect(intakeCompletion({ parq: partial }).stepStatus.parq).toBe(false);
    expect(intakeCompletion({ parq: allParq(false) }).stepStatus.parq).toBe(true);
  });

  it('counts a section with one real answer, and skips blank strings and empty arrays', () => {
    const result = intakeCompletion({
      parq: allParq(false),
      goals: { primary_goal: '   ' },
      history: { years_training: 0 },
      anthropometrics: { sex: 'male' },
      dietary: { restrictions: [] },
    });
    expect(result.stepStatus).toEqual({
      parq: true,
      // whitespace only — the client typed nothing
      goals: false,
      // zero years is a beginner's real answer, not an absence of one
      history: true,
      anthropometrics: true,
      dietary: false,
    });
    expect(result.answered).toBe(3);
  });
});

describe('intakeSummary', () => {
  const allFalse = allParq(false);

  it('passes metric values through unchanged', () => {
    const summary = intakeSummary(
      {
        parq: allFalse,
        anthropometrics: { height_cm: 180, weight_kg: 80, date_of_birth: '1990-01-01', sex: 'male' },
        goals: { primary_goal: 'Build strength' },
      },
      'metric',
    );
    expect(summary.height).toBe(180);
    expect(summary.weight).toBe(80);
    expect(summary.sex).toBe('male');
    expect(summary.primaryGoal).toBe('Build strength');
    expect(summary.flagCount).toBe(0);
  });

  it('converts cm/kg to in/lb for imperial', () => {
    const summary = intakeSummary(
      { parq: allFalse, anthropometrics: { height_cm: 180, weight_kg: 80 } },
      'imperial',
    );
    // 180 cm / 2.54 = 70.866..., 80 kg * 2.20462 = 176.3696
    expect(summary.height).toBeCloseTo(70.9, 1);
    expect(summary.weight).toBeCloseTo(176.4, 1);
  });

  it('leaves fields null when their source data is missing', () => {
    const summary = intakeSummary({ parq: allFalse }, 'metric');
    expect(summary.height).toBeNull();
    expect(summary.weight).toBeNull();
    expect(summary.ageYears).toBeNull();
    expect(summary.primaryGoal).toBeNull();
  });

  it('counts flags from a red_flags array when given', () => {
    const summary = intakeSummary({ parq: allFalse }, 'metric', ['parq_heart', 'parq_dizziness']);
    expect(summary.flagCount).toBe(2);
  });
});

describe('checkNumericField', () => {
  it('treats an unanswered field as fine — only PAR-Q is required', () => {
    expect(checkNumericField('', 'weight_kg')).toBeNull();
    expect(checkNumericField('   ', 'height_cm')).toBeNull();
  });

  it('reports not_a_number for text the field cannot parse', () => {
    // sanitizeDecimal on the screen strips letters, so a lone '.' is the realistic case.
    expect(checkNumericField('.', 'weight_kg')).toBe('not_a_number');
    expect(checkNumericField('abc', 'weight_kg')).toBe('not_a_number');
  });

  it('accepts zero years of training — a beginner has trained none', () => {
    expect(checkNumericField('0', 'years_training')).toBeNull();
  });

  it('rejects a height typed in metres and a weight typed in pounds', () => {
    expect(checkNumericField('1.75', 'height_cm')).toBe('below_min');
    expect(checkNumericField('1750', 'height_cm')).toBe('above_max');
    expect(checkNumericField('440', 'weight_kg')).toBe('above_max');
  });

  it('accepts the exact bounds', () => {
    for (const field of ['years_training', 'height_cm', 'weight_kg'] as const) {
      const { min, max } = INTAKE_LIMITS[field];
      expect(checkNumericField(String(min), field)).toBeNull();
      expect(checkNumericField(String(max), field)).toBeNull();
    }
  });

  it('agrees with the zod schemas it shares INTAKE_LIMITS with', () => {
    expect(historyResponsesSchema.safeParse({ years_training: 0 }).success).toBe(true);
    expect(historyResponsesSchema.safeParse({ years_training: 81 }).success).toBe(false);
    expect(anthropometricsResponsesSchema.safeParse({ height_cm: 1.75 }).success).toBe(false);
    expect(anthropometricsResponsesSchema.safeParse({ weight_kg: 72.5 }).success).toBe(true);
  });
});

describe('intake date fields', () => {
  it('allows a birthday up to today and refuses one in the future', () => {
    const today = todayCalendarDate();
    expect(intakeDateBounds().date_of_birth.max).toBe(today);
    expect(anthropometricsResponsesSchema.safeParse({ date_of_birth: today }).success).toBe(true);
    expect(anthropometricsResponsesSchema.safeParse({ date_of_birth: '2999-01-01' }).success).toBe(false);
  });

  it('refuses a date that is well-shaped but not a real day', () => {
    // The old z.string() let all three of these reach the database, and a garbage
    // date_of_birth then showed the PT no age at all rather than an error.
    expect(anthropometricsResponsesSchema.safeParse({ date_of_birth: '2026-02-30' }).success).toBe(false);
    expect(anthropometricsResponsesSchema.safeParse({ date_of_birth: '14/09/2026' }).success).toBe(false);
    expect(goalsResponsesSchema.safeParse({ target_date: 'next June' }).success).toBe(false);
  });

  it('accepts a target date from today out to the ten-year ceiling', () => {
    const { min, max } = intakeDateBounds().target_date;
    expect(goalsResponsesSchema.safeParse({ target_date: min }).success).toBe(true);
    expect(goalsResponsesSchema.safeParse({ target_date: max }).success).toBe(true);
    expect(Number(max.slice(0, 4)) - Number(min.slice(0, 4))).toBe(10);
  });
});

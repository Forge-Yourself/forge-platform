import { describe, expect, it } from 'vitest';
import {
  evaluateParq,
  goalsResponsesSchema,
  intakeCompletion,
  intakeResponsesSchema,
  intakeSummary,
  INTAKE_TEMPLATE_V1,
  PARQ_QUESTIONS,
  parqResponsesSchema,
} from './intake';

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
    const allFalse = Object.fromEntries(PARQ_QUESTIONS.map((q) => [q, false]));
    expect(evaluateParq(allFalse)).toEqual([]);
  });

  it('flags every question independently when answered true', () => {
    for (const q of PARQ_QUESTIONS) {
      const responses = Object.fromEntries(PARQ_QUESTIONS.map((k) => [k, k === q]));
      expect(evaluateParq(responses)).toEqual([q]);
    }
  });

  it('flags all seven when every answer is true', () => {
    const allTrue = Object.fromEntries(PARQ_QUESTIONS.map((q) => [q, true]));
    expect(evaluateParq(allTrue)).toEqual([...PARQ_QUESTIONS]);
  });

  it('treats a missing answer as not flagged', () => {
    expect(evaluateParq({})).toEqual([]);
  });
});

describe('parqResponsesSchema', () => {
  it('requires all seven questions to be booleans', () => {
    const allFalse = Object.fromEntries(PARQ_QUESTIONS.map((q) => [q, false]));
    expect(parqResponsesSchema.safeParse(allFalse).success).toBe(true);
  });

  it('rejects a missing question', () => {
    const { parq_heart: _drop, ...rest } = Object.fromEntries(PARQ_QUESTIONS.map((q) => [q, false]));
    expect(parqResponsesSchema.safeParse(rest).success).toBe(false);
  });
});

describe('intakeResponsesSchema', () => {
  const allFalse = Object.fromEntries(PARQ_QUESTIONS.map((q) => [q, false]));

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
    const allFalse = Object.fromEntries(PARQ_QUESTIONS.map((q) => [q, false]));
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

  it('reports 5 of 5 once every top-level key is present, regardless of how thorough each section is', () => {
    const allFalse = Object.fromEntries(PARQ_QUESTIONS.map((q) => [q, false]));
    const result = intakeCompletion({
      parq: allFalse,
      goals: {},
      history: {},
      anthropometrics: {},
      dietary: {},
    });
    expect(result.answered).toBe(5);
    expect(result.total).toBe(5);
  });
});

describe('intakeSummary', () => {
  const allFalse = Object.fromEntries(PARQ_QUESTIONS.map((q) => [q, false]));

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

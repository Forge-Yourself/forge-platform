import { describe, expect, it } from 'vitest';
import {
  AI_CREDIT_PACKS,
  AI_LOW_BALANCE_THRESHOLD,
  aiDraftModelSchema,
  aiProgramDraftRequestSchema,
  aiProgramDraftResponseSchema,
  creditState,
  draftToSaveProgramPayload,
  type ResolvedDraft,
} from './ai';
import { saveProgramPayloadSchema } from './programs';

const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const EXERCISE_ID = '33333333-3333-4333-8333-333333333333';
const GENERATION_ID = '44444444-4444-4444-8444-444444444444';

describe('aiProgramDraftRequestSchema', () => {
  const valid = {
    clientId: CLIENT_ID,
    goal: 'strength',
    equipment: ['barbell', 'dumbbell'],
    experience: 'intermediate',
  };

  it('accepts the three required inputs', () => {
    expect(aiProgramDraftRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('defaults to a four-week program', () => {
    expect(aiProgramDraftRequestSchema.parse(valid).weeks).toBe(4);
  });

  it('requires at least one piece of equipment', () => {
    expect(aiProgramDraftRequestSchema.safeParse({ ...valid, equipment: [] }).success).toBe(false);
  });

  it('rejects an equipment value outside chk_exercises_equipment', () => {
    expect(aiProgramDraftRequestSchema.safeParse({ ...valid, equipment: ['sandbag'] }).success).toBe(false);
  });

  it('trims the free-text exclusion and caps it', () => {
    const parsed = aiProgramDraftRequestSchema.parse({ ...valid, avoid: '  No overhead pressing.  ' });
    expect(parsed.avoid).toBe('No overhead pressing.');
    expect(aiProgramDraftRequestSchema.safeParse({ ...valid, avoid: 'x'.repeat(501) }).success).toBe(false);
  });

  it('rejects a field the route decides for itself', () => {
    expect(aiProgramDraftRequestSchema.safeParse({ ...valid, model: 'claude-opus-5' }).success).toBe(false);
    expect(aiProgramDraftRequestSchema.safeParse({ ...valid, credits: 0 }).success).toBe(false);
  });
});

describe('aiDraftModelSchema', () => {
  const modelOutput = {
    summary: '3 days/week · 18 exercises · no overhead press',
    weeks: [
      {
        weekNumber: 1,
        label: 'Base',
        days: [
          {
            dayNumber: 1,
            label: 'Lower body',
            blocks: [
              {
                blockType: 'working',
                label: 'Main lift',
                restBetweenSec: 180,
                exercises: [
                  {
                    exerciseSlug: 'barbell_back_squat',
                    why: 'Primary strength driver; load progresses weekly.',
                    targetSets: 4,
                    targetRepsMin: 6,
                    targetRepsMax: 6,
                    targetRpe: 7,
                    restSec: 180,
                    tempoPrescribed: '3-1-1',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it('accepts a well-formed model output', () => {
    expect(aiDraftModelSchema.safeParse(modelOutput).success).toBe(true);
  });

  it('accepts a null RPE and a null tempo — warm-ups prescribe neither', () => {
    const relaxed = structuredClone(modelOutput);
    relaxed.weeks[0].days[0].blocks[0].exercises[0].targetRpe = null;
    relaxed.weeks[0].days[0].blocks[0].exercises[0].tempoPrescribed = null;
    expect(aiDraftModelSchema.safeParse(relaxed).success).toBe(true);
  });

  it('rejects a program with no weeks or a day with no blocks', () => {
    expect(aiDraftModelSchema.safeParse({ ...modelOutput, weeks: [] }).success).toBe(false);

    const empty = structuredClone(modelOutput);
    empty.weeks[0].days[0].blocks = [];
    expect(aiDraftModelSchema.safeParse(empty).success).toBe(false);
  });

  it('rejects a block type outside chk_pb_block_type', () => {
    const bad = structuredClone(modelOutput);
    bad.weeks[0].days[0].blocks[0].blockType = 'giant_set';
    expect(aiDraftModelSchema.safeParse(bad).success).toBe(false);
  });
});

describe('draftToSaveProgramPayload', () => {
  const draft: ResolvedDraft = {
    summary: '3 days/week · 2 exercises',
    weeks: [
      {
        week_number: 1,
        label: 'Base',
        days: [
          {
            day_number: 1,
            label: 'Lower body',
            blocks: [
              {
                sort_order: 0,
                block_type: 'superset',
                label: 'Main lift',
                rest_between_sec: 180,
                exercises: [
                  {
                    sort_order: 0,
                    exercise_id: EXERCISE_ID,
                    exercise_name: 'Barbell Back Squat',
                    why: 'Primary strength driver.',
                    target_sets: 4,
                    target_reps_min: 6,
                    target_reps_max: 8,
                    target_rpe: 7.5,
                    rest_sec: 180,
                    tempo_prescribed: '3-1-1',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it('produces a payload save_program accepts', () => {
    const result = saveProgramPayloadSchema.safeParse(draftToSaveProgramPayload(draft));
    expect(result.success).toBe(true);
  });

  it('drops the presentation-only fields — a rationale is never persisted', () => {
    const exercise = draftToSaveProgramPayload(draft).weeks[0]?.days[0]?.blocks[0]?.exercises[0];
    expect(exercise).toBeDefined();
    expect('why' in (exercise as object)).toBe(false);
    expect('exercise_name' in (exercise as object)).toBe(false);
  });

  it('carries the prescription through unchanged', () => {
    const exercise = draftToSaveProgramPayload(draft).weeks[0]?.days[0]?.blocks[0]?.exercises[0];
    expect(exercise?.target_sets).toBe(4);
    expect(exercise?.target_reps_min).toBe(6);
    expect(exercise?.target_reps_max).toBe(8);
    expect(exercise?.target_rpe).toBe(7.5);
    expect(exercise?.tempo_prescribed).toBe('3-1-1');
  });

  it('keeps a block type the database recognises and falls back when it does not', () => {
    expect(draftToSaveProgramPayload(draft).weeks[0]?.days[0]?.blocks[0]?.block_type).toBe('superset');

    const bogus = structuredClone(draft);
    bogus.weeks[0]!.days[0]!.blocks[0]!.block_type = 'nonsense';
    expect(draftToSaveProgramPayload(bogus).weeks[0]?.days[0]?.blocks[0]?.block_type).toBe('working');
  });
});

describe('aiProgramDraftResponseSchema', () => {
  it('requires the generation id, the post-charge balance, and the draft', () => {
    const result = aiProgramDraftResponseSchema.safeParse({
      generationId: GENERATION_ID,
      balance: 9,
      lowBalance: false,
      draft: { summary: 'x', weeks: [] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative balance — chk_acw_balance never allows one', () => {
    const result = aiProgramDraftResponseSchema.safeParse({
      generationId: GENERATION_ID,
      balance: -1,
      lowBalance: true,
      draft: { summary: 'x', weeks: [] },
    });
    expect(result.success).toBe(false);
  });
});

describe('creditState', () => {
  it('reports empty at zero — the upsell prompt, per D36', () => {
    expect(creditState(0)).toBe('empty');
  });

  it('reports low at or below the threshold of 3', () => {
    expect(AI_LOW_BALANCE_THRESHOLD).toBe(3);
    expect(creditState(1)).toBe('low');
    expect(creditState(3)).toBe('low');
  });

  it('reports ok above the threshold', () => {
    expect(creditState(4)).toBe('ok');
    expect(creditState(10)).toBe('ok');
  });
});

describe('AI_CREDIT_PACKS', () => {
  it('offers the three packs the low-credit sheet renders', () => {
    expect(AI_CREDIT_PACKS.map((p) => p.credits)).toEqual([20, 50, 150]);
    expect(AI_CREDIT_PACKS.map((p) => p.priceCents)).toEqual([500, 1000, 2500]);
  });

  it('uses tiers chk_acp_tier allows', () => {
    for (const pack of AI_CREDIT_PACKS) {
      expect(['starter', 'standard', 'power', 'mega']).toContain(pack.tier);
    }
  });

  it('marks exactly one pack as best value', () => {
    const flagged = AI_CREDIT_PACKS.filter((p) => 'bestValue' in p && p.bestValue);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.tier).toBe('standard');
  });
});

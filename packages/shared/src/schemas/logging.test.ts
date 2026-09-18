import { describe, expect, it } from 'vitest';
import {
  completeSessionInputSchema,
  detectPrs,
  formatElapsed,
  logSetInputSchema,
  LOGGING_LIMITS,
  sessionVolume,
} from './logging';

const ULID = '01J8RZ0000000000000000AAAA';
const base = { id: ULID, weight_kg: 100, reps: 8, rpe: null, notes: null, is_warmup: false };

describe('logSetInputSchema', () => {
  it('accepts a weight x reps set', () => {
    expect(logSetInputSchema.safeParse(base).success).toBe(true);
  });

  it('accepts reps alone for a bodyweight movement', () => {
    expect(logSetInputSchema.safeParse({ ...base, weight_kg: null }).success).toBe(true);
  });

  it('rejects a set with neither weight nor reps (mirrors log_set 23514)', () => {
    expect(logSetInputSchema.safeParse({ ...base, weight_kg: null, reps: null }).success).toBe(false);
  });

  it('bounds weight and reps from LOGGING_LIMITS, once', () => {
    expect(logSetInputSchema.safeParse({ ...base, weight_kg: LOGGING_LIMITS.weight_kg.max + 1 }).success).toBe(false);
    expect(logSetInputSchema.safeParse({ ...base, reps: LOGGING_LIMITS.reps.max + 1 }).success).toBe(false);
  });

  it('accepts RPE in half steps between 1 and 10 (chk_sets_rpe)', () => {
    expect(logSetInputSchema.safeParse({ ...base, rpe: 7.5 }).success).toBe(true);
    expect(logSetInputSchema.safeParse({ ...base, rpe: 7.3 }).success).toBe(false);
    expect(logSetInputSchema.safeParse({ ...base, rpe: 10.5 }).success).toBe(false);
  });

  it('rejects a malformed id', () => {
    expect(logSetInputSchema.safeParse({ ...base, id: 'nope' }).success).toBe(false);
  });
});

describe('completeSessionInputSchema', () => {
  it('accepts an empty finish and a rated one (chk_ws_rating)', () => {
    expect(completeSessionInputSchema.safeParse({ rating: null, notes: null }).success).toBe(true);
    expect(completeSessionInputSchema.safeParse({ rating: 5, notes: 'great' }).success).toBe(true);
    expect(completeSessionInputSchema.safeParse({ rating: 6, notes: null }).success).toBe(false);
  });
});

describe('formatElapsed', () => {
  it('formats under an hour as M:SS and over as H:MM:SS', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65)).toBe('1:05');
    expect(formatElapsed(3_725)).toBe('1:02:05');
  });
});

describe('sessionVolume', () => {
  it('sums weight x reps over working sets only', () => {
    expect(
      sessionVolume([
        { weight_kg: 100, reps: 8, is_warmup: false },
        { weight_kg: 60, reps: 10, is_warmup: true },
        { weight_kg: null, reps: 12, is_warmup: false },
      ]),
    ).toBe(800);
  });
});

describe('detectPrs — the TS mirror of log_set', () => {
  const prior = [
    { weight_kg: 100, reps: 8, is_warmup: false },
    { weight_kg: 80, reps: 12, is_warmup: false },
    { weight_kg: 200, reps: 20, is_warmup: true }, // ignored
  ];

  it('flags weight, reps and volume against the best prior working set', () => {
    expect(detectPrs({ weight_kg: 102.5, reps: 5, is_warmup: false }, prior)).toEqual(['weight']);
    expect(detectPrs({ weight_kg: 60, reps: 13, is_warmup: false }, prior)).toEqual(['reps']);
    expect(detectPrs({ weight_kg: 100, reps: 10, is_warmup: false }, prior)).toEqual(['volume']);
  });

  it('first ever working set is a PR on every axis it has a value for', () => {
    expect(detectPrs({ weight_kg: 50, reps: 5, is_warmup: false }, [])).toEqual(['weight', 'reps', 'volume']);
    expect(detectPrs({ weight_kg: null, reps: 5, is_warmup: false }, [])).toEqual(['reps']);
  });

  it('a warm-up never earns a PR', () => {
    expect(detectPrs({ weight_kg: 500, reps: 50, is_warmup: true }, prior)).toEqual([]);
  });
});

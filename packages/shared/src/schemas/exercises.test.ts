import { describe, expect, it } from 'vitest';
import {
  createCustomExerciseSchema,
  DIFFICULTIES,
  EQUIPMENT,
  equipmentSchema,
  exerciseSearchSchema,
  MOVEMENT_PATTERNS,
  movementPatternSchema,
  MUSCLE_GROUPS,
  muscleGroupSchema,
} from './exercises';

describe('exercise enums', () => {
  it('accepts every value in chk_exercises_muscle_group', () => {
    expect(MUSCLE_GROUPS).toHaveLength(20);
    for (const value of MUSCLE_GROUPS) {
      expect(muscleGroupSchema.safeParse(value).success).toBe(true);
    }
  });

  it('accepts every value in chk_exercises_equipment', () => {
    expect(EQUIPMENT).toHaveLength(16);
    for (const value of EQUIPMENT) {
      expect(equipmentSchema.safeParse(value).success).toBe(true);
    }
  });

  it('accepts every value in chk_exercises_movement', () => {
    expect(MOVEMENT_PATTERNS).toHaveLength(12);
    for (const value of MOVEMENT_PATTERNS) {
      expect(movementPatternSchema.safeParse(value).success).toBe(true);
    }
  });

  it('rejects a value outside each CHECK constraint', () => {
    expect(muscleGroupSchema.safeParse('pecs').success).toBe(false);
    expect(equipmentSchema.safeParse('sandbag').success).toBe(false);
    expect(movementPatternSchema.safeParse('jump').success).toBe(false);
  });

  it('has exactly the three difficulties chk_exercises_difficulty allows', () => {
    expect([...DIFFICULTIES]).toEqual(['beginner', 'intermediate', 'advanced']);
  });
});

describe('exerciseSearchSchema', () => {
  it('accepts an entirely empty search — every filter is independent', () => {
    expect(exerciseSearchSchema.safeParse({}).success).toBe(true);
  });

  it('accepts filters that compose', () => {
    const result = exerciseSearchSchema.safeParse({
      query: 'press',
      muscle: 'chest',
      equipment: 'barbell',
      pattern: 'push',
    });
    expect(result.success).toBe(true);
  });

  it('trims the query', () => {
    expect(exerciseSearchSchema.parse({ query: '  press  ' }).query).toBe('press');
  });

  it('caps the page size at 100', () => {
    expect(exerciseSearchSchema.safeParse({ limit: 100 }).success).toBe(true);
    expect(exerciseSearchSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(exerciseSearchSchema.safeParse({ offset: -1 }).success).toBe(false);
  });

  it('rejects a field outside the granted set', () => {
    expect(exerciseSearchSchema.safeParse({ is_custom: true }).success).toBe(false);
  });
});

describe('createCustomExerciseSchema', () => {
  const valid = { name: 'Landmine Row', muscleGroup: 'back', equipment: 'barbell' };

  it('requires only name, muscle group and equipment', () => {
    expect(createCustomExerciseSchema.safeParse(valid).success).toBe(true);
  });

  it('defaults the movement pattern to other', () => {
    expect(createCustomExerciseSchema.parse(valid).movementPattern).toBe('other');
  });

  it('trims the name and rejects an empty one', () => {
    expect(createCustomExerciseSchema.parse({ ...valid, name: '  Row  ' }).name).toBe('Row');
    expect(createCustomExerciseSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });

  it('rejects an invalid enum value', () => {
    expect(createCustomExerciseSchema.safeParse({ ...valid, muscleGroup: 'pecs' }).success).toBe(false);
    expect(createCustomExerciseSchema.safeParse({ ...valid, difficulty: 'elite' }).success).toBe(false);
  });

  it('caps coaching cues at 10', () => {
    const cues = Array.from({ length: 11 }, (_, i) => 'cue ' + i);
    expect(createCustomExerciseSchema.safeParse({ ...valid, coachingCues: cues }).success).toBe(false);
    expect(createCustomExerciseSchema.safeParse({ ...valid, coachingCues: ['brace hard'] }).success).toBe(true);
  });

  it('rejects the two fields the RPC forces server-side', () => {
    expect(createCustomExerciseSchema.safeParse({ ...valid, isCustom: false }).success).toBe(false);
    expect(createCustomExerciseSchema.safeParse({ ...valid, createdByUserId: 'x' }).success).toBe(false);
  });

  it('rejects a demo video url that is not a url', () => {
    expect(createCustomExerciseSchema.safeParse({ ...valid, demoVideoUrl: 'not-a-url' }).success).toBe(false);
    expect(
      createCustomExerciseSchema.safeParse({ ...valid, demoVideoUrl: 'https://example.com/a.mp4' }).success,
    ).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { base64ToBytes, bodyMetricInputSchema, photoObjectPaths, photoPoseSchema } from './schemas';

const ID = '0192f000-0000-7000-8000-000000000001';
const CLIENT = '0192f000-0000-7000-8000-000000000002';
const base = { id: ID, client_id: CLIENT, measured_at: null, weight_kg: null, body_fat_pct: null, circumferences: null, note: null };

describe('bodyMetricInputSchema (same bounds as 0017 CHECKs)', () => {
  it('accepts one value', () => {
    expect(bodyMetricInputSchema.safeParse({ ...base, weight_kg: 70.4 }).success).toBe(true);
    expect(bodyMetricInputSchema.safeParse({ ...base, circumferences: { waist: 81.5 } }).success).toBe(true);
  });

  it('refuses an empty check-in', () => {
    expect(bodyMetricInputSchema.safeParse(base).success).toBe(false);
  });

  it('refuses an unknown site and a value out of range', () => {
    expect(bodyMetricInputSchema.safeParse({ ...base, circumferences: { calf: 40 } }).success).toBe(false);
    expect(bodyMetricInputSchema.safeParse({ ...base, circumferences: { waist: 5 } }).success).toBe(false);
    expect(bodyMetricInputSchema.safeParse({ ...base, weight_kg: 0 }).success).toBe(false);
    expect(bodyMetricInputSchema.safeParse({ ...base, body_fat_pct: 101 }).success).toBe(false);
  });
});

describe('photos', () => {
  it('knows the five poses', () => {
    expect(photoPoseSchema.options).toEqual(['front', 'back', 'side_left', 'side_right', 'custom']);
  });

  it('lays objects out as <client>/<photo>/{full,thumb}.jpg', () => {
    expect(photoObjectPaths(CLIENT, ID)).toEqual({
      full: `${CLIENT}/${ID}/full.jpg`,
      thumb: `${CLIENT}/${ID}/thumb.jpg`,
    });
  });
});

describe('base64ToBytes', () => {
  it('decodes plain and data-URI base64', () => {
    expect(Array.from(base64ToBytes('aGVsbG8='))).toEqual([104, 101, 108, 108, 111]);
    expect(Array.from(base64ToBytes('data:image/jpeg;base64,/9j/'))).toEqual([255, 216, 255]);
  });
});

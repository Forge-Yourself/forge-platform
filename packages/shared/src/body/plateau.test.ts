import { describe, expect, it } from 'vitest';
import { plateau, weekStartUtc } from './plateau';

const DAY = 86_400_000;
const THU = Date.UTC(2026, 8, 17, 12); // Thursday 17 Sep 2026
const pts = (now: number, pairs: [number, number][]) => pairs.map(([daysAgo, value]) => ({ ms: now - daysAgo * DAY, value }));

describe('weekStartUtc', () => {
  it('is Monday 00:00 UTC', () => {
    expect(weekStartUtc(THU)).toBe(Date.UTC(2026, 8, 14));
    expect(weekStartUtc(Date.UTC(2026, 8, 20, 23))).toBe(Date.UTC(2026, 8, 14));
    expect(weekStartUtc(Date.UTC(2026, 8, 21))).toBe(Date.UTC(2026, 8, 21));
  });
});

describe('plateau (mirrors public.body_plateau)', () => {
  const flat: [number, number][] = [[0, 80.0], [7, 80.2], [14, 80.1], [21, 80.3]];

  it('four flat weeks are a plateau', () => {
    expect(plateau(pts(THU, flat), THU)).toBe(true);
  });

  it('a 4 kg move is not', () => {
    expect(plateau(pts(THU, [[0, 80.0], [7, 80.2], [14, 80.1], [21, 84]]), THU)).toBe(false);
  });

  it('three weeks are not enough', () => {
    expect(plateau(pts(THU, flat.slice(0, 3)), THU)).toBe(false);
  });

  it('a flat month that ended weeks ago is not flagged', () => {
    expect(plateau(pts(THU, [[28, 80.0], [35, 80.2], [42, 80.1], [49, 80.1]]), THU)).toBe(false);
  });

  it('survives Monday morning before the week\'s weigh-in', () => {
    const monday = Date.UTC(2026, 8, 21, 6);
    expect(plateau(pts(THU, flat), monday)).toBe(true);
  });

  it('averages several weights in one week', () => {
    expect(plateau(pts(THU, [...flat, [1, 90]]), THU)).toBe(false);
    expect(plateau(pts(THU, [...flat, [1, 80.0]]), THU)).toBe(true);
  });

  it('sits either side of the 0.5 % line', () => {
    // weekly means 100, 100, 100, 100.5: spread 0.5 / mean 100.125 = 0.4994 % -> plateau
    expect(plateau(pts(THU, [[0, 100], [7, 100], [14, 100], [21, 100.5]]), THU)).toBe(true);
    // 100 and 100.51: 0.51 / 100.1275 = 0.509 % -> not
    expect(plateau(pts(THU, [[0, 100], [7, 100], [14, 100], [21, 100.51]]), THU)).toBe(false);
  });

  it('is false with no points', () => {
    expect(plateau([], THU)).toBe(false);
  });
});

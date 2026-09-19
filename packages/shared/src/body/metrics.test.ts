import { describe, expect, it } from 'vitest';
import {
  chartGeometry,
  historyRows,
  metricPayload,
  metricPoints,
  metricValue,
  nearestValue,
  seriesDelta,
  weekLabels,
  windowPoints,
  type BodyMetricRowLike,
} from './metrics';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 17, 12);

function row(daysAgo: number, v: Partial<BodyMetricRowLike>, id = `r${daysAgo}`): BodyMetricRowLike {
  return {
    id,
    measured_at: new Date(NOW - daysAgo * DAY).toISOString(),
    recorded_by_user_id: 'u1',
    weight_kg: null,
    body_fat_pct: null,
    circumferences: null,
    ...v,
  };
}

describe('metricValue', () => {
  it('reads weight, body fat and a circumference site', () => {
    const r = row(0, { weight_kg: 70.4, body_fat_pct: 22.5, circumferences: { waist: 81.5 } });
    expect(metricValue(r, 'weight')).toBe(70.4);
    expect(metricValue(r, 'body_fat')).toBe(22.5);
    expect(metricValue(r, 'waist')).toBe(81.5);
    expect(metricValue(r, 'hips')).toBeNull();
  });

  it('ignores a malformed circumferences value', () => {
    expect(metricValue(row(0, { circumferences: [1, 2] }), 'waist')).toBeNull();
    expect(metricValue(row(0, { circumferences: { waist: '80' } }), 'waist')).toBeNull();
  });
});

describe('metricPoints / windowPoints', () => {
  const rows = [
    row(1, { weight_kg: 70 }),
    row(20, { weight_kg: 71 }),
    row(3, { body_fat_pct: 22 }),
    row(60, { weight_kg: 73 }),
  ];

  it('keeps only rows that carry the metric, oldest first', () => {
    expect(metricPoints(rows, 'weight').map((p) => p.value)).toEqual([73, 71, 70]);
  });

  it('cuts to the window', () => {
    const pts = metricPoints(rows, 'weight');
    expect(windowPoints(pts, 4, NOW).map((p) => p.value)).toEqual([71, 70]);
    expect(windowPoints(pts, 12, NOW).map((p) => p.value)).toEqual([73, 71, 70]);
  });
});

describe('seriesDelta / historyRows', () => {
  const pts = metricPoints([row(14, { weight_kg: 72 }), row(7, { weight_kg: 71.5 }), row(0, { weight_kg: 71.6 })], 'weight');

  it('is last minus first, null with fewer than two points', () => {
    expect(seriesDelta(pts)).toBeCloseTo(-0.4, 6);
    expect(seriesDelta(pts.slice(0, 1))).toBeNull();
  });

  it('lists newest first with the change from the row before it', () => {
    const h = historyRows(pts);
    expect(h.map((r) => r.point.value)).toEqual([71.6, 71.5, 72]);
    expect(h[0]?.delta).toBeCloseTo(0.1, 6);
    expect(h[1]?.delta).toBeCloseTo(-0.5, 6);
    expect(h[2]?.delta).toBeNull();
  });
});

describe('nearestValue', () => {
  const pts = metricPoints([row(30, { weight_kg: 74 }), row(10, { weight_kg: 72 })], 'weight');
  it('picks the closest point inside the tolerance', () => {
    expect(nearestValue(pts, NOW - 12 * DAY, 7)).toBe(72);
  });
  it('returns null when nothing is close enough', () => {
    expect(nearestValue(pts, NOW - 20 * DAY, 7)).toBeNull();
  });
});

describe('metricPayload', () => {
  it('puts a weight in weight_kg only', () => {
    expect(metricPayload('weight', 70.4)).toEqual({ weight_kg: 70.4, body_fat_pct: null, circumferences: null });
  });
  it('puts a site in circumferences', () => {
    expect(metricPayload('neck', 38)).toEqual({ weight_kg: null, body_fat_pct: null, circumferences: { neck: 38 } });
  });
});

describe('chartGeometry', () => {
  it('maps time to x and value to y inside the 300x118 box', () => {
    const g = chartGeometry(
      [
        { ms: 0, value: 10 },
        { ms: 50, value: 20 },
        { ms: 100, value: 15 },
      ],
      0,
      100,
    );
    expect(g?.line).toBe('8.0,106.0 150.0,18.0 292.0,62.0');
    expect(g?.area).toBe('8.0,118 8.0,106.0 150.0,18.0 292.0,62.0 292.0,118');
    expect(g?.last).toEqual({ x: 292, y: 62 });
  });

  it('draws a single point on the baseline instead of dividing by zero', () => {
    expect(chartGeometry([{ ms: 5, value: 70 }], 5, 5)?.line).toBe('150.0,106.0');
  });

  it('returns null for no points', () => {
    expect(chartGeometry([], 0, 1)).toBeNull();
  });
});

describe('weekLabels', () => {
  it('matches the prototype for eight weeks and scales for the others', () => {
    expect(weekLabels(8)).toEqual([1, 3, 5, 8]);
    expect(weekLabels(4)).toEqual([1, 2, 3, 4]);
    expect(weekLabels(26)).toEqual([1, 10, 16, 26]);
  });
});

/**
 * Body metrics as the screens read them. A body_metrics row is one check-in
 * carrying whichever values were entered (spec §4), so every chart, delta and
 * history list starts by pulling ONE metric out of the rows that have it.
 */
export const CIRCUMFERENCE_SITES = ['waist', 'hips', 'chest', 'arm', 'thigh', 'neck'] as const;
export type CircumferenceSite = (typeof CIRCUMFERENCE_SITES)[number];
export type BodyMetricKey = 'weight' | 'body_fat' | CircumferenceSite;

/** The prototype's segments; the other five sites sit behind "More". */
export const PRIMARY_METRICS = ['weight', 'body_fat', 'waist'] as const satisfies readonly BodyMetricKey[];
export const MORE_METRICS = ['hips', 'chest', 'arm', 'thigh', 'neck'] as const satisfies readonly BodyMetricKey[];

export const CHART_WINDOWS = [4, 8, 12, 26] as const;
export type ChartWindow = (typeof CHART_WINDOWS)[number];
/** "Eight weeks is the window a PT reviews" — prototype annotation. */
export const DEFAULT_WINDOW: ChartWindow = 8;

const DAY = 86_400_000;

export type BodyMetricRowLike = {
  id: string;
  measured_at: string;
  recorded_by_user_id: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  circumferences: unknown;
};

export type MetricPoint = { id: string; at: string; ms: number; value: number; recordedBy: string };

export function isCircumferenceSite(key: string): key is CircumferenceSite {
  return (CIRCUMFERENCE_SITES as readonly string[]).includes(key);
}

export function metricValue(row: BodyMetricRowLike, key: BodyMetricKey): number | null {
  if (key === 'weight') return row.weight_kg === null ? null : Number(row.weight_kg);
  if (key === 'body_fat') return row.body_fat_pct === null ? null : Number(row.body_fat_pct);
  const c = row.circumferences;
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return null;
  const v = (c as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Oldest first. */
export function metricPoints(rows: readonly BodyMetricRowLike[], key: BodyMetricKey): MetricPoint[] {
  const out: MetricPoint[] = [];
  for (const r of rows) {
    const value = metricValue(r, key);
    if (value === null) continue;
    out.push({ id: r.id, at: r.measured_at, ms: Date.parse(r.measured_at), value, recordedBy: r.recorded_by_user_id });
  }
  return out.sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id));
}

export function windowPoints<T extends { ms: number }>(points: readonly T[], weeks: number, nowMs: number): T[] {
  const start = nowMs - weeks * 7 * DAY;
  return points.filter((p) => p.ms >= start);
}

export function seriesDelta(points: readonly { value: number }[]): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1]!.value - points[0]!.value;
}

/** Newest first; each row repeats its change from the row before it (prototype annotation). */
export function historyRows(points: readonly MetricPoint[]): { point: MetricPoint; delta: number | null }[] {
  const out: { point: MetricPoint; delta: number | null }[] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const prev = points[i - 1];
    out.push({ point: points[i]!, delta: prev === undefined ? null : points[i]!.value - prev.value });
  }
  return out;
}

/** The value measured closest to targetMs, within maxDays either side. Compare shows this under each photo. */
export function nearestValue(points: readonly { ms: number; value: number }[], targetMs: number, maxDays: number): number | null {
  let best: { gap: number; value: number } | null = null;
  for (const p of points) {
    const gap = Math.abs(p.ms - targetMs);
    if (gap > maxDays * DAY) continue;
    if (best === null || gap < best.gap) best = { gap, value: p.value };
  }
  return best?.value ?? null;
}

export type MetricPayload = {
  weight_kg: number | null;
  body_fat_pct: number | null;
  circumferences: Partial<Record<CircumferenceSite, number>> | null;
};

/** The record_body_metric arguments for saving one metric's stored (metric-unit) value. */
export function metricPayload(key: BodyMetricKey, stored: number): MetricPayload {
  if (key === 'weight') return { weight_kg: stored, body_fat_pct: null, circumferences: null };
  if (key === 'body_fat') return { weight_kg: null, body_fat_pct: stored, circumferences: null };
  return { weight_kg: null, body_fat_pct: null, circumferences: { [key]: stored } };
}

/**
 * Prototype chart geometry: viewBox 300x118, x from 8 to 292, y from 106
 * (lowest value) to 18 (highest). x is TIME across the window, not the point's
 * index, so a missed week shows as a gap rather than a fake steady slope.
 */
export function chartGeometry(
  points: readonly { ms: number; value: number }[],
  startMs: number,
  endMs: number,
): { line: string; area: string; last: { x: number; y: number } } | null {
  if (points.length === 0) return null;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo || 1;
  const range = endMs - startMs;
  const xy = points.map((p) => {
    const x = range > 0 ? 8 + Math.min(1, Math.max(0, (p.ms - startMs) / range)) * 284 : 150;
    const y = 106 - ((p.value - lo) / span) * 88;
    return [x, y] as const;
  });
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const first = xy[0]!;
  const last = xy[xy.length - 1]!;
  return {
    line,
    area: `${first[0].toFixed(1)},118 ${line} ${last[0].toFixed(1)},118`,
    last: { x: Math.round(last[0] * 10) / 10, y: Math.round(last[1] * 10) / 10 },
  };
}

/** Four axis labels; the prototype's "Wk 1 · Wk 3 · Wk 5 · Wk 8" for eight weeks. */
export function weekLabels(weeks: number): number[] {
  return [1, Math.round(weeks * 0.375), Math.round(weeks * 0.625), weeks];
}

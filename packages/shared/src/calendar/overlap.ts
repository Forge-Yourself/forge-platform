/**
 * Geometry for the overlap review (design screen 06): a booking bar and a
 * Google bar on one time axis, with the overlap drawn as a band, so the clash
 * is visible without reading times. Fractions are 0–1 of the axis width.
 */

export type TimeSpan = { start: string; end: string };
export type Pct = { left: number; width: number };

export type OverlapGeometry = {
  axisStart: string;
  axisEnd: string;
  /** Every 30 minutes from axisStart to axisEnd inclusive. */
  ticks: string[];
  a: Pct;
  b: Pct;
  overlap: Pct | null;
  overlapStart: string | null;
  overlapEnd: string | null;
  overlapMin: number;
};

const HALF_HOUR = 30 * 60_000;

export function overlapGeometry(a: TimeSpan, b: TimeSpan): OverlapGeometry {
  const as = Date.parse(a.start);
  const ae = Date.parse(a.end);
  const bs = Date.parse(b.start);
  const be = Date.parse(b.end);
  const axisStart = Math.floor(Math.min(as, bs) / HALF_HOUR) * HALF_HOUR - HALF_HOUR;
  const axisEnd = Math.ceil(Math.max(ae, be) / HALF_HOUR) * HALF_HOUR + HALF_HOUR;
  const span = axisEnd - axisStart;
  const pct = (s: number, e: number): Pct => ({ left: (s - axisStart) / span, width: (e - s) / span });

  const os = Math.max(as, bs);
  const oe = Math.min(ae, be);
  const has = oe > os;
  const ticks: string[] = [];
  for (let t = axisStart; t <= axisEnd; t += HALF_HOUR) ticks.push(new Date(t).toISOString());

  return {
    axisStart: new Date(axisStart).toISOString(),
    axisEnd: new Date(axisEnd).toISOString(),
    ticks,
    a: pct(as, ae),
    b: pct(bs, be),
    overlap: has ? pct(os, oe) : null,
    overlapStart: has ? new Date(os).toISOString() : null,
    overlapEnd: has ? new Date(oe).toISOString() : null,
    overlapMin: has ? Math.round((oe - os) / 60_000) : 0,
  };
}

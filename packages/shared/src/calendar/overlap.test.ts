import { describe, expect, it } from 'vitest';
import { overlapGeometry } from './overlap';

const at = (hhmm: string) => `2026-09-09T${hhmm}:00.000Z`;

describe('overlapGeometry', () => {
  // The design's example: Karim 17:00-18:00, Google · Dentist 17:30-18:30.
  const g = overlapGeometry({ start: at('17:00'), end: at('18:00') }, { start: at('17:30'), end: at('18:30') });

  it('pads the axis by 30 minutes either side', () => {
    expect(g.axisStart).toBe(at('16:30'));
    expect(g.axisEnd).toBe(at('19:00'));
  });

  it('ticks every 30 minutes from the axis start', () => {
    expect(g.ticks).toEqual([at('16:30'), at('17:00'), at('17:30'), at('18:00'), at('18:30'), at('19:00')]);
  });

  it('places both bars as fractions of the axis', () => {
    expect(g.a.left).toBeCloseTo(0.2);
    expect(g.a.width).toBeCloseTo(0.4);
    expect(g.b.left).toBeCloseTo(0.4);
    expect(g.b.width).toBeCloseTo(0.4);
  });

  it('places the overlap band and its range', () => {
    expect(g.overlap).not.toBeNull();
    expect(g.overlap!.left).toBeCloseTo(0.4);
    expect(g.overlap!.width).toBeCloseTo(0.2);
    expect(g.overlapStart).toBe(at('17:30'));
    expect(g.overlapEnd).toBe(at('18:00'));
    expect(g.overlapMin).toBe(30);
  });

  it('has no band when the spans only touch', () => {
    const t = overlapGeometry({ start: at('17:00'), end: at('18:00') }, { start: at('18:00'), end: at('19:00') });
    expect(t.overlap).toBeNull();
    expect(t.overlapMin).toBe(0);
  });

  it('rounds the axis out to the half hour', () => {
    const r = overlapGeometry({ start: at('17:10'), end: at('17:55') }, { start: at('17:40'), end: at('18:05') });
    expect(r.axisStart).toBe(at('16:30'));
    expect(r.axisEnd).toBe(at('19:00'));
  });
});

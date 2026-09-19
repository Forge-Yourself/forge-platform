/**
 * Spec D8 as the plan corrects it, and the TS twin of public.body_plateau()
 * (0017). A rule written in both languages needs tests on both sides
 * (PITFALLS): plateau.test.ts and the harness use the same fixtures.
 *
 * Anchored on the week of the LATEST weight, which must be this week or last,
 * so the flag does not vanish every Monday before the week's weigh-in and a
 * plateau from months ago is not shown as current. Weeks are Monday-start UTC.
 */
const DAY = 86_400_000;
const WEEK = 7 * DAY;
export const PLATEAU_WEEKS = 4;
export const PLATEAU_SPREAD = 0.005;

export function weekStartUtc(ms: number): number {
  const d = new Date(ms);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return midnight - ((d.getUTCDay() + 6) % 7) * DAY;
}

export function plateau(points: readonly { ms: number; value: number }[], nowMs: number): boolean {
  if (points.length === 0) return false;
  const byWeek = new Map<number, number[]>();
  for (const p of points) {
    const w = weekStartUtc(p.ms);
    const list = byWeek.get(w);
    if (list) list.push(p.value);
    else byWeek.set(w, [p.value]);
  }
  const latest = Math.max(...byWeek.keys());
  if (latest < weekStartUtc(nowMs) - WEEK) return false;

  const means: number[] = [];
  for (let i = 0; i < PLATEAU_WEEKS; i++) {
    const values = byWeek.get(latest - i * WEEK);
    if (!values) return false;
    means.push(values.reduce((a, b) => a + b, 0) / values.length);
  }
  const mean = means.reduce((a, b) => a + b, 0) / means.length;
  return (Math.max(...means) - Math.min(...means)) / mean < PLATEAU_SPREAD;
}

import { LB_PER_KG, type UnitSystem } from '../schemas/units';
import type { BodyMetricKey } from './metrics';

/**
 * Body values are STORED metric (kg, %, cm) and converted only for display,
 * like every weight in Forge. kgToDisplay() in schemas/units.ts rounds to the
 * nearest 0.5 because that is the finest plate on a bar; a body weight needs
 * its own conversion at the precision the stepper moves in.
 */
export const CM_PER_IN = 2.54;

export type BodyUnit = 'kg' | 'lb' | '%' | 'cm' | 'in';

export function bodyUnit(key: BodyMetricKey, unit: UnitSystem): BodyUnit {
  if (key === 'weight') return unit === 'imperial' ? 'lb' : 'kg';
  if (key === 'body_fat') return '%';
  return unit === 'imperial' ? 'in' : 'cm';
}

export function bodyDecimals(key: BodyMetricKey, unit: UnitSystem): number {
  return bodyUnit(key, unit) === 'in' ? 2 : 1;
}

/** Prototype METRICS: weight 0.1, body fat 0.1, waist 0.5. Imperial steps are the nearest tidy equivalent. */
export function bodyStep(key: BodyMetricKey, unit: UnitSystem): number {
  const u = bodyUnit(key, unit);
  if (u === 'kg' || u === '%') return 0.1;
  if (u === 'lb') return 0.2;
  if (u === 'cm') return 0.5;
  return 0.25;
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export function bodyToDisplay(key: BodyMetricKey, stored: number, unit: UnitSystem): number {
  const u = bodyUnit(key, unit);
  const shown = u === 'lb' ? stored * LB_PER_KG : u === 'in' ? stored / CM_PER_IN : stored;
  return round(shown, bodyDecimals(key, unit));
}

/** To the stored unit, at the column's precision (NUMERIC(5,2) for weight). */
export function bodyToStored(key: BodyMetricKey, display: number, unit: UnitSystem): number {
  const u = bodyUnit(key, unit);
  if (u === 'lb') return round(display / LB_PER_KG, 2);
  if (u === 'in') return round(display * CM_PER_IN, 2);
  return round(display, key === 'body_fat' ? 1 : 2);
}

export function stepBody(current: number, delta: number, key: BodyMetricKey, unit: UnitSystem): number {
  return round(current + delta, bodyDecimals(key, unit));
}

export function formatBody(value: number | null, key: BodyMetricKey, unit: UnitSystem): string {
  if (value === null) return '—';
  return value.toFixed(bodyDecimals(key, unit));
}

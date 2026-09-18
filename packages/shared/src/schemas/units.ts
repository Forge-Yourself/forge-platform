/**
 * Every weight is STORED in kilograms (sets.weight_kg, body_metrics.weight_kg,
 * program_exercises.target_weight_kg) and converted only at display time from
 * users.unit_system. The one conversion constant lives here; intake.ts used to
 * hold a private copy.
 */
export const LB_PER_KG = 2.20462;

export type UnitSystem = 'metric' | 'imperial';

/** Nearest 0.5 in the display unit — the finest increment a gym plate offers. */
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

export function kgToDisplay(kg: number, unit: UnitSystem): number {
  return unit === 'imperial' ? roundHalf(kg * LB_PER_KG) : roundHalf(kg);
}

/** The exact kilogram value of a number the user typed in their own unit. */
export function displayToKg(value: number, unit: UnitSystem): number {
  return unit === 'imperial' ? value / LB_PER_KG : value;
}

export function unitLabel(unit: UnitSystem): 'kg' | 'lb' {
  return unit === 'imperial' ? 'lb' : 'kg';
}

export function formatWeight(kg: number | null | undefined, unit: UnitSystem): string {
  if (kg === null || kg === undefined) return '—';
  const shown = kgToDisplay(kg, unit);
  const text = Number.isInteger(shown) ? String(shown) : shown.toFixed(1);
  return text + ' ' + unitLabel(unit);
}

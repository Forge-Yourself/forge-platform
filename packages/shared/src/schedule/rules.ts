import { parseHhmm } from './time';

export const ALL_LENGTHS = [30, 45, 60, 90] as const;

export type BookingRules = { lengths: number[]; bufferMin: number; windowWeeks: number; cutoffHours: number };

/** Display defaults only. The server's defaults (rules_for in 0020) are authoritative and arrive via booking_policy. */
export const DEFAULT_RULES: BookingRules = { lengths: [45, 60, 90], bufferMin: 15, windowWeeks: 4, cutoffHours: 12 };

/** Same bounds as 0020's CHECK constraints on booking_rules. */
export const RULE_BOUNDS = {
  bufferMin: { min: 0, max: 60, step: 5 },
  windowWeeks: { min: 1, max: 12, step: 1 },
  cutoffHours: { min: 0, max: 48, step: 1 },
} as const;

export type RuleKey = keyof typeof RULE_BOUNDS;

export function stepRule(rules: BookingRules, key: RuleKey, dir: 1 | -1): BookingRules {
  const b = RULE_BOUNDS[key];
  return { ...rules, [key]: Math.min(b.max, Math.max(b.min, rules[key] + dir * b.step)) };
}

/** "At least one stays on" (design, Rules tab). */
export function toggleLength(lengths: readonly number[], len: number): number[] {
  if (lengths.includes(len)) return lengths.length === 1 ? [...lengths] : lengths.filter((l) => l !== len);
  return [...lengths, len].sort((a, b) => a - b);
}

export type TimeRange = { start: string; end: string };
export type HoursRange = TimeRange & { dow: number };
export type ExceptionInput = { date: string; kind: 'off' | 'extra'; ranges: TimeRange[] | null };

export type HoursCheck = { ok: true } | { ok: false; code: 'bad_range' | 'overlapping_hours'; dow: number };

/**
 * The same two refusals as save_availability, checked before the round trip.
 * Zero-padded HH:MM strings order the same way as the times they name, so
 * once both ends have parsed they are compared as strings.
 */
export function validateHours(hours: readonly HoursRange[]): HoursCheck {
  for (const h of hours) {
    const s = parseHhmm(h.start);
    const e = parseHhmm(h.end);
    if (s === null || e === null || e <= s || h.dow < 0 || h.dow > 6) return { ok: false, code: 'bad_range', dow: h.dow };
  }
  for (let i = 0; i < hours.length; i++) {
    for (let j = i + 1; j < hours.length; j++) {
      const a = hours[i]!;
      const b = hours[j]!;
      if (a.dow === b.dow && a.start < b.end && b.start < a.end) return { ok: false, code: 'overlapping_hours', dow: a.dow };
    }
  }
  return { ok: true };
}

export function weeklyMinutes(hours: readonly HoursRange[]): number {
  return hours.reduce((sum, h) => sum + ((parseHhmm(h.end) ?? 0) - (parseHhmm(h.start) ?? 0)), 0);
}

export function dayRanges(hours: readonly HoursRange[], dow: number): HoursRange[] {
  return hours.filter((h) => h.dow === dow).sort((a, b) => a.start.localeCompare(b.start));
}

/** Minutes of break before `ranges[i]` on its day, or null when there is none to draw (first, touching, or overlapping). */
export function breakBefore(ranges: readonly TimeRange[], i: number): number | null {
  const prev = ranges[i - 1];
  const cur = ranges[i];
  if (!prev || !cur) return null;
  const gap = (parseHhmm(cur.start) ?? 0) - (parseHhmm(prev.end) ?? 0);
  return gap > 0 ? gap : null;
}

/** Tue–Fri become exact copies of Monday; Sunday and Saturday are untouched. */
export function copyMondayToWeekdays(hours: readonly HoursRange[]): HoursRange[] {
  const monday = dayRanges(hours, 1);
  const keep = hours.filter((h) => h.dow < 2 || h.dow > 5);
  const copies = [2, 3, 4, 5].flatMap((dow) => monday.map((m) => ({ ...m, dow })));
  return [...keep, ...copies].sort((a, b) => a.dow - b.dow || a.start.localeCompare(b.start));
}

import { describe, expect, it } from 'vitest';
import type { UnitSystem } from '../schemas/units';
import fixtures from './fixtures.json';
import { normalize, readNumber, tokenize } from './numbers';
import { bestParse, parseSetUtterance } from './parse';

type Fixture = { text: string; unit: UnitSystem; weightKg: number | null; reps: number | null; rpe: number | null };

function matches(f: Fixture): boolean {
  const p = parseSetUtterance(f.text, f.unit);
  const weightOk =
    f.weightKg === null ? p.weightKg === null : p.weightKg !== null && Math.abs(p.weightKg - f.weightKg) < 0.02;
  return weightOk && p.reps === f.reps && p.rpe === f.rpe;
}

/** Index with a guarantee; the tables below are total over the inputs used. */
function at<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`no entry ${i}`);
  return x;
}

// ── Generated fixtures: the top 25 lifts' typical loads, spoken the ways a PT says them ──
const EN_UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const EN_TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function enUnder100(n: number): string {
  if (n < 10) return at(EN_UNITS, n);
  if (n < 20) return at(EN_TEENS, n - 10);
  return at(EN_TENS, Math.floor(n / 10)) + (n % 10 ? ' ' + at(EN_UNITS, n % 10) : '');
}
/** "one hundred two", "a hundred and two", or the gym form "one oh two" / "one twenty five". */
function enInt(n: number, style: 'formal' | 'and' | 'gym'): string {
  if (n < 100) return enUnder100(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (style === 'gym' && r !== 0) return at(EN_UNITS, h) + ' ' + (r < 10 ? 'oh ' + at(EN_UNITS, r) : enUnder100(r));
  const head = style === 'and' && h === 1 ? 'a hundred' : at(EN_UNITS, h) + ' hundred';
  if (r === 0) return head;
  return head + (style === 'and' ? ' and ' : ' ') + enUnder100(r);
}
function en(n: number, style: 'formal' | 'and' | 'gym'): string {
  const int = Math.floor(n);
  if (n === int) return enInt(int, style);
  return enInt(int, style) + (style === 'and' ? ' and a half' : ' point five');
}

const AR_UNITS = ['صفر', 'واحد', 'اتنين', 'تلاتة', 'اربعة', 'خمسة', 'ستة', 'سبعة', 'تمانية', 'تسعة'];
const AR_TEENS = ['عشرة', 'حداش', 'اطنعش', 'تلطاش', 'اربعطاش', 'خمسطاش', 'سطاش', 'سبعطاش', 'تمنطاش', 'تسعطاش'];
const AR_TENS = ['', '', 'عشرين', 'تلاتين', 'اربعين', 'خمسين', 'ستين', 'سبعين', 'تمانين', 'تسعين'];
const AR_HUNDREDS = ['', 'مية', 'ميتين', 'تلتمية', 'اربعمية', 'خمسمية'];

function arUnder100(n: number): string {
  if (n < 10) return at(AR_UNITS, n);
  if (n < 20) return at(AR_TEENS, n - 10);
  // Arabic says the unit first: خمسة وعشرين = 25.
  return (n % 10 ? at(AR_UNITS, n % 10) + ' و' : '') + at(AR_TENS, Math.floor(n / 10));
}
function ar(n: number): string {
  const int = Math.floor(n);
  const h = Math.floor(int / 100);
  const r = int % 100;
  const parts: string[] = [];
  if (h) parts.push(at(AR_HUNDREDS, h));
  if (r || !h) parts.push(arUnder100(r));
  let s = parts.join(' و');
  if (n !== int) s += ' ونص';
  return s;
}

/** Loads a PT logs across the top 25 lifts (bench, squat, deadlift, OHP, row, RDL, hip thrust, curls, raises…). */
const LOADS = [20, 24, 32.5, 40, 50, 60, 62.5, 70, 80, 85, 90, 100, 102.5, 110, 115, 120, 125, 135, 140, 145, 160, 180, 200, 225, 250];
const REPS = [1, 3, 5, 6, 8, 10, 12, 15];
const RPES = [7, 8, 9];

function generated(): Fixture[] {
  const out: Fixture[] = [];
  LOADS.forEach((load, i) => {
    const reps = at(REPS, i % REPS.length);
    const rpe = at(RPES, i % RPES.length);
    out.push({ text: `${en(load, 'formal')} for ${en(reps, 'formal')}`, unit: 'metric', weightKg: load, reps, rpe: null });
    out.push({ text: `${en(load, 'and')} for ${en(reps, 'formal')} RPE ${en(rpe, 'formal')}`, unit: 'metric', weightKg: load, reps, rpe });
    if (load >= 100) out.push({ text: `${en(load, 'gym')} by ${en(reps, 'formal')}`, unit: 'metric', weightKg: load, reps, rpe: null });
    out.push({ text: `${ar(load)} على ${ar(reps)}`, unit: 'metric', weightKg: load, reps, rpe: null });
    out.push({ text: `${ar(load)} كيلو ${ar(reps)} مرات آر بي إي ${ar(rpe)}`, unit: 'metric', weightKg: load, reps, rpe });
    out.push({ text: `${load} for ${reps} at ${rpe}`, unit: 'metric', weightKg: load, reps, rpe });
  });
  return out;
}

describe('normalize', () => {
  it('folds Eastern Arabic digits and the Arabic decimal separator', () => {
    expect(normalize('١٠٢٫٥ على ٨')).toBe('102.5 علي 8');
  });
  it('splits a glued unit and a times sign', () => {
    expect(normalize('100kg 100x8')).toBe('100 kg 100 x 8');
  });
  it('keeps an Arabizi numeral that carries a digit in one piece', () => {
    expect(normalize('wa7ad arba3a 3ashra 5amsta3sh sab3in, 8reps 100كيلو')).toBe(
      'wa7ad arba3a 3ashra 5amsta3sh sab3in 8 reps 100 كيلو',
    );
  });
  it('strips diacritics and folds letter variants', () => {
    expect(normalize('مِئَةٌ أربعة')).toBe('مئه اربعه');
  });
});

describe('readNumber', () => {
  const read = (s: string) => readNumber(tokenize(normalize(s)), 0)?.value ?? null;
  it.each([
    ['one oh two point five', 102.5],
    ['a hundred and two and a half', 102.5],
    ['one twenty five', 125],
    ['one fifteen', 115],
    ['twenty five', 25],
    ['eight', 8],
    ['مية وخمسة وتمانين', 185],
    ['خمسة وعشرين', 25],
    ['خمس مية', 500],
    ['احد عشر', 11],
    ['ميه ونص', 100.5],
    ['mitt w khamse', 105],
    ['one ten', 110],
  ])('%s → %d', (s, v) => {
    expect(read(s)).toBe(v);
  });
  it('does not merge two plain units', () => {
    expect(read('eight eight')).toBe(8);
  });
});

describe('parseSetUtterance', () => {
  it('reads the prototype utterance', () => {
    expect(parseSetUtterance('one oh two point five for eight, RPE eight', 'metric')).toEqual({
      weightKg: 102.5, reps: 8, rpe: 8, spokenUnit: null, confidence: 'full',
    });
  });
  it('converts a spoken pound load to kilograms', () => {
    const p = parseSetUtterance('225 pounds for 5', 'metric');
    expect(p.spokenUnit).toBe('lb');
    expect(p.weightKg).toBeCloseTo(102.06, 2);
  });
  it('assumes the user unit when none is spoken', () => {
    expect(parseSetUtterance('225 for 5', 'imperial').weightKg).toBeCloseTo(102.06, 2);
  });
  it('drops an out-of-range value rather than clamping it', () => {
    expect(parseSetUtterance('900 for 8', 'metric')).toMatchObject({ weightKg: null, reps: 8, confidence: 'partial' });
  });
  it('reports none for speech with no numbers', () => {
    expect(parseSetUtterance('hello coach', 'metric').confidence).toBe('none');
  });
});

describe('bestParse', () => {
  it('prefers a later alternative that fills more slots', () => {
    const r = bestParse(['bench one hundred', 'bench one hundred for eight'], 'metric');
    expect(r.transcript).toBe('bench one hundred for eight');
    expect(r.parse.confidence).toBe('full');
  });
  it('keeps the recognizer order on a tie', () => {
    expect(bestParse(['100 for 8', '108'], 'metric').transcript).toBe('100 for 8');
  });
});

describe('fixtures (EP-05: ≥ 95% of the top-25-lift utterances parse exactly)', () => {
  const all: Fixture[] = [...(fixtures as Fixture[]), ...generated()];
  it('has at least 150 utterances', () => {
    expect(all.length).toBeGreaterThanOrEqual(150);
  });
  it('parses at least 95% exactly', () => {
    const failures = all.filter((f) => !matches(f));
    const rate = 1 - failures.length / all.length;
    // The message names every failing utterance, so a regression says which one.
    expect(rate, failures.map((f) => f.text).join(' | ')).toBeGreaterThanOrEqual(0.95);
  });
  it('parses every hand-written fixture exactly', () => {
    const failures = (fixtures as Fixture[]).filter((f) => !matches(f)).map((f) => [f.text, parseSetUtterance(f.text, f.unit)]);
    expect(failures).toEqual([]);
  });
});

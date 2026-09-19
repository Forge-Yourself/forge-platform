import { displayToKg, LB_PER_KG, type UnitSystem } from '../schemas/units';
import { normalize, readNumber, tokenize, type Tok } from './numbers';

export type SpokenUnit = 'kg' | 'lb';
export type VoiceConfidence = 'full' | 'partial' | 'none';

export type VoiceSetParse = {
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  /** The unit the speaker said, or null when they said none (the user's own unit was assumed). */
  spokenUnit: SpokenUnit | null;
  confidence: VoiceConfidence;
};

// Keywords, in normalize()d form (ة→ه, ى→ي, no diacritics).
const KG = new Set(['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramme', 'كيلو', 'كيلوغرام', 'كيلوجرام', 'كغ', 'كجم']);
const LB = new Set(['lb', 'lbs', 'pound', 'pounds', 'باوند', 'ليبره', 'رطل']);
const REPS_LEAD = new Set(['for', 'by', 'x', 'times', 'علي', 'ب', 'fo', 'b']);
const REPS_TRAIL = new Set(['reps', 'rep', 'repetitions', 'مره', 'مرات', 'عده', 'عدات', 'تكرار', 'تكرارات', 'marra', 'marrat']);
const RPE_LEAD = new Set(['rpe', 'at', 'rp', 'جهد']);
const FILLER = new Set(['um', 'uh', 'the', 'like', 'so', 'then', 'with', 'of', 'يعني', 'هيك', 'مع', 'ok', 'okay']);

/** Recognizers spell RPE many ways: "r p e", "r.p.e", "ار بي اي", "our pe". Fold them to one token. */
function foldRpe(text: string): string {
  return text
    .replace(/\br\s*p\s*e\b/g, 'rpe')
    .replace(/\bour\s+p\s*e\b/g, 'rpe')
    .replace(/ار\s*بي\s*اي/g, 'rpe')
    .replace(/ار\s*بي\s*ي/g, 'rpe');
}

type Found = { value: number; start: number; end: number };

function wordAt(toks: readonly Tok[], i: number): string | null {
  const t = toks[i];
  if (!t) return null;
  if (t.k === 'word') return t.w;
  if (t.k === 'and') return 'and';
  return null;
}

/** The nearest keyword before a number, skipping fillers and a stray joiner ("…, and RPE nine"). */
function prevWord(toks: readonly Tok[], i: number): string | null {
  for (let j = i - 1; j >= 0; j -= 1) {
    const w = wordAt(toks, j);
    if (w === null) return null;
    if (FILLER.has(w) || w === 'and') continue;
    return w;
  }
  return null;
}

function nextWord(toks: readonly Tok[], i: number): string | null {
  for (let j = i; j < toks.length; j += 1) {
    const w = wordAt(toks, j);
    if (w === null) return null;
    if (FILLER.has(w)) continue;
    return w;
  }
  return null;
}

const isRpe = (v: number) => v >= 1 && v <= 10 && Number.isInteger(v * 2);
const isReps = (v: number) => Number.isInteger(v) && v >= 1 && v <= 100;

/**
 * One utterance about the set in front of the user → weight, reps, RPE.
 * Deterministic and offline (spec D7). English, Arabic and code-switched speech
 * all go through the same lexicon, so no locale is needed. A number is tied to
 * a slot by the keyword around it ("for 8", "100 kilo", "RPE 8"); numbers with
 * no keyword fill weight, reps, RPE in order. Out-of-range values are dropped,
 * never clamped: an empty chip is fixed with one tap, a wrong one may be logged.
 */
export function parseSetUtterance(text: string, unit: UnitSystem): VoiceSetParse {
  const toks = tokenize(foldRpe(normalize(text)));
  const numbers: Found[] = [];
  for (let i = 0; i < toks.length; ) {
    const r = readNumber(toks, i);
    if (r && r.end > i) {
      numbers.push({ value: r.value, start: i, end: r.end });
      i = r.end;
    } else i += 1;
  }

  let weight: number | null = null;
  let spokenUnit: SpokenUnit | null = null;
  let reps: number | null = null;
  let rpe: number | null = null;
  const loose: number[] = [];

  for (const n of numbers) {
    const before = prevWord(toks, n.start);
    const after = nextWord(toks, n.end);
    if (before !== null && RPE_LEAD.has(before)) {
      if (rpe === null) rpe = n.value;
    } else if (after !== null && (KG.has(after) || LB.has(after))) {
      if (weight === null) {
        weight = n.value;
        spokenUnit = KG.has(after) ? 'kg' : 'lb';
      }
    } else if (before !== null && REPS_LEAD.has(before)) {
      if (reps === null) reps = n.value;
    } else if (after !== null && REPS_TRAIL.has(after)) {
      if (reps === null) reps = n.value;
    } else loose.push(n.value);
  }
  for (const v of loose) {
    if (weight === null) weight = v;
    else if (reps === null) reps = v;
    else if (rpe === null) rpe = v;
  }

  let weightKg: number | null = null;
  if (weight !== null) {
    const kg =
      spokenUnit === 'kg' ? weight : spokenUnit === 'lb' ? weight / LB_PER_KG : displayToKg(weight, unit);
    weightKg = kg > 0 && kg <= 500 ? Math.round(kg * 100) / 100 : null;
  }
  if (reps !== null && !isReps(reps)) reps = null;
  if (rpe !== null && !isRpe(rpe)) rpe = null;
  if (weightKg === null) spokenUnit = null;

  const confidence: VoiceConfidence =
    weightKg !== null && reps !== null ? 'full' : weightKg !== null || reps !== null ? 'partial' : 'none';
  return { weightKg, reps, rpe, spokenUnit, confidence };
}

const SCORE: Record<VoiceConfidence, number> = { full: 2, partial: 1, none: 0 };

/**
 * Recognizers return up to five alternatives. Take the first that parses
 * best; ties keep the recognizer's own order (its most confident first).
 */
export function bestParse(alternatives: readonly string[], unit: UnitSystem): { transcript: string; parse: VoiceSetParse } {
  let best = { transcript: alternatives[0] ?? '', parse: parseSetUtterance(alternatives[0] ?? '', unit) };
  for (const alt of alternatives.slice(1)) {
    const p = parseSetUtterance(alt, unit);
    const filled = (x: VoiceSetParse) => SCORE[x.confidence] * 10 + (x.rpe !== null ? 1 : 0);
    if (filled(p) > filled(best.parse)) best = { transcript: alt, parse: p };
  }
  return best;
}

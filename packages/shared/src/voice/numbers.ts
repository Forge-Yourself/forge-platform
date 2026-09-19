/**
 * Spoken numbers, English and Arabic (MSA, Lebanese, and the Latin-script
 * "Arabizi" a recognizer occasionally returns), for the voice set parser.
 * Everything here is pure; `parse.ts` assigns the numbers to slots.
 */

export type Tok =
  | { k: 'num'; v: number } // a digit literal: "102.5", "8"
  | { k: 'unit'; v: number } // 0–9 as a word
  | { k: 'oh' } // "oh" / "o" inside "one oh two"
  | { k: 'teen'; v: number; tail?: boolean } // 10–19; `tail` marks Arabic عشر, which also closes "احد عشر"
  | { k: 'tens'; v: number } // 20, 30 … 90
  | { k: 'hundred' } // English multiplier
  | { k: 'hundreds'; v: number } // Arabic absolute 100 … 900
  | { k: 'half' }
  | { k: 'point' }
  | { k: 'and' }
  | { k: 'a' }
  | { k: 'word'; w: string };

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  // Arabic, after normalize(): ة→ه, أ/إ/آ→ا, ى→ي, diacritics gone.
  صفر: 0, واحد: 1, وحده: 1, احد: 1, اثنا: 2, اثنين: 2, اثنان: 2, اثنتين: 2, اتنين: 2, تنين: 2,
  ثلاثه: 3, ثلاث: 3, تلاته: 3, تلات: 3, اربعه: 4, اربع: 4, خمسه: 5, خمس: 5,
  سته: 6, ست: 6, سبعه: 7, سبع: 7, ثمانيه: 8, ثماني: 8, ثمان: 8, تمانيه: 8, تماني: 8, تمنه: 8,
  تسعه: 9, تسع: 9,
  // Arabizi.
  wahad: 1, wa7ad: 1, tnen: 2, tnein: 2, tlete: 3, tlata: 3, arba3a: 4, arb3a: 4, khamse: 5, khamseh: 5,
  sette: 6, sitte: 6, sab3a: 7, tmene: 8, tmeneh: 8, tes3a: 9, tis3a: 9,
};

const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
  عشره: 10, عشر: 10, حداش: 11, احداش: 11, حدعش: 11, اطنعش: 12, طنعش: 12, تناعش: 12, اتناش: 12,
  تلطاش: 13, تلتعش: 13, اربعطاش: 14, اربعتعش: 14, خمسطاش: 15, خمستعش: 15, سطاش: 16, ستعش: 16,
  سبعطاش: 17, سبعتعش: 17, تمنطاش: 18, تمنتعش: 18, تسعطاش: 19, تسعتعش: 19,
  '3ashra': 10, '3ashara': 10, '5amsta3sh': 15,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  عشرين: 20, ثلاثين: 30, تلاتين: 30, اربعين: 40, خمسين: 50, ستين: 60, سبعين: 70,
  ثمانين: 80, تمانين: 80, تسعين: 90,
  عشرون: 20, ثلاثون: 30, اربعون: 40, خمسون: 50, ستون: 60, سبعون: 70, ثمانون: 80, تسعون: 90,
  '3ishrin': 20, '3eshrin': 20, tleten: 30, tletin: 30, arb3in: 40, arbe3in: 40, khamsin: 50, settin: 60,
  sab3in: 70, tmenin: 80, tes3in: 90,
};

const HUNDREDS: Record<string, number> = {
  ميه: 100, مئه: 100, مايه: 100, ميتين: 200, مئتين: 200, مئتان: 200, متين: 200,
  ثلاثميه: 300, ثلاثمئه: 300, تلتميه: 300, اربعميه: 400, اربعمئه: 400, خمسميه: 500, خمسمئه: 500,
  ستميه: 600, سبعميه: 700, تمنميه: 800, ثمانمئه: 800, تسعميه: 900,
  mit: 100, mitt: 100, miye: 100, meyye: 100, mitten: 200, mitein: 200,
};

const AR_TEN_TAIL = new Set(['عشر', 'عشره']);
const HALF = new Set(['half', 'نص', 'نصف', 'nos', 'nuss', 'nus']);
const POINT = new Set(['point', 'dot', 'فاصله', 'نقطه', 'fasle']);
const AND = new Set(['and', 'و', 'w', 'wa', 'ou']);

const AR_DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;

/** Lexicon words that carry a digit ("3ashra", "sab3in"); normalize() must never split them. */
const DIGIT_WORDS = new Set(
  [UNITS, TEENS, TENS, HUNDREDS].flatMap((m) => Object.keys(m)).filter((w) => /\d/.test(w)),
);

/** A number glued to a word: "100kg", "8reps", "100\u0643\u064A\u0644\u0648". Only letters follow the number. */
const GLUED = /^(\d+(?:\.\d+)?)([a-z\u0600-\u06FF]+)$/;

/**
 * "100kg" \u2192 "100 kg". Only a token that is a whole number then letters is split,
 * and never a lexicon word, so an Arabizi numeral ("wa7ad", "arba3a", "3ashra")
 * keeps its digit-letters.
 */
function splitGlued(w: string): string {
  if (DIGIT_WORDS.has(w)) return w;
  const m = GLUED.exec(w);
  return m ? `${m[1]} ${m[2]}` : w;
}

/** Lowercase, strip Arabic diacritics and tatweel, fold letter variants and every digit script to ASCII. */
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(AR_DIACRITICS, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/(\d),(\d{3})\b/g, '$1$2') // "1,000"
    .replace(/(\d)\s*[x×*]\s*(?=\d)/g, '$1 x ') // "100x8"
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ') // a full stop, not a decimal point
    .replace(/[,،؛;:!?"“”'‘’()\-–—/@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(splitGlued) // last, so punctuation is gone and each token is whole
    .join(' ');
}

function lex(w: string): Tok {
  if (/^\d+(\.\d+)?$/.test(w)) return { k: 'num', v: Number(w) };
  if (w === 'oh' || w === 'o') return { k: 'oh' };
  const unit = UNITS[w];
  if (unit !== undefined) return { k: 'unit', v: unit };
  const teen = TEENS[w];
  if (teen !== undefined) return { k: 'teen', v: teen, tail: AR_TEN_TAIL.has(w) };
  const tens = TENS[w];
  if (tens !== undefined) return { k: 'tens', v: tens };
  if (w === 'hundred') return { k: 'hundred' };
  const hundreds = HUNDREDS[w];
  if (hundreds !== undefined) return { k: 'hundreds', v: hundreds };
  if (HALF.has(w)) return { k: 'half' };
  if (POINT.has(w)) return { k: 'point' };
  if (AND.has(w)) return { k: 'and' };
  if (w === 'a' || w === 'an') return { k: 'a' };
  return { k: 'word', w };
}

const isNumberWord = (t: Tok | undefined): boolean =>
  !!t && (t.k === 'unit' || t.k === 'teen' || t.k === 'tens' || t.k === 'hundred' || t.k === 'hundreds' || t.k === 'half');

/** Whitespace tokens; an Arabic "و" glued to a number word ("وخمسين") becomes its own token. */
export function tokenize(normalized: string): Tok[] {
  const out: Tok[] = [];
  for (const w of normalized.split(' ')) {
    if (w === '') continue;
    const t = lex(w);
    if (t.k === 'word' && w.startsWith('و') && w.length > 1) {
      const rest = lex(w.slice(1));
      if (isNumberWord(rest) || rest.k === 'num') {
        out.push({ k: 'and' }, rest);
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

type Read = { value: number; end: number };

/**
 * Word cardinals from `i`. Parts combine only in a grammatical order — a
 * hundreds part first, then at most one teen, or one tens and one unit in
 * either order (English "twenty five", Arabic "خمسة وعشرين") — so "eight
 * eight" reads as two numbers, not sixteen. Also the gym shorthand "one
 * twenty five" (125) and "one oh two" (102).
 */
function readWords(toks: readonly Tok[], i: number): Read | null {
  let hundreds = 0;
  let unit: number | null = null;
  let tens: number | null = null;
  let teen: number | null = null;
  let hasHundreds = false;
  let j = i;
  let any = false;

  const groupEmpty = () => unit === null && tens === null && teen === null;

  for (;;) {
    let t = toks[j];
    if (!t) break;
    let joined = false;
    // A joiner is consumed only when a combinable number word follows it.
    if (t.k === 'and') {
      const n = toks[j + 1];
      if (!any || !n || n.k === 'half' || !isNumberWord(n)) break;
      t = n;
      joined = true;
    }
    if (t.k === 'a') {
      if (any || toks[j + 1]?.k !== 'hundred') break;
      unit = 1;
      any = true;
      j += 1;
      continue;
    }
    const step = joined ? 2 : 1;

    if (t.k === 'hundred') {
      if (hasHundreds || tens !== null || teen !== null) break;
      hundreds = (unit ?? 1) * 100;
      unit = null;
      hasHundreds = true;
    } else if (t.k === 'hundreds') {
      if (hasHundreds) break;
      if (t.v === 100 && unit !== null && tens === null && teen === null && !joined) {
        hundreds = unit * 100; // "خمس ميه"
        unit = null;
      } else if (groupEmpty()) {
        hundreds = t.v;
      } else break;
      hasHundreds = true;
    } else if (t.k === 'unit') {
      if (unit !== null || teen !== null) break;
      unit = t.v;
    } else if (t.k === 'teen') {
      // Arabic "احد عشر": a unit then عشر.
      if (t.tail && unit !== null && tens === null && teen === null && !joined) {
        teen = 10 + unit;
        unit = null;
      } else if (!hasHundreds && unit !== null && unit > 0 && tens === null && teen === null && !joined) {
        hundreds = unit * 100; // "one fifteen" = 115
        unit = null;
        hasHundreds = true;
        teen = t.v;
      } else if (groupEmpty()) teen = t.v;
      else break;
    } else if (t.k === 'tens') {
      if (!hasHundreds && unit !== null && unit > 0 && tens === null && teen === null && !joined) {
        hundreds = unit * 100; // "one twenty five" = 125
        unit = null;
        hasHundreds = true;
        tens = t.v;
      } else if (tens !== null || teen !== null) break;
      else if (unit !== null && !joined) break; // "five twenty" after a hundred is not English
      else tens = t.v;
    } else if (t.k === 'oh') {
      // "one oh two": unit, oh, unit.
      const n = toks[j + 1];
      if (hasHundreds || unit === null || unit === 0 || tens !== null || teen !== null || n?.k !== 'unit') break;
      hundreds = unit * 100;
      hasHundreds = true;
      unit = n.v;
      j += 2;
      any = true;
      continue;
    } else break;

    any = true;
    j += step;
  }
  if (!any) return null;
  return { value: hundreds + (unit ?? 0) + (tens ?? 0) + (teen ?? 0), end: j };
}

/** "and a half", "and half", "ونص", "a half", "half" right after a number. */
function readHalf(toks: readonly Tok[], i: number): number | null {
  const a = toks[i];
  const b = toks[i + 1];
  const c = toks[i + 2];
  if (a?.k === 'half') return i + 1;
  if (a?.k === 'and' && b?.k === 'half') return i + 2;
  if (a?.k === 'and' && b?.k === 'a' && c?.k === 'half') return i + 3;
  if (a?.k === 'a' && b?.k === 'half') return i + 2;
  return null;
}

/** One number starting at `i`: digits or words, then an optional decimal part or half. */
export function readNumber(toks: readonly Tok[], i: number): Read | null {
  const t = toks[i];
  if (!t) return null;
  let value: number;
  let j: number;
  if (t.k === 'num') {
    value = t.v;
    j = i + 1;
  } else {
    const r = readWords(toks, i);
    if (!r) return null;
    value = r.value;
    j = r.end;
  }
  if (toks[j]?.k === 'point' && Number.isInteger(value)) {
    let digits = '';
    let k = j + 1;
    for (;;) {
      const d = toks[k];
      if (d?.k === 'unit') digits += String(d.v);
      else if (d?.k === 'oh') digits += '0';
      else if (d?.k === 'num' && Number.isInteger(d.v) && digits === '') {
        digits = String(d.v);
        k += 1;
        break;
      } else break;
      k += 1;
    }
    if (digits !== '') {
      value = Number(`${value}.${digits}`);
      j = k;
    }
  }
  const h = readHalf(toks, j);
  if (h !== null && Number.isInteger(value)) {
    value += 0.5;
    j = h;
  }
  return { value, end: j };
}

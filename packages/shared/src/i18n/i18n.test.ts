import { describe, expect, it } from 'vitest';
import ar from './ar.json';
import en from './en.json';
import { isLocale, isRTL, locales, resources } from './index';

/**
 * en.json and ar.json are maintained key-for-key identical by hand. A missing
 * translation should be a failing test, not a raw key rendered on a client's
 * screen in production — that is the whole reason this file exists.
 *
 * PLURALS ARE THE ONE EXCEPTION, and getting that wrong is what these tests
 * previously enforced. i18next resolves a `_suffix` per LANGUAGE via
 * Intl.PluralRules: English has two categories (one/other), Arabic has six
 * (zero/one/two/few/many/other). Demanding an identical key list forced ar to
 * carry exactly en's two — so `t('clients.detail.redFlagTitle', { count: 3 })`
 * missed ar's `_few`, fell through to the English `_other`, and rendered an
 * ENGLISH sentence inside an RTL screen. Measured before the fix: counts 0, 2,
 * 3 and 11 were all English.
 *
 * So parity is checked on the BASE key, and each locale is then required to
 * carry every category its own language actually has.
 */
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

function leafKeys(node: unknown, prefix = ''): string[] {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      leafKeys(v, prefix ? prefix + '.' + k : k),
    );
  }
  return [prefix];
}

/** 'clients.detail.redFlagTitle_few' -> ['clients.detail.redFlagTitle', 'few'] */
function splitPlural(key: string): [base: string, category: string | null] {
  const cut = key.lastIndexOf('_');
  if (cut === -1) return [key, null];
  const suffix = key.slice(cut + 1);
  return (PLURAL_CATEGORIES as readonly string[]).includes(suffix)
    ? [key.slice(0, cut), suffix]
    : [key, null];
}

/** Leaf keys with plural suffixes collapsed away, first occurrence order kept. */
function baseKeys(node: unknown): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const key of leafKeys(node)) {
    const [base] = splitPlural(key);
    if (!seen.has(base)) {
      seen.add(base);
      ordered.push(base);
    }
  }
  return ordered;
}

/** base key -> the categories that locale actually ships for it. */
function pluralCategoriesByBase(node: unknown): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const key of leafKeys(node)) {
    const [base, category] = splitPlural(key);
    if (category === null) continue;
    const set = found.get(base) ?? new Set<string>();
    set.add(category);
    found.set(base, set);
  }
  return found;
}

const enKeys = baseKeys(en);
const arKeys = baseKeys(ar);

describe('translation parity', () => {
  it('has no English key missing from Arabic', () => {
    expect(enKeys.filter((k) => !arKeys.includes(k))).toEqual([]);
  });

  it('has no Arabic key missing from English', () => {
    expect(arKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  it('keeps both files in the same key order', () => {
    expect(arKeys).toEqual(enKeys);
  });

  it('agrees on which keys are pluralised', () => {
    expect([...pluralCategoriesByBase(ar).keys()].sort()).toEqual(
      [...pluralCategoriesByBase(en).keys()].sort(),
    );
  });

  it.each([
    ['en', en],
    ['ar', ar],
  ])('ships every plural category %s actually has', (locale, bundle) => {
    // The authority is Intl, not a hand-written list: it is the same source
    // i18next's PluralResolver consults to pick a suffix, so anything it names
    // and the bundle lacks is a guaranteed fallback to another language.
    const required = new Intl.PluralRules(locale, { type: 'cardinal' })
      .resolvedOptions()
      .pluralCategories.slice()
      .sort();

    const missing: string[] = [];
    for (const [base, have] of pluralCategoriesByBase(bundle)) {
      for (const category of required) {
        if (!have.has(category)) missing.push(base + '_' + category);
      }
    }
    expect(missing).toEqual([]);
  });

  it('has no empty translation string in either locale', () => {
    const empties = (node: unknown, prefix = ''): string[] => {
      if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
        return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
          empties(v, prefix ? prefix + '.' + k : k),
        );
      }
      return typeof node === 'string' && node.trim() === '' ? [prefix] : [];
    };
    expect(empties(en)).toEqual([]);
    expect(empties(ar)).toEqual([]);
  });

  it('carries the M3 namespaces this milestone added', () => {
    for (const ns of ['library', 'programs', 'builder', 'ai', 'credits']) {
      expect(Object.keys(en)).toContain(ns);
      expect(Object.keys(ar)).toContain(ns);
    }
  });
});

describe('locale helpers', () => {
  it('treats Arabic as RTL and English as LTR', () => {
    expect(isRTL('ar')).toBe(true);
    expect(isRTL('en')).toBe(false);
  });

  it('guards against a locale outside the users.locale CHECK constraint', () => {
    for (const locale of locales) {
      expect(isLocale(locale)).toBe(true);
    }
    expect(isLocale('de')).toBe(false);
  });

  it('ships resources for every locale that has a JSON file', () => {
    expect(Object.keys(resources).sort()).toEqual(['ar', 'en']);
  });
});

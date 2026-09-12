import { describe, expect, it } from 'vitest';
import ar from './ar.json';
import en from './en.json';
import { isLocale, isRTL, locales, resources } from './index';

/**
 * en.json and ar.json are maintained key-for-key identical by hand. A missing
 * translation should be a failing test, not a raw key rendered on a client's
 * screen in production — that is the whole reason this file exists.
 */
function leafKeys(node: unknown, prefix = ''): string[] {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      leafKeys(v, prefix ? prefix + '.' + k : k),
    );
  }
  return [prefix];
}

const enKeys = leafKeys(en);
const arKeys = leafKeys(ar);

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

import ar from './ar.json';
import en from './en.json';

/** Matches users.locale CHECK constraint in db/schema.sql. */
export const locales = ['en', 'ar', 'fr'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

const rtlLocales = new Set<Locale>(['ar']);

export function isRTL(locale: Locale): boolean {
  return rtlLocales.has(locale);
}

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/** Arabic strings are placeholders pending native-speaker review (spec §9). */
export const resources = { en: { translation: en }, ar: { translation: ar } } as const;

export type TranslationKeys = typeof en;

import { defaultLocale, isLocale, isRTL, resources, type Locale } from '@forge/shared';
import { getLocales } from 'expo-localization';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';

function deviceLocale(): Locale {
  const tag = getLocales()[0]?.languageCode ?? defaultLocale;
  return isLocale(tag) ? tag : defaultLocale;
}

const initialLocale = deviceLocale();

/** Own instance rather than the module singleton — initReactI18next still registers it globally. */
const i18n = createInstance();

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
  fallbackLng: defaultLocale,
  interpolation: { escapeValue: false },
});

/**
 * Direction is a native-layer setting: forceRTL only takes effect after the app reloads,
 * so a language switch flips strings immediately but mirrors the layout on next launch.
 */
export function applyDirection(locale: Locale): void {
  const shouldBeRTL = isRTL(locale);
  I18nManager.allowRTL(shouldBeRTL);
  if (I18nManager.isRTL !== shouldBeRTL) {
    I18nManager.forceRTL(shouldBeRTL);
  }
}

applyDirection(initialLocale);

export async function setLocale(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale);
  applyDirection(locale);
}

export { i18n, initialLocale };

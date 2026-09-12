import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Tiny per-device key/value store for settings that must survive a relaunch and are
 * needed BEFORE (or without) a session: the appearance override and the language
 * choice. Both are read at boot, before AuthProvider has resolved anything, so
 * neither can live only in `public.users`.
 *
 * SecureStore rather than AsyncStorage purely because it is already in the dependency
 * tree — lib/supabase.ts keeps the session in the same keychain. Nothing stored here
 * is sensitive; this is not a security boundary. expo-secure-store has no web
 * implementation, so web falls back to localStorage, same as lib/supabase.ts.
 *
 * Extracted from lib/appearance.ts when the locale gained the same requirement: the
 * two had identical storage needs and were about to have two copies of this shim.
 */
const isWeb = Platform.OS === 'web';

export async function getStoredValue(key: string): Promise<string | null> {
  try {
    return isWeb ? (globalThis.localStorage?.getItem(key) ?? null) : await SecureStore.getItemAsync(key);
  } catch {
    // A corrupt keychain entry or a browser with storage blocked must not stop the
    // app booting — the caller's default is always a valid answer.
    return null;
  }
}

export async function setStoredValue(key: string, value: string): Promise<void> {
  try {
    if (isWeb) {
      globalThis.localStorage?.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  } catch {
    // Same reasoning: a preference that fails to persist is a smaller problem than
    // a throw out of a settings handler.
  }
}

export async function deleteStoredValue(key: string): Promise<void> {
  try {
    if (isWeb) {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* see above */
  }
}

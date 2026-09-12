import type { Database } from '@forge/shared';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env',
  );
}

/**
 * Session tokens live in the OS keychain on native. The web build has no
 * keychain — expo-secure-store throws there — so it falls back to
 * localStorage. Forge doesn't ship on web (mobile-only per CLAUDE.md); this
 * fallback exists purely so `pnpm web` is usable for local dev/testing.
 */
const secureStorage =
  Platform.OS === 'web'
    ? {
        getItem: (key: string) => Promise.resolve(globalThis.localStorage?.getItem(key) ?? null),
        setItem: (key: string, value: string) =>
          Promise.resolve(globalThis.localStorage?.setItem(key, value)),
        removeItem: (key: string) => Promise.resolve(globalThis.localStorage?.removeItem(key)),
      }
    : {
        getItem: (key: string) => SecureStore.getItemAsync(key),
        setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
        removeItem: (key: string) => SecureStore.deleteItemAsync(key),
      };

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Implicit flow (the default) cannot survive a mobile deep-link round trip —
    // the app process handling the callback is not the one that started the request.
    // PKCE keeps a verifier in secureStorage and exchanges it for a session on return.
    flowType: 'pkce',
  },
});

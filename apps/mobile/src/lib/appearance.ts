import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type AppearanceOverride = 'system' | 'light' | 'dark';

const APPEARANCE_KEY = 'forge.appearance-override';

/**
 * Per-device theme override, independent of the OS `useColorScheme()` setting.
 * Lives in the same SecureStore keychain as the Supabase session (see lib/supabase.ts) —
 * not sensitive data, but it's already the storage this app talks to and avoids pulling
 * in a second persistence mechanism (e.g. AsyncStorage) for one small value.
 * expo-secure-store has no web implementation, so web falls back to localStorage
 * (same pattern as lib/supabase.ts).
 */
const isWeb = Platform.OS === 'web';

async function getItem(key: string): Promise<string | null> {
  return isWeb
    ? (globalThis.localStorage?.getItem(key) ?? null)
    : SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function getAppearanceOverride(): Promise<AppearanceOverride> {
  const value = await getItem(APPEARANCE_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

export async function setAppearanceOverride(value: AppearanceOverride): Promise<void> {
  if (value === 'system') {
    await deleteItem(APPEARANCE_KEY);
  } else {
    await setItem(APPEARANCE_KEY, value);
  }
}

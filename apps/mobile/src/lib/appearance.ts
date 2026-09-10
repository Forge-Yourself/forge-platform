import * as SecureStore from 'expo-secure-store';

export type AppearanceOverride = 'system' | 'light' | 'dark';

const APPEARANCE_KEY = 'forge.appearance-override';

/**
 * Per-device theme override, independent of the OS `useColorScheme()` setting.
 * Lives in the same SecureStore keychain as the Supabase session (see lib/supabase.ts) —
 * not sensitive data, but it's already the storage this app talks to and avoids pulling
 * in a second persistence mechanism (e.g. AsyncStorage) for one small value.
 */

export async function getAppearanceOverride(): Promise<AppearanceOverride> {
  const value = await SecureStore.getItemAsync(APPEARANCE_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

export async function setAppearanceOverride(value: AppearanceOverride): Promise<void> {
  if (value === 'system') {
    await SecureStore.deleteItemAsync(APPEARANCE_KEY);
  } else {
    await SecureStore.setItemAsync(APPEARANCE_KEY, value);
  }
}

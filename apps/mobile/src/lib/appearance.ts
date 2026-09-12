import { deleteStoredValue, getStoredValue, setStoredValue } from './deviceStore';

export type AppearanceOverride = 'system' | 'light' | 'dark';

const APPEARANCE_KEY = 'forge.appearance-override';

/**
 * Per-device theme override, independent of the OS `useColorScheme()` setting.
 * Persisted through lib/deviceStore.ts (SecureStore on native, localStorage on web) —
 * the same shim lib/i18n.ts uses for the language choice, since both are read at boot
 * before there is a session to read `public.users` with.
 */
export async function getAppearanceOverride(): Promise<AppearanceOverride> {
  const value = await getStoredValue(APPEARANCE_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

export async function setAppearanceOverride(value: AppearanceOverride): Promise<void> {
  if (value === 'system') {
    await deleteStoredValue(APPEARANCE_KEY);
  } else {
    await setStoredValue(APPEARANCE_KEY, value);
  }
}

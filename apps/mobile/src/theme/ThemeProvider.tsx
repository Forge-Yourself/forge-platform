import {
  colorSchemes,
  motion,
  radius,
  space,
  touchTarget,
  typography,
  type ColorRoles,
  type SchemeName,
} from '@forge/shared';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { getAppearanceOverride, setAppearanceOverride, type AppearanceOverride } from '../lib/appearance';

export type Theme = {
  scheme: SchemeName;
  colors: ColorRoles;
  space: typeof space;
  radius: typeof radius;
  typography: typeof typography;
  motion: typeof motion;
  touchTarget: number;
  /** Current per-device override ('system' when none is set) — Task 11's Appearance row reads this. */
  appearanceOverride: AppearanceOverride;
  /**
   * Persists the override (lib/appearance.ts, SecureStore-backed) AND updates this
   * provider's live state so the picked scheme applies immediately — appearance,
   * unlike the locale/RTL direction switch, is not a "takes effect on next launch"
   * setting. Nothing else reads lib/appearance.ts's storage directly at runtime, so
   * without this the write would silently not affect the running app.
   */
  setAppearanceOverride: (value: AppearanceOverride) => Promise<void>;
};

function buildTheme(
  scheme: SchemeName,
  appearanceOverride: AppearanceOverride,
  setOverride: (value: AppearanceOverride) => Promise<void>,
): Theme {
  return {
    scheme,
    colors: colorSchemes[scheme],
    space,
    radius,
    typography,
    motion,
    touchTarget,
    appearanceOverride,
    setAppearanceOverride: setOverride,
  };
}

const noopSetOverride = async () => {};
const ThemeContext = createContext<Theme>(buildTheme('dark', 'system', noopSetOverride));

export function ThemeProvider({ children }: { children: ReactNode }) {
  const osScheme: SchemeName = useColorScheme() === 'light' ? 'light' : 'dark';
  // SecureStore reads are async; this provider renders synchronously, so it starts on
  // the OS scheme and re-renders once the stored override (if any) has loaded. A brief
  // flash of the OS theme on cold boot for users who've overridden it is an accepted
  // tradeoff — not worth holding first paint for.
  const [override, setOverride] = useState<AppearanceOverride>('system');

  useEffect(() => {
    let cancelled = false;
    void getAppearanceOverride().then((value) => {
      if (!cancelled) setOverride(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const scheme: SchemeName = override === 'system' ? osScheme : override;

  async function applyOverride(value: AppearanceOverride) {
    await setAppearanceOverride(value);
    setOverride(value);
  }

  return <ThemeContext value={buildTheme(scheme, override, applyOverride)}>{children}</ThemeContext>;
}

export function useTheme(): Theme {
  return use(ThemeContext);
}

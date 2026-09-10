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
import { getAppearanceOverride, type AppearanceOverride } from '../lib/appearance';

export type Theme = {
  scheme: SchemeName;
  colors: ColorRoles;
  space: typeof space;
  radius: typeof radius;
  typography: typeof typography;
  motion: typeof motion;
  touchTarget: number;
};

function buildTheme(scheme: SchemeName): Theme {
  return {
    scheme,
    colors: colorSchemes[scheme],
    space,
    radius,
    typography,
    motion,
    touchTarget,
  };
}

const ThemeContext = createContext<Theme>(buildTheme('dark'));

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
  return <ThemeContext value={buildTheme(scheme)}>{children}</ThemeContext>;
}

export function useTheme(): Theme {
  return use(ThemeContext);
}

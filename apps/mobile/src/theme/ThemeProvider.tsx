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
import { createContext, use, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

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
  const scheme: SchemeName = useColorScheme() === 'light' ? 'light' : 'dark';
  return <ThemeContext value={buildTheme(scheme)}>{children}</ThemeContext>;
}

export function useTheme(): Theme {
  return use(ThemeContext);
}

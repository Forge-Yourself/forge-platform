import { palette } from './tokens.js';

/**
 * Role names, not color names. Screens reference roles so a palette change is one edit.
 * The design system is dark-first (charcoal-800 is the primary surface); light inverts onto cream.
 *
 * Status colors are chip roles, never body text: mid-luminance green/amber/red cannot reach
 * 4.5:1 against either surface, so status text always sits on its own tinted surface.
 * tokens.test.ts enforces every pairing below.
 */
export type ColorRoles = {
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;

  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  primary: string;
  onPrimary: string;

  accent: string;
  onAccent: string;
  accentText: string;
  accentSurface: string;

  successAccent: string;
  successSurface: string;
  onSuccessSurface: string;

  warnAccent: string;
  warnSurface: string;
  onWarnSurface: string;

  dangerAccent: string;
  dangerSurface: string;
  onDangerSurface: string;

  focusRing: string;
};

export const lightColors: ColorRoles = {
  surface: palette.cream50,
  surfaceRaised: palette.white,
  surfaceSunken: palette.cream100,
  border: palette.iron200,
  // iron-300 reads as a border but only reaches 2.44:1 on cream — below the 3:1 UI bar.
  borderStrong: palette.iron400,

  textPrimary: palette.charcoal800,
  textSecondary: palette.iron500,
  textMuted: palette.iron400,

  primary: palette.charcoal800,
  onPrimary: palette.white,

  accent: palette.ember600,
  onAccent: palette.charcoal900,
  accentText: palette.ember700,
  accentSurface: palette.ember100,

  successAccent: palette.success,
  successSurface: palette.successBg,
  onSuccessSurface: palette.charcoal900,

  warnAccent: palette.warn,
  warnSurface: palette.warnBg,
  onWarnSurface: palette.charcoal900,

  dangerAccent: palette.danger,
  dangerSurface: palette.dangerBg,
  onDangerSurface: palette.charcoal900,

  focusRing: palette.ember600,
};

export const darkColors: ColorRoles = {
  surface: palette.charcoal800,
  surfaceRaised: palette.charcoal700,
  surfaceSunken: palette.charcoal900,
  border: palette.iron600,
  borderStrong: palette.iron400,

  textPrimary: palette.cream50,
  textSecondary: palette.iron200,
  textMuted: palette.iron300,

  primary: palette.ember600,
  onPrimary: palette.charcoal900,

  accent: palette.ember500,
  onAccent: palette.charcoal900,
  accentText: palette.ember500,
  accentSurface: palette.charcoal700,

  successAccent: palette.successBg,
  successSurface: palette.charcoal700,
  onSuccessSurface: palette.successBg,

  warnAccent: palette.warnBg,
  warnSurface: palette.charcoal700,
  onWarnSurface: palette.warnBg,

  dangerAccent: palette.dangerBg,
  dangerSurface: palette.charcoal700,
  onDangerSurface: palette.dangerBg,

  focusRing: palette.ember500,
};

export const colorSchemes = { light: lightColors, dark: darkColors } as const;
export type SchemeName = keyof typeof colorSchemes;

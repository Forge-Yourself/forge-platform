import { palette } from './tokens';

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
  /** Soft ember chip fill for tag/badge-style accents. */
  accentSurfaceSoft: string;
  /** Chip text for accentSurfaceSoft — accentText itself falls short of 4.5:1 on the soft tint. */
  onAccentSurfaceSoft: string;

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
  // `border` is a plain divider value only — active control boundaries (e.g. TextField/input
  // borders, WCAG 1.4.11's 3:1 non-text bar) must use `borderStrong`, never `border`.
  borderStrong: palette.iron400,

  textPrimary: palette.charcoal800,
  textSecondary: palette.iron500,
  textMuted: palette.iron400,

  primary: palette.charcoal800,
  onPrimary: palette.white,

  // accent bumped to ember-700 (was ember-600) so the locked CTA text color is white, not
  // charcoal — white on ember-600 fails at 3.37:1; white on ember-700 passes at 5.28:1.
  accent: palette.ember700,
  onAccent: palette.white,
  accentText: palette.ember700,
  accentSurface: palette.ember100,
  // Soft ember chip fill for tag/badge accents.
  accentSurfaceSoft: palette.ember100,
  // ember-700 (accentText) only reaches 4.41:1 on ember-100 — short of the 4.5:1 bar — so the
  // soft chip's text uses ember-800 instead, which clears it at 5.53:1.
  onAccentSurfaceSoft: palette.ember800,

  successAccent: palette.success,
  successSurface: palette.successBg,
  // Hue-matched on-tint text (was charcoal900 for all three) — onSuccess reaches 7.57:1 on successBg.
  onSuccessSurface: palette.onSuccess,

  warnAccent: palette.warn,
  warnSurface: palette.warnBg,
  // onWarn reaches 5.67:1 on warnBg.
  onWarnSurface: palette.onWarn,

  dangerAccent: palette.danger,
  dangerSurface: palette.dangerBg,
  // onDanger reaches 6.56:1 on dangerBg.
  onDangerSurface: palette.onDanger,

  focusRing: palette.ember600,
};

export const darkColors: ColorRoles = {
  surface: palette.charcoal800,
  surfaceRaised: palette.charcoal700,
  surfaceSunken: palette.charcoal900,
  // charcoal-600 (was iron-600) — one step lighter than surfaceRaised, reads as a divider
  // without the blue-grey cast of the iron family on a dark ground.
  border: palette.charcoal600,
  // Active control boundaries (inputs) must use `borderStrong`, never `border` — same rule as light.
  borderStrong: palette.iron400,

  // cream-100 (was cream-50) — design-prototype match; still 14.76:1 on charcoal800, well above 4.5:1.
  textPrimary: palette.cream100,
  textSecondary: palette.iron200,
  textMuted: palette.iron300,

  primary: palette.ember600,
  onPrimary: palette.charcoal900,

  // ember-500/charcoal900 already passes at 7.92:1 (verified via contrastRatio) — no ember-700
  // swap needed here; the light-scheme failure (white on ember-600) doesn't reproduce in dark.
  accent: palette.ember500,
  onAccent: palette.charcoal900,
  // ember-300 (was ember-500) — design-prototype match, 9.15:1 on charcoal800 vs ember-500's 7.02:1.
  accentText: palette.ember300,
  accentSurface: palette.charcoal700,
  // Semi-transparent ember (not a solid palette token) for the soft chip fill on dark surfaces.
  accentSurfaceSoft: 'rgba(232,99,26,0.18)',
  // Flattened onto `surface`, the fill above reads as a dark ember-brown — ember-300 (accentText)
  // reaches 7.35:1 on it, well past 4.5:1, so the chip text reuses accentText here.
  onAccentSurfaceSoft: palette.ember300,

  // Unchanged: dark chips already use the pale tint (successBg/warnBg/dangerBg) as bright text on
  // charcoal700, which passes at 11-13:1. The new hue-matched onSuccess/onWarn/onDanger trio is
  // tuned for LIGHT tint backgrounds (successBg etc. as the surface) — on charcoal700 it inverts to
  // dark-on-dark and fails badly (e.g. onSuccess on charcoal700 is ~1.5:1), so it is not used here.
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

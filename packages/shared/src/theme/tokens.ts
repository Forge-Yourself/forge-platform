/**
 * Single source of truth for Forge design tokens.
 * Ported from docs/Forge_DesignSystem.html — do not redefine these values anywhere else.
 * The RN theme (apps/mobile) and the web CSS vars (apps/web) both derive from this file.
 */

export const palette = {
  charcoal900: '#0F131C',
  charcoal800: '#1A1F2B',
  charcoal700: '#222836',
  // charcoal-600: dark-mode divider between surfaceRaised and surfaceSunken tones — one step
  // lighter than charcoal-700, used for the dark `border` role (design-prototype reconciliation).
  charcoal600: '#2C3342',
  iron600: '#3A4150',
  iron500: '#4A5560',
  iron400: '#6B7280',
  iron300: '#9AA3B1',
  iron200: '#CDD2DB',
  iron100: '#E5E8ED',
  cream100: '#F5F2EE',
  cream50: '#FBFAF7',
  white: '#FFFFFF',
  // ember-800: one step darker than ember-700, reserved for pressed/active CTA states.
  ember800: '#A03D0E',
  ember700: '#B84812',
  ember600: '#E8631A',
  ember500: '#FF8A3D',
  ember300: '#FFB068',
  ember100: '#FCE7D3',
  success: '#2E8B57',
  successBg: '#D5EBD9',
  // on-tint trio: hue-matched, darker text for status chips, replacing the generic
  // charcoal900 that was used across all three (design-prototype reconciliation).
  onSuccess: '#1A4F31',
  warn: '#C77800',
  warnBg: '#FFF1D6',
  onWarn: '#8A5300',
  danger: '#C0392B',
  dangerBg: '#FADBD8',
  onDanger: '#8C2A1F',
} as const;

/** 4px base progression. Index is the design-system step (s-1 … s-11). */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 32,
  8: 40,
  9: 48,
  10: 64,
  11: 80,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

export const fontFamily = {
  sans: 'System',
  /** All numeric data — sets, reps, weights, timers — renders in mono. */
  mono: 'JetBrainsMono',
} as const;

export const fontFamilyWeb = {
  sans: "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', Arial, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

export type TypeStyle = {
  fontSize: number;
  fontWeight: '400' | '500' | '600' | '700' | '800' | '900';
  letterSpacing: number;
  lineHeight: number;
};

export const typography = {
  display: { fontSize: 48, fontWeight: '900', letterSpacing: -1, lineHeight: 52 },
  h1: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5, lineHeight: 38 },
  h2: { fontSize: 24, fontWeight: '700', letterSpacing: 0, lineHeight: 30 },
  h3: { fontSize: 18, fontWeight: '700', letterSpacing: 0, lineHeight: 24 },
  body: { fontSize: 15, fontWeight: '400', letterSpacing: 0, lineHeight: 22 },
  bodyBold: { fontSize: 15, fontWeight: '600', letterSpacing: 0, lineHeight: 22 },
  caption: { fontSize: 13, fontWeight: '400', letterSpacing: 0, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '700', letterSpacing: 1.5, lineHeight: 18 },
} as const satisfies Record<string, TypeStyle>;

export const motion = {
  fast: 80,
  default: 150,
  slow: 220,
  easing: [0.2, 0.8, 0.2, 1],
} as const;

/** Minimum touch target — WCAG 2.2 AA and the gym-floor ergonomics constraint. */
export const touchTarget = 44;

export type Palette = typeof palette;
export type Space = typeof space;
export type Radius = typeof radius;
export type Typography = typeof typography;

import type { BookingState } from '@forge/shared';
import type { Theme } from '../../theme/ThemeProvider';

export type StateStyle = { bar: string; bg: string; fg: string; border: string; dashed: boolean; strike: boolean; hatch: boolean };

/**
 * The design's six booking states on existing colour roles. Every pairing is
 * one tokens.test.ts already holds to 4.5:1 (status text always sits on its
 * own tinted surface), so no new palette entry is needed. Each block also
 * prints its state word: colour is never the only cue.
 */
export function stateStyle(state: BookingState, c: Theme['colors']): StateStyle {
  switch (state) {
    case 'booked':
      return { bar: c.accent, bg: c.accentSurfaceSoft, fg: c.onAccentSurfaceSoft, border: 'transparent', dashed: false, strike: false, hatch: false };
    case 'checked':
      return { bar: c.successAccent, bg: c.successSurface, fg: c.onSuccessSurface, border: 'transparent', dashed: false, strike: false, hatch: false };
    case 'done':
      return { bar: c.textMuted, bg: c.surfaceRaised, fg: c.textMuted, border: 'transparent', dashed: false, strike: false, hatch: false };
    case 'noshow':
      return { bar: c.warnAccent, bg: c.warnSurface, fg: c.onWarnSurface, border: 'transparent', dashed: false, strike: false, hatch: false };
    case 'cancelled':
      return { bar: c.textMuted, bg: 'transparent', fg: c.textMuted, border: c.border, dashed: true, strike: true, hatch: false };
    case 'me':
      return { bar: c.textPrimary, bg: c.surface, fg: c.textPrimary, border: c.border, dashed: false, strike: false, hatch: true };
  }
}

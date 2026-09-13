import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { colorSchemes, type ColorRoles, type SchemeName } from './semantic';
import { space, touchTarget, typography } from './tokens';

const TEXT_MIN = 4.5; // WCAG 2.2 AA, body text
const NON_TEXT_MIN = 3; // WCAG 2.2 AA, UI components and large text

const schemes = Object.entries(colorSchemes) as [SchemeName, ColorRoles][];

/** Alpha-composites an `rgba(r,g,b,a)` fill onto a solid #RRGGBB backdrop; passes hex through. */
function flattenOverSurface(color: string, backdrop: string): string {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(color);
  if (!m) return color;
  const [, r, g, b, a] = m.map(Number) as [number, number, number, number, number];
  const bgInt = parseInt(backdrop.slice(1), 16);
  const br = (bgInt >> 16) & 0xff;
  const bgc = (bgInt >> 8) & 0xff;
  const bb = bgInt & 0xff;
  const mix = (fg: number, bgChan: number) => Math.round(fg * a + bgChan * (1 - a));
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(mix(r, br))}${hex(mix(g, bgc))}${hex(mix(b, bb))}`;
}

describe.each(schemes)('%s scheme meets WCAG 2.2 AA', (_name, c) => {
  const textRoles = ['textPrimary', 'textSecondary', 'textMuted'] as const;
  const backdrops = ['surface', 'surfaceRaised'] as const;

  it.each(textRoles.flatMap((t) => backdrops.map((b) => [t, b] as const)))(
    '%s on %s is legible',
    (text, backdrop) => {
      expect(contrastRatio(c[text], c[backdrop])).toBeGreaterThanOrEqual(TEXT_MIN);
    },
  );

  it.each([
    ['onPrimary', 'primary'],
    ['onAccent', 'accent'],
  ] as const)('%s on %s is legible', (fg, bg) => {
    expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  // The four tinted chip fills are solid hex in light and translucent rgba() in dark, so each
  // one is flattened onto the backdrop it actually renders over before its on-tint text is
  // checked. Chips appear on both the screen ground and on cards, so both backdrops count.
  it.each([
    ['onAccentSurfaceSoft', 'accentSurfaceSoft'],
    ['onSuccessSurface', 'successSurface'],
    ['onWarnSurface', 'warnSurface'],
    ['onDangerSurface', 'dangerSurface'],
  ] as const)('%s is legible on %s over either backdrop', (fg, fill) => {
    for (const backdrop of backdrops) {
      const bg = flattenOverSurface(c[fill], c[backdrop]);
      expect(contrastRatio(c[fg], bg)).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  /**
   * A chip fill has to be SEEN as a shape, not merely be a legible background for its text.
   *
   * Dark mode used to set all three status fills to charcoal-700 — the same value as
   * `surfaceRaised` — so every status pill, tinted banner and initials avatar drawn on a card
   * was a zero-contrast rectangle: the fill was invisible and only its coloured text survived.
   *
   * The measure is per-channel distance, not a contrast ratio, because these tints are
   * deliberately near-isoluminant with their backdrop and carry their signal in HUE: cream-on-
   * white warn (#FFF1D6 on #FFFFFF) is plainly visible at 1.07:1 luminance but differs by 41
   * in blue. A luminance floor would fail the light scheme's whole (shipped, design-matched)
   * chip family while still passing anything that merely dimmed it. 12/255 is roughly the
   * smallest flat-colour step that reads as a distinct panel edge at arm's length.
   */
  const FILL_CHANNEL_DELTA_MIN = 12;

  function maxChannelDelta(a: string, b: string): number {
    const [ai, bi] = [parseInt(a.slice(1), 16), parseInt(b.slice(1), 16)];
    return Math.max(
      Math.abs(((ai >> 16) & 0xff) - ((bi >> 16) & 0xff)),
      Math.abs(((ai >> 8) & 0xff) - ((bi >> 8) & 0xff)),
      Math.abs((ai & 0xff) - (bi & 0xff)),
    );
  }

  it.each(['accentSurfaceSoft', 'successSurface', 'warnSurface', 'dangerSurface'] as const)(
    '%s is visible as a shape against either backdrop',
    (fill) => {
      for (const backdrop of backdrops) {
        const bg = flattenOverSurface(c[fill], c[backdrop]);
        expect(maxChannelDelta(bg, c[backdrop])).toBeGreaterThanOrEqual(FILL_CHANNEL_DELTA_MIN);
      }
    },
  );

  it.each(['surface', 'surfaceRaised'] as const)('accentText is legible on %s', (backdrop) => {
    expect(contrastRatio(c.accentText, c[backdrop])).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it.each(['successAccent', 'warnAccent', 'dangerAccent', 'borderStrong', 'focusRing'] as const)(
    '%s is distinguishable against the surface',
    (role) => {
      expect(contrastRatio(c[role], c.surface)).toBeGreaterThanOrEqual(NON_TEXT_MIN);
    },
  );
});

describe('scale tokens', () => {
  it('keeps spacing on the 4px base', () => {
    for (const value of Object.values(space)) {
      expect(value % 4).toBe(0);
    }
  });

  it('renders body text large enough to read at arm’s length', () => {
    expect(typography.body.fontSize).toBeGreaterThanOrEqual(15);
    expect(touchTarget).toBeGreaterThanOrEqual(44);
  });
});

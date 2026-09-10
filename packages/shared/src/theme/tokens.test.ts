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
    ['onSuccessSurface', 'successSurface'],
    ['onWarnSurface', 'warnSurface'],
    ['onDangerSurface', 'dangerSurface'],
  ] as const)('%s on %s is legible', (fg, bg) => {
    expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it.each(['surface', 'surfaceRaised'] as const)('accentText is legible on %s', (backdrop) => {
    expect(contrastRatio(c.accentText, c[backdrop])).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  // accentSurfaceSoft is a solid hex in light but a translucent rgba() in dark (see semantic.ts) —
  // contrastRatio only parses #RRGGBB, so an rgba fill is first flattened onto `surface` (what it
  // actually renders on top of) before checking the chip text (onAccentSurfaceSoft) against it.
  it('onAccentSurfaceSoft is legible on accentSurfaceSoft', () => {
    const bg = flattenOverSurface(c.accentSurfaceSoft, c.surface);
    expect(contrastRatio(c.onAccentSurfaceSoft, bg)).toBeGreaterThanOrEqual(TEXT_MIN);
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

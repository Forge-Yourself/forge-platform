import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.js';
import { colorSchemes, type ColorRoles, type SchemeName } from './semantic.js';
import { space, touchTarget, typography } from './tokens.js';

const TEXT_MIN = 4.5; // WCAG 2.2 AA, body text
const NON_TEXT_MIN = 3; // WCAG 2.2 AA, UI components and large text

const schemes = Object.entries(colorSchemes) as [SchemeName, ColorRoles][];

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

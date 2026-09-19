import { describe, expect, it } from 'vitest';
import { bodyDecimals, bodyStep, bodyToDisplay, bodyToStored, bodyUnit, formatBody, stepBody } from './units';

describe('body units', () => {
  it('labels each metric in each system', () => {
    expect(bodyUnit('weight', 'metric')).toBe('kg');
    expect(bodyUnit('weight', 'imperial')).toBe('lb');
    expect(bodyUnit('body_fat', 'imperial')).toBe('%');
    expect(bodyUnit('waist', 'metric')).toBe('cm');
    expect(bodyUnit('waist', 'imperial')).toBe('in');
  });

  it('steps like the prototype: 0.1 kg, 0.1 %, 0.5 cm', () => {
    expect(bodyStep('weight', 'metric')).toBe(0.1);
    expect(bodyStep('body_fat', 'metric')).toBe(0.1);
    expect(bodyStep('waist', 'metric')).toBe(0.5);
    expect(bodyStep('weight', 'imperial')).toBe(0.2);
    expect(bodyStep('arm', 'imperial')).toBe(0.25);
  });

  it('converts for display to the unit precision, not to plate halves', () => {
    expect(bodyToDisplay('weight', 70.4, 'metric')).toBe(70.4);
    expect(bodyToDisplay('weight', 70.4, 'imperial')).toBe(155.2);
    expect(bodyToDisplay('waist', 81.5, 'imperial')).toBe(32.09);
    expect(bodyToDisplay('body_fat', 22.5, 'imperial')).toBe(22.5);
  });

  it('round-trips a stored value through display and back', () => {
    const stored = bodyToStored('weight', bodyToDisplay('weight', 70.4, 'imperial'), 'imperial');
    expect(stored).toBeCloseTo(70.4, 1);
    expect(bodyToStored('waist', 32, 'imperial')).toBe(81.28);
  });

  it('steps without float drift', () => {
    expect(stepBody(62.4, 0.1, 'weight', 'metric')).toBe(62.5);
    expect(stepBody(0.3, -0.1, 'body_fat', 'metric')).toBe(0.2);
  });

  it('formats at the metric precision', () => {
    expect(bodyDecimals('arm', 'imperial')).toBe(2);
    expect(formatBody(62, 'weight', 'metric')).toBe('62.0');
    expect(formatBody(null, 'weight', 'metric')).toBe('—');
  });
});

import { describe, expect, it } from 'vitest';
import { displayToKg, formatWeight, kgToDisplay, LB_PER_KG } from './units';

describe('kgToDisplay / displayToKg', () => {
  it('is the identity in metric', () => {
    expect(kgToDisplay(102.5, 'metric')).toBe(102.5);
    expect(displayToKg(102.5, 'metric')).toBe(102.5);
  });

  it('converts to pounds rounded to the nearest 0.5 for display', () => {
    // 100 kg = 220.462 lb -> 220.5 on a plate-loaded bar
    expect(kgToDisplay(100, 'imperial')).toBe(220.5);
  });

  it('stores the exact kilogram value when the entry was in pounds', () => {
    expect(displayToKg(225, 'imperial')).toBeCloseTo(225 / LB_PER_KG, 6);
  });

  it('round-trips a common plate weight within display precision', () => {
    const kg = displayToKg(225, 'imperial');
    expect(kgToDisplay(kg, 'imperial')).toBe(225);
  });
});

describe('formatWeight', () => {
  it('drops a trailing .0 and keeps a half', () => {
    expect(formatWeight(100, 'metric')).toBe('100 kg');
    expect(formatWeight(102.5, 'metric')).toBe('102.5 kg');
    expect(formatWeight(100, 'imperial')).toBe('220.5 lb');
  });

  it('renders a missing weight as a dash', () => {
    expect(formatWeight(null, 'metric')).toBe('—');
  });
});

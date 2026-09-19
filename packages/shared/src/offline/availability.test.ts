import { describe, expect, it } from 'vitest';
import { parseOfflineMode, resolveOfflineLogging } from './availability';

describe('parseOfflineMode', () => {
  it('accepts the three modes and defaults anything else to off', () => {
    expect(parseOfflineMode('beta')).toBe('beta');
    expect(parseOfflineMode('all')).toBe('all');
    expect(parseOfflineMode('off')).toBe('off');
    expect(parseOfflineMode('ALL')).toBe('off');
    expect(parseOfflineMode(null)).toBe('off');
    expect(parseOfflineMode(1)).toBe('off');
  });
});

describe('resolveOfflineLogging', () => {
  const cases: Array<[mode: 'off' | 'beta' | 'all', beta: boolean, choice: boolean, available: boolean, effective: boolean]> = [
    ['off', true, true, false, false],
    ['beta', false, true, false, false],
    ['beta', true, false, true, false],
    ['beta', true, true, true, true],
    ['all', false, false, true, false],
    ['all', false, true, true, true],
  ];
  it.each(cases)('mode %s, beta %s, choice %s → available %s, effective %s', (mode, userBeta, deviceChoice, available, effective) => {
    expect(resolveOfflineLogging({ mode, userBeta, deviceChoice })).toEqual({ available, effective });
  });
});

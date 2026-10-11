import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import { CHECKIN_ERROR_CODES, checkinErrorCode, checkinErrorKey } from './errors';

const get = (path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], en);

describe('checkinErrorCode', () => {
  it('maps every raised token to itself', () => {
    for (const c of CHECKIN_ERROR_CODES.filter((c) => c !== 'not_authorized')) expect(checkinErrorCode(c)).toBe(c);
  });
  it('maps 0015 wording, network failures and junk', () => {
    expect(checkinErrorCode('not authorized')).toBe('not_authorized');
    expect(checkinErrorCode('TypeError: Failed to fetch')).toBe('offline');
    expect(checkinErrorCode('something else')).toBe('unknown');
    expect(checkinErrorCode(null)).toBe('unknown');
  });
  it('has copy for every code', () => {
    for (const c of [...CHECKIN_ERROR_CODES, 'offline', 'unknown'] as const) {
      expect(typeof get(checkinErrorKey(c)), c).toBe('string');
    }
  });
});

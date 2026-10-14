import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import { BOOKING_ERROR_CODES, bookingErrorCode, bookingErrorKey } from './errors';

function lookup(path: string): unknown {
  return path.split('.').reduce<unknown>((node, k) => (node as Record<string, unknown> | undefined)?.[k], en);
}

describe('bookingErrorCode', () => {
  it('recognises every token the RPCs raise', () => {
    for (const code of BOOKING_ERROR_CODES) {
      if (code === 'not_authorized') continue;
      expect(bookingErrorCode(code)).toBe(code);
    }
  });
  it("maps 0015's 'not authorized' wording", () => {
    expect(bookingErrorCode('not authorized')).toBe('not_authorized');
  });
  it('treats a fetch failure as offline', () => {
    expect(bookingErrorCode('TypeError: Failed to fetch')).toBe('offline');
    expect(bookingErrorCode('Network request failed')).toBe('offline');
  });
  it('falls back to unknown', () => {
    expect(bookingErrorCode('duplicate key value violates unique constraint')).toBe('unknown');
    expect(bookingErrorCode(null)).toBe('unknown');
  });
});

describe('bookingErrorKey', () => {
  it('has English copy for every code', () => {
    for (const code of [...BOOKING_ERROR_CODES, 'unknown', 'offline'] as const) {
      expect(typeof lookup(bookingErrorKey(code))).toBe('string');
    }
  });
});

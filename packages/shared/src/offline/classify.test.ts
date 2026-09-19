import { describe, expect, it } from 'vitest';
import { backoffMs, classifyError, isNetworkError } from './classify';

describe('isNetworkError', () => {
  it('is true for a fetch that never reached the server (web and native text)', () => {
    expect(isNetworkError({ code: '', message: 'TypeError: Failed to fetch' })).toBe(true);
    expect(isNetworkError({ code: '', message: 'Network request failed' })).toBe(true);
    expect(isNetworkError({ message: 'Load failed' })).toBe(true);
  });
  it('is false for a Postgres error and for nothing', () => {
    expect(isNetworkError({ code: '42501', message: 'network' })).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});

describe('classifyError', () => {
  it('treats an expired token as auth', () => {
    expect(classifyError({ code: 'PGRST301', message: 'JWT expired' })).toBe('auth');
    expect(classifyError({ code: 'PGRST303', message: 'JWT claims validation failed' })).toBe('auth');
  });
  it('treats anything that never reached Postgres as transient', () => {
    expect(classifyError({ code: '', message: 'Failed to fetch' })).toBe('transient');
    expect(classifyError({ code: '', message: 'AbortError' })).toBe('transient');
  });
  it('treats rule and rights failures as permanent', () => {
    for (const code of ['42501', '23514', 'P0001', '22P02', 'PGRST202']) {
      expect(classifyError({ code, message: 'x' })).toBe('permanent');
    }
  });
  it('treats connection and resource SQLSTATEs as transient', () => {
    for (const code of ['08006', '53300', '57014', '40001']) {
      expect(classifyError({ code, message: 'x' })).toBe('transient');
    }
  });
});

describe('backoffMs', () => {
  it('doubles from 2 s and caps at 60 s', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  });
});

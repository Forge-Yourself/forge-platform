import { describe, expect, it } from 'vitest';
import { isUlid, makeUlid, ULID_REGEX } from './ulid';

const zeros = new Uint8Array(10);
const ones = new Uint8Array(10).fill(0xff);

describe('makeUlid', () => {
  it('is 26 Crockford base32 characters', () => {
    const id = makeUlid(1_700_000_000_000, zeros);
    expect(id).toHaveLength(26);
    expect(id).toMatch(ULID_REGEX);
  });

  it('encodes the timestamp in the first ten characters, so ids sort by time', () => {
    const a = makeUlid(1_700_000_000_000, ones);
    const b = makeUlid(1_700_000_000_001, zeros);
    expect(a < b).toBe(true);
    expect(a.slice(0, 10)).not.toBe(b.slice(0, 10));
  });

  it('encodes the epoch as all zeros and the random tail as given', () => {
    expect(makeUlid(0, zeros)).toBe('00000000000000000000000000');
    expect(makeUlid(0, ones)).toBe('0000000000ZZZZZZZZZZZZZZZZ');
  });

  it('rejects a random source of the wrong length', () => {
    expect(() => makeUlid(0, new Uint8Array(9))).toThrow();
  });
});

describe('isUlid', () => {
  it('accepts a generated id and rejects lookalikes', () => {
    expect(isUlid(makeUlid(Date.now(), ones))).toBe(true);
    expect(isUlid('01J8RZ0000000000000000AAAA')).toBe(true);
    expect(isUlid('01J8RZ0000000000000000AAAI')).toBe(false); // I is not in the alphabet
    expect(isUlid('01J8RZ0000000000000000AAA')).toBe(false); // 25 chars
    expect(isUlid('01j8rz0000000000000000aaaa')).toBe(false); // lower case
  });
});

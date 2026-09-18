/**
 * ULID: 48-bit millisecond timestamp + 80 random bits, Crockford base32, 26
 * chars, lexically sortable by time. sets.id is CHAR(26) and client-generated
 * so an offline device can mint ids that never collide with another device's
 * (M4b). The random source is injected so this stays pure and testable; the
 * app wraps it with expo-crypto.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_REGEX.test(value);
}

export function makeUlid(nowMs: number, randomBytes: Uint8Array): string {
  if (randomBytes.length !== 10) {
    throw new Error('makeUlid needs exactly 10 random bytes');
  }
  let time = '';
  let t = Math.floor(nowMs);
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  // 80 bits -> 16 chars of 5 bits: walk the bytes as a bit stream.
  let rand = '';
  let acc = 0;
  let bits = 0;
  for (const byte of randomBytes) {
    acc = ((acc << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      rand += ALPHABET[(acc >> bits) & 31];
    }
  }
  return time + rand;
}

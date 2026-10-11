import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

/**
 * The check-in code (M5b spec D1). Mirrors public.checkin_code in 0021:
 * HMAC-SHA256(secret, "<booking>:<window>") truncated RFC 4226-style to six
 * digits. Both sides pin the same vector (code.test.ts, db/rls_assertions.sql),
 * because a rule written in two languages needs a test on each side.
 */
export const CHECKIN_WINDOW_SEC = 60;
/** A code appears this long before the start (spec D3). */
export const CHECKIN_LEAD_MIN = 30;

export function windowOf(ms: number): number {
  return Math.floor(ms / 1000 / CHECKIN_WINDOW_SEC);
}

/** Seconds until the code rotates, 1…60. */
export function secondsLeft(ms: number): number {
  return CHECKIN_WINDOW_SEC - (Math.floor(ms / 1000) % CHECKIN_WINDOW_SEC);
}

export function checkinCode(secretHex: string, bookingId: string, window: number): string {
  const mac = hmac(sha256, hexToBytes(secretHex), utf8ToBytes(bookingId.toLowerCase() + ':' + window));
  const off = mac[31]! & 0x0f;
  const bin = ((mac[off]! & 0x7f) << 24) | (mac[off + 1]! << 16) | (mac[off + 2]! << 8) | mac[off + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}

const PREFIX = 'forge-checkin:1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatCheckinPayload(bookingId: string, window: number, code: string): string {
  return PREFIX + bookingId.toLowerCase() + ':' + window + ':' + code;
}

export type CheckinPayload = { bookingId: string; window: number; code: string };

/** Null for anything that isn't a Forge check-in code, so a stray QR is ignored, not sent. */
export function parseCheckinPayload(raw: string): CheckinPayload | null {
  if (!raw.startsWith(PREFIX)) return null;
  const parts = raw.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  const [bookingId, w, code] = parts as [string, string, string];
  if (!UUID.test(bookingId) || !/^\d{1,12}$/.test(w) || !/^\d{6}$/.test(code)) return null;
  return { bookingId: bookingId.toLowerCase(), window: Number(w), code };
}

/** "482913" → "482 913", how the design prints it under the QR. */
export function groupCode(code: string): string {
  return code.slice(0, 3) + ' ' + code.slice(3);
}

export function checkInOpensAt(startsAt: string): Date {
  return new Date(Date.parse(startsAt) - CHECKIN_LEAD_MIN * 60_000);
}

/** Mirrors check_in's window: start − 30 min ≤ now ≤ end, both ends included. */
export function isCheckInOpen(startsAt: string, endsAt: string, now: number): boolean {
  return now >= checkInOpensAt(startsAt).getTime() && now <= Date.parse(endsAt);
}

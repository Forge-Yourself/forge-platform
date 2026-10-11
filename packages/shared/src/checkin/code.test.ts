import { describe, expect, it } from 'vitest';
import {
  checkInOpensAt, checkinCode, formatCheckinPayload, groupCode, isCheckInOpen, parseCheckinPayload, secondsLeft, windowOf,
} from './code';

// The same vector db/rls_assertions.sql pins against public.checkin_code.
const SECRET = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const BOOKING = '5b000000-0000-4000-8000-0000000000c1';

describe('checkinCode', () => {
  it('matches the SQL vector', () => {
    expect(checkinCode(SECRET, BOOKING, 29000000)).toBe('104142');
    expect(checkinCode(SECRET, BOOKING, 29000001)).toBe('861886');
    expect(checkinCode(SECRET, BOOKING, 29000002)).toBe('701179');
  });
  it('ignores the case of the booking id, as Postgres prints uuids lowercase', () => {
    expect(checkinCode(SECRET, BOOKING.toUpperCase(), 29000000)).toBe('104142');
  });
  it('is always six digits', () => {
    for (let w = 0; w < 200; w++) expect(checkinCode(SECRET, BOOKING, w)).toMatch(/^\d{6}$/);
  });
});

describe('windows', () => {
  it('rotates every 60 seconds', () => {
    expect(windowOf(29000000 * 60_000)).toBe(29000000);
    expect(windowOf(29000000 * 60_000 + 59_999)).toBe(29000000);
    expect(windowOf(29000001 * 60_000)).toBe(29000001);
  });
  it('counts down 60 … 1', () => {
    expect(secondsLeft(0)).toBe(60);
    expect(secondsLeft(18_000)).toBe(42);
    expect(secondsLeft(59_999)).toBe(1);
  });
});

describe('payload', () => {
  it('round-trips', () => {
    const raw = formatCheckinPayload(BOOKING.toUpperCase(), 29000000, '104142');
    expect(raw).toBe('forge-checkin:1:' + BOOKING + ':29000000:104142');
    expect(parseCheckinPayload(raw)).toEqual({ bookingId: BOOKING, window: 29000000, code: '104142' });
  });
  it.each([
    'https://example.com',
    'forge-checkin:2:' + BOOKING + ':1:104142',
    'forge-checkin:1:not-a-uuid:1:104142',
    'forge-checkin:1:' + BOOKING + ':1:10414',
    'forge-checkin:1:' + BOOKING + ':x:104142',
    'forge-checkin:1:' + BOOKING + ':1:104142:extra',
    '',
  ])('rejects %j', (raw) => {
    expect(parseCheckinPayload(raw)).toBeNull();
  });
  it('groups the digits as the design prints them', () => {
    expect(groupCode('482913')).toBe('482 913');
  });
});

describe('isCheckInOpen', () => {
  const start = '2026-10-20T10:00:00.000Z';
  const end = '2026-10-20T11:00:00.000Z';
  it('opens exactly 30 minutes before the start, as check_in does', () => {
    const opens = checkInOpensAt(start).getTime();
    expect(opens).toBe(Date.parse('2026-10-20T09:30:00.000Z'));
    expect(isCheckInOpen(start, end, opens - 1)).toBe(false);
    expect(isCheckInOpen(start, end, opens)).toBe(true);
  });
  it('stays open through the end, and not a moment after', () => {
    expect(isCheckInOpen(start, end, Date.parse(end))).toBe(true);
    expect(isCheckInOpen(start, end, Date.parse(end) + 1)).toBe(false);
  });
});

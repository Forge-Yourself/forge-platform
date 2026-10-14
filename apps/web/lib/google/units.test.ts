import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { calendarApi } from './calendarApi';
import { GoogleAuthRevoked, GoogleHttpError } from './errors';
import { busyFromEvents, eventBodyFor, eventIdFor } from './events';
import { consentUrl, emailFromIdToken, exchangeCode, hasRequiredScopes, pkcePair, refreshAccess, REQUIRED_SCOPES } from './oauth';
import { isReturnToAllowed, withResult } from './returnTo';
import { open, seal } from './seal';
import { event, fakeFetch, json, on } from './testFakes';

const KEY = randomBytes(32).toString('base64');
const NOW = new Date('2026-10-11T09:40:00Z');

describe('seal', () => {
  it('round-trips', () => {
    expect(open(seal('1//refresh-token', KEY), KEY)).toBe('1//refresh-token');
  });
  it('uses a fresh IV each time', () => {
    expect(seal('x', KEY)).not.toBe(seal('x', KEY));
  });
  it('refuses a tampered ciphertext', () => {
    const [v, iv, body, tag] = seal('secret', KEY).split('.');
    const flipped = Buffer.from(body!, 'base64url');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => open([v, iv, flipped.toString('base64url'), tag].join('.'), KEY)).toThrow();
  });
  it('refuses the wrong key', () => {
    expect(() => open(seal('secret', KEY), randomBytes(32).toString('base64'))).toThrow();
  });
  it('refuses a key that is not 32 bytes', () => {
    expect(() => seal('x', randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('oauth', () => {
  it('builds a consent URL with offline access, consent, PKCE and every scope', () => {
    const { challenge } = pkcePair();
    const url = new URL(consentUrl({ clientId: 'cid', redirectUri: 'https://x/api/google/callback', state: 'st', challenge }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const q = url.searchParams;
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('prompt')).toBe('consent');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toBe(challenge);
    expect(q.get('state')).toBe('st');
    expect(q.get('scope')!.split(' ')).toEqual(expect.arrayContaining([...REQUIRED_SCOPES, 'openid', 'email']));
  });
  it('asks Google to show the account picker for "Use another account"', () => {
    const url = new URL(consentUrl({ clientId: 'c', redirectUri: 'r', state: 's', challenge: 'h', selectAccount: true }));
    expect(url.searchParams.get('prompt')).toBe('consent select_account');
  });
  it('PKCE challenge is the base64url SHA-256 of the verifier', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it('exchanges a code and reads expiry, refresh token and scopes', async () => {
    const { f, calls } = fakeFetch([
      on('POST', 'oauth2.googleapis.com/token', () =>
        json(200, { access_token: 'at', expires_in: 3600, refresh_token: 'rt', id_token: 'x.y.z', scope: REQUIRED_SCOPES.join(' ') }),
      ),
    ]);
    const t = await exchangeCode(f, { clientId: 'c', clientSecret: 's', redirectUri: 'r', code: 'code', verifier: 'v' }, NOW);
    expect(t.accessToken).toBe('at');
    expect(t.refreshToken).toBe('rt');
    expect(t.expiresAt.toISOString()).toBe('2026-10-11T10:40:00.000Z');
    expect(hasRequiredScopes(t.scopes)).toBe(true);
    expect(calls[0]!.body).toContain('code_verifier=v');
    expect(calls[0]!.body).toContain('grant_type=authorization_code');
  });
  it('turns invalid_grant into GoogleAuthRevoked', async () => {
    const { f } = fakeFetch([on('POST', '/token', () => json(400, { error: 'invalid_grant' }))]);
    await expect(refreshAccess(f, { clientId: 'c', clientSecret: 's', refreshToken: 'r' }, NOW)).rejects.toBeInstanceOf(GoogleAuthRevoked);
  });
  it('keeps other token failures as HTTP errors', async () => {
    const { f } = fakeFetch([on('POST', '/token', () => json(503, { error: 'backend' }))]);
    await expect(refreshAccess(f, { clientId: 'c', clientSecret: 's', refreshToken: 'r' }, NOW)).rejects.toBeInstanceOf(GoogleHttpError);
  });
  it('reads the email from an id token', () => {
    const payload = Buffer.from(JSON.stringify({ email: 'rami@gmail.com' })).toString('base64url');
    expect(emailFromIdToken(`h.${payload}.s`)).toBe('rami@gmail.com');
    expect(emailFromIdToken(null)).toBeNull();
    expect(emailFromIdToken('garbage')).toBeNull();
  });
  it('notices an unticked calendar scope', () => {
    expect(hasRequiredScopes(['openid', 'email', REQUIRED_SCOPES[0]!])).toBe(false);
  });
});

describe('events', () => {
  const b = {
    bookingId: '5C000000-0000-4000-8000-0000000000A2',
    status: 'scheduled',
    startsAt: '2026-10-13T14:00:00+00:00',
    endsAt: '2026-10-13T15:00:00+00:00',
    timezone: 'Asia/Beirut',
    title: 'Forge · Karim',
    attempts: 0,
    queuedAt: '2026-10-11T09:00:00Z',
  };
  it('derives a base32hex event id from the booking id', () => {
    expect(eventIdFor(b.bookingId)).toBe('forge5c0000000000400080000000000000a2');
    expect(eventIdFor(b.bookingId)).toMatch(/^[a-v0-9]{5,1024}$/);
  });
  it('writes a title, times and the booking id, and nothing else about the client', () => {
    const body = eventBodyFor(b);
    expect(body.summary).toBe('Forge · Karim');
    expect(body.start).toEqual({ dateTime: '2026-10-13T14:00:00.000Z', timeZone: 'Asia/Beirut' });
    expect(body.extendedProperties.private.forgeBookingId).toBe(b.bookingId);
    expect(Object.keys(body).sort()).toEqual(['end', 'extendedProperties', 'id', 'start', 'status', 'summary', 'transparency']);
  });
  it('busy: keeps timed and all-day events', () => {
    const out = busyFromEvents('pa@x', [
      event({ id: 'a', summary: ' Dentist ' }),
      event({ id: 'b', start: { date: '2026-10-14' }, end: { date: '2026-10-15' }, summary: 'Holiday' }),
    ]);
    expect(out).toEqual([
      { calendar_id: 'pa@x', event_id: 'a', title: 'Dentist', start: '2026-10-13T14:00:00Z', end: '2026-10-13T15:00:00Z' },
      { calendar_id: 'pa@x', event_id: 'b', title: 'Holiday', start_date: '2026-10-14', end_date: '2026-10-15' },
    ]);
  });
  it('busy: drops free, declined, cancelled and Forge\'s own events', () => {
    const out = busyFromEvents('pa@x', [
      event({ id: 'free', transparency: 'transparent' }),
      event({ id: 'declined', attendees: [{ self: true, responseStatus: 'declined' }] }),
      event({ id: 'other-declined', attendees: [{ self: false, responseStatus: 'declined' }, { self: true, responseStatus: 'accepted' }] }),
      event({ id: 'gone', status: 'cancelled' }),
      event({ id: 'ours', extendedProperties: { private: { forgeBookingId: 'x' } } }),
    ]);
    expect(out.map((e) => e.event_id)).toEqual(['other-declined']);
  });
  it('busy: an untitled event has a null title', () => {
    expect(busyFromEvents('c', [event({ id: 'x', summary: undefined })])[0]!.title).toBeNull();
  });
});

describe('calendarApi.putEvent', () => {
  const path = '/calendars/cal/events/ev';
  it('updates an event that exists', async () => {
    const { f, calls } = fakeFetch([on('PUT', path, () => json(200, {}))]);
    await calendarApi(f, 'at').putEvent('cal', 'ev', { summary: 's' });
    expect(calls.map((c) => c.method)).toEqual(['PUT']);
  });
  it('inserts with our id when Google has never seen it', async () => {
    const { f, calls } = fakeFetch([on('PUT', path, () => json(404, {})), on('POST', '/calendars/cal/events', () => json(200, {}))]);
    await calendarApi(f, 'at').putEvent('cal', 'ev', { id: 'ev' });
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'POST']);
  });
  it('revives a deleted event: PUT 404, insert 409, PUT again', async () => {
    let puts = 0;
    const { f, calls } = fakeFetch([
      on('PUT', path, () => (++puts === 1 ? json(404, {}) : json(200, {}))),
      on('POST', '/calendars/cal/events', () => json(409, { error: { message: 'duplicate' } })),
    ]);
    await calendarApi(f, 'at').putEvent('cal', 'ev', { id: 'ev', status: 'confirmed' });
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'POST', 'PUT']);
  });
  it('sends the bearer token', async () => {
    const seen: string[] = [];
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string>).Authorization);
      return json(200, {});
    }) as typeof fetch;
    await calendarApi(f, 'tok').putEvent('cal', 'ev', {});
    expect(seen).toEqual(['Bearer tok']);
  });
  it('treats 401 as revoked', async () => {
    const { f } = fakeFetch([on('PUT', path, () => json(401, {}))]);
    await expect(calendarApi(f, 'at').putEvent('cal', 'ev', {})).rejects.toBeInstanceOf(GoogleAuthRevoked);
  });
});

describe('calendarApi misc', () => {
  it('delete: 410 Gone is done', async () => {
    const { f } = fakeFetch([on('DELETE', '/events/ev', () => new Response(null, { status: 410 }))]);
    await expect(calendarApi(f, 'at').deleteEvent('cal', 'ev')).resolves.toBeUndefined();
  });
  it('lists calendars across pages, preferring the PT\'s own name for each', async () => {
    const { f } = fakeFetch([
      on('GET', /calendarList\?(?!.*pageToken)/, () =>
        json(200, { items: [{ id: 'pa@x', summary: 'pa@x', primary: true }], nextPageToken: 'p2' }),
      ),
      on('GET', /calendarList\?.*pageToken=p2/, () => json(200, { items: [{ id: 'team@x', summary: 'Team', summaryOverride: 'Gym team' }] })),
    ]);
    expect(await calendarApi(f, 'at').listCalendars()).toEqual([
      { id: 'pa@x', summary: 'pa@x', primary: true },
      { id: 'team@x', summary: 'Gym team', primary: false },
    ]);
  });
  it('lists single events in the window', async () => {
    const { f, calls } = fakeFetch([on('GET', '/calendars/pa%40x/events', () => json(200, { items: [event({ id: 'a' })] }))]);
    const items = await calendarApi(f, 'at').listEvents('pa@x', '2026-10-10T00:00:00Z', '2027-01-01T00:00:00Z');
    expect(items).toHaveLength(1);
    const q = new URL(calls[0]!.url).searchParams;
    expect(q.get('singleEvents')).toBe('true');
    expect(q.get('timeMin')).toBe('2026-10-10T00:00:00Z');
  });
  it('a calendar that was deleted reads as missing', async () => {
    const { f } = fakeFetch([on('GET', '/calendars/gone', () => json(404, {}))]);
    expect(await calendarApi(f, 'at').calendarExists('gone')).toBe(false);
  });
});

describe('returnTo', () => {
  const env = process.env.NODE_ENV;
  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = env;
    delete process.env.ALLOWED_ORIGINS;
  });
  it('allows the app scheme', () => {
    expect(isReturnToAllowed('forge://schedule/calendar')).toBe(true);
  });
  it('refuses anyone else\'s site', () => {
    expect(isReturnToAllowed('https://evil.example/steal')).toBe(false);
    expect(isReturnToAllowed('javascript:alert(1)')).toBe(false);
    expect(isReturnToAllowed('not a url')).toBe(false);
  });
  it('allows the local Expo web server outside production only', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    expect(isReturnToAllowed('http://localhost:8081/schedule/calendar')).toBe(true);
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    expect(isReturnToAllowed('http://localhost:8081/schedule/calendar')).toBe(false);
  });
  it('allows a configured origin in production', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.ALLOWED_ORIGINS = 'https://app.forge.example';
    expect(isReturnToAllowed('https://app.forge.example/schedule/calendar')).toBe(true);
  });
  it('adds the result without losing the path', () => {
    expect(withResult('forge://schedule/calendar', 'connected')).toBe('forge://schedule/calendar?gcal=connected');
  });
});

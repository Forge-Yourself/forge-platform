import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { QueuedBooking } from './events';
import { seal } from './seal';
import { syncPt, type LinkState, type SyncDeps } from './sync';
import { event, fakeFetch, json, MemoryStore, on } from './testFakes';

const KEY = randomBytes(32).toString('base64');
const NOW = new Date('2026-10-11T09:40:00Z');
const PT = 'pt-1';

const link = (over: Partial<LinkState> = {}): LinkState => ({
  status: 'connected',
  googleEmail: 'pa@x',
  forgeCalendarId: 'forgecal',
  busyCalendarIds: ['pa@x'],
  busyRefreshedAt: NOW.toISOString(),
  errorAt: null,
  ...over,
});

const freshTokens = () => ({
  refresh: seal('refresh-1', KEY),
  access: seal('access-1', KEY),
  accessExpiresAt: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
});

const queued = (id: string, status = 'scheduled', attempts = 0): QueuedBooking => ({
  bookingId: id,
  status,
  startsAt: '2026-10-13T14:00:00Z',
  endsAt: '2026-10-13T15:00:00Z',
  timezone: 'Asia/Beirut',
  title: 'Forge · Karim',
  attempts,
  queuedAt: '2026-10-11T09:00:00Z',
});

const ID_A = '5c000000-0000-4000-8000-0000000000a1';
const ID_B = '5c000000-0000-4000-8000-0000000000b2';

/** A Google with a live Forge calendar that accepts every write. */
const happyGoogle = () => [
  on('GET', '/calendars/forgecal', () => json(200, { id: 'forgecal' })),
  on('PUT', '/calendars/forgecal/events/', () => json(200, {})),
  on('DELETE', '/calendars/forgecal/events/', () => new Response(null, { status: 204 })),
  on('GET', '/users/me/calendarList', () =>
    json(200, { items: [{ id: 'pa@x', summary: 'Personal', primary: true }, { id: 'forgecal', summary: 'Forge sessions' }] }),
  ),
  on('GET', '/calendars/pa%40x/events', () => json(200, { items: [event({ id: 'dentist', summary: 'Dentist' })] })),
];

function deps(store: MemoryStore, f: typeof fetch): SyncDeps {
  return { store, f, clientId: 'cid', clientSecret: 'secret', tokenKey: KEY, now: NOW };
}

describe('syncPt', () => {
  it('is a no-op for a PT who never connected', async () => {
    const store = new MemoryStore(null, null);
    const { f, calls } = fakeFetch([]);
    expect((await syncPt(deps(store, f), PT)).status).toBe('not_connected');
    expect(calls).toHaveLength(0);
  });

  it('copies a live booking, removes a cancelled one, and empties the queue', async () => {
    const store = new MemoryStore(link(), freshTokens());
    store.queue = [queued(ID_A), queued(ID_B, 'cancelled')];
    const { f, calls } = fakeFetch(happyGoogle());
    const out = await syncPt(deps(store, f), PT);
    expect(out).toMatchObject({ status: 'synced', pushed: 2, failed: 0 });
    expect(store.queue).toHaveLength(0);
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${new URL(c.url).pathname}`);
    expect(writes).toEqual([
      'PUT /calendar/v3/calendars/forgecal/events/forge5c0000000000400080000000000000a1',
      'DELETE /calendar/v3/calendars/forgecal/events/forge5c0000000000400080000000000000b2',
    ]);
    expect(JSON.parse(calls.find((c) => c.method === 'PUT')!.body!).summary).toBe('Forge · Karim');
    expect(store.link!.lastSyncedAt).toBe(NOW.toISOString());
  });

  it('keeps a booking re-queued while its write was in flight', async () => {
    const store = new MemoryStore(link(), freshTokens());
    store.queue = [queued(ID_A)];
    const { f } = fakeFetch([
      on('PUT', '/events/', () => {
        store.queue[0] = { ...store.queue[0]!, queuedAt: '2026-10-11T09:39:59Z' };
        return json(200, {});
      }),
      ...happyGoogle(),
    ]);
    await syncPt(deps(store, f), PT);
    expect(store.queue.map((q) => q.bookingId)).toEqual([ID_A]);
  });

  it('refreshes an expired access token first and stores it sealed', async () => {
    const store = new MemoryStore(link(), { ...freshTokens(), accessExpiresAt: new Date(NOW.getTime() - 1000).toISOString() });
    const { f, calls } = fakeFetch([
      on('POST', 'oauth2.googleapis.com/token', () => json(200, { access_token: 'access-2', expires_in: 3600 })),
      ...happyGoogle(),
    ]);
    expect((await syncPt(deps(store, f), PT)).status).toBe('synced');
    expect(calls[0]!.url).toContain('oauth2.googleapis.com/token');
    expect(calls[0]!.body).toContain('refresh_token=refresh-1');
    expect(store.tokens!.access).toMatch(/^v1\./);
    expect(store.tokens!.access).not.toContain('access-2');
    expect(store.tokens!.accessExpiresAt).toBe('2026-10-11T10:40:00.000Z');
  });

  it('flips to error once when Google revokes access, keeping the queue and the first time', async () => {
    const store = new MemoryStore(link(), { ...freshTokens(), access: null, accessExpiresAt: null });
    store.queue = [queued(ID_A)];
    const { f } = fakeFetch([on('POST', '/token', () => json(400, { error: 'invalid_grant' }))]);
    expect((await syncPt(deps(store, f), PT)).status).toBe('revoked');
    expect(store.link!.status).toBe('error');
    expect(store.link!.errorAt).toBe(NOW.toISOString());
    expect(store.queue).toHaveLength(1);

    const later = { ...deps(store, f), now: new Date(NOW.getTime() + 3600_000) };
    await syncPt(later, PT);
    expect(store.link!.errorAt).toBe(NOW.toISOString());
  });

  it('a reconnect (new tokens) drains the queue and clears the error', async () => {
    const store = new MemoryStore(link({ status: 'error', errorAt: '2026-10-11T07:55:00Z' }), freshTokens());
    store.queue = [queued(ID_A), queued(ID_B)];
    const { f } = fakeFetch(happyGoogle());
    expect((await syncPt(deps(store, f), PT)).status).toBe('synced');
    expect(store.queue).toHaveLength(0);
    expect(store.link).toMatchObject({ status: 'connected', errorAt: null });
  });

  it('a 401 mid-sync is also a revocation', async () => {
    const store = new MemoryStore(link(), freshTokens());
    store.queue = [queued(ID_A)];
    const { f } = fakeFetch([on('PUT', '/events/', () => json(401, {})), ...happyGoogle()]);
    expect((await syncPt(deps(store, f), PT)).status).toBe('revoked');
    expect(store.queue).toHaveLength(1);
  });

  it('Google down: unreachable, nothing dequeued, no error state', async () => {
    const store = new MemoryStore(link(), freshTokens());
    store.queue = [queued(ID_A)];
    const { f } = fakeFetch([on('PUT', '/events/', () => json(503, {})), ...happyGoogle()]);
    const out = await syncPt(deps(store, f), PT);
    expect(out.status).toBe('unreachable');
    expect(store.queue).toHaveLength(1);
    expect(store.queue[0]!.attempts).toBe(0);
    expect(store.link!.status).toBe('connected');
  });

  it('the network failing outright is unreachable too', async () => {
    const store = new MemoryStore(link(), freshTokens());
    const f = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect((await syncPt(deps(store, f), PT)).status).toBe('unreachable');
  });

  it('parks a booking Google refuses and carries on with the rest', async () => {
    const store = new MemoryStore(link(), freshTokens());
    store.queue = [queued(ID_A), queued(ID_B)];
    const { f } = fakeFetch([on('PUT', '000000a1', () => json(400, { error: 'bad' })), ...happyGoogle()]);
    const out = await syncPt(deps(store, f), PT);
    expect(out).toMatchObject({ status: 'synced', pushed: 1, failed: 1 });
    expect(store.queue).toHaveLength(1);
    expect(store.queue[0]).toMatchObject({ bookingId: ID_A, attempts: 1 });
    expect(store.queue[0]!.lastError).toContain('400');
  });

  it('stops retrying a booking after five attempts', async () => {
    const store = new MemoryStore(link(), freshTokens());
    store.queue = [queued(ID_A, 'scheduled', 5)];
    const { f, calls } = fakeFetch(happyGoogle());
    await syncPt(deps(store, f), PT);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('re-creates the Forge calendar when the PT deleted it', async () => {
    const store = new MemoryStore(link(), freshTokens());
    const { f, calls } = fakeFetch([
      on('GET', '/calendars/forgecal', () => json(404, {})),
      on('POST', /\/calendars$/, () => json(200, { id: 'newcal' })),
      ...happyGoogle(),
    ]);
    await syncPt(deps(store, f), PT);
    const create = calls.find((c) => c.method === 'POST')!;
    expect(JSON.parse(create.body!)).toEqual({ summary: 'Forge sessions', timeZone: 'Asia/Beirut' });
    expect(store.link!.forgeCalendarId).toBe('newcal');
  });

  it('creates the Forge calendar on first sync', async () => {
    const store = new MemoryStore(link({ forgeCalendarId: null }), freshTokens());
    const { f, calls } = fakeFetch([on('POST', /\/calendars$/, () => json(200, { id: 'newcal' })), ...happyGoogle()]);
    await syncPt(deps(store, f), PT);
    expect(calls.some((c) => c.method === 'GET' && c.url.includes('/calendars/null'))).toBe(false);
    expect(store.link!.forgeCalendarId).toBe('newcal');
  });

  it('leaves busy times alone while they are fresh', async () => {
    const store = new MemoryStore(link(), freshTokens());
    const { f, calls } = fakeFetch(happyGoogle());
    await syncPt(deps(store, f), PT);
    expect(calls.some((c) => c.url.includes('calendarList'))).toBe(false);
  });

  it('refreshes busy times when stale, skipping the Forge calendar and unknown ids', async () => {
    const store = new MemoryStore(
      link({ busyRefreshedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(), busyCalendarIds: ['pa@x', 'forgecal', 'gone@x'] }),
      freshTokens(),
    );
    const { f, calls } = fakeFetch(happyGoogle());
    await syncPt(deps(store, f), PT);
    expect(calls.filter((c) => c.url.includes('/events?')).map((c) => new URL(c.url).pathname)).toEqual([
      '/calendar/v3/calendars/pa%40x/events',
    ]);
    expect(store.busy.map((b) => b.title)).toEqual(['Dentist']);
    expect(store.link!.busyCalendarIds).toEqual(['pa@x']);
    expect(store.link!.calendars!.map((c) => c.id)).toEqual(['pa@x']);
    expect(store.link!.busyRefreshedAt).toBe(NOW.toISOString());
  });

  it('refreshes busy times when forced, even if fresh', async () => {
    const store = new MemoryStore(link(), freshTokens());
    const { f, calls } = fakeFetch(happyGoogle());
    await syncPt(deps(store, f), PT, { forceBusy: true });
    expect(calls.some((c) => c.url.includes('calendarList'))).toBe(true);
  });

  it('with nothing ticked, clears the busy window', async () => {
    const store = new MemoryStore(link({ busyCalendarIds: [], busyRefreshedAt: null }), freshTokens());
    store.busy = [{ calendar_id: 'pa@x', event_id: 'old', title: 'Old' }];
    const { f } = fakeFetch(happyGoogle());
    await syncPt(deps(store, f), PT);
    expect(store.busy).toEqual([]);
  });
});

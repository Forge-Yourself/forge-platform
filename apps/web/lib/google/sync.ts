import { calendarApi, type CalendarApi, type CalendarListEntry } from './calendarApi';
import { GoogleAuthRevoked, isTransient } from './errors';
import { belongsInGoogle, busyFromEvents, eventBodyFor, eventIdFor, type BusyInput, type QueuedBooking } from './events';
import { refreshAccess } from './oauth';
import { open, seal } from './seal';

/**
 * The sync engine (M5c spec D7–D10, D13). One call brings one PT up to date:
 * a fresh access token, the Forge calendar, the queued bookings, and — when
 * stale or forced — the busy blocks from the calendars they ticked.
 *
 * Everything it touches goes through `SyncStore` (lib/google/store.ts over
 * the service-role client) and an injected `fetch`, so sync.test.ts runs it
 * against an in-memory store and a scripted Google.
 */

export const FORGE_CALENDAR_NAME = 'Forge sessions';
export const BUSY_STALE_MS = 5 * 60_000;
export const HORIZON_BACK_MS = 24 * 3600_000;
export const HORIZON_AHEAD_MS = 12 * 7 * 24 * 3600_000;
const BATCH = 50;
const MAX_BATCHES = 10;

export type LinkState = {
  status: 'connected' | 'error';
  googleEmail: string | null;
  forgeCalendarId: string | null;
  busyCalendarIds: string[];
  busyRefreshedAt: string | null;
  errorAt: string | null;
};

export type LinkPatch = Partial<{
  status: 'connected' | 'error';
  errorAt: string | null;
  forgeCalendarId: string;
  calendars: CalendarListEntry[];
  busyCalendarIds: string[];
  lastSyncedAt: string;
  busyRefreshedAt: string;
}>;

export type StoredTokens = { refresh: string; access: string | null; accessExpiresAt: string | null };

export interface SyncStore {
  getLink(pt: string): Promise<LinkState | null>;
  getTokens(pt: string): Promise<StoredTokens | null>;
  saveAccess(pt: string, accessSealed: string, expiresAt: string): Promise<void>;
  patchLink(pt: string, patch: LinkPatch): Promise<void>;
  ptTimezone(pt: string): Promise<string>;
  queueBatch(pt: string, limit: number): Promise<QueuedBooking[]>;
  /** Removes rows only if they haven't been re-queued since `queuedAt`. */
  dequeue(pt: string, done: { bookingId: string; queuedAt: string }[]): Promise<void>;
  failQueue(bookingId: string, attempts: number, error: string): Promise<void>;
  replaceBusy(pt: string, fromIso: string, toIso: string, blocks: BusyInput[]): Promise<number>;
}

export type SyncDeps = {
  store: SyncStore;
  f: typeof fetch;
  clientId: string;
  clientSecret: string;
  tokenKey: string;
  now: Date;
};

export type SyncOutcome = {
  status: 'synced' | 'revoked' | 'unreachable' | 'not_connected';
  pushed: number;
  failed: number;
  /** Set on unreachable, for the route to log. */
  error?: string;
};

async function accessTokenFor(deps: SyncDeps, pt: string, tokens: StoredTokens): Promise<string> {
  const { now } = deps;
  if (tokens.access && tokens.accessExpiresAt && Date.parse(tokens.accessExpiresAt) - now.getTime() > 60_000) {
    return open(tokens.access, deps.tokenKey);
  }
  const fresh = await refreshAccess(
    deps.f,
    { clientId: deps.clientId, clientSecret: deps.clientSecret, refreshToken: open(tokens.refresh, deps.tokenKey) },
    now,
  );
  await deps.store.saveAccess(pt, seal(fresh.accessToken, deps.tokenKey), fresh.expiresAt.toISOString());
  return fresh.accessToken;
}

async function ensureForgeCalendar(deps: SyncDeps, api: CalendarApi, pt: string, link: LinkState): Promise<string> {
  if (link.forgeCalendarId && (await api.calendarExists(link.forgeCalendarId))) return link.forgeCalendarId;
  const id = await api.createCalendar(FORGE_CALENDAR_NAME, await deps.store.ptTimezone(pt));
  await deps.store.patchLink(pt, { forgeCalendarId: id });
  return id;
}

async function pushQueue(deps: SyncDeps, api: CalendarApi, pt: string, calendarId: string) {
  let pushed = 0;
  let failed = 0;
  const seen = new Set<string>();
  for (let i = 0; i < MAX_BATCHES; i++) {
    const batch = (await deps.store.queueBatch(pt, BATCH)).filter((b) => !seen.has(b.bookingId));
    if (batch.length === 0) break;
    const done: { bookingId: string; queuedAt: string }[] = [];
    try {
      for (const b of batch) {
        seen.add(b.bookingId);
        try {
          if (belongsInGoogle(b.status)) await api.putEvent(calendarId, eventIdFor(b.bookingId), eventBodyFor(b));
          else await api.deleteEvent(calendarId, eventIdFor(b.bookingId));
          done.push({ bookingId: b.bookingId, queuedAt: b.queuedAt });
          pushed++;
        } catch (e) {
          if (isTransient(e) || e instanceof GoogleAuthRevoked) throw e;
          // Google refused this one booking (a 400 on its body, say): park it
          // with the reason and carry on with the rest.
          await deps.store.failQueue(b.bookingId, b.attempts + 1, e instanceof Error ? e.message : String(e));
          failed++;
        }
      }
    } finally {
      if (done.length) await deps.store.dequeue(pt, done);
    }
  }
  return { pushed, failed };
}

async function refreshBusy(deps: SyncDeps, api: CalendarApi, pt: string, link: LinkState, forgeCalendarId: string) {
  const calendars = await api.listCalendars();
  const known = new Set(calendars.map((c) => c.id));
  const ids = link.busyCalendarIds.filter((id) => known.has(id) && id !== forgeCalendarId);
  const from = new Date(deps.now.getTime() - HORIZON_BACK_MS).toISOString();
  const to = new Date(deps.now.getTime() + HORIZON_AHEAD_MS).toISOString();
  const blocks: BusyInput[] = [];
  for (const id of ids) blocks.push(...busyFromEvents(id, await api.listEvents(id, from, to)));
  await deps.store.replaceBusy(pt, from, to, blocks);
  await deps.store.patchLink(pt, {
    calendars: calendars.filter((c) => c.id !== forgeCalendarId),
    busyCalendarIds: ids,
    busyRefreshedAt: deps.now.toISOString(),
  });
}

export async function syncPt(deps: SyncDeps, pt: string, opts: { forceBusy?: boolean } = {}): Promise<SyncOutcome> {
  const { store, now } = deps;
  const link = await store.getLink(pt);
  const tokens = link ? await store.getTokens(pt) : null;
  if (!link || !tokens) return { status: 'not_connected', pushed: 0, failed: 0 };

  let pushed = 0;
  let failed = 0;
  try {
    const api = calendarApi(deps.f, await accessTokenFor(deps, pt, tokens));
    const calendarId = await ensureForgeCalendar(deps, api, pt, link);
    ({ pushed, failed } = await pushQueue(deps, api, pt, calendarId));
    const stale = !link.busyRefreshedAt || now.getTime() - Date.parse(link.busyRefreshedAt) > BUSY_STALE_MS;
    if (opts.forceBusy || stale) await refreshBusy(deps, api, pt, link, calendarId);
    await store.patchLink(pt, { status: 'connected', errorAt: null, lastSyncedAt: now.toISOString() });
    return { status: 'synced', pushed, failed };
  } catch (e) {
    if (e instanceof GoogleAuthRevoked) {
      // Keep the first moment it stopped: that's what the screen says.
      if (link.status !== 'error') await store.patchLink(pt, { status: 'error', errorAt: now.toISOString() });
      return { status: 'revoked', pushed, failed };
    }
    // The network, Google 5xx/429, or an unexpected 4xx on a calendar-level
    // call: nothing is lost (the queue stays), the screen says Google is
    // unreachable, and the next nudge or the daily sweep tries again.
    return { status: 'unreachable', pushed, failed, error: e instanceof Error ? e.message : String(e) };
  }
}

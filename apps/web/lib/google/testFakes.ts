import type { CalendarListEntry } from './calendarApi';
import type { BusyInput, GoogleEvent, QueuedBooking } from './events';
import type { LinkPatch, LinkState, StoredTokens, SyncStore } from './sync';

/**
 * Test doubles for lib/google: a scripted Google (`fakeFetch`) and an
 * in-memory SyncStore. Imported only by *.test.ts.
 */

export type Call = { method: string; url: string; body: string | null };
type Handler = (call: Call) => Response | Promise<Response> | undefined;

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Handlers are tried in order; the first that returns a Response answers. Unmatched calls are 599. */
export function fakeFetch(handlers: Handler[]) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), body: (init?.body as string | undefined) ?? null };
    calls.push(call);
    for (const h of handlers) {
      const r = await h(call);
      if (r) return r;
    }
    return new Response('unscripted ' + call.method + ' ' + call.url, { status: 599 });
  }) as typeof fetch;
  return { f, calls };
}

export const on =
  (method: string, urlPart: string | RegExp, respond: (call: Call) => Response) =>
  (call: Call): Response | undefined =>
    call.method === method && (typeof urlPart === 'string' ? call.url.includes(urlPart) : urlPart.test(call.url))
      ? respond(call)
      : undefined;

export class MemoryStore implements SyncStore {
  link: (LinkState & { calendars?: CalendarListEntry[]; lastSyncedAt?: string }) | null;
  tokens: StoredTokens | null;
  queue: (QueuedBooking & { lastError?: string })[] = [];
  busy: BusyInput[] = [];
  patches: LinkPatch[] = [];
  tz = 'Asia/Beirut';

  constructor(link: LinkState | null, tokens: StoredTokens | null) {
    this.link = link;
    this.tokens = tokens;
  }

  async getLink() {
    return this.link ? { ...this.link } : null;
  }
  async getTokens() {
    return this.tokens;
  }
  async saveAccess(_pt: string, access: string, expiresAt: string) {
    this.tokens = { ...this.tokens!, access, accessExpiresAt: expiresAt };
  }
  async patchLink(_pt: string, patch: LinkPatch) {
    this.patches.push(patch);
    if (this.link) Object.assign(this.link, patch);
  }
  async ptTimezone() {
    return this.tz;
  }
  async queueBatch(_pt: string, limit: number) {
    return this.queue.filter((q) => q.attempts < 5).slice(0, limit);
  }
  async dequeue(_pt: string, done: { bookingId: string; queuedAt: string }[]) {
    this.queue = this.queue.filter((q) => !done.some((d) => d.bookingId === q.bookingId && d.queuedAt >= q.queuedAt));
  }
  async failQueue(bookingId: string, attempts: number, error: string) {
    const q = this.queue.find((x) => x.bookingId === bookingId);
    if (q) Object.assign(q, { attempts, lastError: error });
  }
  async replaceBusy(_pt: string, _from: string, _to: string, blocks: BusyInput[]) {
    this.busy = blocks;
    return blocks.length;
  }
}

export const event = (e: Partial<GoogleEvent> & { id: string }): GoogleEvent => ({
  status: 'confirmed',
  summary: 'Busy',
  start: { dateTime: '2026-10-13T14:00:00Z' },
  end: { dateTime: '2026-10-13T15:00:00Z' },
  ...e,
});

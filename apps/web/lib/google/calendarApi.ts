import { GoogleAuthRevoked, GoogleHttpError } from './errors';
import type { GoogleEvent } from './events';

const BASE = 'https://www.googleapis.com/calendar/v3';

export type CalendarListEntry = { id: string; summary: string; primary: boolean };

/**
 * Google Calendar v3 over plain fetch (no googleapis dependency). `f` is
 * injected so the sync engine is tested against a scripted Google.
 */
export function calendarApi(f: typeof fetch, accessToken: string) {
  async function call(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<Response> {
    const url = BASE + path + (query ? '?' + new URLSearchParams(query).toString() : '');
    const res = await f(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) throw new GoogleAuthRevoked('google_401');
    return res;
  }

  async function json<T>(res: Response): Promise<T> {
    if (!res.ok) throw new GoogleHttpError(res.status, await res.text());
    return (await res.json()) as T;
  }

  const enc = encodeURIComponent;

  return {
    async createCalendar(summary: string, timeZone: string): Promise<string> {
      const r = await json<{ id: string }>(await call('POST', '/calendars', { summary, timeZone }));
      return r.id;
    },

    /** Null when the calendar is gone (the PT deleted "Forge sessions"). */
    async calendarExists(id: string): Promise<boolean> {
      const res = await call('GET', `/calendars/${enc(id)}`);
      if (res.status === 404 || res.status === 410) return false;
      await json(res);
      return true;
    },

    async listCalendars(): Promise<CalendarListEntry[]> {
      const out: CalendarListEntry[] = [];
      let pageToken: string | undefined;
      do {
        const r = await json<{ items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean }[]; nextPageToken?: string }>(
          await call('GET', '/users/me/calendarList', undefined, {
            minAccessRole: 'freeBusyReader',
            maxResults: '250',
            ...(pageToken ? { pageToken } : {}),
          }),
        );
        for (const c of r.items ?? []) {
          out.push({ id: c.id, summary: c.summaryOverride ?? c.summary ?? c.id, primary: c.primary === true });
        }
        pageToken = r.nextPageToken;
      } while (pageToken);
      return out;
    },

    /**
     * Idempotent write keyed on our own event id (spec D5): update; if Google
     * has never seen the id, insert it; if the insert says the id is taken
     * (a deleted event keeps its id reserved), the update revives it.
     */
    async putEvent(calendarId: string, eventId: string, body: object): Promise<void> {
      const path = `/calendars/${enc(calendarId)}/events/${enc(eventId)}`;
      const put = await call('PUT', path, body);
      if (put.ok) return;
      if (put.status !== 404) throw new GoogleHttpError(put.status, await put.text());
      const ins = await call('POST', `/calendars/${enc(calendarId)}/events`, body);
      if (ins.ok) return;
      if (ins.status !== 409) throw new GoogleHttpError(ins.status, await ins.text());
      const again = await call('PUT', path, body);
      if (!again.ok) throw new GoogleHttpError(again.status, await again.text());
    },

    async deleteEvent(calendarId: string, eventId: string): Promise<void> {
      const res = await call('DELETE', `/calendars/${enc(calendarId)}/events/${enc(eventId)}`);
      if (res.ok || res.status === 404 || res.status === 410) return;
      throw new GoogleHttpError(res.status, await res.text());
    },

    async listEvents(calendarId: string, fromIso: string, toIso: string): Promise<GoogleEvent[]> {
      const out: GoogleEvent[] = [];
      let pageToken: string | undefined;
      do {
        const r = await json<{ items?: GoogleEvent[]; nextPageToken?: string }>(
          await call('GET', `/calendars/${enc(calendarId)}/events`, undefined, {
            timeMin: fromIso,
            timeMax: toIso,
            singleEvents: 'true',
            showDeleted: 'false',
            maxResults: '2500',
            fields: 'items(id,status,summary,transparency,start,end,attendees(self,responseStatus),extendedProperties),nextPageToken',
            ...(pageToken ? { pageToken } : {}),
          }),
        );
        out.push(...(r.items ?? []));
        pageToken = r.nextPageToken;
      } while (pageToken);
      return out;
    },
  };
}

export type CalendarApi = ReturnType<typeof calendarApi>;

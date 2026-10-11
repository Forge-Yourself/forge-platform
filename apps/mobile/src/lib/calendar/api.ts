import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../supabase';
import { WEB_HOST } from '../webHost';

/**
 * M5c: Google Calendar. Reads go straight to Supabase (RLS: the PT's own
 * rows); the connection itself lives on apps/web, which holds every Google
 * token (spec D1) — the app only opens Google's consent page and nudges sync.
 */

// On web the consent page opens in a popup that loads this app at returnTo;
// the popup must complete the session for the opener to see the result.
WebBrowser.maybeCompleteAuthSession();

export type CalendarEntry = { id: string; summary: string; primary: boolean };

export type CalendarLink = {
  googleEmail: string | null;
  status: 'connected' | 'error';
  calendars: CalendarEntry[];
  busyCalendarIds: string[];
  lastSyncedAt: string | null;
  errorAt: string | null;
};

export type Overlap = {
  bookingId: string;
  busyId: string;
  title: string | null;
  busyStart: string;
  busyEnd: string;
  bookingStart: string;
  bookingEnd: string;
  overlapStart: string;
  overlapEnd: string;
};

export type GcalResult = 'connected' | 'nocalendars' | 'denied' | 'scopes' | 'error' | 'cancelled' | 'not_configured' | 'unreachable';
export type SyncStatus = 'synced' | 'revoked' | 'unreachable' | 'none' | 'not_connected' | 'not_configured';

type Result<T> = { data: T; error: null } | { data: null; error: string };

export async function fetchLink(ptUserId: string): Promise<Result<CalendarLink | null>> {
  const { data, error } = await supabase.from('google_calendar_links').select('*').eq('pt_user_id', ptUserId).maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: null };
  return {
    data: {
      googleEmail: data.google_email,
      status: data.status === 'error' ? 'error' : 'connected',
      calendars: Array.isArray(data.calendars) ? (data.calendars as CalendarEntry[]) : [],
      busyCalendarIds: data.busy_calendar_ids ?? [],
      lastSyncedAt: data.last_synced_at,
      errorAt: data.error_at,
    },
    error: null,
  };
}

/** Bookings waiting to reach Google: the "N bookings made since then" on Sync stopped. */
export async function fetchQueueCount(ptUserId: string): Promise<number> {
  const { count } = await supabase.from('google_sync_queue').select('booking_id', { count: 'exact', head: true }).eq('pt_user_id', ptUserId);
  return count ?? 0;
}

export async function fetchOverlaps(fromIso: string, toIso: string): Promise<Result<Overlap[]>> {
  const { data, error } = await supabase.rpc('calendar_overlaps', { p_from: fromIso, p_to: toIso });
  if (error) return { data: null, error: error.message };
  return {
    data: (data ?? []).map((r) => ({
      bookingId: r.out_booking_id,
      busyId: r.out_busy_id,
      title: r.out_title,
      busyStart: r.out_busy_start,
      busyEnd: r.out_busy_end,
      bookingStart: r.out_booking_start,
      bookingEnd: r.out_booking_end,
      overlapStart: r.out_overlap_start,
      overlapEnd: r.out_overlap_end,
    })),
    error: null,
  };
}

export async function setBusyCalendars(ids: string[]): Promise<boolean> {
  const { error } = await supabase.rpc('set_busy_calendars', { p_ids: ids });
  return !error;
}

export async function keepOverlap(bookingId: string, busyId: string): Promise<boolean> {
  const { error } = await supabase.rpc('keep_overlap', { p_booking_id: bookingId, p_busy_id: busyId });
  return !error;
}

async function post(path: string, body: unknown): Promise<Response | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  try {
    return await fetch(`${WEB_HOST}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

/** Where Google's callback sends the browser back to. `forge://schedule/calendar` on a device. */
export function calendarReturnUrl(): string {
  return Linking.createURL('/schedule/calendar');
}

/**
 * Connect (or reconnect): apps/web returns Google's consent page, the auth
 * session shows it, and the callback redirects back with `?gcal=<result>`.
 */
export async function connectGoogle(opts: { selectAccount?: boolean } = {}): Promise<GcalResult> {
  const returnTo = calendarReturnUrl();
  const res = await post('/api/google/connect', { returnTo, selectAccount: opts.selectAccount === true });
  if (!res) return 'unreachable';
  if (res.status === 503) return 'not_configured';
  if (!res.ok) return 'error';
  const { url } = (await res.json().catch(() => ({}))) as { url?: string };
  if (!url) return 'error';

  const result = await WebBrowser.openAuthSessionAsync(url, returnTo);
  if (result.type === 'cancel' || result.type === 'dismiss') return 'cancelled';
  if (result.type !== 'success' || !result.url) return 'error';
  return parseGcalResult(result.url) ?? 'error';
}

export function parseGcalResult(url: string): GcalResult | null {
  const m = /[?&]gcal=([a-z_]+)/.exec(url);
  const v = m?.[1];
  return v === 'connected' || v === 'nocalendars' || v === 'denied' || v === 'scopes' || v === 'error' ? v : null;
}

export async function disconnectGoogle(): Promise<boolean> {
  const res = await post('/api/google/disconnect', {});
  return !!res?.ok;
}

export async function syncNow(force: boolean): Promise<SyncStatus> {
  const res = await post('/api/google/sync', { force });
  if (!res) return 'unreachable';
  const body = (await res.json().catch(() => ({}))) as { status?: SyncStatus };
  if (res.status === 503) return 'not_configured';
  return body.status ?? (res.ok ? 'synced' : 'unreachable');
}

let pendingNudge: ReturnType<typeof setTimeout> | null = null;

/**
 * Fire-and-forget after a booking write (spec D8): the booking is already
 * saved; this only hurries its copy into Google. Never awaited, never shown.
 * Writes in a burst (cancel, then rebook) share one call: the timer fires
 * after all of them have committed, so none is left for the daily sweep.
 */
export function nudgeCalendarSync(): void {
  if (pendingNudge) return;
  pendingNudge = setTimeout(() => {
    pendingNudge = null;
    void post('/api/google/sync', {}).catch(() => undefined);
  }, 1500);
}

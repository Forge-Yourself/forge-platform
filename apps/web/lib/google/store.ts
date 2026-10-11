import type { Database } from '@forge/shared';
import type { CalendarListEntry } from './calendarApi';
import type { QueuedBooking } from './events';
import type { LinkPatch, LinkState, StoredTokens, SyncStore } from './sync';
import { createServiceClient } from '@/lib/supabase/service';

type Service = ReturnType<typeof createServiceClient>;

const STATE_TTL_MS = 10 * 60_000;

function check<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

/**
 * The service-role side of M5c: the SyncStore the engine runs on, plus the
 * connection bookkeeping the routes need. Every caller must have authorized
 * the user first (bearer token or OAuth state) — this client can read
 * anything, including sealed tokens.
 */
export function googleStore(db: Service = createServiceClient()) {
  const sync: SyncStore = {
    async getLink(pt) {
      const row = check(await db.from('google_calendar_links').select('*').eq('pt_user_id', pt).maybeSingle());
      if (!row) return null;
      const link: LinkState = {
        status: row.status === 'error' ? 'error' : 'connected',
        googleEmail: row.google_email,
        forgeCalendarId: row.forge_calendar_id,
        busyCalendarIds: row.busy_calendar_ids ?? [],
        busyRefreshedAt: row.busy_refreshed_at,
        errorAt: row.error_at,
      };
      return link;
    },

    async getTokens(pt) {
      const row = check(await db.from('google_calendar_tokens').select('*').eq('pt_user_id', pt).maybeSingle());
      if (!row) return null;
      const tokens: StoredTokens = { refresh: row.refresh_token, access: row.access_token, accessExpiresAt: row.access_expires_at };
      return tokens;
    },

    async saveAccess(pt, access, expiresAt) {
      check(
        await db
          .from('google_calendar_tokens')
          .update({ access_token: access, access_expires_at: expiresAt, updated_at: new Date().toISOString() })
          .eq('pt_user_id', pt),
      );
    },

    async patchLink(pt, patch: LinkPatch) {
      const row: Database['public']['Tables']['google_calendar_links']['Update'] = {};
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.errorAt !== undefined) row.error_at = patch.errorAt;
      if (patch.forgeCalendarId !== undefined) row.forge_calendar_id = patch.forgeCalendarId;
      if (patch.calendars !== undefined) row.calendars = patch.calendars;
      if (patch.busyCalendarIds !== undefined) row.busy_calendar_ids = patch.busyCalendarIds;
      if (patch.lastSyncedAt !== undefined) row.last_synced_at = patch.lastSyncedAt;
      if (patch.busyRefreshedAt !== undefined) row.busy_refreshed_at = patch.busyRefreshedAt;
      check(await db.from('google_calendar_links').update(row).eq('pt_user_id', pt));
    },

    async ptTimezone(pt) {
      const row = check(await db.from('users').select('timezone').eq('id', pt).maybeSingle());
      return row?.timezone ?? 'Asia/Beirut';
    },

    async queueBatch(pt, limit) {
      const rows = check(await db.rpc('google_queue_batch', { p_pt: pt, p_limit: limit })) ?? [];
      if (rows.length === 0) return [];
      // queued_at, so a booking re-queued mid-sync isn't dequeued by this pass.
      const at = check(
        await db.from('google_sync_queue').select('booking_id, queued_at').in('booking_id', rows.map((r) => r.out_booking_id)),
      );
      const queuedAt = new Map((at ?? []).map((r) => [r.booking_id, r.queued_at]));
      return rows.map(
        (r): QueuedBooking => ({
          bookingId: r.out_booking_id,
          status: r.out_status,
          startsAt: r.out_starts_at,
          endsAt: r.out_ends_at,
          timezone: r.out_timezone,
          title: r.out_title,
          attempts: r.out_attempts,
          queuedAt: queuedAt.get(r.out_booking_id) ?? new Date(0).toISOString(),
        }),
      );
    },

    async dequeue(_pt, done) {
      for (const d of done) {
        check(await db.from('google_sync_queue').delete().eq('booking_id', d.bookingId).lte('queued_at', d.queuedAt));
      }
    },

    async failQueue(bookingId, attempts, error) {
      check(await db.from('google_sync_queue').update({ attempts, last_error: error.slice(0, 500) }).eq('booking_id', bookingId));
    },

    async replaceBusy(pt, fromIso, toIso, blocks) {
      return (
        check(await db.rpc('google_replace_busy', { p_pt: pt, p_from: fromIso, p_to: toIso, p_blocks: blocks as unknown as never })) ?? 0
      );
    },
  };

  return {
    sync,

    async createState(pt: string, state: string, returnTo: string, verifier: string) {
      // Old, abandoned attempts go first; a state is useful for minutes.
      check(await db.from('google_oauth_states').delete().lt('created_at', new Date(Date.now() - STATE_TTL_MS).toISOString()));
      check(await db.from('google_oauth_states').insert({ state, pt_user_id: pt, return_to: returnTo, code_verifier: verifier }));
    },

    /** One use only: the row is deleted whether or not it's still fresh. */
    async takeState(state: string): Promise<{ pt: string; returnTo: string; verifier: string } | null> {
      const row = check(await db.from('google_oauth_states').delete().eq('state', state).select('*').maybeSingle());
      if (!row || Date.now() - Date.parse(row.created_at) > STATE_TTL_MS) return null;
      return { pt: row.pt_user_id, returnTo: row.return_to, verifier: row.code_verifier };
    },

    /**
     * Saves a fresh connection (spec D14): the same Google account keeps its
     * Forge calendar and ticks; a different one starts over. Returns whether
     * this is a new account for the PT.
     */
    async saveConnection(pt: string, a: { email: string | null; refreshSealed: string; accessSealed: string; expiresAt: string }) {
      const existing = check(await db.from('google_calendar_links').select('google_email').eq('pt_user_id', pt).maybeSingle());
      const sameAccount = !!existing && !!a.email && existing.google_email === a.email;
      const base = { status: 'connected', error_at: null, connected_at: new Date().toISOString(), busy_refreshed_at: null, google_email: a.email };
      if (sameAccount) {
        check(await db.from('google_calendar_links').update(base).eq('pt_user_id', pt));
      } else {
        // A different account: its busy blocks and kept overlaps belong to the old one.
        check(await db.from('google_busy_blocks').delete().eq('pt_user_id', pt));
        check(
          await db
            .from('google_calendar_links')
            .upsert({ pt_user_id: pt, ...base, forge_calendar_id: null, calendars: [], busy_calendar_ids: [], last_synced_at: null }),
        );
      }
      check(
        await db.from('google_calendar_tokens').upsert({
          pt_user_id: pt,
          refresh_token: a.refreshSealed,
          access_token: a.accessSealed,
          access_expires_at: a.expiresAt,
          updated_at: new Date().toISOString(),
        }),
      );
      return { isNewAccount: !sameAccount };
    },

    async setCalendars(pt: string, calendars: CalendarListEntry[], busyIds: string[] | null) {
      check(
        await db
          .from('google_calendar_links')
          .update(busyIds ? { calendars, busy_calendar_ids: busyIds } : { calendars })
          .eq('pt_user_id', pt),
      );
    },

    async enqueueAll(pt: string) {
      return check(await db.rpc('google_enqueue_all', { p_pt: pt }));
    },

    async queueCount(pt: string) {
      const r = await db.from('google_sync_queue').select('booking_id', { count: 'exact', head: true }).eq('pt_user_id', pt);
      if (r.error) throw new Error(r.error.message);
      return r.count ?? 0;
    },

    /** Everything Forge holds about the connection goes (spec D15). Returns the refresh token to revoke, sealed. */
    async disconnect(pt: string): Promise<string | null> {
      const tokens = check(await db.from('google_calendar_tokens').select('refresh_token').eq('pt_user_id', pt).maybeSingle());
      check(await db.from('google_overlap_kept').delete().eq('pt_user_id', pt));
      check(await db.from('google_busy_blocks').delete().eq('pt_user_id', pt));
      check(await db.from('google_sync_queue').delete().eq('pt_user_id', pt));
      check(await db.from('google_calendar_tokens').delete().eq('pt_user_id', pt));
      check(await db.from('google_calendar_links').delete().eq('pt_user_id', pt));
      return tokens?.refresh_token ?? null;
    },

    async allLinkedPts(): Promise<string[]> {
      return (check(await db.from('google_calendar_links').select('pt_user_id')) ?? []).map((r) => r.pt_user_id);
    },

    /**
     * Whose calendars a caller's booking write touches (spec D8): their own
     * if they're a connected PT, otherwise the connected PTs they train with.
     */
    async ptsFor(userId: string): Promise<string[]> {
      const own = check(await db.from('google_calendar_links').select('pt_user_id').eq('pt_user_id', userId).maybeSingle());
      if (own) return [userId];
      const rows = check(
        await db.from('clients').select('pt_user_id').eq('client_user_id', userId).in('state', ['active', 'accepted', 'paused']),
      );
      const pts = [...new Set((rows ?? []).map((r) => r.pt_user_id).filter((x): x is string => !!x))];
      if (pts.length === 0) return [];
      const linked = check(await db.from('google_calendar_links').select('pt_user_id').in('pt_user_id', pts));
      return (linked ?? []).map((r) => r.pt_user_id);
    },
  };
}

export type GoogleStore = ReturnType<typeof googleStore>;

import {
  bookingErrorCode,
  type BookingErrorCode,
  type BookingRules,
  type Database,
  type ExceptionInput,
  type HoursRange,
} from '@forge/shared';
import { nudgeCalendarSync } from '../calendar/api';
import { supabase } from '../supabase';

export type BookingRow = Database['public']['Tables']['bookings']['Row'];
export type BookingPolicy = { lengths: number[]; bufferMin: number; windowWeeks: number; cutoffHours: number; timezone: string };
export type Slot = { date: string; startsAt: string };
export type DayWindow = { date: string; start: string; end: string };
export type SeriesPreviewRow = { n: number; startsAt: string; afterOffsetChange: boolean; conflict: boolean };
export type ApiResult<T> = { data: T; error: null } | { data: null; error: BookingErrorCode };
export type Scope = 'one' | 'following';

/**
 * Thin typed wrappers over 0020. Every booking write goes through here, and
 * every error comes back as a BookingErrorCode the screens map to copy. A
 * successful write nudges Google Calendar sync (M5c spec D8).
 */
const fail = (e: { message?: string } | null): { data: null; error: BookingErrorCode } => ({
  data: null,
  error: bookingErrorCode(e?.message),
});

export async function fetchPolicy(ptUserId: string): Promise<ApiResult<BookingPolicy>> {
  const { data, error } = await supabase.rpc('booking_policy', { p_pt: ptUserId });
  const row = data?.[0];
  if (error || !row) return fail(error);
  return {
    data: {
      lengths: row.lengths_min,
      bufferMin: row.buffer_min,
      windowWeeks: row.window_weeks,
      cutoffHours: row.cutoff_hours,
      timezone: row.timezone,
    },
    error: null,
  };
}

export async function fetchPtBookings(ptUserId: string, fromIso: string, toIso: string): Promise<ApiResult<BookingRow[]>> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('pt_user_id', ptUserId)
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .order('starts_at');
  if (error) return fail(error);
  return { data: data ?? [], error: null };
}

export async function fetchDayWindows(fromDate: string, toDate: string): Promise<ApiResult<DayWindow[]>> {
  const { data, error } = await supabase.rpc('pt_day_windows', { p_from: fromDate, p_to: toDate });
  if (error) return fail(error);
  return { data: (data ?? []).map((w) => ({ date: w.win_date, start: w.win_start, end: w.win_end })), error: null };
}

export async function fetchOpenSlots(
  ptUserId: string,
  fromDate: string,
  toDate: string,
  length: number,
  ignoreId?: string,
): Promise<ApiResult<Slot[]>> {
  const { data, error } = await supabase.rpc('open_slots', {
    p_pt: ptUserId,
    p_from: fromDate,
    p_to: toDate,
    p_length: length,
    ...(ignoreId ? { p_ignore: ignoreId } : {}),
  });
  if (error) return fail(error);
  return { data: (data ?? []).map((s) => ({ date: s.slot_date, startsAt: s.slot_start })), error: null };
}

export async function previewSeries(a: {
  start: string;
  length: number;
  everyWeeks: 1 | 2;
  count: number | null;
  until: string | null;
}): Promise<ApiResult<SeriesPreviewRow[]>> {
  const { data, error } = await supabase.rpc('preview_series', {
    p_start: a.start,
    p_length: a.length,
    p_every_weeks: a.everyWeeks,
    // Exactly one of these is null (series_occurrences enforces it). The SQL
    // params carry no DEFAULT, so the generator types them non-null; PostgREST
    // sends JSON null either way. Same cast log_set's wrapper makes.
    p_count: a.count as number,
    p_until: a.until as string,
  });
  if (error) return fail(error);
  return {
    data: (data ?? []).map((r) => ({ n: r.n, startsAt: r.occ_start, afterOffsetChange: r.after_offset_change, conflict: r.conflict })),
    error: null,
  };
}

export async function createBooking(a: {
  id: string;
  clientId: string;
  startsAt: string;
  length: number;
  everyWeeks?: 1 | 2;
  count?: number;
  until?: string;
}): Promise<ApiResult<BookingRow[]>> {
  const { data, error } = await supabase.rpc('create_booking', {
    p_id: a.id,
    p_client_id: a.clientId,
    p_starts_at: a.startsAt,
    p_length: a.length,
    ...(a.everyWeeks ? { p_every_weeks: a.everyWeeks } : {}),
    ...(a.count ? { p_count: a.count } : {}),
    ...(a.until ? { p_until: a.until } : {}),
  });
  if (error) return fail(error);
  nudgeCalendarSync();
  return { data: data ?? [], error: null };
}

export async function rescheduleBooking(id: string, newStart: string, scope: Scope): Promise<ApiResult<BookingRow[]>> {
  const { data, error } = await supabase.rpc('reschedule_booking', { p_id: id, p_new_start: newStart, p_scope: scope });
  if (error) return fail(error);
  nudgeCalendarSync();
  return { data: data ?? [], error: null };
}

export async function cancelBooking(
  id: string,
  scope: Scope,
  counted: boolean | null,
  reason: string | null,
): Promise<ApiResult<BookingRow[]>> {
  const { data, error } = await supabase.rpc('cancel_booking', {
    p_id: id,
    p_scope: scope,
    ...(counted !== null ? { p_counted: counted } : {}),
    ...(reason ? { p_reason: reason } : {}),
  });
  if (error) return fail(error);
  nudgeCalendarSync();
  return { data: data ?? [], error: null };
}

export async function markNoShow(id: string): Promise<ApiResult<BookingRow>> {
  const { data, error } = await supabase.rpc('mark_no_show', { p_id: id });
  if (error || !data) return fail(error);
  nudgeCalendarSync();
  return { data, error: null };
}

export async function fetchAvailability(
  ptUserId: string,
): Promise<ApiResult<{ hours: HoursRange[]; exceptions: ExceptionInput[]; priceCents: number | null }>> {
  const today = new Date();
  const todayKey =
    today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const [h, x, r] = await Promise.all([
    supabase.from('schedules').select('day_of_week, start_time, end_time').eq('user_id', ptUserId).eq('is_active', true),
    supabase.from('availability_exceptions').select('on_date, kind, ranges').eq('pt_user_id', ptUserId).gte('on_date', todayKey).order('on_date'),
    supabase.from('booking_rules').select('price_cents').eq('pt_user_id', ptUserId).maybeSingle(),
  ]);
  if (h.error) return fail(h.error);
  if (x.error) return fail(x.error);
  if (r.error) return fail(r.error);
  return {
    data: {
      // Postgres TIME comes back as HH:MM:SS.
      hours: (h.data ?? []).map((r) => ({ dow: r.day_of_week, start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5) })),
      exceptions: (x.data ?? []).map((e) => ({
        date: e.on_date,
        kind: e.kind === 'extra' ? 'extra' : 'off',
        ranges: Array.isArray(e.ranges) ? (e.ranges as { start: string; end: string }[]) : null,
      })),
      priceCents: r.data?.price_cents ?? null,
    },
    error: null,
  };
}

export async function saveAvailability(
  hours: HoursRange[],
  exceptions: ExceptionInput[],
  rules: BookingRules,
  /** M5b: cents, or null to clear. Omitted keeps whatever is saved. */
  priceCents?: number | null,
): Promise<ApiResult<{ bookingId: string; startsAt: string }[]>> {
  const { data, error } = await supabase.rpc('save_availability', {
    p_hours: hours,
    p_exceptions: exceptions,
    p_rules: {
      lengths: rules.lengths,
      buffer: rules.bufferMin,
      window: rules.windowWeeks,
      cutoff: rules.cutoffHours,
      ...(priceCents !== undefined ? { price: priceCents } : {}),
    },
  });
  if (error) return fail(error);
  return { data: (data ?? []).map((r) => ({ bookingId: r.out_booking_id, startsAt: r.out_starts_at })), error: null };
}

export async function fetchUserName(userId: string): Promise<string | null> {
  const { data } = await supabase.from('users').select('display_name').eq('id', userId).maybeSingle();
  return data?.display_name ?? null;
}

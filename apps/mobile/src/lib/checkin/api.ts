import { checkinErrorCode, type CheckinErrorCode, type Database, type PendingCheckInArgs } from '@forge/shared';
import { supabase } from '../supabase';

/**
 * Thin typed wrappers over 0021. Every check-in, rating, amount and reminder
 * write goes through here; every error comes back as a CheckinErrorCode.
 */
export type CheckInRow = Database['public']['Tables']['check_ins']['Row'];
export type ReminderSettings = Database['public']['Tables']['reminder_settings']['Row'];
export type ReminderKey = 'client_24h' | 'client_2h' | 'client_change' | 'pt_agenda' | 'pt_book' | 'pt_late';
export type CheckInOutcome = 'checked_in' | 'checked_out' | 'already';
export type CheckInResult = {
  bookingId: string;
  status: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  outcome: CheckInOutcome;
};
export type Result<T> = { data: T; error: null } | { data: null; error: CheckinErrorCode };

const fail = (e: { message?: string } | null): { data: null; error: CheckinErrorCode } => ({
  data: null,
  error: checkinErrorCode(e?.message),
});

export async function fetchCheckinKeys(fromIso: string, toIso: string): Promise<Result<{ bookingId: string; secretHex: string }[]>> {
  const { data, error } = await supabase.rpc('checkin_keys', { p_from: fromIso, p_to: toIso });
  if (error) return fail(error);
  return { data: (data ?? []).map((r) => ({ bookingId: r.out_booking_id, secretHex: r.out_secret_hex })), error: null };
}

/** The raw call, so the pending queue's transport and the screens share one path. */
export async function callCheckIn(a: PendingCheckInArgs) {
  return supabase.rpc('check_in', {
    ...(a.p_booking_id ? { p_booking_id: a.p_booking_id } : {}),
    p_code: a.p_code,
    ...(a.p_window !== null ? { p_window: a.p_window } : {}),
    p_at: a.p_at,
  });
}

export async function checkIn(a: PendingCheckInArgs): Promise<Result<CheckInResult>> {
  const { data, error } = await callCheckIn(a);
  const row = data?.[0];
  if (error || !row) return fail(error);
  return {
    data: {
      bookingId: row.out_booking_id,
      status: row.out_status,
      checkedInAt: row.out_checked_in_at,
      checkedOutAt: row.out_checked_out_at,
      outcome: row.out_outcome as CheckInOutcome,
    },
    error: null,
  };
}

/** The PT's "Check in by hand": no code, method manual. */
export async function checkInByHand(bookingId: string): Promise<Result<CheckInResult>> {
  const { data, error } = await supabase.rpc('check_in', { p_booking_id: bookingId });
  const row = data?.[0];
  if (error || !row) return fail(error);
  return {
    data: {
      bookingId: row.out_booking_id,
      status: row.out_status,
      checkedInAt: row.out_checked_in_at,
      checkedOutAt: row.out_checked_out_at,
      outcome: row.out_outcome as CheckInOutcome,
    },
    error: null,
  };
}

export async function checkOut(bookingId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('check_out', { p_booking_id: bookingId });
  return error ? fail(error) : { data: null, error: null };
}

export async function callRate(id: string, rating: number, comment: string | null) {
  return supabase.rpc('rate_booking', { p_id: id, p_rating: rating, ...(comment ? { p_comment: comment } : {}) });
}

export async function rateBooking(id: string, rating: number, comment: string | null): Promise<Result<null>> {
  const { error } = await callRate(id, rating, comment);
  return error ? fail(error) : { data: null, error: null };
}

export async function setBookingAmount(id: string, cents: number | null): Promise<Result<null>> {
  // p_cents has no DEFAULT, so the generator types it non-null; PostgREST sends JSON null either way.
  const { error } = await supabase.rpc('set_booking_amount', { p_id: id, p_cents: cents as number });
  return error ? fail(error) : { data: null, error: null };
}

export async function fetchCheckIn(bookingId: string): Promise<Result<CheckInRow | null>> {
  const { data, error } = await supabase.from('check_ins').select('*').eq('booking_id', bookingId).maybeSingle();
  if (error) return fail(error);
  return { data, error: null };
}

export const REMINDER_DEFAULTS: Record<ReminderKey, boolean> = {
  client_24h: true,
  client_2h: false,
  client_change: true,
  pt_agenda: true,
  pt_book: true,
  pt_late: true,
};

/** The PT's saved choices, or the defaults when they never saved any. */
export async function fetchReminders(ptUserId: string): Promise<Result<Record<ReminderKey, boolean>>> {
  const { data, error } = await supabase.from('reminder_settings').select('*').eq('pt_user_id', ptUserId).maybeSingle();
  if (error) return fail(error);
  if (!data) return { data: REMINDER_DEFAULTS, error: null };
  return {
    data: {
      client_24h: data.client_24h,
      client_2h: data.client_2h,
      client_change: data.client_change,
      pt_agenda: data.pt_agenda,
      pt_book: data.pt_book,
      pt_late: data.pt_late,
    },
    error: null,
  };
}

export async function saveReminder(key: ReminderKey, value: boolean): Promise<Result<null>> {
  const { error } = await supabase.rpc('save_reminder_settings', { p: { [key]: value } });
  return error ? fail(error) : { data: null, error: null };
}

import { bookingErrorCode, isSelfClientRow, type BookingErrorCode } from '@forge/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { cachedFetch, OFFLINE } from '../offline/cachedFetch';
import { useOffline } from '../offline/offlineContext';
import { supabase } from '../supabase';
import { fetchPolicy, fetchUserName, type BookingPolicy, type BookingRow } from './scheduleApi';

type Bundle = {
  booking: BookingRow | null;
  clientName: string | null;
  isSelf: boolean;
  programName: string | null;
  policy: BookingPolicy | null;
  series: { starts_at: string; status: string }[];
  /** M5b: when the client checked in, if they did. */
  checkedInAt: string | null;
  fetchedAt: string;
  error: string | null;
};

export async function fetchBookingDetail(id: string): Promise<Bundle> {
  const fetchedAt = new Date().toISOString();
  const empty: Bundle = { booking: null, clientName: null, isSelf: false, programName: null, policy: null, series: [], checkedInAt: null, fetchedAt, error: null };
  const b = await supabase.from('bookings').select('*').eq('id', id).maybeSingle();
  if (b.error) return { ...empty, error: bookingErrorCode(b.error.message) === 'offline' ? OFFLINE : b.error.message };
  const booking = b.data;
  if (!booking) return empty; // removed, or no longer visible: the design's "This booking was removed"

  const seriesId = booking.parent_booking_id ?? (booking.recurrence_rule ? booking.id : null);
  const [client, program, policy, series, checkIn] = await Promise.all([
    booking.client_id
      ? supabase.from('clients').select('id, pt_user_id, client_user_id, invite_name, invite_email').eq('id', booking.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    booking.client_id
      ? supabase.from('programs').select('name').eq('client_id', booking.client_id).eq('state', 'active').limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    fetchPolicy(booking.pt_user_id),
    seriesId
      ? supabase.from('bookings').select('starts_at, status').or(`id.eq.${seriesId},parent_booking_id.eq.${seriesId}`).order('starts_at')
      : Promise.resolve({ data: [] }),
    supabase.from('check_ins').select('checked_in_at').eq('booking_id', id).maybeSingle(),
  ]);
  const c = client.data;
  const linkedName = c?.client_user_id ? await fetchUserName(c.client_user_id) : null;
  return {
    booking,
    clientName: linkedName ?? c?.invite_name ?? c?.invite_email ?? null,
    isSelf: c ? isSelfClientRow(c) : false,
    programName: program.data?.name ?? null,
    policy: policy.error ? null : policy.data,
    series: series.data ?? [],
    checkedInAt: checkIn.data?.checked_in_at ?? null,
    fetchedAt,
    error: null,
  };
}

export type BookingDetailData = Omit<Bundle, 'error'> & { loading: boolean; error: BookingErrorCode | null; refetch: () => void };

export function useBookingDetail(id: string | undefined): BookingDetailData {
  const offline = useOffline();
  const [state, setState] = useState<Omit<BookingDetailData, 'refetch'>>({
    booking: null, clientName: null, isSelf: false, programName: null, policy: null, series: [], checkedInAt: null, fetchedAt: '', loading: true, error: null,
  });
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!id) return () => {};
    const mine = ++seq.current;
    void cachedFetch({ enabled: offline.effective, online: offline.online }, 'booking:' + id, () => fetchBookingDetail(id)).then((r) => {
      if (mine !== seq.current) return;
      setState({ ...r, loading: false, error: r.error ? bookingErrorCode(r.error) : null });
    });
    return () => {
      seq.current++;
    };
  }, [id, offline.effective, offline.online]);

  useFocusEffect(load);
  return { ...state, refetch: () => void load() };
}

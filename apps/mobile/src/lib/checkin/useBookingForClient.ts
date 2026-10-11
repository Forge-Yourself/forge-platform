import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { cachedFetch, OFFLINE } from '../offline/cachedFetch';
import { useOffline } from '../offline/offlineContext';
import type { BookingRow } from '../schedule/scheduleApi';
import { fetchUserName } from '../schedule/scheduleApi';
import { supabase } from '../supabase';

type Bundle = {
  booking: BookingRow | null;
  coachName: string | null;
  clientName: string | null;
  dayLabel: string | null;
  fetchedAt: string;
  error: string | null;
};

const NET = /failed to fetch|network request failed|load failed/i;

/** One booking as its client (or its PT) sees it on the rating sheet and the receipt. */
export async function fetchBookingForClient(id: string): Promise<Bundle> {
  const fetchedAt = new Date().toISOString();
  const empty: Bundle = { booking: null, coachName: null, clientName: null, dayLabel: null, fetchedAt, error: null };
  const b = await supabase.from('bookings').select('*').eq('id', id).maybeSingle();
  if (b.error) return { ...empty, error: NET.test(b.error.message) ? OFFLINE : b.error.message };
  if (!b.data) return empty;
  const [coach, client, ws] = await Promise.all([
    fetchUserName(b.data.pt_user_id),
    b.data.client_id
      ? supabase.from('clients').select('client_user_id, invite_name').eq('id', b.data.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('workout_sessions').select('day_label').eq('booking_id', id).limit(1).maybeSingle(),
  ]);
  const c = client.data;
  const clientName = c?.client_user_id ? await fetchUserName(c.client_user_id) : (c?.invite_name ?? null);
  return { booking: b.data, coachName: coach, clientName, dayLabel: ws.data?.day_label ?? null, fetchedAt, error: null };
}

export type BookingForClient = Omit<Bundle, 'error'> & { loading: boolean; error: string | null; refetch: () => void };

export function useBookingForClient(id: string | undefined): BookingForClient {
  const offline = useOffline();
  const [state, setState] = useState<Omit<BookingForClient, 'refetch'>>({
    booking: null, coachName: null, clientName: null, dayLabel: null, fetchedAt: '', loading: true, error: null,
  });
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!id) return () => {};
    const mine = ++seq.current;
    void cachedFetch({ enabled: offline.effective, online: offline.online }, 'bookingForClient:' + id, () => fetchBookingForClient(id)).then(
      (r) => {
        if (mine !== seq.current) return;
        setState({ ...r, loading: false });
      },
    );
    return () => {
      seq.current++;
    };
  }, [id, offline.effective, offline.online]);
  useFocusEffect(load);
  return { ...state, refetch: () => void load() };
}

/** deviceStore key for "Not now" on the after-session sheet (spec D12). */
export const rateDismissedKey = (bookingId: string) => 'forge.rateDismissed.' + bookingId;

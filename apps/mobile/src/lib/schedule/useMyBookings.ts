import { bookingErrorCode, type BookingErrorCode } from '@forge/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { cachedFetch, OFFLINE } from '../offline/cachedFetch';
import { useOffline } from '../offline/offlineContext';
import { supabase } from '../supabase';
import { fetchPolicy, fetchUserName, type BookingPolicy, type BookingRow } from './scheduleApi';

export type Coach = { clientId: string; ptUserId: string; ptName: string | null };
type Bundle = {
  coach: Coach | null;
  policy: BookingPolicy | null;
  upcoming: BookingRow[];
  past: BookingRow[];
  fetchedAt: string;
  error: string | null;
};

/**
 * A client's coach, the coach's policy, and the client's bookings. "Coach" is
 * the first active/accepted non-self clients row — a client with several PTs
 * is M7's problem. Paused rows still contribute bookings to read.
 */
export async function fetchMyBookings(userId: string): Promise<Bundle> {
  const fetchedAt = new Date().toISOString();
  const empty: Bundle = { coach: null, policy: null, upcoming: [], past: [], fetchedAt, error: null };
  const rows = await supabase.from('clients').select('id, pt_user_id, client_user_id, state').eq('client_user_id', userId);
  if (rows.error) return { ...empty, error: bookingErrorCode(rows.error.message) === 'offline' ? OFFLINE : rows.error.message };
  const mine = (rows.data ?? []).filter((r) => r.pt_user_id !== r.client_user_id);
  const active = mine.find((r) => r.state === 'active' || r.state === 'accepted') ?? null;
  if (mine.length === 0) return empty;

  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [b, policy, ptName] = await Promise.all([
    supabase.from('bookings').select('*').in('client_id', mine.map((r) => r.id)).gte('starts_at', since).order('starts_at'),
    active ? fetchPolicy(active.pt_user_id) : Promise.resolve(null),
    active ? fetchUserName(active.pt_user_id) : Promise.resolve(null),
  ]);
  if (b.error) return { ...empty, error: bookingErrorCode(b.error.message) === 'offline' ? OFFLINE : b.error.message };

  const now = Date.now();
  const all = b.data ?? [];
  // M5b: a checked-in booking is still the session in front of you until it ends.
  const live = (r: BookingRow) => (r.status === 'scheduled' || r.status === 'checked_in') && Date.parse(r.ends_at) > now;
  return {
    coach: active ? { clientId: active.id, ptUserId: active.pt_user_id, ptName } : null,
    policy: policy && !policy.error ? policy.data : null,
    upcoming: all.filter(live),
    past: all.filter((r) => !live(r)).reverse(),
    fetchedAt,
    error: null,
  };
}

export type MyBookingsData = Omit<Bundle, 'error'> & { loading: boolean; error: BookingErrorCode | null; refetch: () => void };

export function useMyBookings(userId: string | undefined): MyBookingsData {
  const offline = useOffline();
  const [state, setState] = useState<Omit<MyBookingsData, 'refetch'>>({
    coach: null, policy: null, upcoming: [], past: [], fetchedAt: '', loading: true, error: null,
  });
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!userId) return () => {};
    const mine = ++seq.current;
    void cachedFetch({ enabled: offline.effective, online: offline.online }, 'myBookings:' + userId, () => fetchMyBookings(userId)).then(
      (r) => {
        if (mine !== seq.current) return;
        setState({ ...r, loading: false, error: r.error ? bookingErrorCode(r.error) : null });
      },
    );
    return () => {
      seq.current++;
    };
  }, [userId, offline.effective, offline.online]);

  useFocusEffect(load);
  return { ...state, refetch: () => void load() };
}

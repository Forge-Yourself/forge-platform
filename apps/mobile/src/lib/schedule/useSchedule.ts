import { addDays, bookingErrorCode, bookingState, localDayKey, type BookingErrorCode, type BookingState } from '@forge/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { warmCheckinKeys } from '../checkin/keys';
import { fetchRoster } from '../clients/useClientList';
import { cachedFetch, OFFLINE } from '../offline/cachedFetch';
import { useOffline } from '../offline/offlineContext';
import { supabase } from '../supabase';
import { fetchDayWindows, fetchPtBookings, type DayWindow } from './scheduleApi';

export type ScheduleItem = {
  id: string;
  clientId: string | null;
  name: string;
  isSelf: boolean;
  startsAt: string;
  endsAt: string;
  status: string;
  state: BookingState;
  lengthMin: number;
  seriesId: string | null;
  cancelLate: boolean;
  cancelledAt: string | null;
};

type Bundle = { items: ScheduleItem[]; windows: DayWindow[]; hasHours: boolean; fetchedAt: string; error: string | null };

/** One fetch for any visible range: bookings, published windows, names, and whether any hours exist at all. */
export async function fetchScheduleBundle(ptUserId: string, from: Date, to: Date): Promise<Bundle> {
  const fetchedAt = new Date().toISOString();
  const [b, w, roster, hours] = await Promise.all([
    fetchPtBookings(ptUserId, from.toISOString(), to.toISOString()),
    fetchDayWindows(localDayKey(from), localDayKey(addDays(to, -1))),
    fetchRoster(ptUserId),
    supabase.from('schedules').select('id', { count: 'exact', head: true }).eq('user_id', ptUserId),
  ]);
  const code: BookingErrorCode | null =
    b.error ?? w.error ?? (roster.error ? bookingErrorCode(roster.error) : null) ?? (hours.error ? bookingErrorCode(hours.error.message) : null);
  if (code) return { items: [], windows: [], hasHours: false, fetchedAt, error: code === 'offline' ? OFFLINE : code };

  const byId = Object.fromEntries(roster.rows.map((r) => [r.id, r]));
  const items: ScheduleItem[] = (b.data ?? []).map((row) => {
    const client = row.client_id ? byId[row.client_id] : undefined;
    const isSelf = client?.isSelf ?? false;
    return {
      id: row.id,
      clientId: row.client_id,
      name: client?.displayName ?? '',
      isSelf,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      state: bookingState(row.status, isSelf),
      lengthMin: row.length_min ?? Math.round((Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60_000),
      seriesId: row.parent_booking_id ?? (row.recurrence_rule ? row.id : null),
      cancelLate: row.cancel_late,
      cancelledAt: row.cancelled_at,
    };
  });
  return { items, windows: w.data ?? [], hasHours: (hours.count ?? 0) > 0, fetchedAt, error: null };
}

export type ScheduleData = Omit<Bundle, 'error'> & { loading: boolean; error: BookingErrorCode | null; refetch: () => void };

/**
 * The PT's schedule for [from, to). Refetches on focus (N12); only the newest
 * load sets state (O1). Read-through cached when the offline beta is on, so
 * the last fetched week survives losing the signal (spec D15).
 */
export function useSchedule(ptUserId: string | undefined, from: Date, to: Date): ScheduleData {
  const offline = useOffline();
  const fromKey = from.toISOString();
  const toKey = to.toISOString();
  const [state, setState] = useState<Omit<ScheduleData, 'refetch'>>({
    items: [], windows: [], hasHours: true, fetchedAt: '', loading: true, error: null,
  });
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!ptUserId) return () => {};
    const mine = ++seq.current;
    void cachedFetch({ enabled: offline.effective, online: offline.online }, `schedule:${ptUserId}:${fromKey}:${toKey}`, () =>
      fetchScheduleBundle(ptUserId, new Date(fromKey), new Date(toKey)),
    ).then((r) => {
      if (mine !== seq.current) return;
      setState({ ...r, loading: false, error: r.error ? bookingErrorCode(r.error) : null });
      // M5b: while there's signal, keep today's check-in secrets on the phone so
      // the QR still renders if the gym has none (spec D2).
      if (!r.error && offline.online) void warmCheckinKeys().catch(() => undefined);
    });
    return () => {
      seq.current++;
    };
  }, [ptUserId, fromKey, toKey, offline.effective, offline.online]);

  useFocusEffect(load);
  return { ...state, refetch: () => void load() };
}

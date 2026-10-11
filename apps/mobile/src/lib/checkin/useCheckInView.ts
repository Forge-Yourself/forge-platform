import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { OFFLINE } from '../offline/cachedFetch';
import { useOffline } from '../offline/offlineContext';
import { fetchBookingDetail } from '../schedule/useBookingDetail';
import type { BookingRow } from '../schedule/scheduleApi';
import { supabase } from '../supabase';
import type { CheckInRow } from './api';

export type CheckInView = {
  booking: BookingRow | null;
  clientName: string | null;
  isSelf: boolean;
  programName: string | null;
  checkIn: CheckInRow | null;
  /** The logged session's day label and times, once one points at this booking. */
  session: { dayLabel: string | null; startedAt: string | null; completedAt: string | null } | null;
};

export type CheckInViewData = CheckInView & { loading: boolean; error: string | null; refetch: () => void; poll: () => void };

async function fetchLive(id: string) {
  const [b, ci, ws] = await Promise.all([
    supabase.from('bookings').select('*').eq('id', id).maybeSingle(),
    supabase.from('check_ins').select('*').eq('booking_id', id).maybeSingle(),
    supabase
      .from('workout_sessions')
      .select('day_label, started_at, completed_at')
      .eq('booking_id', id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const error = b.error ?? ci.error ?? ws.error;
  return {
    error: error ? (/failed to fetch|network request failed|load failed/i.test(error.message) ? OFFLINE : error.message) : null,
    booking: b.data,
    checkIn: ci.data,
    session: ws.data ? { dayLabel: ws.data.day_label, startedAt: ws.data.started_at, completedAt: ws.data.completed_at } : null,
  };
}

/**
 * The QR screen's data. One full load on focus (names, program), then `poll`
 * re-reads only the booking, its check-in and its session (spec D11).
 *
 * Unlike the schedule hooks, a failed load never clears what is on screen:
 * the code must keep rotating when the gym has no signal, so the last good
 * booking stays until a newer one arrives (O1: only the newest load lands).
 */
export function useCheckInView(id: string | undefined): CheckInViewData {
  const offline = useOffline();
  const [state, setState] = useState<CheckInView & { loading: boolean; error: string | null }>({
    booking: null, clientName: null, isSelf: false, programName: null, checkIn: null, session: null, loading: true, error: null,
  });
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!id) return () => {};
    const mine = ++seq.current;
    void Promise.all([fetchBookingDetail(id), fetchLive(id)]).then(([d, live]) => {
      if (mine !== seq.current) return;
      setState((prev) => {
        const err = d.error ?? live.error;
        if (err) return { ...prev, loading: false, error: prev.booking ? null : err };
        return {
          booking: live.booking ?? d.booking,
          clientName: d.clientName,
          isSelf: d.isSelf,
          programName: d.programName,
          checkIn: live.checkIn,
          session: live.session,
          loading: false,
          error: null,
        };
      });
    });
    return () => {
      seq.current++;
    };
  }, [id]);

  const poll = useCallback(() => {
    if (!id || !offline.online) return;
    const mine = ++seq.current;
    void fetchLive(id).then((live) => {
      if (mine !== seq.current || live.error) return;
      setState((prev) => ({ ...prev, booking: live.booking, checkIn: live.checkIn, session: live.session }));
    });
  }, [id, offline.online]);

  useFocusEffect(load);
  return { ...state, refetch: () => void load(), poll };
}

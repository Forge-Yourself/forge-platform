import { DEFAULT_RULES, type BookingErrorCode, type BookingRules, type ExceptionInput, type HoursRange } from '@forge/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { fetchAvailability, fetchPolicy } from './scheduleApi';

export type AvailabilityData = {
  loading: boolean;
  error: BookingErrorCode | null;
  /** Bumps on every successful load, so a screen can re-seed its draft behind an id guard. */
  version: number;
  hours: HoursRange[];
  exceptions: ExceptionInput[];
  rules: BookingRules;
  timezone: string;
  refetch: () => void;
};

export function useAvailability(ptUserId: string | undefined): AvailabilityData {
  const [state, setState] = useState<Omit<AvailabilityData, 'refetch'>>({
    loading: true, error: null, version: 0, hours: [], exceptions: [], rules: DEFAULT_RULES, timezone: 'Asia/Beirut',
  });
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!ptUserId) return () => {};
    const mine = ++seq.current;
    void Promise.all([fetchAvailability(ptUserId), fetchPolicy(ptUserId)]).then(([a, p]) => {
      if (mine !== seq.current) return;
      if (a.error || p.error) {
        setState((s) => ({ ...s, loading: false, error: a.error ?? p.error }));
        return;
      }
      setState((s) => ({
        loading: false,
        error: null,
        version: s.version + 1,
        hours: a.data.hours,
        exceptions: a.data.exceptions,
        rules: { lengths: p.data.lengths, bufferMin: p.data.bufferMin, windowWeeks: p.data.windowWeeks, cutoffHours: p.data.cutoffHours },
        timezone: p.data.timezone,
      }));
    });
    return () => {
      seq.current++;
    };
  }, [ptUserId]);

  useFocusEffect(load);
  return { ...state, refetch: () => void load() };
}

import type { BookingErrorCode } from '@forge/shared';
import { useEffect, useState } from 'react';
import { fetchOpenSlots, type Slot } from './scheduleApi';

export type OpenSlotsData = { loading: boolean; error: BookingErrorCode | null; slots: Slot[]; refetch: () => void };

type Loaded = { key: string; error: BookingErrorCode | null; slots: Slot[] };

/**
 * Online only: a slot list from the cache would be a promise the server may
 * not keep (spec D15). State is set only inside .then() (the
 * react-hooks/set-state-in-effect rule useClientList documents), so `loading`
 * is derived: the result on hand belongs to an older set of params.
 */
export function useOpenSlots(
  ptUserId: string | null,
  fromDate: string,
  toDate: string,
  length: number | null,
  ignoreId?: string,
): OpenSlotsData {
  const [nonce, setNonce] = useState(0);
  const key = [ptUserId, fromDate, toDate, length, ignoreId, nonce].join('|');
  const [loaded, setLoaded] = useState<Loaded>({ key: '', error: null, slots: [] });

  useEffect(() => {
    // Cleanup runs before the next params' effect, so only the newest load lands (O1).
    let live = true;
    const run: Promise<Loaded> =
      !ptUserId || !length
        ? Promise.resolve({ key, error: null, slots: [] })
        : fetchOpenSlots(ptUserId, fromDate, toDate, length, ignoreId).then((r) =>
            r.error ? { key, error: r.error, slots: [] } : { key, error: null, slots: r.data },
          );
    void run.then((next) => {
      if (live) setLoaded(next);
    });
    return () => {
      live = false;
    };
  }, [key, ptUserId, fromDate, toDate, length, ignoreId]);

  const current = loaded.key === key;
  return {
    loading: !current,
    error: current ? loaded.error : null,
    slots: current ? loaded.slots : [],
    refetch: () => setNonce((n) => n + 1),
  };
}

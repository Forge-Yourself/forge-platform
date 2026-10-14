import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { getStoredValue } from '../deviceStore';
import { useOffline } from '../offline/offlineContext';
import { supabase } from '../supabase';
import { pendingQueue } from './pending';
import { rateDismissedKey } from './useBookingForClient';

const DAY = 86_400_000;

/**
 * Spec D12: the after-session sheet opens itself once. On the client's Today,
 * the newest booking completed in the last 24 hours that has no rating, was
 * not dismissed on this device ("Not now"), and has no rating queued, opens
 * the sheet. At most once per mount, so closing it never loops back.
 */
export function useAutoRate(enabled: boolean): void {
  const offline = useOffline();
  const done = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!enabled || !offline.online || done.current) return undefined;
      let cancelled = false;
      void (async () => {
        const { data } = await supabase
          .from('bookings')
          .select('id')
          .eq('status', 'completed')
          .is('rating', null)
          .gte('updated_at', new Date(Date.now() - DAY).toISOString())
          .order('updated_at', { ascending: false })
          .limit(5);
        for (const row of data ?? []) {
          if (cancelled || done.current) return;
          if ((await getStoredValue(rateDismissedKey(row.id))) === '1') continue;
          if (await pendingQueue.has('rate', row.id).catch(() => false)) continue;
          if (cancelled) return;
          done.current = true;
          router.push({ pathname: '/(app)/bookings/[id]/rate', params: { id: row.id } });
          return;
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [enabled, offline.online]),
  );
}

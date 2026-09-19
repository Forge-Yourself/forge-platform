import { metricPoints, plateau, seriesDelta, windowPoints } from '@forge/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { countVisiblePhotos, fetchBodyMetrics } from './bodyApi';

const WEEK = 7 * 86_400_000;

export type BodySummary = {
  loading: boolean;
  latestKg: number | null;
  delta4wKg: number | null;
  plateau: boolean;
  /** For a PT this is the shared count: RLS hides the rest. */
  photoCount: number;
};

/** Six weeks covers the 4-week delta and the plateau's four weeks plus the "last week" allowance. */
export function useBodySummary(clientId: string | undefined): BodySummary {
  const [state, setState] = useState<BodySummary>({ loading: true, latestKg: null, delta4wKg: null, plateau: false, photoCount: 0 });
  const seq = useRef(0);

  useFocusEffect(
    useCallback(() => {
      if (!clientId) return () => {};
      const mine = ++seq.current;
      const now = Date.now();
      void Promise.all([
        fetchBodyMetrics(clientId, new Date(now - 6 * WEEK).toISOString()),
        countVisiblePhotos(clientId),
      ]).then(([metrics, photoCount]) => {
        if (mine !== seq.current) return;
        const weights = metricPoints(metrics.rows, 'weight');
        setState({
          loading: false,
          latestKg: weights.at(-1)?.value ?? null,
          delta4wKg: seriesDelta(windowPoints(weights, 4, now)),
          plateau: plateau(weights, now),
          photoCount,
        });
      });
      return () => {
        seq.current++;
      };
    }, [clientId]),
  );

  return state;
}

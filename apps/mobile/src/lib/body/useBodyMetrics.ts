import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { fetchBodyMetrics, type BodyMetricRow } from './bodyApi';

const WEEK = 7 * 86_400_000;

export type BodyMetricsData = {
  loading: boolean;
  error: string | null;
  rows: BodyMetricRow[];
  /** When the rows were fetched. Windows and the plateau are measured from here, not from a render-time Date.now() (React Compiler purity rule). */
  loadedAt: number;
  refetch: () => void;
  applySaved: (row: BodyMetricRow) => void;
  applyDeleted: (id: string) => void;
};

/**
 * One client's check-ins for the widest chart window (26 weeks). Refetches on
 * focus (N12); only the newest load may set state (O1).
 */
export function useBodyMetrics(clientId: string | undefined, weeks = 26): BodyMetricsData {
  const [state, setState] = useState<{ rows: BodyMetricRow[]; loading: boolean; error: string | null; loadedAt: number }>(
    () => ({ rows: [], loading: true, error: null, loadedAt: Date.now() }),
  );
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!clientId) return () => {};
    const mine = ++seq.current;
    const now = Date.now();
    void fetchBodyMetrics(clientId, new Date(now - weeks * WEEK).toISOString()).then((r) => {
      if (mine === seq.current) setState({ rows: r.rows, loading: false, error: r.error, loadedAt: now });
    });
    return () => {
      seq.current++;
    };
  }, [clientId, weeks]);

  useFocusEffect(load);

  const applySaved = useCallback((row: BodyMetricRow) => {
    setState((prev) => ({
      ...prev,
      rows: [...prev.rows.filter((r) => r.id !== row.id), row],
      loadedAt: Date.now(),
    }));
  }, []);

  const applyDeleted = useCallback((id: string) => {
    setState((prev) => ({ ...prev, rows: prev.rows.filter((r) => r.id !== id) }));
  }, []);

  return {
    ...state,
    refetch: () => {
      load();
    },
    applySaved,
    applyDeleted,
  };
}

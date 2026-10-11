import type { BookingErrorCode } from '@forge/shared';
import { useEffect, useState } from 'react';
import { previewSeries, type SeriesPreviewRow } from './scheduleApi';

type Args = { start: string; length: number; everyWeeks: 1 | 2; count: number | null; until: string | null } | null;
type Loaded = { key: string; rows: SeriesPreviewRow[]; error: BookingErrorCode | null };

/** The dates a series would create, with DST and conflict flags (spec D6). Same keyed shape as useOpenSlots. */
export function useSeriesPreview(args: Args): { loading: boolean; rows: SeriesPreviewRow[]; error: BookingErrorCode | null } {
  const key = args ? JSON.stringify(args) : '';
  const [loaded, setLoaded] = useState<Loaded>({ key: '', rows: [], error: null });
  useEffect(() => {
    // Cleanup runs before the next key's effect, so only the newest preview lands (O1).
    let live = true;
    const run: Promise<Loaded> = args
      ? previewSeries(args).then((r) => (r.error ? { key, rows: [], error: r.error } : { key, rows: r.data, error: null }))
      : Promise.resolve({ key, rows: [], error: null });
    void run.then((next) => {
      if (live) setLoaded(next);
    });
    return () => {
      live = false;
    };
    // `key` is the serialised args; listing `args` too would refire on every render's new object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = loaded.key === key;
  return { loading: !current, rows: current ? loaded.rows : [], error: current ? loaded.error : null };
}

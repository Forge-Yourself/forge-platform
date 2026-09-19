import type { SessionRow, SetRow } from '@forge/shared';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';
import { engine } from './engine';

type Handlers = {
  onSet: (row: SetRow) => void;
  onDelete: (id: string) => void;
  onSession: (row: SessionRow) => void;
};

type BroadcastPayload = {
  table?: string;
  operation?: string;
  record?: unknown;
  old_record?: unknown;
};

/**
 * Spec §4.2 / §7, the live mirror. Joins the private topic session:<id>;
 * Realtime authorizes the join against 0016's realtime.messages policy, so a
 * stranger's join fails server-side. Payloads are what
 * realtime.broadcast_changes sends: { table, operation, record, old_record }.
 *
 * With offline logging effective, every row goes through the engine first:
 * a pending local write for the same id wins, and an echo of our own write
 * is dropped. Returns whether the channel is joined (the Live badge).
 */
export function useSessionChannel(sessionId: string | null, handlers: Handlers, throughEngine: boolean): boolean {
  const [joined, setJoined] = useState(false);
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    const handle = (msg: { payload?: BroadcastPayload }) => {
      const p = msg.payload ?? {};
      if (p.table === 'sets' && p.operation === 'DELETE') {
        const id = (p.old_record as { id?: string } | undefined)?.id;
        if (!id) return;
        void (throughEngine ? engine.applyServerSetDelete(id) : Promise.resolve(true)).then((ok) => {
          if (ok && !cancelled) latest.current.onDelete(id);
        });
        return;
      }
      if (p.table === 'sets' && p.record) {
        const row = p.record as SetRow;
        void (throughEngine ? engine.applyServerSet(row) : Promise.resolve(true)).then((ok) => {
          if (ok && !cancelled) latest.current.onSet(row);
        });
        return;
      }
      if (p.table === 'workout_sessions' && p.record) {
        const row = p.record as SessionRow;
        void (throughEngine ? engine.applyServerSession(row) : Promise.resolve(true)).then((ok) => {
          if (ok && !cancelled) latest.current.onSession(row);
        });
      }
    };

    const channel = supabase
      .channel('session:' + sessionId, { config: { private: true } })
      .on('broadcast', { event: 'INSERT' }, handle)
      .on('broadcast', { event: 'UPDATE' }, handle)
      .on('broadcast', { event: 'DELETE' }, handle);

    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel.subscribe((status) => {
        if (!cancelled) setJoined(status === 'SUBSCRIBED');
      });
    });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [sessionId, throughEngine]);

  return joined;
}

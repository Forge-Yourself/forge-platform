import type { SessionRow, SetRow } from '@forge/shared';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { newUlid } from '../logging/ulid';
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
 * is dropped. Returns whether the channel is joined (the Live badge) and how
 * many devices are tracked on the topic via Realtime Presence (0018:
 * participants only, never an admin — so `devices` never counts a spectator).
 *
 * Joined only while `online`: with no signal the socket is dead anyway, and
 * leaving then rejoining means the caller's reload on reconnect catches up
 * whatever the channel missed.
 */
export function useSessionChannel(
  sessionId: string | null,
  handlers: Handlers,
  throughEngine: boolean,
  online: boolean,
): { joined: boolean; devices: number } {
  const [joined, setJoined] = useState(false);
  const [devices, setDevices] = useState(0);
  // One key per mounted screen, so two devices of one user count as two.
  // Lazy initialiser, not useRef().current: the lint's react-hooks/refs rule
  // (React Compiler's purity rule) rejects reading a ref during render.
  const [presenceKey] = useState(() => newUlid());
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (!sessionId || !online) return;
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
      .channel('session:' + sessionId, { config: { private: true, presence: { key: presenceKey } } })
      .on('broadcast', { event: 'INSERT' }, handle)
      .on('broadcast', { event: 'UPDATE' }, handle)
      .on('broadcast', { event: 'DELETE' }, handle)
      .on('presence', { event: 'sync' }, () => {
        if (cancelled) return;
        // Every tracked device on the topic, this one included (0018: participants only, never an admin).
        setDevices(Object.values(channel.presenceState()).reduce((n, metas) => n + metas.length, 0));
      });

    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel.subscribe((status) => {
        if (cancelled) return;
        setJoined(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') void channel.track({ platform: Platform.OS });
      });
    });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [sessionId, throughEngine, online, presenceKey]);

  return { joined: joined && online, devices: joined && online ? devices : 0 };
}

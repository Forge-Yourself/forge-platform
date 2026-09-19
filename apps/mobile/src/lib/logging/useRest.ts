import { remainingSec, restPhase, restProgress, type RestPhase } from '@forge/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { restStore } from './restStore';

export type { RestPhase };

/** Lock-screen copy for a rest, fixed when it starts. */
export type RestLabels = { clientName: string | null; exerciseName: string; nextLabel: string };

export type RestTimer = {
  active: boolean;
  phase: RestPhase;
  /** Whole seconds left, rounded up: 0 only once the rest is really over. */
  remaining: number;
  /** 0 → 1 as the rest elapses; the ring's secondary cue. */
  progress: number;
  setNumber: number;
  total: number | null;
  start: (seconds: number, setNumber: number, total: number | null, labels: RestLabels) => void;
  plus30: () => void;
  togglePause: () => void;
  clear: () => void;
};

/**
 * One session's rest clock from the shared store. The inline strip and the
 * full-screen timer both read it, so +30s on one shows on the other and on the
 * lock screen. The zero cue is not here: it is the driver's, because on the
 * console the rest that ends may belong to a client who is not on screen.
 */
export function useRest(sessionId: string | null): RestTimer {
  const snap = useSyncExternalStore(restStore.subscribe, restStore.getSnapshot, restStore.getSnapshot);
  const rest = sessionId ? (snap.rests[sessionId] ?? null) : null;
  const [tick, setTick] = useState(() => Date.now());
  const now = Math.max(tick, snap.at);
  const phase: RestPhase = rest ? restPhase(rest, now) : 'complete';
  const running = rest !== null && phase === 'running';

  // Idempotent: the store memoises the read, so the driver (Task 8) hydrating
  // too costs nothing. Without it a reload would forget a rest still running.
  useEffect(() => {
    void restStore.hydrate();
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  return {
    active: rest !== null,
    phase,
    remaining: rest ? remainingSec(rest, now) : 0,
    progress: rest ? restProgress(rest, now) : 0,
    setNumber: rest?.setNumber ?? 1,
    total: rest?.total ?? null,
    start: (seconds, setNumber, total, labels) => {
      if (!sessionId) return;
      restStore.start({ sessionId, seconds, setNumber, total, ...labels });
    },
    plus30: () => {
      if (sessionId) restStore.plus30(sessionId);
    },
    togglePause: () => {
      if (sessionId) restStore.togglePause(sessionId);
    },
    clear: () => {
      if (sessionId) restStore.clear(sessionId);
    },
  };
}

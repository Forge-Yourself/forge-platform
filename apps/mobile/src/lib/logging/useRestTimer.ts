import { useEffect, useRef, useState } from 'react';

export type RestPhase = 'running' | 'paused' | 'complete';

type RestState = {
  /** Wall-clock target; the countdown is derived, so time asleep still counts. */
  endsAt: number;
  /** Set while paused: the ms that were left when Pause was tapped. */
  pausedMs: number | null;
  /** Denominator for the ring. Grows with +30s so the ring never jumps backwards. */
  totalMs: number;
  /** The set this rest leads into, and the prescription's total, for "Rest · set 3 of 4". */
  setNumber: number;
  total: number | null;
};

export type RestTimer = {
  active: boolean;
  phase: RestPhase;
  /** Whole seconds left, rounded up — 0 only once the rest is really over. */
  remaining: number;
  /** 0 → 1 as the rest elapses; the ring's secondary cue. */
  progress: number;
  setNumber: number;
  total: number | null;
  start: (seconds: number, setNumber: number, total: number | null) => void;
  plus30: () => void;
  togglePause: () => void;
  clear: () => void;
};

/**
 * One rest clock for the whole session screen, read by both the inline strip
 * (prototype `session`) and the full-screen timer (prototype `timer`), so +30s
 * on one shows on the other. `onZero` fires once per rest — the audio cue and
 * the haptic belong to the screen, not to whichever view happens to be open.
 */
export function useRestTimer(onZero: () => void): RestTimer {
  const [rest, setRest] = useState<RestState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  const zeroRef = useRef(onZero);

  useEffect(() => {
    zeroRef.current = onZero;
  }, [onZero]);

  const remainingMs = rest ? (rest.pausedMs ?? Math.max(0, rest.endsAt - now)) : 0;
  const remaining = Math.ceil(remainingMs / 1000);
  const phase: RestPhase = rest?.pausedMs != null ? 'paused' : remaining === 0 ? 'complete' : 'running';
  const running = rest !== null && phase === 'running';

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (rest && phase === 'complete' && !fired.current) {
      fired.current = true;
      zeroRef.current();
    }
  }, [rest, phase]);

  return {
    active: rest !== null,
    phase,
    remaining,
    progress: rest ? Math.min(1, Math.max(0, 1 - remainingMs / rest.totalMs)) : 0,
    setNumber: rest?.setNumber ?? 1,
    total: rest?.total ?? null,
    start: (seconds, setNumber, total) => {
      fired.current = false;
      const at = Date.now();
      setNow(at);
      setRest({ endsAt: at + seconds * 1000, pausedMs: null, totalMs: Math.max(1, seconds * 1000), setNumber, total });
    },
    plus30: () => {
      fired.current = false;
      const at = Date.now();
      setNow(at);
      setRest((r) => {
        if (!r) return r;
        if (r.pausedMs !== null) return { ...r, pausedMs: r.pausedMs + 30_000, totalMs: r.totalMs + 30_000 };
        return { ...r, endsAt: Math.max(r.endsAt, at) + 30_000, totalMs: r.totalMs + 30_000 };
      });
    },
    togglePause: () => {
      const at = Date.now();
      setNow(at);
      setRest((r) => {
        if (!r) return r;
        return r.pausedMs === null
          ? { ...r, pausedMs: Math.max(0, r.endsAt - at) }
          : { ...r, endsAt: at + r.pausedMs, pausedMs: null };
      });
    },
    clear: () => setRest(null),
  };
}

/**
 * The rest clock as data (M4d spec §6.2). One RestState per live session; the
 * mobile store persists them and the lock-screen driver shows the soonest.
 * Every function takes `now` so the rules are deterministic under test and the
 * same call replays a lock-screen tap at the time it happened.
 */

export type RestPhase = 'running' | 'paused' | 'complete';

export type RestState = {
  sessionId: string;
  /** Wall-clock target; the countdown is derived, so time asleep still counts. */
  endsAt: number;
  /** Set while paused: the ms that were left when Pause was tapped. */
  pausedMs: number | null;
  /** Denominator for the ring. Grows with +30s so the ring never jumps backwards. */
  totalMs: number;
  /** The set this rest leads into, and the prescription's total, for "Rest · set 3 of 4". */
  setNumber: number;
  total: number | null;
  /** Lock-screen copy, resolved when the rest starts: the client, the exercise, the next set. */
  clientName: string | null;
  exerciseName: string;
  nextLabel: string;
};

export type RestActionKind = 'plus30' | 'skip';
/** A tap on the lock screen, recorded natively while the JS runtime may be dead. */
export type RestAction = { sessionId: string; action: RestActionKind; at: number };

export const PLUS_MS = 30_000;
/** How many applied action keys to remember; the native queue never holds more than a few. */
const APPLIED_KEEP = 50;

export function remainingMs(r: RestState, now: number): number {
  return r.pausedMs ?? Math.max(0, r.endsAt - now);
}

/** Whole seconds left, rounded up: 0 only once the rest is really over. */
export function remainingSec(r: RestState, now: number): number {
  return Math.ceil(remainingMs(r, now) / 1000);
}

export function restPhase(r: RestState, now: number): RestPhase {
  if (r.pausedMs !== null) return 'paused';
  return remainingSec(r, now) === 0 ? 'complete' : 'running';
}

/** 0 → 1 as the rest elapses; the ring's secondary cue. */
export function restProgress(r: RestState, now: number): number {
  return Math.min(1, Math.max(0, 1 - remainingMs(r, now) / r.totalMs));
}

export type StartRest = Omit<RestState, 'endsAt' | 'pausedMs' | 'totalMs'> & { seconds: number };

export function startRest(input: StartRest, now: number): RestState {
  const { seconds, ...rest } = input;
  return { ...rest, endsAt: now + seconds * 1000, pausedMs: null, totalMs: Math.max(1, seconds * 1000) };
}

/** +30 s from whichever is later, the target or now — a finished rest restarts at 30 s, not in the past. */
export function plus30(r: RestState, now: number): RestState {
  if (r.pausedMs !== null) return { ...r, pausedMs: r.pausedMs + PLUS_MS, totalMs: r.totalMs + PLUS_MS };
  return { ...r, endsAt: Math.max(r.endsAt, now) + PLUS_MS, totalMs: r.totalMs + PLUS_MS };
}

/**
 * Pause or resume. A rest already at zero is left alone: pausing it would
 * pin it at 0 in the paused phase, where it never reads complete again — and
 * a lock-screen pause tap replayed after the rest ended lands here.
 */
export function togglePause(r: RestState, now: number): RestState {
  if (restPhase(r, now) === 'complete') return r;
  return r.pausedMs === null
    ? { ...r, pausedMs: Math.max(0, r.endsAt - now) }
    : { ...r, endsAt: now + r.pausedMs, pausedMs: null };
}

/**
 * The rest the lock screen shows (spec D4): the running one ending first.
 * Paused and finished rests never win; equal targets break on session id so
 * the choice is stable across renders.
 */
export function soonest(rests: readonly RestState[], now: number): RestState | null {
  let best: RestState | null = null;
  for (const r of rests) {
    if (restPhase(r, now) !== 'running') continue;
    if (
      best === null ||
      r.endsAt < best.endsAt ||
      (r.endsAt === best.endsAt && r.sessionId < best.sessionId)
    ) {
      best = r;
    }
  }
  return best;
}

export const actionKey = (a: RestAction): string => `${a.sessionId}:${a.action}:${a.at}`;

/**
 * Fold lock-screen taps into the rests, oldest first (spec §6.2). A tap
 * already applied (same session, action and time) is skipped, so draining the
 * native queue twice is harmless; a tap for a session with no rest is dropped.
 * Returns the new map and the applied keys to remember, newest last.
 */
export function applyNativeActions(
  rests: Readonly<Record<string, RestState>>,
  actions: readonly RestAction[],
  applied: readonly string[],
): { rests: Record<string, RestState>; applied: string[] } {
  const next: Record<string, RestState> = { ...rests };
  const seen = new Set(applied);
  const keys = [...applied];
  for (const a of [...actions].sort((x, y) => x.at - y.at)) {
    const key = actionKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    const r = next[a.sessionId];
    if (!r) continue;
    if (a.action === 'skip') delete next[a.sessionId];
    else next[a.sessionId] = plus30(r, a.at);
  }
  return { rests: next, applied: keys.slice(-APPLIED_KEEP) };
}

/** A rest older than this is from a session nobody finished; hydrating it would ring for nothing. */
export const STALE_MS = 6 * 60 * 60 * 1000;

/** Drop rests that ended more than STALE_MS ago, and every rest whose session is no longer live. */
export function pruneRests(
  rests: Readonly<Record<string, RestState>>,
  now: number,
  liveSessionIds?: readonly string[],
): Record<string, RestState> {
  const live = liveSessionIds ? new Set(liveSessionIds) : null;
  const out: Record<string, RestState> = {};
  for (const [id, r] of Object.entries(rests)) {
    if (live && !live.has(id)) continue;
    if (r.pausedMs === null && now - r.endsAt > STALE_MS) continue;
    out[id] = r;
  }
  return out;
}

import {
  applyNativeActions,
  plus30,
  pruneRests,
  startRest,
  togglePause,
  type RestAction,
  type RestState,
  type StartRest,
} from '@forge/shared';
import { kvStore } from '../offline/kvStore';

export type RestSnapshot = {
  readonly rests: Readonly<Record<string, RestState>>;
  /** Lock-screen actions already applied, so a drained queue replayed is a no-op. */
  readonly applied: readonly string[];
  /** Wall time of the last change: readers take max(their clock, at), so a change shows at once. */
  readonly at: number;
};

const KEY = 'rest-clocks';
const EMPTY: RestSnapshot = { rests: {}, applied: [], at: 0 };

let snapshot: RestSnapshot = EMPTY;
let hydrating: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: RestSnapshot, persist: boolean) {
  snapshot = next;
  for (const l of listeners) l();
  if (persist) void kvStore.write([{ table: 'meta', key: KEY, value: next }]).catch(() => undefined);
}

function withRests(rests: Record<string, RestState>): RestSnapshot {
  return { rests, applied: snapshot.applied, at: Date.now() };
}

/**
 * Every live session's rest clock (M4d spec §6.1). It lives outside React so
 * the console keeps each client's rest across a switch and the lock-screen
 * driver sees all of them. It is persisted to KvStore `meta` on every change
 * and hydrated once. A change made before hydration finishes wins over the
 * stored copy.
 */
export const restStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): RestSnapshot {
    return snapshot;
  },
  hydrate(): Promise<void> {
    hydrating ??= kvStore
      .get<RestSnapshot>('meta', KEY)
      .then((stored) => {
        if (!stored) return;
        const now = Date.now();
        publish(
          {
            rests: pruneRests({ ...stored.rests, ...snapshot.rests }, now),
            applied: [...stored.applied, ...snapshot.applied].slice(-50),
            at: now,
          },
          false,
        );
      })
      .catch(() => undefined);
    return hydrating;
  },
  start(input: StartRest): void {
    publish(withRests({ ...snapshot.rests, [input.sessionId]: startRest(input, Date.now()) }), true);
  },
  plus30(sessionId: string): void {
    const r = snapshot.rests[sessionId];
    if (r) publish(withRests({ ...snapshot.rests, [sessionId]: plus30(r, Date.now()) }), true);
  },
  togglePause(sessionId: string): void {
    const r = snapshot.rests[sessionId];
    if (!r) return;
    // A finished rest is left alone by the clock itself, so this is a no-op
    // write in that case — cheap, and the rule stays in one tested place.
    publish(withRests({ ...snapshot.rests, [sessionId]: togglePause(r, Date.now()) }), true);
  },
  clear(sessionId: string): void {
    if (!snapshot.rests[sessionId]) return;
    publish(
      withRests(Object.fromEntries(Object.entries(snapshot.rests).filter(([id]) => id !== sessionId))),
      true,
    );
  },
  /** Keep only rests whose session is still live; the rail calls this with what it loaded. */
  keepOnly(liveSessionIds: readonly string[]): void {
    const next = pruneRests(snapshot.rests, Date.now(), liveSessionIds);
    if (Object.keys(next).length !== Object.keys(snapshot.rests).length) publish(withRests(next), true);
  },
  /** Lock-screen taps, replayed at the time they happened (spec §6.2). */
  applyActions(actions: readonly RestAction[]): void {
    if (actions.length === 0) return;
    const r = applyNativeActions(snapshot.rests, actions, snapshot.applied);
    publish({ rests: r.rests, applied: r.applied, at: Date.now() }, true);
  },
  /** Sign-out: nothing of this user's may ring for the next one. */
  reset(): void {
    hydrating = null;
    publish(EMPTY, true);
  },
};

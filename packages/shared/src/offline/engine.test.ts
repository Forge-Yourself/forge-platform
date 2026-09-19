import { beforeEach, describe, expect, it } from 'vitest';
import { SyncEngine, type EngineEvent } from './engine';
import { MemoryKvStore } from './memoryStore';
import type { CompleteArgs, DeleteSetArgs, LogSetArgs, RpcResult, SessionRow, SetRow, StartArgs, Transport } from './types';

const L = '00000000-0000-4000-8000-00000000000a';
const S = '00000000-0000-4000-8000-00000000000b';
const OTHER = '00000000-0000-4000-8000-00000000000c';
const CLIENT = '00000000-0000-4000-8000-0000000000c1';
const EX = '00000000-0000-4000-8000-0000000000e1';
const U1 = '01J8RZ0000000000000000AAA1';
const U2 = '01J8RZ0000000000000000AAA2';

function sessionRow(id: string, status = 'in_progress'): SessionRow {
  return {
    id, client_id: CLIENT, status, booking_id: null, completed_at: null, created_at: '2026-09-19T10:00:00Z',
    day_label: null, day_number: null, duration_min: null, gym_id: null, is_pt_led: true, logged_by_user_id: 'u',
    program_day_id: null, pt_notes: null, rating: null, scheduled_date: null, session_notes: null,
    started_at: '2026-09-19T10:00:00Z', updated_at: '2026-09-19T10:00:00Z', week_number: null,
  };
}

function setRow(id: string, sessionId: string, weight = 100): SetRow {
  return {
    id, workout_session_id: sessionId, exercise_id: EX, set_number: 1, weight_kg: weight, reps: 8, rpe: null,
    notes: null, distance_m: null, duration_sec: null, tempo_actual: null, is_warmup: false, is_drop_set: false,
    is_failure: false, is_synced: true, synced_at: null, conflict_resolved: false, device_id: null,
    logged_by_user_id: 'u', created_at: '2026-09-19T10:01:00Z', updated_at: '2026-09-19T10:01:00Z',
  };
}

const startArgs = (id = L): StartArgs => ({ p_client_id: CLIENT, p_program_day_id: null, p_id: id, p_started_at: '2026-09-19T10:00:00Z' });
const logArgs = (id: string, sessionId = L, weight = 100): LogSetArgs => ({
  p_id: id, p_session_id: sessionId, p_exercise_id: EX, p_set_number: 1, p_weight_kg: weight, p_reps: 8,
  p_rpe: null, p_notes: null, p_is_warmup: false, p_device_id: 'test',
});
const completeArgs = (sessionId = L): CompleteArgs => ({ p_session_id: sessionId, p_rating: 4, p_notes: null, p_completed_at: '2026-09-19T11:00:00Z' });

type Call = { op: string; args: unknown };
type Handler = (op: string, args: unknown) => RpcResult<unknown> | Promise<RpcResult<unknown>>;

const defaultHandler: Handler = (op, args) => {
  if (op === 'start') return { ok: true, data: sessionRow((args as StartArgs).p_id) };
  if (op === 'log_set') {
    const a = args as LogSetArgs;
    return { ok: true, data: { set: setRow(a.p_id, a.p_session_id, a.p_weight_kg ?? 0), newPrs: ['weight'] } };
  }
  if (op === 'complete') return { ok: true, data: sessionRow((args as CompleteArgs).p_session_id, 'completed') };
  return { ok: true, data: null };
};

class FakeTransport implements Transport {
  calls: Call[] = [];
  refreshOk = true;
  refreshCalls = 0;
  handler: Handler = defaultHandler;
  private async call<T>(op: string, args: unknown): Promise<RpcResult<T>> {
    this.calls.push({ op, args });
    return (await this.handler(op, args)) as RpcResult<T>;
  }
  start(a: StartArgs) {
    return this.call<SessionRow>('start', a);
  }
  logSet(a: LogSetArgs) {
    return this.call<{ set: SetRow; newPrs: string[] }>('log_set', a);
  }
  deleteSet(a: DeleteSetArgs) {
    return this.call<null>('delete_set', a);
  }
  complete(a: CompleteArgs) {
    return this.call<SessionRow>('complete', a);
  }
  async refreshAuth() {
    this.refreshCalls += 1;
    return this.refreshOk;
  }
}

let store: MemoryKvStore;
let transport: FakeTransport;
let engine: SyncEngine;
let events: EngineEvent[];

beforeEach(() => {
  store = new MemoryKvStore();
  transport = new FakeTransport();
  engine = new SyncEngine(store, transport, () => new Date('2026-09-19T10:00:00Z'));
  events = [];
  engine.subscribe((e) => events.push(e));
});

const ops = () => transport.calls.map((c) => c.op);
const outbox = () => engine.entries();

describe('enqueue and drain', () => {
  it('replays FIFO and empties the outbox', async () => {
    await engine.enqueue({ op: 'start', sessionId: L, args: startArgs() });
    await engine.enqueue({ op: 'log_set', sessionId: L, args: logArgs(U1) });
    await engine.enqueue({ op: 'complete', sessionId: L, args: completeArgs() });
    expect(await engine.drain()).toEqual({ kind: 'drained', sent: 3 });
    expect(ops()).toEqual(['start', 'log_set', 'complete']);
    expect(await outbox()).toEqual([]);
    expect(await engine.drain()).toEqual({ kind: 'idle' });
  });

  it('writes the optimistic rows in the same batch as the entry', async () => {
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) }, [
      { table: 'sets', key: U1, value: setRow(U1, S, 90) },
    ]);
    expect((await engine.localSets(S)).map((s) => s.weight_kg)).toEqual([90]);
  });

  it('emits set_synced with the PRs the server found', async () => {
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    await engine.drain();
    expect(events).toContainEqual(expect.objectContaining({ type: 'set_synced', newPrs: ['weight'] }));
  });

  it('survives a kill: a new engine on the same store drains and keeps numbering', async () => {
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U2, S) });
    const reborn = new SyncEngine(store, transport);
    await reborn.enqueue({ op: 'complete', sessionId: S, args: completeArgs(S) });
    expect((await reborn.entries()).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(await reborn.drain()).toEqual({ kind: 'drained', sent: 3 });
  });
});

describe('coalescing', () => {
  it('keeps only the last log_set for one ULID', async () => {
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S, 100) });
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S, 105) });
    const q = await outbox();
    expect(q).toHaveLength(1);
    const [head] = q;
    expect(head?.op === 'log_set' ? head.args.p_weight_kg : null).toBe(105);
  });

  it('drops a never-sent log_set and its delete together', async () => {
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    await engine.enqueue({ op: 'delete_set', sessionId: S, args: { p_id: U1 } });
    expect(await outbox()).toEqual([]);
  });

  it('queues a delete for a set that already synced', async () => {
    await engine.enqueue({ op: 'delete_set', sessionId: S, args: { p_id: U1 } });
    expect((await outbox()).map((e) => e.op)).toEqual(['delete_set']);
  });

  it('never coalesces into the entry on the wire', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    transport.handler = async (op, args) => {
      if (op === 'log_set') await gate;
      return defaultHandler(op, args);
    };
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    const running = engine.drain();
    await new Promise((r) => setTimeout(r, 0));
    await engine.enqueue({ op: 'delete_set', sessionId: S, args: { p_id: U1 } });
    release();
    await running;
    expect(ops()).toEqual(['log_set', 'delete_set']);
  });
});

describe('session id rewrite', () => {
  it('rewrites queued ops, local rows and the alias when the server returns another session', async () => {
    transport.handler = (op, args) => (op === 'start' ? { ok: true, data: sessionRow(S) } : defaultHandler(op, args));
    await engine.enqueue({ op: 'start', sessionId: L, args: startArgs() }, [{ table: 'sessions', key: L, value: sessionRow(L) }]);
    await engine.enqueue({ op: 'log_set', sessionId: L, args: logArgs(U1) }, [{ table: 'sets', key: U1, value: setRow(U1, L) }]);
    await engine.drain();
    expect((transport.calls[1]!.args as LogSetArgs).p_session_id).toBe(S);
    expect(await engine.resolveSessionId(L)).toBe(S);
    expect(await store.get('sessions', L)).toBeNull();
    expect((await engine.localSession(L))?.id).toBe(S);
    expect((await engine.localSets(L)).map((s) => [s.id, s.workout_session_id])).toEqual([[U1, S]]);
    expect(events).toContainEqual({ type: 'session_rewritten', from: L, to: S });
  });
});

describe('failures', () => {
  it('backs off on a network error and keeps the entry at the head', async () => {
    transport.handler = () => ({ ok: false, error: { code: '', message: 'Failed to fetch' } });
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    expect(await engine.drain()).toEqual({ kind: 'transient', sent: 0, retryInMs: 2000 });
    expect(await engine.drain()).toEqual({ kind: 'transient', sent: 0, retryInMs: 4000 });
    const [head] = await outbox();
    expect([head!.state, head!.attempts]).toEqual(['pending', 2]);
  });

  it('refreshes once on an expired token and carries on', async () => {
    let first = true;
    transport.handler = (op, args) => {
      if (first) {
        first = false;
        return { ok: false, error: { code: 'PGRST301', message: 'JWT expired' } };
      }
      return defaultHandler(op, args);
    };
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    expect(await engine.drain()).toEqual({ kind: 'drained', sent: 1 });
    expect(transport.refreshCalls).toBe(1);
  });

  it('pauses on auth when the refresh fails', async () => {
    transport.refreshOk = false;
    transport.handler = () => ({ ok: false, error: { code: 'PGRST301', message: 'JWT expired' } });
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    expect(await engine.drain()).toEqual({ kind: 'auth', sent: 0 });
    expect((await outbox())[0]!.state).toBe('pending');
  });

  it('parks a denied write as failed and moves on', async () => {
    transport.handler = (op, args) =>
      (args as LogSetArgs).p_id === U1 ? { ok: false, error: { code: '42501', message: 'not authorized' } } : defaultHandler(op, args);
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U2, S) });
    expect(await engine.drain()).toEqual({ kind: 'drained', sent: 1 });
    expect(await engine.status()).toEqual({ pending: 0, failed: 1 });
  });

  it('fails every op of a session whose start was refused, and nothing else', async () => {
    transport.handler = (op, args) =>
      op === 'start' ? { ok: false, error: { code: '42501', message: 'not authorized for this client' } } : defaultHandler(op, args);
    await engine.enqueue({ op: 'start', sessionId: L, args: startArgs() });
    await engine.enqueue({ op: 'log_set', sessionId: L, args: logArgs(U1) });
    await engine.enqueue({ op: 'log_set', sessionId: OTHER, args: logArgs(U2, OTHER) });
    await engine.drain();
    expect(ops()).toEqual(['start', 'log_set']);
    expect((await outbox()).map((e) => [e.op, e.state, e.lastError?.code])).toEqual([
      ['start', 'failed', '42501'],
      ['log_set', 'failed', 'start_failed'],
    ]);
  });

  it('an op queued after its start failed waits with it, and retries with it', async () => {
    let refuse = true;
    transport.handler = (op, args) =>
      op === 'start' && refuse ? { ok: false, error: { code: 'P0001', message: 'x' } } : defaultHandler(op, args);
    await engine.enqueue({ op: 'start', sessionId: L, args: startArgs() });
    await engine.enqueue({ op: 'log_set', sessionId: L, args: logArgs(U1) });
    await engine.drain();
    await engine.enqueue({ op: 'log_set', sessionId: L, args: logArgs(U1, L, 110) });
    await engine.enqueue({ op: 'log_set', sessionId: L, args: logArgs(U2) });
    expect(await engine.drain()).toEqual({ kind: 'idle' });
    expect((await outbox()).map((e) => [e.op, e.state, e.lastError?.code])).toEqual([
      ['start', 'failed', 'P0001'],
      ['log_set', 'failed', 'start_failed'],
      ['log_set', 'failed', 'start_failed'],
    ]);
    refuse = false;
    const [start] = await outbox();
    await engine.retry(start!.seq);
    expect(await engine.drain()).toEqual({ kind: 'drained', sent: 3 });
  });
});

describe('user actions', () => {
  it('retry puts a failed start back in the queue, cascade included', async () => {
    let refuse = true;
    transport.handler = (op, args) =>
      op === 'start' && refuse ? { ok: false, error: { code: 'P0001', message: 'x' } } : defaultHandler(op, args);
    await engine.enqueue({ op: 'start', sessionId: L, args: startArgs() });
    await engine.enqueue({ op: 'log_set', sessionId: L, args: logArgs(U1) });
    await engine.drain();
    refuse = false;
    const [start] = await outbox();
    await engine.retry(start!.seq);
    expect(await engine.drain()).toEqual({ kind: 'drained', sent: 2 });
  });

  it('discarding a start removes its session, sets and ops', async () => {
    await engine.enqueue({ op: 'start', sessionId: L, args: startArgs() }, [{ table: 'sessions', key: L, value: sessionRow(L) }]);
    await engine.enqueue({ op: 'log_set', sessionId: L, args: logArgs(U1) }, [{ table: 'sets', key: U1, value: setRow(U1, L) }]);
    const [start] = await outbox();
    await engine.discard(start!.seq);
    expect(await outbox()).toEqual([]);
    expect(await engine.localSession(L)).toBeNull();
    expect(await engine.localSets(L)).toEqual([]);
  });

  it('discardAll empties queue and local rows but keeps the read cache', async () => {
    await engine.putCache('roster:pt', [1, 2]);
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) }, [{ table: 'sets', key: U1, value: setRow(U1, S) }]);
    await engine.discardAll();
    expect(await engine.status()).toEqual({ pending: 0, failed: 0 });
    expect(await engine.localSets(S)).toEqual([]);
    expect((await engine.getCache<number[]>('roster:pt'))?.value).toEqual([1, 2]);
  });
});

describe('merging server rows', () => {
  it('overlays pending local edits and deletes on a server read', async () => {
    const server = [setRow(U1, S, 100), setRow(U2, S, 80)];
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S, 105) }, [
      { table: 'sets', key: U1, value: setRow(U1, S, 105) },
    ]);
    await engine.enqueue({ op: 'delete_set', sessionId: S, args: { p_id: U2 } });
    const merged = await engine.overlaySets(S, server);
    expect(merged.map((s) => [s.id, s.weight_kg])).toEqual([[U1, 105]]);
  });

  it('ignores a broadcast echo while its own write is pending, applies it after', async () => {
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S, 105) }, [
      { table: 'sets', key: U1, value: setRow(U1, S, 105) },
    ]);
    expect(await engine.applyServerSet(setRow(U1, S, 100))).toBe(false);
    expect((await engine.localSets(S))[0]!.weight_kg).toBe(105);
    await engine.drain();
    expect(await engine.applyServerSet(setRow(U1, S, 110))).toBe(true);
    expect((await engine.localSets(S))[0]!.weight_kg).toBe(110);
  });

  it('never lets a stale in_progress read regress a completed session', async () => {
    await store.write([{ table: 'sessions', key: S, value: sessionRow(S, 'completed') }]);
    expect(await engine.applyServerSession(sessionRow(S))).toBe(false);
    expect((await engine.localSession(S))?.status).toBe('completed');
  });

  it('prune drops completed sessions with nothing queued', async () => {
    await store.write([
      { table: 'sessions', key: S, value: sessionRow(S, 'completed') },
      { table: 'sets', key: U1, value: setRow(U1, S) },
      { table: 'sessions', key: L, value: sessionRow(L) },
    ]);
    await engine.prune();
    expect(await engine.localSession(S)).toBeNull();
    expect(await engine.localSets(S)).toEqual([]);
    expect(await engine.localSession(L)).not.toBeNull();
  });
});

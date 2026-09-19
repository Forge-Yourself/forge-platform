import { backoffMs, classifyError } from './classify';
import { orderSets } from './order';
import type { KvStore, KvWrite, OutboxEntry, OutboxOp, RpcError, SessionRow, SetRow, Transport } from './types';

export type DrainOutcome =
  | { kind: 'idle' }
  | { kind: 'drained'; sent: number }
  | { kind: 'transient'; sent: number; retryInMs: number }
  | { kind: 'auth'; sent: number };

export type EngineEvent =
  | { type: 'changed' }
  | { type: 'set_synced'; set: SetRow; newPrs: string[] }
  | { type: 'session_synced'; session: SessionRow }
  | { type: 'session_rewritten'; from: string; to: string }
  | { type: 'failed'; entry: OutboxEntry };

export type QueueStatus = { pending: number; failed: number };

export const START_FAILED: RpcError = { code: 'start_failed', message: 'the session could not be created' };

const seqKey = (seq: number): string => String(seq).padStart(12, '0');

function setIdOf(e: OutboxEntry): string | null {
  return e.op === 'log_set' || e.op === 'delete_set' ? e.args.p_id : null;
}

function retarget(e: OutboxEntry, to: string): OutboxEntry {
  if (e.op === 'log_set') return { ...e, sessionId: to, args: { ...e.args, p_session_id: to } };
  if (e.op === 'complete') return { ...e, sessionId: to, args: { ...e.args, p_session_id: to } };
  return { ...e, sessionId: to };
}

/**
 * Spec §5. The outbox, its replay, and every rule about local rows. Pure over
 * a KvStore and a Transport, so all of it runs in vitest.
 *
 * Invariants:
 * - One mutation of the store at a time (`exclusive`). The network call itself
 *   runs outside the lock, so a tap never waits on a round trip.
 * - The entry on the wire (`inflight`) is never coalesced, retried, discarded
 *   or removed except by its own result.
 * - A pending local write always beats a server row for the same id: a stale
 *   broadcast or refetch never rolls back what the user just did.
 */
export class SyncEngine {
  private lock: Promise<unknown> = Promise.resolve();
  private inflight: number | null = null;
  private running: Promise<DrainOutcome> | null = null;
  private readonly listeners = new Set<(e: EngineEvent) => void>();

  constructor(
    private readonly store: KvStore,
    private readonly transport: Transport,
    private readonly now: () => Date = () => new Date(),
  ) {}

  subscribe(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(e: EngineEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  // ── Queue ────────────────────────────────────────────────────────────────

  async entries(): Promise<OutboxEntry[]> {
    return (await this.store.all<OutboxEntry>('outbox')).map((r) => r.value);
  }

  async status(): Promise<QueueStatus> {
    const all = await this.entries();
    return {
      pending: all.filter((e) => e.state === 'pending').length,
      failed: all.filter((e) => e.state === 'failed').length,
    };
  }

  /** Queues `op` and writes `rows` (the optimistic local rows) in one atomic batch. */
  enqueue(op: OutboxOp, rows: readonly KvWrite[] = []): Promise<void> {
    return this.exclusive(async () => {
      const open = (await this.entries()).filter((e) => e.seq !== this.inflight);
      // Its session was never created: replaying now could only fail with
      // "session not found". Park it with the start so retry(start) frees both.
      const startFailed = open.some((e) => e.op === 'start' && e.sessionId === op.sessionId && e.state === 'failed');
      const fresh = startFailed
        ? { state: 'failed' as const, lastError: START_FAILED }
        : { state: 'pending' as const, lastError: null };
      if (op.op === 'log_set' || op.op === 'delete_set') {
        const prior = open.find((e) => e.op === 'log_set' && e.args.p_id === op.args.p_id);
        if (prior && op.op === 'log_set') {
          const replaced = { ...prior, args: op.args, attempts: 0, ...fresh } as OutboxEntry;
          await this.store.write([...rows, { table: 'outbox', key: seqKey(prior.seq), value: replaced }]);
          this.emit({ type: 'changed' });
          return;
        }
        if (prior && op.op === 'delete_set') {
          await this.store.write([...rows, { table: 'outbox', key: seqKey(prior.seq), value: null }]);
          this.emit({ type: 'changed' });
          return;
        }
      }
      const seq = (await this.store.get<number>('meta', 'nextSeq')) ?? 1;
      const entry = { ...op, seq, attempts: 0, ...fresh, createdAt: this.now().toISOString() } as OutboxEntry;
      await this.store.write([
        ...rows,
        { table: 'meta', key: 'nextSeq', value: seq + 1 },
        { table: 'outbox', key: seqKey(seq), value: entry },
      ]);
      this.emit({ type: 'changed' });
    });
  }

  /** One drain at a time; a second caller shares the running one. */
  drain(): Promise<DrainOutcome> {
    if (!this.running) {
      this.running = this.drainLoop().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async drainLoop(): Promise<DrainOutcome> {
    let sent = 0;
    let refreshed = false;
    for (;;) {
      const head = await this.exclusive(async () => {
        const next = (await this.entries()).find((e) => e.state === 'pending') ?? null;
        this.inflight = next?.seq ?? null;
        return next;
      });
      if (!head) return sent === 0 ? { kind: 'idle' } : { kind: 'drained', sent };

      const error = await this.attempt(head);
      if (!error) {
        sent += 1;
        continue;
      }
      const kind = classifyError(error);
      if (kind === 'auth' && !refreshed) {
        refreshed = true;
        if (await this.transport.refreshAuth()) continue;
      }
      if (kind === 'auth') {
        await this.exclusive(() => this.bump(head, error));
        return { kind: 'auth', sent };
      }
      if (kind === 'transient') {
        const attempts = await this.exclusive(() => this.bump(head, error));
        return { kind: 'transient', sent, retryInMs: backoffMs(attempts) };
      }
      await this.exclusive(() => this.fail(head, error));
    }
  }

  /** Sends one entry; on success applies the result under the lock. Returns the error, or null. */
  private async attempt(e: OutboxEntry): Promise<RpcError | null> {
    switch (e.op) {
      case 'start': {
        const r = await this.transport.start(e.args);
        if (!r.ok) return r.error;
        await this.exclusive(() => this.applyStart(e, r.data));
        return null;
      }
      case 'log_set': {
        const r = await this.transport.logSet(e.args);
        if (!r.ok) return r.error;
        await this.exclusive(async () => {
          const writes: KvWrite[] = [{ table: 'outbox', key: seqKey(e.seq), value: null }];
          if (!(await this.touchedByOthers(r.data.set.id, e.seq))) {
            writes.push({ table: 'sets', key: r.data.set.id, value: r.data.set });
          }
          await this.store.write(writes);
          this.inflight = null;
        });
        this.emit({ type: 'set_synced', set: r.data.set, newPrs: r.data.newPrs });
        this.emit({ type: 'changed' });
        return null;
      }
      case 'delete_set': {
        const r = await this.transport.deleteSet(e.args);
        if (!r.ok) return r.error;
        await this.exclusive(async () => {
          await this.store.write([{ table: 'outbox', key: seqKey(e.seq), value: null }]);
          this.inflight = null;
        });
        this.emit({ type: 'changed' });
        return null;
      }
      case 'complete': {
        const r = await this.transport.complete(e.args);
        if (!r.ok) return r.error;
        await this.exclusive(async () => {
          await this.store.write([
            { table: 'outbox', key: seqKey(e.seq), value: null },
            { table: 'sessions', key: r.data.id, value: r.data },
          ]);
          this.inflight = null;
        });
        this.emit({ type: 'session_synced', session: r.data });
        this.emit({ type: 'changed' });
        return null;
      }
    }
  }

  private async applyStart(e: OutboxEntry, row: SessionRow): Promise<void> {
    const from = e.sessionId;
    const to = row.id;
    const all = await this.entries();
    const hasComplete = all.some((o) => o.seq !== e.seq && o.sessionId === from && o.op === 'complete');
    const writes: KvWrite[] = [{ table: 'outbox', key: seqKey(e.seq), value: null }];

    if (from === to) {
      if (!hasComplete) writes.push({ table: 'sessions', key: to, value: row });
      await this.store.write(writes);
      this.inflight = null;
      this.emit({ type: 'session_synced', session: row });
      this.emit({ type: 'changed' });
      return;
    }

    // Another device (or the PT, online) already had a session in progress for
    // this client. Everything queued or stored under `from` moves to `to`.
    for (const o of all) {
      if (o.seq !== e.seq && o.sessionId === from) {
        writes.push({ table: 'outbox', key: seqKey(o.seq), value: retarget(o, to) });
      }
    }
    for (const { key, value } of await this.store.all<SetRow>('sets')) {
      if (value.workout_session_id === from) {
        writes.push({ table: 'sets', key, value: { ...value, workout_session_id: to } });
      }
    }
    const local = await this.store.get<SessionRow>('sessions', from);
    writes.push({ table: 'sessions', key: from, value: null });
    writes.push({
      table: 'sessions',
      key: to,
      value: hasComplete && local ? { ...row, status: local.status, completed_at: local.completed_at } : row,
    });
    writes.push({ table: 'aliases', key: from, value: to });
    await this.store.write(writes);
    this.inflight = null;
    this.emit({ type: 'session_rewritten', from, to });
    this.emit({ type: 'changed' });
  }

  private async bump(e: OutboxEntry, error: RpcError): Promise<number> {
    const current = (await this.store.get<OutboxEntry>('outbox', seqKey(e.seq))) ?? e;
    const attempts = current.attempts + 1;
    await this.store.write([{ table: 'outbox', key: seqKey(e.seq), value: { ...current, attempts, lastError: error } }]);
    this.inflight = null;
    this.emit({ type: 'changed' });
    return attempts;
  }

  private async fail(e: OutboxEntry, error: RpcError): Promise<void> {
    const failed: OutboxEntry[] = [{ ...e, state: 'failed', lastError: error }];
    if (e.op === 'start') {
      for (const o of await this.entries()) {
        if (o.seq !== e.seq && o.sessionId === e.sessionId) failed.push({ ...o, state: 'failed', lastError: START_FAILED });
      }
    }
    await this.store.write(failed.map((f) => ({ table: 'outbox' as const, key: seqKey(f.seq), value: f })));
    this.inflight = null;
    for (const f of failed) this.emit({ type: 'failed', entry: f });
    this.emit({ type: 'changed' });
  }

  private async touchedByOthers(setId: string, exceptSeq: number | null): Promise<boolean> {
    return (await this.entries()).some((o) => o.seq !== exceptSeq && setIdOf(o) === setId);
  }

  // ── User actions (sync queue screen, settings) ───────────────────────────

  retry(seq: number): Promise<void> {
    return this.exclusive(async () => {
      const all = await this.entries();
      const target = all.find((e) => e.seq === seq);
      if (!target || target.seq === this.inflight) return;
      const reset = (e: OutboxEntry): KvWrite => ({
        table: 'outbox',
        key: seqKey(e.seq),
        value: { ...e, state: 'pending', attempts: 0, lastError: null },
      });
      const writes = [reset(target)];
      if (target.op === 'start') {
        for (const o of all) {
          if (o.seq !== seq && o.sessionId === target.sessionId && o.lastError?.code === START_FAILED.code) writes.push(reset(o));
        }
      }
      await this.store.write(writes);
      this.emit({ type: 'changed' });
    });
  }

  async retryAll(): Promise<void> {
    for (const e of await this.entries()) {
      if (e.state === 'failed') await this.retry(e.seq);
    }
  }

  discard(seq: number): Promise<void> {
    return this.exclusive(async () => {
      const all = await this.entries();
      const target = all.find((e) => e.seq === seq);
      if (!target || target.seq === this.inflight) return;
      const writes: KvWrite[] = [{ table: 'outbox', key: seqKey(seq), value: null }];
      if (target.op === 'log_set') writes.push({ table: 'sets', key: target.args.p_id, value: null });
      if (target.op === 'start') {
        for (const o of all) {
          if (o.seq !== seq && o.sessionId === target.sessionId) writes.push({ table: 'outbox', key: seqKey(o.seq), value: null });
        }
        for (const { key, value } of await this.store.all<SetRow>('sets')) {
          if (value.workout_session_id === target.sessionId) writes.push({ table: 'sets', key, value: null });
        }
        writes.push({ table: 'sessions', key: target.sessionId, value: null });
      }
      await this.store.write(writes);
      this.emit({ type: 'changed' });
    });
  }

  /** Toggle-off with a queue (spec §4.3). Keeps the read cache. */
  discardAll(): Promise<void> {
    return this.exclusive(async () => {
      const writes: KvWrite[] = [];
      for (const table of ['outbox', 'sessions', 'sets', 'aliases'] as const) {
        for (const { key } of await this.store.all(table)) writes.push({ table, key, value: null });
      }
      await this.store.write(writes);
      this.emit({ type: 'changed' });
    });
  }

  // ── Local reads and server merges ────────────────────────────────────────

  async resolveSessionId(id: string): Promise<string> {
    return (await this.store.get<string>('aliases', id)) ?? id;
  }

  async localSession(id: string): Promise<SessionRow | null> {
    return this.store.get<SessionRow>('sessions', await this.resolveSessionId(id));
  }

  async localSessionsInProgress(): Promise<SessionRow[]> {
    return (await this.store.all<SessionRow>('sessions')).map((r) => r.value).filter((s) => s.status === 'in_progress');
  }

  async localSets(sessionId: string): Promise<SetRow[]> {
    const id = await this.resolveSessionId(sessionId);
    return orderSets((await this.store.all<SetRow>('sets')).map((r) => r.value).filter((s) => s.workout_session_id === id));
  }

  /** Server rows, with every pending local upsert laid over them and pending deletes removed. */
  async overlaySets(sessionId: string, server: readonly SetRow[]): Promise<SetRow[]> {
    const entries = await this.entries();
    const upserts = new Set(entries.filter((e) => e.op === 'log_set').map(setIdOf));
    const deletes = new Set(entries.filter((e) => e.op === 'delete_set').map(setIdOf));
    const merged = new Map(server.map((s) => [s.id, s]));
    for (const local of await this.localSets(sessionId)) {
      if (upserts.has(local.id)) merged.set(local.id, local);
    }
    for (const id of deletes) if (id) merged.delete(id);
    return orderSets([...merged.values()]);
  }

  /** A server set (refetch or broadcast). False when a pending local write for it wins. */
  applyServerSet(row: SetRow): Promise<boolean> {
    return this.exclusive(async () => {
      if (await this.touchedByOthers(row.id, null)) return false;
      await this.store.write([{ table: 'sets', key: row.id, value: row }]);
      return true;
    });
  }

  applyServerSetDelete(id: string): Promise<boolean> {
    return this.exclusive(async () => {
      if (await this.touchedByOthers(id, null)) return false;
      await this.store.write([{ table: 'sets', key: id, value: null }]);
      return true;
    });
  }

  applyServerSession(row: SessionRow): Promise<boolean> {
    return this.exclusive(async () => {
      const pendingComplete = (await this.entries()).some((e) => e.sessionId === row.id && e.op === 'complete');
      if (pendingComplete) return false;
      await this.store.write([{ table: 'sessions', key: row.id, value: row }]);
      return true;
    });
  }

  /** Completed sessions with nothing queued live on the server; drop the local copy. */
  prune(): Promise<void> {
    return this.exclusive(async () => {
      const queued = new Set((await this.entries()).map((e) => e.sessionId));
      const done = (await this.store.all<SessionRow>('sessions'))
        .map((r) => r.value)
        .filter((s) => s.status === 'completed' && !queued.has(s.id))
        .map((s) => s.id);
      if (done.length === 0) return;
      const doneSet = new Set(done);
      const writes: KvWrite[] = done.map((id) => ({ table: 'sessions', key: id, value: null }));
      for (const { key, value } of await this.store.all<SetRow>('sets')) {
        if (doneSet.has(value.workout_session_id)) writes.push({ table: 'sets', key, value: null });
      }
      await this.store.write(writes);
    });
  }

  // ── Read cache (spec §6) ─────────────────────────────────────────────────

  async getCache<T>(key: string): Promise<{ value: T; at: string } | null> {
    return this.store.get<{ value: T; at: string }>('cache', key);
  }

  async putCache(key: string, value: unknown): Promise<void> {
    await this.store.write([{ table: 'cache', key, value: { value, at: this.now().toISOString() } }]);
  }
}

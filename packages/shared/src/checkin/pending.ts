import { classifyError } from '../offline/classify';
import type { KvStore, RpcResult } from '../offline/types';

/**
 * A client's check-in scans and ratings made with no signal (M5b spec D10).
 * The queue keeps at most one entry per kind + key and a newer one replaces
 * an older one (a rating with a comment supersedes the bare rating queued a
 * moment before). Check-in scans are keyed by scan time, so a door scan and a
 * later check-out scan of the same booking are two entries, drained in order.
 *
 * Separate from the M4b SyncEngine on purpose: these writes have no local rows
 * to reconcile and no ordering between them, and they are not behind the
 * offline-logging beta switch.
 */
export type PendingCheckInArgs = { p_booking_id: string | null; p_code: string; p_window: number | null; p_at: string };
export type PendingRateArgs = { p_id: string; p_rating: number; p_comment: string | null };

export type PendingOp =
  | { kind: 'check_in'; key: string; args: PendingCheckInArgs }
  | { kind: 'rate'; key: string; args: PendingRateArgs };

export interface PendingTransport {
  send(op: PendingOp): Promise<RpcResult<unknown>>;
}

export type PendingDrain = { sent: number; dropped: PendingOp[]; transient: boolean; auth: boolean };

const TABLE = 'pending' as const;
const keyOf = (kind: PendingOp['kind'], key: string) => kind + ':' + key;

export class PendingQueue {
  private running: Promise<PendingDrain> | null = null;

  constructor(
    private readonly store: KvStore,
    private readonly transport: PendingTransport,
  ) {}

  async enqueue(op: PendingOp): Promise<void> {
    await this.store.write([{ table: TABLE, key: keyOf(op.kind, op.key), value: op }]);
  }

  async list(): Promise<PendingOp[]> {
    return (await this.store.all<PendingOp>(TABLE)).map((r) => r.value);
  }

  async has(kind: PendingOp['kind'], key: string): Promise<boolean> {
    return (await this.store.get<PendingOp>(TABLE, keyOf(kind, key))) !== null;
  }

  /**
   * Sends each entry once. Success removes it; a permanent refusal removes it
   * and reports it (retrying the same payload can never succeed); a network
   * or auth failure stops the drain and keeps everything left.
   * Overlapping calls share one run.
   */
  drain(): Promise<PendingDrain> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<PendingDrain> {
    const out: PendingDrain = { sent: 0, dropped: [], transient: false, auth: false };
    for (const { key, value } of await this.store.all<PendingOp>(TABLE)) {
      const r = await this.transport.send(value);
      if (r.ok) {
        await this.removeIfUnchanged(key, value);
        out.sent++;
        continue;
      }
      const cls = classifyError(r.error);
      if (cls === 'permanent') {
        await this.removeIfUnchanged(key, value);
        out.dropped.push(value);
        continue;
      }
      if (cls === 'auth') out.auth = true;
      else out.transient = true;
      break;
    }
    return out;
  }

  /** A newer op enqueued while this one was on the wire must survive its result. */
  private async removeIfUnchanged(key: string, sent: PendingOp): Promise<void> {
    const cur = await this.store.get<PendingOp>(TABLE, key);
    if (cur && JSON.stringify(cur) === JSON.stringify(sent)) {
      await this.store.write([{ table: TABLE, key, value: null }]);
    }
  }
}

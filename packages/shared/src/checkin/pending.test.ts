import { describe, expect, it } from 'vitest';
import { MemoryKvStore } from '../offline/memoryStore';
import type { RpcResult } from '../offline/types';
import { PendingQueue, type PendingOp, type PendingTransport } from './pending';

const scan = (key: string, code = '104142'): PendingOp => ({
  kind: 'check_in',
  key,
  args: { p_booking_id: key, p_code: code, p_window: 1, p_at: '2026-10-11T10:00:00.000Z' },
});
const rate = (key: string, rating: number, comment: string | null = null): PendingOp => ({
  kind: 'rate',
  key,
  args: { p_id: key, p_rating: rating, p_comment: comment },
});

class FakeTransport implements PendingTransport {
  sent: PendingOp[] = [];
  constructor(private readonly reply: (op: PendingOp) => RpcResult<unknown> = () => ({ ok: true, data: null })) {}
  async send(op: PendingOp): Promise<RpcResult<unknown>> {
    this.sent.push(op);
    return this.reply(op);
  }
}

describe('PendingQueue', () => {
  it('keeps one entry per kind and booking, newest wins (Review Focus 3)', async () => {
    const q = new PendingQueue(new MemoryKvStore(), new FakeTransport());
    await q.enqueue(scan('a'));
    await q.enqueue(scan('a'));
    await q.enqueue(rate('a', 5));
    await q.enqueue(rate('a', 4, 'Great'));
    const list = await q.list();
    expect(list).toHaveLength(2);
    expect(list.find((o) => o.kind === 'rate')?.args).toEqual({ p_id: 'a', p_rating: 4, p_comment: 'Great' });
    expect(await q.has('check_in', 'a')).toBe(true);
    expect(await q.has('check_in', 'b')).toBe(false);
  });

  it('sends everything and empties on success', async () => {
    const t = new FakeTransport();
    const q = new PendingQueue(new MemoryKvStore(), t);
    await q.enqueue(scan('a'));
    await q.enqueue(rate('b', 5));
    expect(await q.drain()).toEqual({ sent: 2, dropped: [], transient: false, auth: false });
    expect(t.sent).toHaveLength(2);
    expect(await q.list()).toEqual([]);
  });

  it('drops what the server refuses for good, and reports it', async () => {
    const t = new FakeTransport((op) =>
      op.key === 'a' ? { ok: false, error: { code: 'P0001', message: 'code_expired' } } : { ok: true, data: null },
    );
    const q = new PendingQueue(new MemoryKvStore(), t);
    await q.enqueue(scan('a'));
    await q.enqueue(scan('b'));
    const r = await q.drain();
    expect(r.sent).toBe(1);
    expect(r.dropped.map((o) => o.key)).toEqual(['a']);
    expect(await q.list()).toEqual([]);
  });

  it('stops at a network failure and keeps the rest', async () => {
    const t = new FakeTransport(() => ({ ok: false, error: { code: '', message: 'TypeError: Failed to fetch' } }));
    const q = new PendingQueue(new MemoryKvStore(), t);
    await q.enqueue(scan('a'));
    await q.enqueue(scan('b'));
    expect(await q.drain()).toMatchObject({ sent: 0, transient: true });
    expect(t.sent).toHaveLength(1);
    expect(await q.list()).toHaveLength(2);
  });

  it('pauses on an expired session without losing anything', async () => {
    const t = new FakeTransport(() => ({ ok: false, error: { code: 'PGRST301', message: 'JWT expired' } }));
    const q = new PendingQueue(new MemoryKvStore(), t);
    await q.enqueue(rate('a', 5));
    expect(await q.drain()).toMatchObject({ auth: true, sent: 0 });
    expect(await q.list()).toHaveLength(1);
  });

  it('keeps a newer op enqueued while the older one was on the wire', async () => {
    const store = new MemoryKvStore();
    const holder: { q: PendingQueue | null } = { q: null };
    const t = new FakeTransport((op) => {
      if (op.kind === 'rate' && op.args.p_comment === null) void holder.q?.enqueue(rate('a', 4, 'Late comment'));
      return { ok: true, data: null };
    });
    const q = new PendingQueue(store, t);
    holder.q = q;
    await q.enqueue(rate('a', 5));
    await q.drain();
    const left = await q.list();
    expect(left).toHaveLength(1);
    expect(left[0]?.kind === 'rate' && left[0].args.p_comment).toBe('Late comment');
  });

  it('shares one run between overlapping drains', async () => {
    const t = new FakeTransport();
    const q = new PendingQueue(new MemoryKvStore(), t);
    await q.enqueue(scan('a'));
    await Promise.all([q.drain(), q.drain()]);
    expect(t.sent).toHaveLength(1);
  });
});

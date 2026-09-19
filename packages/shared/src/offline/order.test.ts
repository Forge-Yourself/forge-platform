import { describe, expect, it } from 'vitest';
import { makeUlid } from '../schemas/ulid';
import { displayNumbers, orderSets } from './order';

const id = (ms: number, r = 0) => makeUlid(ms, new Uint8Array(10).fill(r));
const set = (ms: number, exercise: string, warm = false, r = 0) => ({ id: id(ms, r), exercise_id: exercise, is_warmup: warm });

describe('orderSets', () => {
  it('orders by the client time encoded in the ULID, not arrival order', () => {
    const a = set(1000, 'x');
    const b = set(2000, 'x');
    const c = set(3000, 'x');
    expect(orderSets([c, a, b]).map((s) => s.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe('displayNumbers', () => {
  it('numbers working sets 1..n per exercise and warm-ups 0', () => {
    const w = set(500, 'x', true);
    const a = set(1000, 'x');
    const y = set(1500, 'y');
    const b = set(2000, 'x');
    expect(displayNumbers([b, y, w, a])).toEqual({ [w.id]: 0, [a.id]: 1, [b.id]: 2, [y.id]: 1 });
  });
  it('gives two devices logging "set 3" at once distinct numbers', () => {
    const pt = set(3000, 'x', false, 1);
    const client = set(3001, 'x', false, 2);
    const n = displayNumbers([client, pt]);
    expect([n[pt.id], n[client.id]]).toEqual([1, 2]);
  });
});

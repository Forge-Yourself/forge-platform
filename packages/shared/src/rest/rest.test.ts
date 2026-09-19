import { describe, expect, it } from 'vitest';
import {
  applyNativeActions,
  plus30,
  pruneRests,
  remainingSec,
  restPhase,
  restProgress,
  soonest,
  startRest,
  togglePause,
  type RestState,
} from './rest';

const T0 = 1_000_000;

function rest(sessionId: string, seconds: number, at = T0): RestState {
  return startRest(
    { sessionId, seconds, setNumber: 2, total: 4, clientName: 'Maya', exerciseName: 'Bench press', nextLabel: '100 kg × 8' },
    at,
  );
}

describe('the clock', () => {
  it('counts down from wall time and rounds up', () => {
    const r = rest('a', 90);
    expect(remainingSec(r, T0)).toBe(90);
    expect(remainingSec(r, T0 + 89_001)).toBe(1);
    expect(remainingSec(r, T0 + 90_000)).toBe(0);
    expect(restPhase(r, T0 + 90_000)).toBe('complete');
  });
  it('freezes while paused and resumes from what was left', () => {
    const paused = togglePause(rest('a', 90), T0 + 30_000);
    expect(restPhase(paused, T0 + 500_000)).toBe('paused');
    expect(remainingSec(paused, T0 + 500_000)).toBe(60);
    const resumed = togglePause(paused, T0 + 500_000);
    expect(remainingSec(resumed, T0 + 510_000)).toBe(50);
  });
  it('+30s grows the ring denominator so progress never jumps backwards', () => {
    const r = rest('a', 60);
    const before = restProgress(r, T0 + 30_000);
    const after = restProgress(plus30(r, T0 + 30_000), T0 + 30_000);
    expect(before).toBeCloseTo(0.5);
    expect(after).toBeCloseTo(1 / 3);
    expect(remainingSec(plus30(r, T0 + 30_000), T0 + 30_000)).toBe(60);
  });
  it('+30s on a finished rest restarts at 30 s from now', () => {
    const r = rest('a', 60);
    expect(remainingSec(plus30(r, T0 + 120_000), T0 + 120_000)).toBe(30);
  });
});

describe('soonest', () => {
  it('picks the running rest that ends first', () => {
    expect(soonest([rest('a', 90), rest('b', 60), rest('c', 120)], T0)?.sessionId).toBe('b');
  });
  it('skips paused and finished rests', () => {
    const paused = togglePause(rest('a', 30), T0);
    const done = rest('b', 10, T0 - 60_000);
    expect(soonest([paused, done, rest('c', 90)], T0)?.sessionId).toBe('c');
    expect(soonest([paused, done], T0)).toBeNull();
  });
  it('breaks a tie on session id', () => {
    expect(soonest([rest('z', 60), rest('m', 60)], T0)?.sessionId).toBe('m');
  });
});

describe('applyNativeActions', () => {
  const base = { a: rest('a', 60), b: rest('b', 90) };

  it('applies +30s at the time of the tap, not now', () => {
    const { rests } = applyNativeActions(base, [{ sessionId: 'a', action: 'plus30', at: T0 + 10_000 }], []);
    expect(rests.a?.endsAt).toBe(T0 + 90_000);
  });
  it('removes a skipped rest and leaves the others', () => {
    const { rests } = applyNativeActions(base, [{ sessionId: 'a', action: 'skip', at: T0 + 5_000 }], []);
    expect(rests.a).toBeUndefined();
    expect(rests.b).toBeDefined();
  });
  it('applies in time order whatever order the queue returned', () => {
    const { rests } = applyNativeActions(
      base,
      [
        { sessionId: 'a', action: 'skip', at: T0 + 20_000 },
        { sessionId: 'a', action: 'plus30', at: T0 + 10_000 },
      ],
      [],
    );
    expect(rests.a).toBeUndefined();
  });
  it('is idempotent: a drained queue replayed changes nothing', () => {
    const actions = [{ sessionId: 'a', action: 'plus30' as const, at: T0 + 10_000 }];
    const once = applyNativeActions(base, actions, []);
    const twice = applyNativeActions(once.rests, actions, once.applied);
    expect(twice.rests.a?.endsAt).toBe(once.rests.a?.endsAt);
  });
  it('drops a tap for a session with no rest', () => {
    const { rests } = applyNativeActions(base, [{ sessionId: 'gone', action: 'plus30', at: T0 }], []);
    expect(Object.keys(rests).sort()).toEqual(['a', 'b']);
  });
  it('remembers at most 50 applied keys', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ sessionId: 'x', action: 'plus30' as const, at: T0 + i }));
    expect(applyNativeActions({}, many, []).applied).toHaveLength(50);
  });
});

describe('pruneRests', () => {
  it('drops a rest that ended hours ago and keeps a fresh one', () => {
    const old = rest('old', 60, T0 - 7 * 60 * 60 * 1000);
    const fresh = rest('fresh', 60);
    expect(Object.keys(pruneRests({ old, fresh }, T0))).toEqual(['fresh']);
  });
  it('keeps a paused rest however old', () => {
    const paused = togglePause(rest('p', 60, T0 - 8 * 60 * 60 * 1000), T0 - 8 * 60 * 60 * 1000 + 1000);
    expect(pruneRests({ p: paused }, T0).p).toBeDefined();
  });
  it('drops rests whose session is no longer live', () => {
    expect(Object.keys(pruneRests({ a: rest('a', 60), b: rest('b', 60) }, T0, ['b']))).toEqual(['b']);
  });
});

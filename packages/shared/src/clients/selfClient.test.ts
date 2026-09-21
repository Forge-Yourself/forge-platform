import { describe, expect, it } from 'vitest';
import { isSelfClientRow, splitRoster } from './selfClient';

const PT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const row = (pt: string, client: string | null, extra: Record<string, unknown> = {}) => ({
  pt_user_id: pt,
  client_user_id: client,
  ...extra,
});

describe('isSelfClientRow', () => {
  it('is true when the PT and the subject are the same user', () => {
    expect(isSelfClientRow(row(PT, PT))).toBe(true);
  });

  it('is false for an ordinary client', () => {
    expect(isSelfClientRow(row(PT, OTHER))).toBe(false);
  });

  it('is false for an unclaimed invite, whoever it was addressed to', () => {
    // client_user_id IS NULL is the shape uq_clients_self cannot see, which is
    // why invite_client refuses the PT's own address separately.
    expect(isSelfClientRow(row(PT, null))).toBe(false);
  });
});

describe('splitRoster', () => {
  it('keeps the self row out of the roster and hands it back separately', () => {
    const self = row(PT, PT);
    const client = row(PT, OTHER);
    const result = splitRoster([client, self]);

    expect(result.roster).toEqual([client]);
    expect(result.self).toBe(self);
  });

  it('reports no self row when the PT has not opted in', () => {
    const result = splitRoster([row(PT, OTHER), row(PT, null)]);

    expect(result.roster).toHaveLength(2);
    expect(result.self).toBeNull();
  });

  it('leaves an empty roster empty rather than inventing a self row', () => {
    expect(splitRoster([])).toEqual({ roster: [], self: null });
  });

  it('makes a PT whose ONLY row is their own read as an empty roster', () => {
    // The case that decides whether "Invite your first client" still fires.
    const result = splitRoster([row(PT, PT)]);

    expect(result.roster).toEqual([]);
    expect(result.self).not.toBeNull();
  });

  it('preserves roster order', () => {
    const a = row(PT, 'a');
    const b = row(PT, 'b');
    const c = row(PT, 'c');

    expect(splitRoster([a, row(PT, PT), b, c]).roster).toEqual([a, b, c]);
  });

  it("carries the caller's own fields through untouched", () => {
    const result = splitRoster([row(PT, PT, { displayName: 'PT A', state: 'active' })]);

    expect(result.self).toMatchObject({ displayName: 'PT A', state: 'active' });
  });
});

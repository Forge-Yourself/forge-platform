import { describe, expect, it } from 'vitest';
import { clientStateSchema, inviteClientSchema, resendInviteSchema } from './clients';

describe('clientStateSchema', () => {
  it('accepts every value in chk_clients_state', () => {
    for (const state of ['invited', 'accepted', 'active', 'paused', 'deactivated']) {
      expect(clientStateSchema.safeParse(state).success).toBe(true);
    }
  });

  it('rejects a state outside the CHECK constraint', () => {
    expect(clientStateSchema.safeParse('archived').success).toBe(false);
  });
});

describe('inviteClientSchema', () => {
  it('trims and lowercases the email', () => {
    const result = inviteClientSchema.parse({ email: '  Client@Example.com  ' });
    expect(result.email).toBe('client@example.com');
  });

  it('rejects an invalid email', () => {
    expect(inviteClientSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('accepts a valid email with name and tags omitted', () => {
    const result = inviteClientSchema.safeParse({ email: 'client@example.com' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty-string name but accepts a real one', () => {
    expect(inviteClientSchema.safeParse({ email: 'a@b.com', name: '' }).success).toBe(false);
    expect(inviteClientSchema.safeParse({ email: 'a@b.com', name: 'Maya' }).success).toBe(true);
  });

  it('caps tags at 10 items of 30 characters each', () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `tag${i}`);
    expect(inviteClientSchema.safeParse({ email: 'a@b.com', tags: tooMany }).success).toBe(false);

    const tooLong = ['x'.repeat(31)];
    expect(inviteClientSchema.safeParse({ email: 'a@b.com', tags: tooLong }).success).toBe(false);

    expect(inviteClientSchema.safeParse({ email: 'a@b.com', tags: ['weight-loss'] }).success).toBe(true);
  });

  it('rejects a field outside the granted set', () => {
    expect(inviteClientSchema.safeParse({ email: 'a@b.com', pt_user_id: 'x' }).success).toBe(false);
  });
});

describe('resendInviteSchema', () => {
  it('accepts a bare clientId with no email re-point', () => {
    expect(
      resendInviteSchema.safeParse({ clientId: '11111111-1111-4111-8111-111111111111' }).success,
    ).toBe(true);
  });

  it('rejects a non-uuid clientId', () => {
    expect(resendInviteSchema.safeParse({ clientId: 'not-a-uuid' }).success).toBe(false);
  });

  it('trims and lowercases an email re-point when given', () => {
    const result = resendInviteSchema.parse({
      clientId: '11111111-1111-4111-8111-111111111111',
      email: '  New@Address.com ',
    });
    expect(result.email).toBe('new@address.com');
  });
});

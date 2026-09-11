import { z } from 'zod';

/** Matches db/schema.sql's `chk_clients_state` CHECK constraint exactly. */
export const clientStateSchema = z.enum(['invited', 'accepted', 'active', 'paused', 'deactivated']);
export type ClientState = z.infer<typeof clientStateSchema>;

/**
 * Payload for `invite_client()` (supabase/migrations/0005_m2_clients_intake.sql).
 * `.strict()` so a stray key (e.g. a caller reaching for `pt_user_id`, which
 * the RPC always derives from `auth.uid()` itself) fails validation instead
 * of being silently ignored.
 */
export const inviteClientSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    name: z.string().trim().min(1).max(120).optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  })
  .strict();
export type InviteClientInput = z.infer<typeof inviteClientSchema>;

/** Payload for `resend_invite()` — `email` re-points the invite when given. */
export const resendInviteSchema = z
  .object({
    clientId: z.string().uuid(),
    email: z.string().trim().toLowerCase().email().optional(),
  })
  .strict();
export type ResendInviteInput = z.infer<typeof resendInviteSchema>;

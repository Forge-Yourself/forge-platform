import type { ClientState } from '@forge/shared';
import { supabase } from '../supabase';

/**
 * Thin wrappers around the seven RPCs from
 * supabase/migrations/0005_m2_clients_intake.sql. No business logic lives
 * here — the database owns all of it (authorization, state transitions,
 * audit logging); these just call `.rpc()` and rethrow on error so callers
 * can route failures through `useAsyncSubmit`'s existing pattern.
 */

export async function inviteClient(email: string, name?: string, tags?: string[]): Promise<string> {
  const { data, error } = await supabase.rpc('invite_client', {
    p_email: email,
    p_name: name,
    p_tags: tags,
  });
  if (error) throw error;
  return data;
}

export async function resendInvite(clientId: string, email?: string): Promise<void> {
  const { error } = await supabase.rpc('resend_invite', { p_client_id: clientId, p_email: email });
  if (error) throw error;
}

export async function revokeInvite(clientId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_invite', { p_client_id: clientId });
  if (error) throw error;
}

/** `p_state` excludes 'invited'/'accepted' — those are set by invite_client/claim_client_invites, never this RPC. */
export async function setClientState(
  clientId: string,
  state: Extract<ClientState, 'active' | 'paused' | 'deactivated'>,
): Promise<void> {
  const { error } = await supabase.rpc('set_client_state', { p_client_id: clientId, p_state: state });
  if (error) throw error;
}

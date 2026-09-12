import { supabase } from '../supabase';

/**
 * Wraps `claim_client_invites()` — links every unclaimed, unexpired invite
 * addressed to the caller's own verified email. Idempotent: safe to call on
 * every client app boot, and again right after role selection.
 */
export async function claimClientInvites(): Promise<number> {
  const { data, error } = await supabase.rpc('claim_client_invites');
  if (error) throw error;
  return data;
}

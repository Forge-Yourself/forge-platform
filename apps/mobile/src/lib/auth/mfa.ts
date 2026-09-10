import type { AuthError } from '@supabase/supabase-js';
import { logAccountEvent } from './audit';
import { supabase } from '../supabase';

export type UnenrollMfaFactorResult = { success: true } | { success: false; error: AuthError };

/**
 * Unenrolls an MFA factor and logs the `user_mfa_disable` audit event on success.
 *
 * No screen calls this yet — Task 9's plan explicitly asks for the function to exist
 * even before there's a UI button for it, since Task 11 owns the settings screen where
 * that button lands. Kept as its own small focused module (mirroring oauth.ts's shape)
 * rather than folded into AuthProvider: this is a one-shot imperative action, not state
 * the provider needs to track. Note this does NOT refresh `useAuth().mfaFactors` —
 * unenroll doesn't reliably fire a USER_UPDATED/SIGNED_IN event, so the caller (Task 11's
 * settings screen) should re-run `supabase.auth.mfa.listFactors()` itself after a
 * successful unenroll if it needs the list to reflect the change immediately.
 */
export async function unenrollMfaFactor(factorId: string): Promise<UnenrollMfaFactorResult> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) {
    return { success: false, error };
  }
  void logAccountEvent('user_mfa_disable');
  return { success: true };
}

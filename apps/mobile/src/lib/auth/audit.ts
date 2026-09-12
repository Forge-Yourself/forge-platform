import type { Database } from '@forge/shared';
import { supabase } from '../supabase';

/** Mirrors the CHECK constraint in log_account_event (supabase/migrations/0004_m1_identity.sql). */
export type AccountEventAction =
  | 'user_login'
  | 'user_logout'
  | 'user_mfa_enable'
  | 'user_mfa_disable'
  | 'user_password_change';

type AccountEventDetails = Database['public']['Functions']['log_account_event']['Args']['p_details'];

/**
 * Writes a session-lifecycle audit entry via the log_account_event RPC.
 * MUST NOT throw into the UI — an audit write failing must never block a real user
 * action (login, logout, MFA toggle, password change). Errors are swallowed and only
 * surfaced via console.warn for local debugging.
 */
export async function logAccountEvent(
  action: AccountEventAction,
  details?: AccountEventDetails,
): Promise<void> {
  try {
    const { error } = await supabase.rpc('log_account_event', {
      p_action: action,
      p_details: details ?? undefined,
    });
    if (error) {
      console.warn('[audit] log_account_event failed', action, error.message);
    }
  } catch (err) {
    console.warn('[audit] log_account_event threw', action, err);
  }
}

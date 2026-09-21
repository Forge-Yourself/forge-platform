import { isNetworkError } from '@forge/shared';
import { refreshAuthProfile } from '../auth/refreshProfile';
import { supabase } from '../supabase';

/**
 * Mints (or returns) the caller's own `clients` row — the record a PT trains
 * themselves against. Idempotent on the server, so a second tap is harmless.
 *
 * The `refreshAuthProfile()` call is not optional. AuthProvider only refetches
 * on SIGNED_IN / USER_UPDATED / INITIAL_SESSION, and an RPC fires none of them,
 * so without it `useAuth().selfClientId` stays null and every screen that keys
 * off it misbehaves until some unrelated auth event happens to land. Same
 * reasoning as every direct write to `public.users` — see refreshProfile.ts.
 *
 * Returns the new client id, or null with a message the caller can show.
 */
export async function ensureSelfClient(): Promise<{ clientId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('ensure_self_client');

  if (error) {
    return { clientId: null, error: isNetworkError(error) ? 'offline' : error.message };
  }

  await refreshAuthProfile();
  return { clientId: data ?? null, error: null };
}

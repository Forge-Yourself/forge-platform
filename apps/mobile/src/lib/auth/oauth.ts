import { AuthError } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../supabase';

export type OAuthProvider = 'google' | 'apple';

export type OAuthOutcome =
  | { type: 'success' }
  | { type: 'cancelled' }
  | { type: 'error'; error: AuthError };

/**
 * Required once per app launch so `WebBrowser.openAuthSessionAsync`'s underlying auth
 * session can dismiss itself when the redirect lands (Android in particular hangs
 * otherwise). Must run at module scope, not inside a component/effect, per
 * expo-web-browser's docs — importing this module (from sign-in.tsx / sign-up.tsx) is
 * what triggers it; deliberately not repeated at each call site so it only registers
 * once regardless of how many screens import `signInWithProvider`.
 */
WebBrowser.maybeCompleteAuthSession();

/**
 * Drives the browser-based OAuth flow for a Supabase external provider (Google today;
 * written provider-agnostically so enabling Apple later is a config change + a button,
 * not a rewrite here — see supabase/config.toml's `[auth.external.*]` blocks).
 *
 * Flow: ask Supabase for the provider's authorization URL (skipping its own redirect so
 * we can drive the browser ourselves), open it in an in-app auth session, then exchange
 * the resulting `result.url` for a session via PKCE. The user closing the browser
 * without finishing ('cancel' / 'dismiss') is a normal outcome, not an error — the
 * caller should just stop submitting, not show an error banner.
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<OAuthOutcome> {
  const redirectTo = Linking.createURL('/auth/callback');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    return { type: 'error', error };
  }
  if (!data?.url) {
    return { type: 'error', error: new AuthError('No authorization URL returned', undefined, 'unexpected_failure') };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { type: 'cancelled' };
  }
  if (result.type !== 'success' || !result.url) {
    return {
      type: 'error',
      error: new AuthError(`Unexpected auth session result: ${result.type}`, undefined, 'unexpected_failure'),
    };
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(result.url);
  if (exchangeError) {
    return { type: 'error', error: exchangeError };
  }

  return { type: 'success' };
}

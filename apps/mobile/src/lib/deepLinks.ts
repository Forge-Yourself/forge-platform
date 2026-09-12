import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { supabase } from './supabase';

/**
 * Parses and routes an incoming forge:// URL:
 *  - type=signup   -> verifyOtp({ type: 'signup' })   -> onAuthStateChange(SIGNED_IN) picks it
 *                      up; the root gate (app/_layout.tsx) then routes reactively.
 *  - type=recovery -> verifyOtp({ type: 'recovery' }) -> establishes a session, but landing a
 *                      recovery link in the app must not just drop the user into (app) — the
 *                      gate has no way to distinguish "recovering" from "signed in", so this
 *                      navigates to (auth)/reset-password directly and doesn't rely on the gate.
 *  - code param    -> OAuth / PKCE callback -> exchangeCodeForSession. Thin plumbing for now;
 *                      Task 8 wires the "start OAuth" trigger that produces these callbacks.
 *  - type=join     -> M2's invite link (apps/web's /join page redirects here with the
 *                      invited email). Pre-fills (auth)/sign-up's email field — a
 *                      convenience, not a lock, since the client might need to correct it.
 *                      Only a convenience: linking is by verified-email match
 *                      (claim_client_invites()), not by anything in this URL.
 */
async function handleUrl(url: string | null): Promise<void> {
  if (!url) return;

  const { queryParams } = Linking.parse(url);
  const type = typeof queryParams?.type === 'string' ? queryParams.type : undefined;
  const tokenHash = typeof queryParams?.token_hash === 'string' ? queryParams.token_hash : undefined;
  const code = typeof queryParams?.code === 'string' ? queryParams.code : undefined;
  const email = typeof queryParams?.email === 'string' ? queryParams.email : undefined;

  if (type === 'join' && email) {
    router.push({ pathname: '/(auth)/sign-up', params: { email } });
    return;
  }

  if (type === 'signup' && tokenHash) {
    await supabase.auth.verifyOtp({ type: 'signup', token_hash: tokenHash });
    return;
  }

  if (type === 'recovery' && tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
    if (!error) {
      router.replace('/(auth)/reset-password');
    }
    return;
  }

  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  }
}

/**
 * Wires both the cold-start path (Linking.getInitialURL — the URL that launched the
 * process) and the warm-start path (Linking.addEventListener('url', ...) — a link
 * opened while the app is already running). Both are required; a common bug is
 * handling only one. Call once from the root layout on mount; returns an unsubscribe.
 */
export function subscribeToDeepLinks(): () => void {
  void Linking.getInitialURL().then(handleUrl);

  const subscription = Linking.addEventListener('url', ({ url }) => {
    void handleUrl(url);
  });

  return () => subscription.remove();
}

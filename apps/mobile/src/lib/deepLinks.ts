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
 */
async function handleUrl(url: string | null): Promise<void> {
  if (!url) return;

  const { queryParams } = Linking.parse(url);
  const type = typeof queryParams?.type === 'string' ? queryParams.type : undefined;
  const tokenHash = typeof queryParams?.token_hash === 'string' ? queryParams.token_hash : undefined;
  const code = typeof queryParams?.code === 'string' ? queryParams.code : undefined;

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

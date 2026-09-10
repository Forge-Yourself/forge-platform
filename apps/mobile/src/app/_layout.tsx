import type { AuthMFAGetAuthenticatorAssuranceLevelResponse } from '@supabase/supabase-js';
import { Redirect, Slot } from 'expo-router';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../lib/i18n';
import { AuthProvider, useAuth } from '../lib/auth/AuthProvider';
import { subscribeToDeepLinks } from '../lib/deepLinks';
import { supabase } from '../lib/supabase';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { Screen, Spinner } from '../ui';

type Aal = AuthMFAGetAuthenticatorAssuranceLevelResponse['data'];

function LoadingScreen() {
  return (
    <Screen>
      <Spinner />
    </Screen>
  );
}

/**
 * The auth gate. Order matters (see Task 6 plan step 5):
 *   1. AuthProvider still resolving -> hold on a loading screen.
 *   2. Signed out -> (auth)/sign-in.
 *   3. Signed in, AAL still aal1 with an aal2 step pending (an MFA factor is enrolled
 *      but this session hasn't cleared the challenge) -> (auth)/mfa-challenge.
 *   4. onboarding not completed -> (onboarding)/role.
 *   5. Role is pt with no pt_profiles row yet -> (onboarding)/pt-profile.
 *   6. Otherwise: render whatever route is currently matched (Slot) — this is
 *      deliberately passive, not a forced redirect into (app)/index, so that
 *      lib/deepLinks.ts's explicit router.replace('/(auth)/reset-password') during a
 *      password-recovery deep link isn't immediately fought by the gate on the next
 *      render (a signed-in recovery session that's otherwise "clean" just falls
 *      through to here and Slot renders reset-password, the currently active route).
 *
 * Redirects use the <Redirect/> component rather than an imperative router.replace()
 * call from an effect: expo-router's Redirect defers navigation to run once it has
 * mounted, so it can't hit the "navigate before the Root Layout has mounted" error that
 * an eager top-level router.replace() call can. It also composes cleanly with plain
 * conditional rendering here instead of needing a manual "has the router mounted yet"
 * ref.
 */
function Gate() {
  const auth = useAuth();
  // `aal` starts fresh at 'loading' on every mount. Gate is keyed by user id in
  // ThemedGate below, so a sign-out -> different-user-sign-in remounts this component
  // instead of reusing stale AAL state from the previous user while the new check is
  // in flight — a plain effect reset would either need to setState during the same
  // render (react-hooks/set-state-in-effect) or leave a one-tick window where the
  // gate evaluates the new user's MFA requirement against the old user's AAL.
  const [aal, setAal] = useState<Aal | 'loading'>('loading');

  useEffect(() => {
    // Nothing to check until signed in — the gate short-circuits on status before ever
    // reading `aal` in that case, so leaving the previous value in place is harmless.
    if (auth.status !== 'signedIn') {
      return;
    }
    let cancelled = false;
    void supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      if (!cancelled) setAal(data);
    });
    return () => {
      cancelled = true;
    };
    // Re-check whenever the session identity changes (sign-in, MFA challenge verified).
  }, [auth.status, auth.session?.access_token]);

  if (auth.status === 'loading') {
    return <LoadingScreen />;
  }

  if (auth.status === 'signedOut') {
    return <Redirect href="/(auth)/sign-in" />;
  }

  // signedIn from here on.
  if (aal === 'loading') {
    return <LoadingScreen />;
  }

  if (aal?.currentLevel === 'aal1' && aal.nextLevel === 'aal2') {
    return <Redirect href="/(auth)/mfa-challenge" />;
  }

  if (auth.user?.onboarding_completed === false) {
    return <Redirect href="/(onboarding)/role" />;
  }

  if (auth.user?.role === 'pt' && !auth.ptProfile) {
    return <Redirect href="/(onboarding)/pt-profile" />;
  }

  return <Slot />;
}

function ThemedGate() {
  const t = useTheme();
  const auth = useAuth();

  useEffect(() => subscribeToDeepLinks(), []);

  return (
    <>
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
      {/* Keyed by user id (stable across token refresh, unlike access_token) so a
          sign-out -> different-user-sign-in remounts Gate and its AAL state resets
          for free, instead of racing a stale value from the previous user. */}
      <Gate key={auth.session?.user.id ?? 'signed-out'} />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <ThemedGate />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

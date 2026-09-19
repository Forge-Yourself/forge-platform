import type { AuthMFAGetAuthenticatorAssuranceLevelResponse } from '@supabase/supabase-js';
import { Redirect, Slot, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../lib/i18n';
import { AuthProvider, useAuth } from '../lib/auth/AuthProvider';
import { OfflineProvider } from '../lib/offline/OfflineProvider';
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
 * True when the route already matched IS the route a gate branch wants to send the
 * user to.
 *
 * Every redirect below has to ask this before firing. expo-router's <Redirect>
 * drives router.replace() from a useFocusEffect whose callback it does not
 * memoize, so the effect's deps change on every render and the replace re-runs for
 * as long as the component stays mounted. Gate returns a redirect INSTEAD of
 * <Slot/>, so a branch whose condition is still true after the redirect has landed
 * never gets to render the screen that would make it false: it replaces,
 * re-renders, replaces again, forever. On web that reads as a page reloading in a
 * loop; on native it is a screen that never paints.
 *
 * That is not hypothetical — the post-onboarding pt_profiles check below had
 * exactly this shape, and a PT with onboarding_completed = true and no pt_profiles
 * row (reachable by skipping every step of the wizard, see
 * (onboarding)/pt-profile.tsx's handleFinish) could not open the app at all.
 */
function isCurrentRoute(segments: readonly string[], group: string, route: string): boolean {
  return segments[0] === group && segments[1] === route;
}

/**
 * The auth gate. Order matters (see Task 6 plan step 5):
 *   1. AuthProvider still resolving -> hold on a loading screen.
 *   2. Signed out -> (auth)/sign-in, UNLESS the current route is already somewhere in
 *      (auth) — sign-up, forgot-password and verify-pending are all legitimately
 *      reachable pre-session, and without this check the gate would force every one
 *      of them back to sign-in the instant they're navigated to (status is
 *      'signedOut' throughout signup until the email is confirmed).
 *   3. Signed in, AAL still aal1 with an aal2 step pending (an MFA factor is enrolled
 *      but this session hasn't cleared the challenge) -> (auth)/mfa-challenge.
 *   4. onboarding not completed -> (onboarding)/role, UNLESS the user has already
 *      picked role='pt' (Task 10's (onboarding)/role screen, via set_initial_role()),
 *      in which case they belong on (onboarding)/pt-profile instead — see the Task 10
 *      note below on why this can't be a separate, later check the way it looks like
 *      it should be.
 *   5. Post-onboarding check: role is pt with no pt_profiles row -> (onboarding)/pt-profile.
 *      This was documented as unreachable; it was not. Skipping every step of the
 *      wizard set onboarding_completed=true without ever upserting the row, and the
 *      resulting account could not open the app. Reachable states are handled, not
 *      asserted away.
 *
 *   Every redirect above yields when the user is already on its target — see
 *   isCurrentRoute for why a gate that redirects to the route it is already on
 *   cannot stop.
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
  const segments = useSegments();
  // useSegments() is typed as a union of known route tuples, so indexing past [0]
  // needs a widened view. One cast here beats one at each call site.
  const currentSegments = segments as readonly string[];
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
    // Let any (auth) screen render as-is — sign-up, forgot-password, verify-pending
    // are all navigated to imperatively while still signed out. Only force sign-in
    // when landing signed-out on a route OUTSIDE (auth), e.g. deep-linking straight
    // into (app) or (onboarding) with no session.
    if (segments[0] === '(auth)') {
      return <Slot />;
    }
    return <Redirect href="/(auth)/sign-in" />;
  }

  // signedIn from here on.
  if (aal === 'loading') {
    return <LoadingScreen />;
  }

  if (aal?.currentLevel === 'aal1' && aal.nextLevel === 'aal2') {
    // The challenge screen is the only place this condition gets cleared, so it has
    // to be allowed to render rather than be redirected on top of itself.
    if (isCurrentRoute(currentSegments, '(auth)', 'mfa-challenge')) {
      return <Slot />;
    }
    return <Redirect href="/(auth)/mfa-challenge" />;
  }

  if (auth.user?.onboarding_completed === false) {
    // Tapping the signup-confirmation email link establishes a session immediately, and
    // a brand-new user always has onboarding_completed=false — so without a carve-out,
    // (auth)/verify-success would be forced straight to (onboarding)/role the instant it
    // mounted, and the design's "offer MFA before onboarding" screen would never be
    // reachable. verify-success's own two exits (MFA setup, or "Skip for now" ->
    // router.replace('/')) are what leave this state, not the gate racing them.
    // reset-password is carved out for the same reason: a user who signed up, never
    // finished onboarding and then used a password-recovery link arrives here with a
    // live session, and lib/deepLinks.ts has already put them on that screen.
    //
    // (Task 9) (onboarding)/mfa-enroll is a DIFFERENT segment ((onboarding), not (auth))
    // from verify-success's "Set up two-factor" button, so it needs its own carve-out
    // here too — otherwise this branch would redirect it straight to /(onboarding)/role
    // before mfa-enroll ever rendered. Scoped to that one route specifically (not all of
    // (onboarding)) so role.tsx/pt-profile.tsx still redirect normally for a user who
    // lands there some other way pre-onboarding.
    //
    // THESE ARE EXACT ROUTES, NOT `segments[0] === '(auth)'`. The group-wide form hung
    // the app. Sign-in deliberately does not navigate on success (see (auth)/sign-in.tsx)
    // — it lets this gate route onward — so a user who signs in with onboarding still to
    // do is signedIn while parked on (auth)/sign-in. A group-wide carve-out yielded
    // <Slot/> for that, which mounted the root navigator; the navigator comes up on its
    // default route, (app)/(tabs), which flipped this branch to <Redirect> on the very
    // next commit; returning <Redirect> INSTEAD of <Slot/> unmounted the navigator
    // before the redirect's own effect could run, so the replace never happened and
    // useSegments() fell back to (auth)/sign-in, which re-entered the carve-out. Mount,
    // redirect, unmount, repeat — "Maximum update depth exceeded" inside
    // <BottomTabNavigator>, with the URL still sitting on /sign-in. Naming the routes
    // exactly means /sign-in is not carved out, the redirect stops alternating, and it
    // gets to land. See docs/PITFALLS.md.
    if (
      isCurrentRoute(currentSegments, '(auth)', 'verify-success') ||
      isCurrentRoute(currentSegments, '(auth)', 'reset-password') ||
      isCurrentRoute(currentSegments, '(onboarding)', 'mfa-enroll')
    ) {
      return <Slot />;
    }

    // (Task 10) A PT who has already selected 'pt' on (onboarding)/role belongs on
    // (onboarding)/pt-profile next, not bounced back to role.tsx by the catch-all
    // redirect below. This can't be expressed as a separate `!auth.ptProfile` check
    // reached only once onboarding_completed flips true (the shape the original
    // step-5 comment implied): `users.role` always has a value — it defaults to
    // 'client' at signup (see (auth)/sign-up.tsx's SIGNUP_ROLE) before the role
    // picker ever runs — so a user who genuinely hasn't chosen yet is
    // indistinguishable from one who chose 'client', and pt_profiles not existing
    // yet is the normal, expected state through all four pt-profile steps (the row
    // is created/updated progressively as the user moves through them, not only at
    // the end) — so routing here can't depend on whether that row exists yet, only
    // on the role itself.
    if (auth.user.role === 'pt') {
      if (isCurrentRoute(currentSegments, '(onboarding)', 'pt-profile')) {
        return <Slot />;
      }
      return <Redirect href="/(onboarding)/pt-profile" />;
    }

    if (isCurrentRoute(currentSegments, '(onboarding)', 'role')) {
      return <Slot />;
    }
    return <Redirect href="/(onboarding)/role" />;
  }

  // A PT whose pt_profiles row is missing even though onboarding is marked complete.
  // The original comment here called this unreachable because "pt-profile.tsx's
  // finish step always creates the row" — it did not: skipping every step of the
  // wizard flipped onboarding_completed with no upsert ever running, and this branch
  // then redirected to pt-profile on top of pt-profile forever. handleFinish now
  // always upserts, and the carve-out makes the state recoverable for the accounts
  // already in it — they land on the wizard, finish it, and the row appears.
  if (auth.user?.role === 'pt' && !auth.ptProfile) {
    if (isCurrentRoute(currentSegments, '(onboarding)', 'pt-profile')) {
      return <Slot />;
    }
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
          <OfflineProvider>
            <ThemedGate />
          </OfflineProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

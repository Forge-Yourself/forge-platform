import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { mapAuthError } from '../../lib/auth/authErrors';
import { useAuth } from '../../lib/auth/AuthProvider';
import { useMfaAutoVerify } from '../../lib/auth/useMfaAutoVerify';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, CodeCells, NumericKeypad, Screen, Spinner, Text } from '../../ui';

/**
 * Reached only via the root gate (app/_layout.tsx) when
 * `getAuthenticatorAssuranceLevel()` reports `currentLevel: 'aal1'` with
 * `nextLevel: 'aal2'` — i.e. a verified TOTP factor exists on the account but this
 * session hasn't cleared the challenge yet. That covers every entry path (password
 * sign-in, OAuth, a resumed session) since it's the gate itself that routes here, so
 * this screen doesn't need its own "where did I come from" logic.
 *
 * No "Use a backup code instead" link: Supabase issues no TOTP backup/recovery codes
 * for this factor type, so there is nothing for such a link to do. Don't add one.
 */
export default function MfaChallenge() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();

  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const startedRef = useRef(false);

  // Deliberately no audit event and no navigation here: this is an existing,
  // already-enrolled factor clearing its per-session challenge on sign-in, not an
  // enrollment — user_login was already logged when the password/OAuth step
  // succeeded (see sign-in.tsx / lib/auth/oauth.ts), and user_mfa_enable is logged
  // once, at enrollment time, in (onboarding)/mfa-enroll.tsx. A successful verify()
  // fires MFA_CHALLENGE_VERIFIED, AuthProvider picks up the refreshed session, and the
  // root gate's AAL re-check (keyed off auth.session?.access_token) sees aal2 and lets
  // this screen fall away on its own.
  const handleVerified = useCallback(() => {}, []);
  const { code, setCode, verifyError } = useMfaAutoVerify(factorId, challengeId, t, handleVerified);

  useEffect(() => {
    // Guards against the effect's cleanup-less re-run under React's dev double-invoke —
    // calling challenge() twice would create two live challenges for no benefit.
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const totpFactor = auth.mfaFactors?.totp[0];
      if (!totpFactor) {
        // Shouldn't happen: the gate only routes here when the AAL check reports a
        // pending aal2 step, which implies a verified factor exists. Guard anyway
        // rather than calling challenge() with an undefined id.
        setInitError(t('auth.errors.generic'));
        return;
      }
      setFactorId(totpFactor.id);

      const { data, error } = await supabase.auth.mfa.challenge({ factorId: totpFactor.id });
      if (error || !data) {
        setInitError(mapAuthError(error, t));
        return;
      }
      setChallengeId(data.id);
    })();
    // startedRef makes this a run-once-per-mount effect regardless of dependency
    // changes, so auth.mfaFactors is read once via closure, not tracked reactively —
    // deliberately absent from the deps list rather than listed-but-inert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const ready = !!factorId && !!challengeId && !initError;

  return (
    <Screen>
      <Text variant="h1" style={{ marginBottom: theme.space[2] }}>
        {t('auth.mfaChallenge.title')}
      </Text>
      <Text tone="secondary" style={{ marginBottom: theme.space[6] }}>
        {t('auth.mfaChallenge.subtitle')}
      </Text>

      {initError ? (
        <View style={{ marginBottom: theme.space[4] }}>
          <Banner variant="danger" message={initError} />
        </View>
      ) : null}
      {verifyError ? (
        <View style={{ marginBottom: theme.space[4] }}>
          <Banner variant="danger" message={verifyError} />
        </View>
      ) : null}

      {!ready && !initError ? (
        <Spinner />
      ) : (
        <>
          <View style={{ marginBottom: theme.space[6] }}>
            <CodeCells code={code} />
          </View>
          <NumericKeypad
            onKey={(digit) => setCode((c) => (c.length < 6 ? c + digit : c))}
            onDelete={() => setCode((c) => c.slice(0, -1))}
          />
        </>
      )}
    </Screen>
  );
}

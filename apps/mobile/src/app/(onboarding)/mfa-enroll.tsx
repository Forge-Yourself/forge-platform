import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { router } from 'expo-router';
import { logAccountEvent } from '../../lib/auth/audit';
import { mapAuthError } from '../../lib/auth/authErrors';
import { useMfaAutoVerify } from '../../lib/auth/useMfaAutoVerify';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Banner,
  Button,
  CodeCells,
  NumericKeypad,
  Screen,
  SegmentedPill,
  Spinner,
  Text,
} from '../../ui';

const QR_SIZE = 176;

/**
 * Reached from (auth)/verify-success's "Set up two-factor" button. Lives in
 * (onboarding), not (auth) — see the carve-out in app/_layout.tsx's gate for why that's
 * safe to reach even while `onboarding_completed` is still false.
 *
 * SegmentedPill shows Authenticator (active) and SMS (disabled, "Coming soon") — a
 * locked design decision. SMS is inert: it never becomes selectable from this screen,
 * there's no SMS enrollment path behind it yet.
 *
 * Flow: enroll() gets a QR + secret for a brand-new unverified TOTP factor, then
 * challenge() immediately so a challengeId is ready the moment the user finishes typing
 * their first code — only verify() actually activates the factor.
 */
export default function MfaEnroll() {
  const { t } = useTranslation();
  const theme = useTheme();

  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [qrXml, setQrXml] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const handleVerified = useCallback(() => {
    void logAccountEvent('user_mfa_enable');
    // verify() on enrollment elevates the session straight to aal2 (no separate
    // aal2 challenge is pending afterward), so the gate won't bounce this back to
    // (auth)/mfa-challenge. router.replace('/') hands control back to the gate, which
    // continues the normal onboarding flow (role picker, etc.) from here — same exit
    // shape as verify-success's own "Skip for now".
    router.replace('/');
  }, []);
  const { code, setCode, verifyError } = useMfaAutoVerify(factorId, challengeId, t, handleVerified);

  useEffect(() => {
    // Guards against React's dev double-invoke re-running this effect — enroll() creates
    // a new unverified factor server-side every time it's called, so this must run at
    // most once per mount, not once per effect invocation.
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
      });
      if (enrollError || !enrollData) {
        setInitError(mapAuthError(enrollError, t));
        return;
      }
      setFactorId(enrollData.id);
      setQrXml(enrollData.totp.qr_code);
      setSecret(enrollData.totp.secret);

      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: enrollData.id,
      });
      if (challengeError || !challengeData) {
        setInitError(mapAuthError(challengeError, t));
        return;
      }
      setChallengeId(challengeData.id);
    })();
  }, [t]);

  const ready = !!qrXml && !!secret && !!challengeId && !initError;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {/* MFA is offered, never forced — verify-success says as much. Without a way
            back, a user who taps "Set up two-factor" and changes their mind (or whose
            enroll() call failed) has only the Android hardware button, and nothing at
            all on iOS but the edge swipe. router.replace('/') rather than back(),
            since this screen is also reachable from Settings. */}
        <Button
          label={t('common.back')}
          variant="ghost"
          size="md"
          onPress={() => router.replace('/')}
          style={{ alignSelf: 'flex-start', marginBottom: theme.space[2] }}
        />
        <Text variant="h1" style={{ marginBottom: theme.space[2] }}>
          {t('auth.mfaEnroll.title')}
        </Text>
        <Text tone="secondary" style={{ marginBottom: theme.space[5] }}>
          {t('auth.mfaEnroll.subtitle')}
        </Text>

        <View style={{ marginBottom: theme.space[5] }}>
          <SegmentedPill
            items={[
              { label: t('auth.mfaEnroll.authenticator'), value: 'totp' },
              {
                label: t('auth.mfaEnroll.sms'),
                value: 'sms',
                disabled: true,
                disabledLabel: t('auth.mfaEnroll.smsComingSoon'),
              },
            ]}
            selected="totp"
            // SMS is disabled and never selectable from this screen — there is
            // deliberately nothing for onChange to switch to.
            onChange={() => {}}
          />
        </View>

        {initError ? (
          <View style={{ marginBottom: theme.space[4] }}>
            <Banner variant="danger" message={initError} />
          </View>
        ) : null}

        {!ready && !initError ? (
          <View style={{ paddingVertical: theme.space[6] }}>
            <Spinner />
            <Text tone="muted" style={{ textAlign: 'center', marginTop: theme.space[3] }}>
              {t('auth.mfaEnroll.settingUp')}
            </Text>
          </View>
        ) : null}

        {ready ? (
          <>
            <Text tone="secondary" style={{ marginBottom: theme.space[3] }}>
              {t('auth.mfaEnroll.qrInstructions')}
            </Text>
            <View
              style={{
                alignSelf: 'center',
                width: QR_SIZE,
                height: QR_SIZE,
                marginBottom: theme.space[5],
                // Deliberately hardcoded, not a theme token: a QR code needs a light
                // background to scan reliably regardless of app theme, and no role in
                // semantic.ts is fixed-white in both schemes (onAccent/onPrimary both
                // flip per-scheme) — this is the one place white genuinely means white.
                backgroundColor: '#fff',
                borderRadius: theme.radius.md,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {qrXml ? <SvgXml xml={qrXml} width={QR_SIZE} height={QR_SIZE} /> : null}
            </View>

            <Text tone="muted" style={{ marginBottom: theme.space[2] }}>
              {t('auth.mfaEnroll.manualEntryLabel')}
            </Text>
            <Text
              numeric
              selectable
              style={{
                fontSize: 16,
                letterSpacing: 1,
                marginBottom: theme.space[5],
                textAlign: 'center',
              }}
            >
              {secret}
            </Text>

            <View style={{ marginBottom: theme.space[5] }}>
              <Banner variant="warn" message={t('auth.mfaEnroll.recoveryWarning')} />
            </View>

            {verifyError ? (
              <View style={{ marginBottom: theme.space[4] }}>
                <Banner variant="danger" message={verifyError} />
              </View>
            ) : null}

            <Text tone="secondary" style={{ marginBottom: theme.space[3] }}>
              {t('auth.mfaEnroll.codeLabel')}
            </Text>
            <View style={{ marginBottom: theme.space[6] }}>
              <CodeCells code={code} />
            </View>
            <NumericKeypad
              onKey={(digit) => setCode((c) => (c.length < 6 ? c + digit : c))}
              onDelete={() => setCode((c) => c.slice(0, -1))}
            />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

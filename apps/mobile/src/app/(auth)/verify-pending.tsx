import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, View } from 'react-native';
import { mapAuthError } from '../../lib/auth/authErrors';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, Screen, Text } from '../../ui';

/** Matches Supabase's `otp_expiry = 1800` (Task 2 config) — 30 minutes. */
const OTP_EXPIRY_MINUTES = 30;
/** Client-side floor, independent of Supabase's own [auth.rate_limit] (2/hour default) —
 * gives clear feedback and keeps taps from hammering that server-side limit. */
const RESEND_COOLDOWN_SECONDS = 60;

/** Same opacity-pulse technique as ui/Skeleton.tsx, adapted for a pill rather than a rectangle. */
function WaitingPill({ label }: { label: string }) {
  const t = useTheme();
  const [opacity] = useState(() => new Animated.Value(0.55));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      accessible
      accessibilityLabel={label}
      style={{
        opacity,
        alignSelf: 'center',
        paddingHorizontal: t.space[4],
        paddingVertical: t.space[2],
        borderRadius: t.radius.pill,
        backgroundColor: t.colors.accentSurfaceSoft,
      }}
    >
      <Text
        numeric
        style={{
          color: t.colors.onAccentSurfaceSoft,
          fontSize: 12,
          fontWeight: '700',
          letterSpacing: 1.5,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
    </Animated.View>
  );
}

export default function VerifyPending() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ email?: string | string[] }>();
  const email = Array.isArray(params.email) ? params.email[0] : (params.email ?? '');

  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCooldown((seconds) => {
        if (seconds <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
  }

  /**
   * Manual fallback only. The normal path (verifying via this device's own deep link)
   * is handled entirely by lib/deepLinks.ts + the root gate reacting to SIGNED_IN — this
   * screen never has to notice that on its own. This button re-checks the session for
   * the case where verification happened elsewhere (another device, another tab).
   */
  async function handleContinue() {
    setNotice(null);
    setChecking(true);
    const { data } = await supabase.auth.getSession();
    setChecking(false);

    if (data.session) {
      router.push('/(auth)/verify-success');
    } else {
      setNotice(t('auth.verifyPending.stillPending'));
    }
  }

  async function handleResend() {
    if (cooldown > 0 || !email) return;
    setNotice(null);
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    startCooldown();
    if (error) {
      setNotice(mapAuthError(error, t));
    } else {
      setNotice(t('auth.verifyPending.resent'));
    }
  }

  return (
    <Screen>
      <View
        accessible
        accessibilityLabel={t('auth.verifyPending.mailIcon')}
        style={{
          width: 64,
          height: 64,
          borderRadius: theme.radius.xl,
          backgroundColor: theme.colors.accentSurfaceSoft,
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'center',
          marginBottom: theme.space[6],
        }}
      >
        <Text style={{ color: theme.colors.onAccentSurfaceSoft, fontSize: 28 }}>✉</Text>
      </View>

      <Text variant="h2" style={{ textAlign: 'center', marginBottom: theme.space[2] }}>
        {t('auth.verifyPending.title')}
      </Text>
      <Text variant="body" tone="secondary" style={{ textAlign: 'center' }}>
        {t('auth.verifyPending.body')}
      </Text>
      <Text
        variant="bodyBold"
        style={{ textAlign: 'center', marginTop: theme.space[1], marginBottom: theme.space[2] }}
      >
        {email}
      </Text>
      <Text
        variant="caption"
        tone="muted"
        style={{ textAlign: 'center', marginBottom: theme.space[6] }}
      >
        {t('auth.verifyPending.expiry', { minutes: OTP_EXPIRY_MINUTES })}
      </Text>

      <WaitingPill label={t('auth.verifyPending.waiting')} />

      {notice ? (
        <Text
          variant="caption"
          tone="secondary"
          style={{ textAlign: 'center', marginTop: theme.space[4] }}
        >
          {notice}
        </Text>
      ) : null}

      <Button
        label={t('auth.verifyPending.continue')}
        size="lg"
        onPress={handleContinue}
        disabled={checking}
        style={{ marginTop: theme.space[7] }}
      />

      <Button
        label={
          cooldown > 0
            ? t('auth.verifyPending.resendCooldown', { seconds: cooldown })
            : t('auth.verifyPending.resend')
        }
        variant="ghost"
        onPress={handleResend}
        disabled={cooldown > 0}
        style={{ marginTop: theme.space[3] }}
      />

      <Button
        label={t('auth.verifyPending.changeEmail')}
        variant="ghost"
        onPress={() => router.replace('/(auth)/sign-up')}
        style={{ marginTop: theme.space[1] }}
      />
    </Screen>
  );
}

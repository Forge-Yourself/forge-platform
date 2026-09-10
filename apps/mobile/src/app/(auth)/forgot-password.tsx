import { forgotPasswordSchema } from '@forge/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, Pressable, View } from 'react-native';
import { mapAuthError } from '../../lib/auth/authErrors';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, Button, FormScreen, Text, TextField } from '../../ui';

/** Matches Supabase's `otp_expiry = 1800` (Task 2 config) — 30 minutes. */
const OTP_EXPIRY_MINUTES = 30;

export default function ForgotPassword() {
  const { t } = useTranslation();
  const theme = useTheme();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // The glyph, not just its position, flips: a plain mirrored layout would still point
  // the wrong way. RTL "back" reads right, so the chevron itself swaps to '›'.
  const backGlyph = I18nManager.isRTL ? '›' : '‹';

  async function handleSubmit() {
    setRateLimitError(null);
    const result = forgotPasswordSchema.safeParse({ email });
    if (!result.success) {
      setEmailError(result.error.issues[0]?.message);
      return;
    }
    setEmailError(undefined);
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(result.data.email);
    setSubmitting(false);

    // Confirmation reads identically whether or not the address exists — never branch
    // this copy on the error, except for a rate limit, which isn't account-specific and
    // so doesn't leak anything about whether the address has an account.
    if (error?.code === 'over_email_send_rate_limit' || error?.code === 'over_request_rate_limit') {
      setRateLimitError(mapAuthError(error, t));
      return;
    }
    setSubmitted(true);
  }

  return (
    <FormScreen>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        onPress={() => router.back()}
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: theme.touchTarget, gap: 4 }}
      >
        <Text style={{ fontSize: 20 }}>{backGlyph}</Text>
        <Text tone="secondary">{t('common.back')}</Text>
      </Pressable>

      {submitted ? (
        <View style={{ marginTop: theme.space[6] }}>
          <Text variant="h2" style={{ marginBottom: theme.space[3] }}>
            {t('auth.forgotPassword.title')}
          </Text>
          <Banner variant="success" message={t('auth.forgotPassword.confirmation')} />
        </View>
      ) : (
        <View style={{ marginTop: theme.space[6] }}>
          <Text variant="h2" style={{ marginBottom: theme.space[2] }}>
            {t('auth.forgotPassword.title')}
          </Text>
          <Text
            variant="body"
            tone="secondary"
            style={{ marginBottom: theme.space[6] }}
          >
            {t('auth.forgotPassword.subtitle', { minutes: OTP_EXPIRY_MINUTES })}
          </Text>

          {rateLimitError ? (
            <View style={{ marginBottom: theme.space[4] }}>
              <Banner variant="danger" message={rateLimitError} />
            </View>
          ) : null}

          <TextField
            label={t('auth.forgotPassword.emailLabel')}
            value={email}
            onChangeText={setEmail}
            error={emailError}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="username"
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          <Button
            label={t('auth.forgotPassword.submit')}
            size="lg"
            onPress={handleSubmit}
            disabled={submitting}
            style={{ marginTop: theme.space[3] }}
          />
        </View>
      )}
    </FormScreen>
  );
}

import { signInSchema } from '@forge/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { logAccountEvent } from '../../lib/auth/audit';
import { mapAuthError } from '../../lib/auth/authErrors';
import { runOAuthSignIn } from '../../lib/auth/oauth';
import { useAsyncSubmit } from '../../lib/forms/useAsyncSubmit';
import { zodIssuesToFieldErrors } from '../../lib/forms/zodFieldErrors';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, Button, Divider, FormScreen, Text, TextField, TextLink, Wordmark } from '../../ui';

type FieldErrors = Partial<Record<'email' | 'password', string>>;

/**
 * Sign-in only calls signInWithPassword() and logs the audit event on success — it never
 * navigates itself. The root gate (app/_layout.tsx, Task 6) reacts to the resulting
 * SIGNED_IN auth event and routes onward (MFA challenge, onboarding, or the app).
 */
export default function SignIn() {
  const { t } = useTranslation();
  const theme = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const { submitting, error: formError, setError: setFormError, run } = useAsyncSubmit();

  async function handleSubmit() {
    setFormError(null);
    const result = signInSchema.safeParse({ email, password });
    if (!result.success) {
      setFieldErrors(zodIssuesToFieldErrors<'email' | 'password'>(result.error.issues));
      return;
    }

    setFieldErrors({});
    await run(async () => {
      const { error } = await supabase.auth.signInWithPassword(result.data);

      if (error) {
        // invalid_credentials reads identically whether the email exists or not —
        // see mapAuthError's doc comment. Never branch this copy on account existence.
        setFormError(mapAuthError(error, t));
        return;
      }

      void logAccountEvent('user_login');
    });
  }

  async function handleGoogleSignIn() {
    await runOAuthSignIn('google', run, setFormError, t);
  }

  return (
    <FormScreen
      footer={
        <TextLink
          prefix={t('auth.signIn.noAccountPrefix')}
          action={t('auth.signIn.noAccountAction')}
          onPress={() => router.push('/(auth)/sign-up')}
        />
      }
    >
      {/* The artboard centres the whole block in the viewport rather than stacking it
          from the top: sign-in is the one screen with nothing else on it, and the
          fields land under the thumb instead of up by the status bar. */}
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {/* FORGE is the heading here, not decoration above one — hence the wordmark's
            `type` variant (letterspaced lettering, no mark tile) and "Welcome back."
            as a 15px subtitle under it rather than an h1 of its own. */}
        <Wordmark variant="type" size={34} />
        <Text tone="secondary" style={{ fontSize: 15, marginTop: 6, marginBottom: 26 }}>
          {t('auth.signIn.title')}
        </Text>

        {formError ? (
          <View style={{ marginBottom: theme.space[4] }}>
            <Banner variant="danger" message={formError} />
          </View>
        ) : null}

        <TextField
          label={t('auth.signIn.emailLabel')}
          value={email}
          onChangeText={setEmail}
          error={fieldErrors.email}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="username"
          returnKeyType="next"
        />
        <TextField
          label={t('auth.signIn.passwordLabel')}
          value={password}
          onChangeText={setPassword}
          error={fieldErrors.password}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password"
          textContentType="password"
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />

        <Button
          label={t('auth.signIn.submit')}
          size="lg"
          loading={submitting}
          onPress={handleSubmit}
          style={{ marginTop: 22 }}
        />

        {/* A link, not a third bordered box: the screen had one accent CTA sitting on
            three identical ghost buttons, which made "Forgot password" look like a
            peer of "Sign in". */}
        <Button
          label={t('auth.signIn.forgotPassword')}
          variant="link"
          onPress={() => router.push('/(auth)/forgot-password')}
          style={{ alignSelf: 'center', marginTop: theme.space[1] }}
        />

        {/* The artboard predates Google sign-in and has no slot for it. Rather than
            drop a shipped M1 provider to match a mockup, it goes below a labelled
            rule — which also keeps the screen to one ember CTA. */}
        <View style={{ marginVertical: theme.space[5] }}>
          <Divider label={t('auth.orDivider')} />
        </View>

        <Button
          label={t('auth.google.continue')}
          variant="ghost"
          onPress={handleGoogleSignIn}
          disabled={submitting}
        />
      </View>
    </FormScreen>
  );
}

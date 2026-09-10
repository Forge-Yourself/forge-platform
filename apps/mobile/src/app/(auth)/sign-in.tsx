import { signInSchema } from '@forge/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { logAccountEvent } from '../../lib/auth/audit';
import { mapAuthError } from '../../lib/auth/authErrors';
import { signInWithProvider } from '../../lib/auth/oauth';
import { useAsyncSubmit } from '../../lib/forms/useAsyncSubmit';
import { zodIssuesToFieldErrors } from '../../lib/forms/zodFieldErrors';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, Button, FormScreen, Text, TextField } from '../../ui';

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
    setFormError(null);
    await run(async () => {
      const outcome = await signInWithProvider('google');
      if (outcome.type === 'error') {
        setFormError(mapAuthError(outcome.error, t));
        return;
      }
      if (outcome.type === 'cancelled') {
        // User closed the browser without finishing — nothing to report.
        return;
      }
      void logAccountEvent('user_login');
      // No navigation here: a successful exchangeCodeForSession() fires the
      // SIGNED_IN auth event same as password sign-in, and the root gate
      // (app/_layout.tsx) reacts to it and routes onward.
    });
  }

  return (
    <FormScreen
      footer={
        <Button
          label={t('auth.signIn.noAccount')}
          variant="ghost"
          onPress={() => router.push('/(auth)/sign-up')}
        />
      }
    >
      <Text
        tone="accent"
        style={{ fontSize: 34, fontWeight: '900', letterSpacing: 7, marginBottom: theme.space[6] }}
      >
        FORGE
      </Text>
      <Text variant="h1" style={{ marginBottom: theme.space[6] }}>
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
        onPress={handleSubmit}
        disabled={submitting}
        style={{ marginTop: theme.space[3] }}
      />

      <Button
        label={t('auth.signIn.forgotPassword')}
        variant="ghost"
        onPress={() => router.push('/(auth)/forgot-password')}
        style={{ marginTop: theme.space[3] }}
      />

      <Button
        label={t('auth.google.continue')}
        variant="ghost"
        onPress={handleGoogleSignIn}
        disabled={submitting}
        style={{ marginTop: theme.space[5] }}
      />
    </FormScreen>
  );
}

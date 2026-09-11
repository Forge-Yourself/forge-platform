import { passwordStrength, signUpSchema } from '@forge/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { mapAuthError } from '../../lib/auth/authErrors';
import { runOAuthSignIn } from '../../lib/auth/oauth';
import { useAsyncSubmit } from '../../lib/forms/useAsyncSubmit';
import { zodIssuesToFieldErrors } from '../../lib/forms/zodFieldErrors';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, Button, FormScreen, PasswordStrength, Text, TextField } from '../../ui';

type Field = 'fullName' | 'email' | 'password' | 'acceptedTerms';
type FieldErrors = Partial<Record<Field, string>>;
type Touched = Partial<Record<Field, boolean>>;

/**
 * `role` is not collected here — it's picked post-verification on (onboarding)/role
 * (Task 10), which calls set_initial_role() to correct it. `'client'` is passed to
 * signUp()'s options.data.role purely to satisfy handle_new_user()'s trigger, matching
 * the trigger's own least-privileged fallback (0002_supabase_auth.sql).
 */
const SIGNUP_ROLE = 'client' as const;

/**
 * consent_analytics / consent_marketing: the prototype's sign-up mockup shows a single
 * terms checkbox, no separate marketing/analytics toggles. Rather than add UI the
 * mockup doesn't show (and that we can't persist immediately anyway — signUp() with
 * email confirmation on returns no session, so an RLS-gated UPDATE to public.users
 * can't run until the user is back with a session post-verification), this screen
 * relies on the column defaults (FALSE) and leaves both consents editable later in
 * Settings (Task 11). Documented per the plan's "your call" note on Step 2.
 */
export default function SignUp() {
  const { t } = useTranslation();
  const theme = useTheme();
  // Prefilled from a /join deep link (M2, lib/deepLinks.ts) — a convenience,
  // not a lock; the client can still edit it. Linking itself happens by
  // verified-email match (claim_client_invites()), not by this param.
  const params = useLocalSearchParams<{ email?: string }>();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [touched, setTouched] = useState<Touched>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const { submitting, error: formError, setError: setFormError, run } = useAsyncSubmit();

  function currentInput() {
    return {
      email,
      password,
      displayName: fullName,
      role: SIGNUP_ROLE,
      acceptedTerms,
    };
  }

  /** Validates the whole form but only writes errors for fields passed in `onlyFields` (or all, on submit). */
  function validate(onlyFields?: Field[]): boolean {
    const result = signUpSchema.safeParse(currentInput());
    if (result.success) {
      setFieldErrors((prev) => {
        if (!onlyFields) return {};
        const next = { ...prev };
        for (const f of onlyFields) delete next[f];
        return next;
      });
      return true;
    }

    const errors = zodIssuesToFieldErrors<Field>(result.error.issues, (key) =>
      key === 'displayName' ? 'fullName' : key === 'acceptedTerms' ? 'acceptedTerms' : (key as Field),
    );

    setFieldErrors((prev) => {
      if (!onlyFields) return errors;
      const next = { ...prev };
      for (const f of onlyFields) {
        if (errors[f]) next[f] = errors[f];
        else delete next[f];
      }
      return next;
    });
    return false;
  }

  function handleBlur(field: Field) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    validate([field]);
  }

  async function handleSubmit() {
    setFormError(null);
    setTouched({ fullName: true, email: true, password: true, acceptedTerms: true });
    if (!validate()) return;

    await run(async () => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            role: SIGNUP_ROLE,
            display_name: fullName,
          },
        },
      });

      if (error) {
        setFormError(mapAuthError(error, t));
        return;
      }

      router.push({ pathname: '/(auth)/verify-pending', params: { email } });
    });
  }

  /**
   * Unlike password sign-up, OAuth returns a session immediately (no
   * email-confirmation step) — runOAuthSignIn's success path fires SIGNED_IN, and the
   * root gate reacts by routing to (onboarding)/role, since onboarding_completed is
   * false for every brand-new user regardless of provider (Task 6's gate).
   */
  async function handleGoogleSignIn() {
    await runOAuthSignIn('google', run, setFormError, t);
  }

  const strength = password.length > 0 ? passwordStrength(password) : 0;

  return (
    <FormScreen
      footer={
        <Button
          label={t('auth.signUp.haveAccount')}
          variant="ghost"
          onPress={() => router.push('/(auth)/sign-in')}
        />
      }
    >
      <Text variant="h1" style={{ marginBottom: theme.space[2] }}>
        {t('auth.signUp.title')}
      </Text>
      <Text variant="body" tone="secondary" style={{ marginBottom: theme.space[6] }}>
        {t('auth.signUp.subtitle')}
      </Text>

      {formError ? (
        <View style={{ marginBottom: theme.space[4] }}>
          <Banner variant="danger" message={formError} />
        </View>
      ) : null}

      <TextField
        label={t('auth.signUp.fullNameLabel')}
        value={fullName}
        onChangeText={setFullName}
        onBlur={() => handleBlur('fullName')}
        error={touched.fullName ? fieldErrors.fullName : undefined}
        autoCapitalize="words"
        textContentType="name"
        returnKeyType="next"
      />
      <TextField
        label={t('auth.signUp.emailLabel')}
        value={email}
        onChangeText={setEmail}
        onBlur={() => handleBlur('email')}
        error={touched.email ? fieldErrors.email : undefined}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="username"
        returnKeyType="next"
      />
      <TextField
        label={t('auth.signUp.passwordLabel')}
        value={password}
        onChangeText={setPassword}
        onBlur={() => handleBlur('password')}
        error={touched.password ? fieldErrors.password : undefined}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="password-new"
        textContentType="newPassword"
        returnKeyType="done"
      />
      {password.length > 0 ? (
        <View style={{ marginTop: -8, marginBottom: theme.space[4] }}>
          <PasswordStrength strength={strength} />
        </View>
      ) : null}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: acceptedTerms }}
        accessibilityLabel={t('auth.signUp.termsLabel')}
        onPress={() => {
          setAcceptedTerms((v) => !v);
          setTouched((prev) => ({ ...prev, acceptedTerms: true }));
          validate(['acceptedTerms']);
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: theme.touchTarget,
          gap: theme.space[3],
          marginTop: theme.space[2],
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: theme.radius.sm,
            borderWidth: 1.5,
            borderColor: acceptedTerms ? theme.colors.accent : theme.colors.borderStrong,
            backgroundColor: acceptedTerms ? theme.colors.accent : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {acceptedTerms ? (
            <Text style={{ color: theme.colors.onAccent, fontSize: 14, fontWeight: '700' }}>✓</Text>
          ) : null}
        </View>
        <Text variant="body" style={{ flex: 1 }}>
          {t('auth.signUp.termsLabel')}
        </Text>
      </Pressable>
      {touched.acceptedTerms && fieldErrors.acceptedTerms ? (
        <Text style={{ color: theme.colors.dangerAccent, fontSize: 12, marginTop: theme.space[1] }}>
          {fieldErrors.acceptedTerms}
        </Text>
      ) : null}

      <Button
        label={t('auth.signUp.submit')}
        size="lg"
        onPress={handleSubmit}
        disabled={submitting}
        style={{ marginTop: theme.space[5] }}
      />

      <Button
        label={t('auth.google.continue')}
        variant="ghost"
        onPress={handleGoogleSignIn}
        disabled={submitting}
        style={{ marginTop: theme.space[4] }}
      />
    </FormScreen>
  );
}

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
import {
  Banner,
  Button,
  Divider,
  FormScreen,
  Icon,
  PasswordStrength,
  Text,
  TextField,
  TextLink,
} from '../../ui';

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
      const { data, error } = await supabase.auth.signUp({
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

      // Which screen comes next depends on whether email confirmation is enabled on
      // the project, so branch on what signUp() actually returned rather than
      // assuming. Confirmation ON -> no session; the user has to come back through
      // the emailed deep link, and verify-pending is the screen that waits for it.
      // Confirmation OFF (supabase/config.toml, while Resend has no verified sender
      // domain) -> the session lands right here, and pushing to verify-pending would
      // strand the user on a "check your inbox" screen for mail that is never sent.
      //
      // The root gate can't rescue that: its signed-in branch renders any (auth)
      // route as-is (app/_layout.tsx, the onboarding_completed === false carve-out),
      // so a screen that changes gate state has to navigate itself. replace, not
      // push — signup is a state-changing submit and must not sit on the back stack.
      // '/' is where verify-success's "Skip for now" goes too; the gate takes it from
      // there to (onboarding)/role.
      if (data.session) {
        router.replace('/');
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
        <TextLink
          prefix={t('auth.signUp.haveAccountPrefix')}
          action={t('auth.signUp.haveAccountAction')}
          onPress={() => router.push('/(auth)/sign-in')}
        />
      }
    >
      {/* No wordmark here: sign-in is the screen that introduces the brand, and the
          artboard opens this one on the task instead. 26/800 is its own title size —
          smaller than h1, because it sits above a form rather than alone. */}
      <Text
        accessibilityRole="header"
        style={{ fontSize: 26, fontWeight: '800', letterSpacing: -0.4 }}
      >
        {t('auth.signUp.title')}
      </Text>
      <Text tone="secondary" style={{ fontSize: 14, marginTop: 4, marginBottom: 22 }}>
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
        <View style={{ marginTop: -8, marginBottom: 20 }}>
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
          // flex-start, not centre: the terms line wraps to two lines at 360dp and a
          // centred box then floats against the middle of the paragraph.
          alignItems: 'flex-start',
          minHeight: theme.touchTarget,
          gap: theme.space[3],
          marginTop: theme.space[2],
        }}
      >
        <View
          style={{
            width: 20,
            height: 20,
            marginTop: 1,
            borderRadius: 5,
            borderWidth: 1.5,
            borderColor: acceptedTerms ? theme.colors.accent : theme.colors.borderStrong,
            backgroundColor: acceptedTerms ? theme.colors.accent : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {acceptedTerms ? (
            <Icon name="check" size={12} color={theme.colors.onAccent} strokeWidth={3} />
          ) : null}
        </View>
        <Text style={{ flex: 1, fontSize: 13, lineHeight: 20 }}>
          {t('auth.signUp.termsLabel')}
        </Text>
      </Pressable>
      {touched.acceptedTerms && fieldErrors.acceptedTerms ? (
        <Text style={{ color: theme.colors.dangerAccent, fontSize: 12, marginTop: theme.space[1] }}>
          {fieldErrors.acceptedTerms}
        </Text>
      ) : null}

      {/* Pushes the CTA to the foot of the viewport when the form is short, per the
          artboard's `margin-bottom:auto` on the terms row — FormScreen's ScrollView
          already sets flexGrow so the spacer has somewhere to grow into. */}
      <View style={{ flexGrow: 1, minHeight: theme.space[5] }} />

      <Button
        label={t('auth.signUp.submit')}
        size="lg"
        loading={submitting}
        onPress={handleSubmit}
        style={{ marginTop: 22 }}
      />

      <View style={{ marginVertical: theme.space[5] }}>
        <Divider label={t('auth.orDivider')} />
      </View>

      <Button
        label={t('auth.google.continue')}
        variant="ghost"
        onPress={handleGoogleSignIn}
        disabled={submitting}
      />
    </FormScreen>
  );
}

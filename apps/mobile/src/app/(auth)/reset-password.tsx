import { resetPasswordSchema } from '@forge/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { logAccountEvent } from '../../lib/auth/audit';
import { mapAuthError } from '../../lib/auth/authErrors';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, Button, FormScreen, Text, TextField } from '../../ui';

type FieldErrors = { password?: string; confirmPassword?: string };

/**
 * Reached ONLY through the recovery deep link (lib/deepLinks.ts already verified the
 * OTP and navigated here — by the time this renders, a session already exists). No
 * navigation happens from this screen on success: the session stays live with a real
 * password now set, and the root gate reacts and routes onward as normal.
 */
export default function ResetPassword() {
  const { t } = useTranslation();
  const theme = useTheme();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const passwordsMatch =
    password.length > 0 && confirmPassword.length > 0 && password === confirmPassword;

  async function handleSubmit() {
    setFormError(null);
    const result = resetPasswordSchema.safeParse({ password, confirmPassword });
    if (!result.success) {
      const errors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (key === 'password' && !errors.password) errors.password = issue.message;
        if (key === 'confirmPassword' && !errors.confirmPassword) errors.confirmPassword = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    const { error: updateError } = await supabase.auth.updateUser({ password: result.data.password });
    if (updateError) {
      setSubmitting(false);
      setFormError(mapAuthError(updateError, t));
      return;
    }

    // Signs out every OTHER session, keeps this one — the copy above already warned
    // about this before the tap, so no confirm dialog here.
    await supabase.auth.signOut({ scope: 'others' });
    void logAccountEvent('user_password_change');
    setSubmitting(false);
    // No manual navigation: session is still live, gate reacts as normal.
  }

  return (
    <FormScreen>
      <Text variant="h2" style={{ marginBottom: theme.space[2] }}>
        {t('auth.resetPassword.title')}
      </Text>
      <View style={{ marginBottom: theme.space[5] }}>
        <Banner variant="warn" message={t('auth.resetPassword.warning')} />
      </View>

      {formError ? (
        <View style={{ marginBottom: theme.space[4] }}>
          <Banner variant="danger" message={formError} />
        </View>
      ) : null}

      <TextField
        label={t('auth.resetPassword.passwordLabel')}
        value={password}
        onChangeText={setPassword}
        error={fieldErrors.password}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="password-new"
        textContentType="newPassword"
        returnKeyType="next"
      />
      <TextField
        label={t('auth.resetPassword.confirmLabel')}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        error={fieldErrors.confirmPassword}
        success={passwordsMatch}
        helperText={passwordsMatch ? t('auth.resetPassword.match') : undefined}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="password-new"
        textContentType="newPassword"
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
      />

      <Button
        label={t('auth.resetPassword.submit')}
        size="lg"
        onPress={handleSubmit}
        disabled={submitting}
        style={{ marginTop: theme.space[3] }}
      />
    </FormScreen>
  );
}

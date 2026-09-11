import { inviteClientSchema } from '@forge/shared';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share } from 'react-native';
import { inviteClient } from '../../../lib/clients/clientActions';
import { useAsyncSubmit } from '../../../lib/forms/useAsyncSubmit';
import { zodIssuesToFieldErrors } from '../../../lib/forms/zodFieldErrors';
import { joinInviteUrl } from '../../../lib/webHost';
import { useTheme } from '../../../theme/ThemeProvider';
import { Banner, Button, FormScreen, Text, TextField } from '../../../ui';

type Field = 'name' | 'email';

/**
 * Invite a client — "link first, email second" per the annotation: Copy link
 * is the accent action, Share invite is ghost (only one accent button per
 * section). Success state shows both, plus the expiry/single-use copy stated
 * directly in the sheet rather than buried in help.
 */
export default function InviteClient() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const { submitting, error, setError, run } = useAsyncSubmit();
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  function validate(): boolean {
    const result = inviteClientSchema.safeParse({
      email,
      name: name.trim() || undefined,
    });
    if (result.success) {
      setFieldErrors({});
      return true;
    }
    setFieldErrors(zodIssuesToFieldErrors<Field>(result.error.issues));
    return false;
  }

  async function handleSubmit() {
    setError(null);
    if (!validate()) return;

    await run(async () => {
      try {
        await inviteClient(email.trim().toLowerCase(), name.trim() || undefined, []);
        setSentEmail(email.trim().toLowerCase());
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        setError(
          message.includes('already pending') ? t('clients.invite.duplicateError') : t('clients.invite.error'),
        );
      }
    });
  }

  async function handleCopyLink() {
    if (!sentEmail) return;
    await Clipboard.setStringAsync(joinInviteUrl(sentEmail));
    setLinkCopied(true);
  }

  async function handleShare() {
    if (!sentEmail) return;
    await Share.share({ message: joinInviteUrl(sentEmail) });
  }

  if (sentEmail) {
    return (
      <FormScreen
        footer={<Button label={t('common.close')} onPress={() => router.replace('/(app)/clients/index')} />}
      >
        <Text variant="h1" style={{ marginBottom: theme.space[2] }}>
          {t('clients.invite.successTitle')}
        </Text>
        <Text tone="secondary" style={{ marginBottom: theme.space[5] }}>
          {t('clients.invite.successBody', { name: name.trim() || sentEmail })}
        </Text>

        <Button label={t('clients.invite.copyLink')} onPress={() => void handleCopyLink()} style={{ marginBottom: theme.space[3] }} />
        {linkCopied ? (
          <Text tone="secondary" style={{ marginBottom: theme.space[3] }}>
            {t('clients.invite.linkCopied')}
          </Text>
        ) : null}
        <Button label={t('clients.invite.sendInvite')} variant="ghost" onPress={() => void handleShare()} />

        <Text tone="muted" style={{ marginTop: theme.space[5] }}>
          {t('clients.invite.expiryNote')}
        </Text>
        <Text tone="muted">{t('clients.invite.singleUseNote')}</Text>
      </FormScreen>
    );
  }

  return (
    <FormScreen
      footer={
        <Button
          label={submitting ? t('intake.submitting') : t('clients.invite.title')}
          onPress={() => void handleSubmit()}
          disabled={submitting}
        />
      }
    >
      <Text variant="h1" style={{ marginBottom: theme.space[5] }}>
        {t('clients.invite.title')}
      </Text>

      {error ? <Banner variant="danger" message={error} /> : null}

      <TextField
        label={t('clients.invite.nameLabel')}
        placeholder={t('clients.invite.namePlaceholder')}
        value={name}
        onChangeText={setName}
        error={fieldErrors.name}
      />
      <TextField
        label={t('clients.invite.emailLabel')}
        placeholder={t('clients.invite.emailPlaceholder')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        error={fieldErrors.email}
      />

      <Text tone="muted" style={{ marginTop: theme.space[3] }}>
        {t('clients.invite.expiryNote')}
      </Text>
      <Text tone="muted">{t('clients.invite.singleUseNote')}</Text>
    </FormScreen>
  );
}

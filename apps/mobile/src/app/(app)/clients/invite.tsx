import { inviteClientSchema } from '@forge/shared';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, Share, View } from 'react-native';
import { inviteClient } from '../../../lib/clients/clientActions';
import { useAsyncSubmit } from '../../../lib/forms/useAsyncSubmit';
import { zodIssuesToFieldErrors } from '../../../lib/forms/zodFieldErrors';
import { joinInviteUrl } from '../../../lib/webHost';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Banner,
  Button,
  Card,
  FooterBar,
  Icon,
  NavHeader,
  Row,
  Screen,
  SectionLabel,
  Text,
  TextField,
} from '../../../ui';

type Field = 'name' | 'email';

/**
 * Invite a client — "link first, email second" per the annotation: the PT is the
 * delivery mechanism (invite_client() writes a row and an audit entry; it
 * dispatches nothing), so the link is the product of this screen and Copy is its
 * one accent action.
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
      <Screen padded={false}>
        <NavHeader
          title={t('clients.invite.successTitle')}
          trailing={
            <Button
              label={t('common.done')}
              variant="link"
              onPress={() => router.replace('/(app)/(tabs)/clients')}
            />
          }
        />
        <ScrollView contentContainerStyle={{ padding: theme.space[5], gap: theme.space[4] }}>
          <Row style={{ gap: theme.space[3] }}>
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: theme.colors.successSurface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="check" size={19} color={theme.colors.onSuccessSurface} strokeWidth={2.4} />
            </View>
            <Text tone="secondary" style={{ flex: 1, fontSize: 13.5, lineHeight: 20 }}>
              {t('clients.invite.successBody', { name: name.trim() || sentEmail })}
            </Text>
          </Row>

          <View style={{ gap: theme.space[2] }}>
            <SectionLabel>{t('clients.invite.copyLink')}</SectionLabel>
            <Card style={{ gap: theme.space[3] }}>
              <View
                style={{
                  padding: theme.space[3],
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surfaceSunken,
                }}
              >
                <Text numeric numberOfLines={1} tone="secondary" style={{ fontSize: 12 }}>
                  {joinInviteUrl(sentEmail)}
                </Text>
              </View>
              <Row style={{ gap: theme.space[2] }}>
                <Button
                  label={linkCopied ? t('clients.invite.linkCopied') : t('clients.invite.copyLink')}
                  icon={linkCopied ? 'check' : 'copy'}
                  onPress={() => void handleCopyLink()}
                  style={{ flex: 1 }}
                />
                <Button
                  label={t('common.share')}
                  icon="share"
                  variant="ghost"
                  onPress={() => void handleShare()}
                  style={{ flex: 1 }}
                />
              </Row>
              <Text tone="muted" style={{ fontSize: 12, lineHeight: 18 }}>
                {t('clients.invite.expiryNote')} {t('clients.invite.singleUseNote')}
              </Text>
            </Card>
          </View>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <NavHeader
        title={t('clients.invite.title')}
        leading={<Button label={t('common.cancel')} variant="link" onPress={() => router.back()} />}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: theme.space[5], gap: theme.space[2] }}
          keyboardShouldPersistTaps="handled"
        >
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
            onSubmitEditing={() => void handleSubmit()}
          />

          {/* invite_client() writes a row and an audit entry; it dispatches nothing.
              The PT is the delivery mechanism, so the screen says so before they tap
              rather than leaving them waiting for an email that was never sent. */}
          <Card style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'flex-start' }}>
            <Icon name="inbox" size={19} color={theme.colors.textMuted} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text tone="secondary" style={{ fontSize: 13, lineHeight: 19 }}>
                {t('clients.invite.noEmailNote')}
              </Text>
              <Text tone="muted" style={{ fontSize: 12, lineHeight: 18 }}>
                {t('clients.invite.expiryNote')} {t('clients.invite.singleUseNote')}
              </Text>
            </View>
          </Card>
        </ScrollView>

        <FooterBar>
          <Button
            label={t('clients.invite.submit')}
            size="lg"
            loading={submitting}
            disabled={email.trim() === ''}
            onPress={() => void handleSubmit()}
          />
        </FooterBar>
      </KeyboardAvoidingView>
    </Screen>
  );
}

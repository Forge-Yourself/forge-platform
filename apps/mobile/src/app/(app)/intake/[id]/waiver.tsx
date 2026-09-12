import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useAsyncSubmit } from '../../../../lib/forms/useAsyncSubmit';
import { supabase } from '../../../../lib/supabase';
import { WEB_HOST } from '../../../../lib/webHost';
import { useTheme } from '../../../../theme/ThemeProvider';
import { Banner, Button, FormScreen, SignaturePad, Text } from '../../../../ui';

/**
 * Waiver e-signature. Body copy at 13px/1.65 per the annotation — legal text
 * still has to clear 4.5:1, so `tone="secondary"` (the same role
 * `tokens.test.ts` already verifies at ≥4.5:1 in both schemes). Submit stays
 * disabled until the pad has ink; on failure the signature is left intact so
 * the client doesn't have to re-sign.
 */
export default function Waiver() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const [signature, setSignature] = useState('');
  const { submitting, error, setError, run } = useAsyncSubmit();

  async function handleSubmit() {
    if (!params.id) return;
    setError(null);
    await run(async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error('not signed in');

        const res = await fetch(`${WEB_HOST}/api/waiver`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ intakeFormId: params.id, signatureSvgPath: signature }),
        });
        if (!res.ok) throw new Error('waiver submit failed');

        router.push({ pathname: '/(app)/intake/done', params: { id: params.id } });
      } catch {
        setError(t('waiver.submitError'));
      }
    });
  }

  return (
    <FormScreen
      footer={
        <Button
          label={submitting ? t('waiver.submitting') : t('waiver.submit')}
          size="lg"
          onPress={() => void handleSubmit()}
          disabled={submitting || !signature}
        />
      }
    >
      <View style={{ gap: theme.space[4] }}>
        <Text variant="h1">{t('waiver.title')}</Text>

        {error ? <Banner variant="danger" message={error} /> : null}

        <Text tone="secondary" style={{ fontSize: 13, lineHeight: 21 }}>
          {t('waiver.body')}
        </Text>

        <Text variant="label" tone="muted">
          {t('waiver.signatureLabel')}
        </Text>
        <SignaturePad
          value={signature}
          onChange={setSignature}
          onClear={() => setSignature('')}
          clearLabel={t('waiver.clear')}
        />
        <Text tone="muted" variant="caption">
          {t('waiver.signatureInstructions')}
        </Text>
        {!signature ? (
          <Text tone="muted" variant="caption">
            {t('waiver.submitDisabledNote')}
          </Text>
        ) : null}
      </View>
    </FormScreen>
  );
}

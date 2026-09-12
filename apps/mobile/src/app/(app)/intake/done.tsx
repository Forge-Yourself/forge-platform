import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { openWaiverDocument } from '../../../lib/intake/openWaiver';
import { useAsyncSubmit } from '../../../lib/forms/useAsyncSubmit';
import { useTheme } from '../../../theme/ThemeProvider';
import { Banner, Button, ListRow, SectionCard, Screen, Text } from '../../../ui';

/**
 * Signed confirmation — reuses `verify-success.tsx`'s success-circle visual
 * rather than inventing a second success pattern. Two exits: back to home
 * (the client has no "back to a list" analog to the PT's, per the annotation
 * reasoning adapted to the client's actual navigation), or view the document.
 */
export default function IntakeDone() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const { error, setError, run } = useAsyncSubmit();

  async function handleView() {
    if (!params.id) return;
    setError(null);
    await run(async () => {
      try {
        await openWaiverDocument(params.id!);
      } catch {
        setError(t('waiver.submitError'));
      }
    });
  }

  return (
    <Screen>
      <View
        accessible
        accessibilityLabel={t('waiver.done.title')}
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          backgroundColor: theme.colors.successSurface,
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'center',
          marginBottom: theme.space[6],
        }}
      >
        <Text style={{ color: theme.colors.onSuccessSurface, fontSize: 34, fontWeight: '700' }}>✓</Text>
      </View>

      <Text variant="h2" style={{ textAlign: 'center', marginBottom: theme.space[3] }}>
        {t('waiver.done.title')}
      </Text>
      <Text tone="secondary" style={{ textAlign: 'center', marginBottom: theme.space[6] }}>
        {t('waiver.done.subtitle')}
      </Text>

      {error ? <Banner variant="danger" message={error} /> : null}

      {params.id ? (
        <SectionCard>
          <ListRow
            title={t('waiver.done.documentTitle')}
            subtitle={t('waiver.done.documentSubtitle', { date: new Date().toLocaleDateString() })}
            trailing={<Button label={t('waiver.done.viewDocument')} variant="ghost" onPress={() => void handleView()} />}
          />
        </SectionCard>
      ) : null}

      <Button
        label={t('waiver.done.backToHome')}
        size="lg"
        onPress={() => router.replace('/')}
        style={{ marginTop: theme.space[6] }}
      />
    </Screen>
  );
}

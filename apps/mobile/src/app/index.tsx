import { isRTL, type Locale } from '@forge/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, ScrollView, StyleSheet } from 'react-native';
import { setLocale } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Card, Row, Screen, Text } from '../ui';

type Reachability = 'checking' | 'ok' | 'failed';

export default function Boot() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [reachability, setReachability] = useState<Reachability>('checking');

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from('users')
      .select('id', { head: true, count: 'exact' })
      .then(({ error }) => {
        if (!cancelled) setReachability(error ? 'failed' : 'ok');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const locale = i18n.language as Locale;
  const next: Locale = locale === 'ar' ? 'en' : 'ar';

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: theme.space[4] }}>
        <Text variant="display" tone="accent">
          FORGE
        </Text>
        <Text variant="h3" tone="secondary">
          {t('boot.tagline')}
        </Text>

        <Card>
          <Text variant="label" tone="muted">
            {t('boot.status')}
          </Text>
          <Row style={styles.between}>
            <Text tone="secondary">{t('boot.scheme')}</Text>
            <Text numeric>
              {theme.scheme === 'dark' ? t('boot.schemeDark') : t('boot.schemeLight')}
            </Text>
          </Row>
          <Row style={styles.between}>
            <Text tone="secondary">{t('boot.direction')}</Text>
            <Text numeric>
              {I18nManager.isRTL ? 'RTL' : 'LTR'}
              {isRTL(locale) === I18nManager.isRTL ? '' : ' · reload'}
            </Text>
          </Row>
          <Row style={styles.between}>
            <Text tone="secondary">{t('boot.connection')}</Text>
            <Text numeric tone={reachability === 'failed' ? 'primary' : 'secondary'}>
              {reachability === 'checking'
                ? t('boot.connectionChecking')
                : reachability === 'ok'
                  ? t('boot.connectionOk')
                  : t('boot.connectionFailed')}
            </Text>
          </Row>
        </Card>

        <Card>
          <Text variant="label" tone="muted">
            {t('boot.language')}
          </Text>
          <Button label={t('boot.switchLanguage')} onPress={() => void setLocale(next)} />
        </Card>

        <Card>
          <Text variant="display">Aa</Text>
          <Text variant="h1">{t('boot.tagline')}</Text>
          <Text variant="h2">Push day · Week 3</Text>
          <Text variant="h3">Bench Press</Text>
          <Text>Two more sets. You&apos;ve got this.</Text>
          <Text variant="bodyBold">Maya Khoury · Week 4 · Day 2</Text>
          <Text variant="caption" tone="muted">
            Logged 6 minutes ago
          </Text>
          <Text variant="h2" numeric>
            80 kg × 8 @ RPE 8
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
});

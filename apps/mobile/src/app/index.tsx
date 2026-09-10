import { isRTL, passwordStrength, type Locale } from '@forge/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, ScrollView, StyleSheet } from 'react-native';
import { setLocale } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeProvider';
import {
  Banner,
  Button,
  Card,
  ChipRow,
  ChoiceCard,
  CodeCells,
  ListRow,
  NumericKeypad,
  PasswordStrength,
  Row,
  Screen,
  SectionCard,
  SegmentedPill,
  Skeleton,
  Spinner,
  StepProgress,
  Text,
  TextField,
  Toggle,
} from '../ui';

type Reachability = 'checking' | 'ok' | 'failed';

// --- Task 5 temporary scaffolding -------------------------------------------------------
// Renders every M1 primitive once so the set can be statically checked (typecheck + lint +
// bundle) without a simulator. Task 6 restructures this screen into route groups — clean
// this block out then, or sooner if a dedicated primitives-preview screen is added first.
function PrimitivesDemo() {
  const theme = useTheme();
  const [role, setRole] = useState<'pt' | 'client'>('pt');
  const [mfaTab, setMfaTab] = useState('authenticator');
  const [services, setServices] = useState<string[]>(['Strength']);
  const [notify, setNotify] = useState(true);
  const [code, setCode] = useState('123');

  return (
    <Card>
      <Text variant="label" tone="muted">
        Primitives demo (temporary — Task 5 scaffolding)
      </Text>

      <Button label="Continue (lg)" size="lg" onPress={() => {}} />
      <Button label="Continue (md)" size="md" onPress={() => {}} />

      <TextField
        label="Email"
        placeholder="you@example.com"
        textContentType="emailAddress"
        autoComplete="email"
      />
      <TextField
        label="Password"
        placeholder="••••••••"
        secureTextEntry
        textContentType="password"
        autoComplete="password"
        error="Password must be at least 8 characters"
      />

      <PasswordStrength strength={passwordStrength('Abcdefghijk1!')} />

      <NumericKeypad onKey={(d) => setCode((c) => (c + d).slice(0, 6))} onDelete={() => setCode((c) => c.slice(0, -1))} />
      <CodeCells code={code} />

      <SegmentedPill
        items={[
          { label: 'Authenticator', value: 'authenticator' },
          { label: 'SMS', value: 'sms', disabled: true, disabledLabel: 'Coming soon' },
        ]}
        selected={mfaTab}
        onChange={setMfaTab}
      />

      <SectionCard>
        <ListRow title="Notifications" subtitle="Push and email" trailing={<Text tone="accent">On ›</Text>} onPress={() => {}} />
        <ListRow title="Language" subtitle="English" onPress={() => {}} />
        <ListRow title="App version" trailing={<Text tone="muted">1.0.0</Text>} />
      </SectionCard>

      <StepProgress progress={0.5} label="Step 2 of 4" />

      <ChoiceCard
        title="I'm a personal trainer"
        subtitle="Manage clients, programs, payments."
        selected={role === 'pt'}
        onPress={() => setRole('pt')}
      />
      <ChoiceCard
        title="I train with a coach"
        subtitle="Track my workouts and progress."
        selected={role === 'client'}
        onPress={() => setRole('client')}
      />

      <ChipRow
        options={['Strength', 'Mobility', 'Nutrition']}
        selected={services}
        onToggle={(o) =>
          setServices((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]))
        }
      />

      <Toggle label="Enable notifications" value={notify} onValueChange={setNotify} />

      <Banner variant="info" message="Your changes save automatically." />
      <Banner variant="success" message="Profile updated." />
      <Banner variant="warn" message="You're offline — changes will sync later." />
      <Banner variant="danger" message="Could not verify your code." />

      <Row style={{ gap: theme.space[3] }}>
        <Spinner />
        <Skeleton width={120} height={16} />
      </Row>
    </Card>
  );
}
// --- end temporary scaffolding -----------------------------------------------------------

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

        <PrimitivesDemo />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
});

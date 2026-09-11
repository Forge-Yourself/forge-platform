import { isRTL, type Database, type Locale } from '@forge/shared';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, ScrollView, StyleSheet } from 'react-native';
import { useAuth } from '../../lib/auth/AuthProvider';
import { claimClientInvites } from '../../lib/intake/claimInvites';
import { openWaiverDocument } from '../../lib/intake/openWaiver';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, Button, Card, ListRow, Row, SectionCard, Screen, Text } from '../../ui';

type Reachability = 'checking' | 'ok' | 'failed';
type ClientRow = Database['public']['Tables']['clients']['Row'];
type IntakeFormRow = Database['public']['Tables']['intake_forms']['Row'];
type PtInfo = { display_name: string; avatar_url: string | null };

/** Signed-in PT home placeholder. Real dashboard content lands in later milestones. */
function PtHome() {
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

        <Button label={t('clients.title')} onPress={() => router.push('/(app)/clients/index')} />

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

type ClientHomeState = {
  loading: boolean;
  client: ClientRow | null;
  ptInfo: PtInfo | null;
  intake: IntakeFormRow | null;
};

/**
 * Signed-in client home — PT name, an intake status card that is itself the
 * entry point (start/resume/waiting/waiver/done), and the signed waiver as a
 * downloadable row once it exists. No logging, programs, or metrics here —
 * those are M3/M4.
 */
function ClientHome() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const [state, setState] = useState<ClientHomeState>({
    loading: true,
    client: null,
    ptInfo: null,
    intake: null,
  });
  const [emailCopied, setEmailCopied] = useState(false);
  const [waiverError, setWaiverError] = useState<string | null>(null);

  // Inlined with .then() (not a separately-defined callback) so every setState
  // call stays visible to the linter inside this effect body — same
  // react-hooks/set-state-in-effect constraint documented in
  // usePtProfileData.ts and lib/clients/useClientList.ts.
  useEffect(() => {
    let cancelled = false;
    void claimClientInvites()
      .catch(() => {
        // Best-effort — a failed claim just means the client sees the
        // no-trainer-yet state below, which already has its own recovery copy.
      })
      .then(async () => {
        const { data: client } = await supabase
          .from('clients')
          .select('*')
          .eq('client_user_id', auth.user?.id ?? '')
          .maybeSingle();

        if (!client) {
          if (!cancelled) setState({ loading: false, client: null, ptInfo: null, intake: null });
          return;
        }

        const [{ data: ptInfo }, { data: intake }] = await Promise.all([
          supabase.from('users').select('display_name, avatar_url').eq('id', client.pt_user_id).maybeSingle(),
          supabase.from('intake_forms').select('*').eq('client_id', client.id).maybeSingle(),
        ]);

        if (!cancelled) {
          setState({ loading: false, client, ptInfo: ptInfo ?? null, intake: intake ?? null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auth.user?.id]);

  async function handleCopyEmail() {
    if (!auth.user?.email) return;
    await Clipboard.setStringAsync(auth.user.email);
    setEmailCopied(true);
  }

  async function handleOpenWaiver() {
    if (!state.intake) return;
    setWaiverError(null);
    try {
      await openWaiverDocument(state.intake.id);
    } catch {
      setWaiverError(t('waiver.submitError'));
    }
  }

  if (state.loading) {
    return (
      <Screen>
        <Text tone="muted">{t('common.retry')}</Text>
      </Screen>
    );
  }

  if (!state.client) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ gap: theme.space[4] }}>
          <Text variant="h1">{t('clientHome.noTrainerTitle')}</Text>
          <Text tone="secondary">{t('clientHome.noTrainerBody')}</Text>
          <Text variant="bodyBold" numeric>
            {auth.user?.email}
          </Text>
          <Button label={t('clientHome.copyEmail')} onPress={() => void handleCopyEmail()} />
          {emailCopied ? <Text tone="secondary">{t('clientHome.emailCopied')}</Text> : null}
        </ScrollView>
      </Screen>
    );
  }

  const intakeState = state.intake?.state ?? 'pending';
  const waiverSigned = intakeState === 'waiver_signed';
  const needsWaiver = intakeState === 'completed' || intakeState === 'red_flag_review';

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: theme.space[4] }}>
        <Text variant="h1">{t('clientHome.greeting', { name: auth.user?.display_name ?? '' })}</Text>

        <Card>
          <Text variant="label" tone="muted">
            {t('clientHome.trainerLabel')}
          </Text>
          <Text variant="h3">{state.ptInfo?.display_name ?? '—'}</Text>
        </Card>

        {waiverError ? <Banner variant="danger" message={waiverError} /> : null}

        {intakeState === 'pending' ? (
          <Card>
            <Text variant="h3">{t('clientHome.intake.notStarted')}</Text>
            <Text tone="secondary">{t('clientHome.intake.notStartedBody')}</Text>
            <Button
              label={t('clientHome.intake.startButton')}
              onPress={() =>
                state.intake &&
                router.push({ pathname: '/(app)/intake/[id]', params: { id: state.intake.id } })
              }
            />
          </Card>
        ) : intakeState === 'in_progress' ? (
          <Card>
            <Text variant="h3">{t('clientHome.intake.inProgress')}</Text>
            <Button
              label={t('clientHome.intake.resumeButton')}
              onPress={() =>
                state.intake &&
                router.push({ pathname: '/(app)/intake/[id]', params: { id: state.intake.id } })
              }
            />
          </Card>
        ) : needsWaiver ? (
          <Card>
            <Text variant="h3">{t('clientHome.intake.signWaiver')}</Text>
            <Button
              label={t('clientHome.intake.signWaiverButton')}
              onPress={() =>
                state.intake &&
                router.push({ pathname: '/(app)/intake/[id]/waiver', params: { id: state.intake.id } })
              }
            />
          </Card>
        ) : null}

        {waiverSigned && state.intake ? (
          <SectionCard>
            <ListRow
              title={t('clientHome.waiver.rowTitle')}
              subtitle={
                state.intake.signed_at
                  ? t('clientHome.waiver.rowSubtitle', {
                      date: new Date(state.intake.signed_at).toLocaleDateString(),
                    })
                  : undefined
              }
              onPress={() => void handleOpenWaiver()}
            />
          </SectionCard>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function Home() {
  const auth = useAuth();
  return auth.user?.role === 'client' ? <ClientHome /> : <PtHome />;
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
});

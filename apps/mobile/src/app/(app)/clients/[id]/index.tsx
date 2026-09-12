import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../../lib/auth/AuthProvider';
import { resendInvite, revokeInvite, setClientState } from '../../../../lib/clients/clientActions';
import { useClientDetail } from '../../../../lib/clients/useClientDetail';
import { useAsyncSubmit } from '../../../../lib/forms/useAsyncSubmit';
import { useTheme } from '../../../../theme/ThemeProvider';
import { Banner, Button, Card, ListRow, Row, SectionCard, Screen, Spinner, Text } from '../../../../ui';

type ConfirmAction = 'pause' | 'deactivate' | 'reactivate' | 'revoke';

/**
 * PT client detail — red-flag banner above the stats (warn, not danger, per
 * the annotation), essentials from `intakeSummary()`, intake status that
 * shows counts only while pending/in_progress and never response content
 * (the UI-side half of Task 1's RLS guarantee), and state actions behind an
 * inline confirm card (same pattern as settings' MFA-unenroll confirm).
 */
export default function ClientDetail() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const params = useLocalSearchParams<{ id: string }>();
  const unitSystem = (auth.user?.unit_system as 'metric' | 'imperial') ?? 'metric';
  const { loading, error, client, clientUser, intake, progress, summary, refetch } = useClientDetail(
    params.id,
    unitSystem,
  );
  const { submitting, error: actionError, setError: setActionError, run } = useAsyncSubmit();
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  if (loading) {
    return (
      <Screen>
        <Spinner />
      </Screen>
    );
  }

  if (error || !client) {
    return (
      <Screen>
        <Banner variant="danger" message={error ?? 'Not found'} />
      </Screen>
    );
  }

  const displayName = clientUser?.display_name ?? client.invite_name ?? client.invite_email ?? '—';
  const flagCount = intake?.red_flags && Array.isArray(intake.red_flags) ? intake.red_flags.length : 0;
  const hasSubmittedIntake = intake !== null;
  const waiverSigned = intake?.state === 'waiver_signed';
  const startSessionEnabled = hasSubmittedIntake;

  async function handleConfirm() {
    if (!confirmAction) return;
    setActionError(null);
    await run(async () => {
      try {
        if (confirmAction === 'revoke') {
          await revokeInvite(client!.id);
          router.replace('/(app)/(tabs)/clients');
          return;
        }
        const targetState = confirmAction === 'pause' ? 'paused' : confirmAction === 'deactivate' ? 'deactivated' : 'active';
        await setClientState(client!.id, targetState);
        await refetch();
      } catch {
        setActionError(t('clients.detail.actionError'));
      } finally {
        setConfirmAction(null);
      }
    });
  }

  async function handleResend() {
    setActionError(null);
    await run(async () => {
      try {
        await resendInvite(client!.id);
        await refetch();
      } catch {
        setActionError(t('clients.detail.actionError'));
      }
    });
  }

  const confirmCopy: Record<ConfirmAction, { title: string; body?: string }> = {
    pause: { title: t('clients.detail.pauseConfirmTitle'), body: t('clients.detail.pauseConfirmBody') },
    deactivate: {
      title: t('clients.detail.deactivateConfirmTitle'),
      body: t('clients.detail.deactivateConfirmBody'),
    },
    reactivate: { title: t('clients.detail.reactivateConfirmTitle') },
    revoke: { title: t('clients.detail.revokeConfirmTitle'), body: t('clients.detail.revokeConfirmBody') },
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: theme.space[4] }}>
        <Text variant="h1">{displayName}</Text>
        <Text tone="secondary">{t(`clients.stateLabels.${client.state}`)}</Text>

        {flagCount > 0 ? (
          <Banner
            variant="warn"
            message={t(flagCount === 1 ? 'clients.detail.redFlagBanner_one' : 'clients.detail.redFlagBanner_other', {
              count: flagCount,
            })}
          />
        ) : null}

        {actionError ? <Banner variant="danger" message={actionError} /> : null}

        {summary ? (
          <Card>
            <Text variant="label" tone="muted">
              {t('clients.detail.essentialsTitle')}
            </Text>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text tone="secondary">{t('clients.detail.ageLabel')}</Text>
              <Text numeric>{summary.ageYears ?? '—'}</Text>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text tone="secondary">{t('clients.detail.sexLabel')}</Text>
              <Text>{summary.sex ?? '—'}</Text>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text tone="secondary">{t('clients.detail.heightLabel')}</Text>
              <Text numeric>{summary.height ?? '—'}</Text>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text tone="secondary">{t('clients.detail.weightLabel')}</Text>
              <Text numeric>{summary.weight ?? '—'}</Text>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text tone="secondary">{t('clients.detail.goalLabel')}</Text>
              <Text>{summary.primaryGoal ?? '—'}</Text>
            </Row>
          </Card>
        ) : null}

        <SectionCard>
          <ListRow
            title={t('clients.detail.intakeTitle')}
            subtitle={
              !progress
                ? t('clients.detail.intakeNotStarted')
                : hasSubmittedIntake
                  ? t(`clients.stateLabels.${client.state}`)
                  : t('clients.detail.intakeProgress', {
                      answered: progress.answeredSections,
                      total: progress.totalSections,
                    })
            }
            trailing={
              hasSubmittedIntake ? (
                <Button
                  label={t('clients.detail.reviewIntake')}
                  variant="ghost"
                  onPress={() =>
                    router.push({ pathname: '/(app)/clients/[id]/intake', params: { id: client.id } })
                  }
                />
              ) : undefined
            }
            isLast={!waiverSigned}
          />
          {waiverSigned ? (
            <ListRow title={t('clients.detail.waiverSigned')} isLast />
          ) : hasSubmittedIntake ? (
            <ListRow title={t('clients.detail.waiverUnsigned')} isLast />
          ) : null}
        </SectionCard>

        {client.state === 'invited' ? (
          <Row style={{ gap: theme.space[3] }}>
            <Button
              label={t('clients.detail.resendInvite')}
              variant="ghost"
              onPress={() => void handleResend()}
              disabled={submitting}
              style={{ flex: 1 }}
            />
            <Button
              label={t('clients.detail.revokeInvite')}
              variant="ghost"
              onPress={() => setConfirmAction('revoke')}
              disabled={submitting}
              style={{ flex: 1 }}
            />
          </Row>
        ) : null}

        {client.state === 'active' || client.state === 'accepted' ? (
          <Button label={t('clients.detail.pause')} variant="ghost" onPress={() => setConfirmAction('pause')} />
        ) : null}
        {client.state === 'paused' ? (
          <Button
            label={t('clients.detail.reactivate')}
            variant="ghost"
            onPress={() => setConfirmAction('reactivate')}
          />
        ) : null}
        {client.state !== 'deactivated' && client.state !== 'invited' ? (
          <Button
            label={t('clients.detail.deactivate')}
            variant="ghost"
            onPress={() => setConfirmAction('deactivate')}
          />
        ) : null}
        {client.state === 'deactivated' ? (
          <Button
            label={t('clients.detail.reactivate')}
            variant="ghost"
            onPress={() => setConfirmAction('reactivate')}
          />
        ) : null}

        {confirmAction ? (
          <Card style={{ borderColor: theme.colors.dangerAccent, gap: theme.space[3] }}>
            <Text variant="bodyBold">{confirmCopy[confirmAction].title}</Text>
            {confirmCopy[confirmAction].body ? (
              <Text tone="secondary">{confirmCopy[confirmAction].body}</Text>
            ) : null}
            <Row style={{ gap: theme.space[3] }}>
              <Button
                label={t('common.cancel')}
                variant="ghost"
                onPress={() => setConfirmAction(null)}
                style={{ flex: 1 }}
              />
              <Button
                label={t('clients.detail.confirm')}
                onPress={() => void handleConfirm()}
                disabled={submitting}
                style={{ flex: 1 }}
              />
            </Row>
          </Card>
        ) : null}

        <View style={{ marginTop: theme.space[6] }}>
          <Button
            label={t('clients.detail.startSession')}
            size="lg"
            disabled={!startSessionEnabled}
            onPress={() => {
              // Session logging is M4 — this button exists now and is
              // correctly gated on submitted intake (EP-03's own acceptance
              // criterion), but there is nowhere to route it to yet.
            }}
          />
          <Text tone="muted" style={{ marginTop: theme.space[2] }}>
            {startSessionEnabled
              ? t('clients.detail.startSessionComingSoon')
              : t('clients.detail.startSessionBlocked')}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

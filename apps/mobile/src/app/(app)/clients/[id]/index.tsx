import { weekCompletion } from '@forge/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../../lib/auth/AuthProvider';
import { resendInvite, revokeInvite, setClientState } from '../../../../lib/clients/clientActions';
import { useClientDetail } from '../../../../lib/clients/useClientDetail';
import { useAsyncSubmit } from '../../../../lib/forms/useAsyncSubmit';
import { SessionList } from '../../../../lib/logging/SessionList';
import { StartSessionSheet } from '../../../../lib/logging/StartSessionSheet';
import { useSessionHistory } from '../../../../lib/logging/useSessionHistory';
import { useClientActiveProgram } from '../../../../lib/programs/useClientActiveProgram';
import { useTheme } from '../../../../theme/ThemeProvider';
import {
  Avatar,
  Banner,
  Button,
  Card,
  FooterBar,
  Icon,
  ListRow,
  NavHeader,
  Row,
  Screen,
  SectionCard,
  SectionLabel,
  Skeleton,
  Spinner,
  StatTile,
  Tag,
  Text,
} from '../../../../ui';

type ConfirmAction = 'pause' | 'deactivate' | 'reactivate' | 'revoke';

/**
 * intakeSummary() converts height and weight into the PT's unit system but returns a
 * bare number, so this card was rendering "175" and "72" with nothing to say which
 * system they were in — which makes the conversion worse than useless to a PT who has
 * switched it. The unit comes from the same setting the conversion did.
 */
function withUnit(value: number | null, unit: string): string {
  return value === null ? '—' : `${value} ${unit}`;
}

/** "Feb 26" — a stat tile has room for a month and a two-digit year, not a full date. */
function shortMonthYear(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

/**
 * The red-flag card.
 *
 * This was a plain one-line Banner, which put the single most important thing on
 * the screen — the reason the PT opened it before session one — at the same visual
 * weight as a form-validation message and gave it nothing to tap. It is warn, not
 * danger: the flags need reading, not panic.
 */
function RedFlagCard({ count, onReview }: { count: number; onReview: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[4],
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.warnSurface,
      }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: theme.colors.warnAccent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* `surface`, not `warnSurface`: the tinted chip fills are translucent in dark
            mode, so drawing the glyph in one on top of the solid warn disc left it
            invisible. The screen ground is the one value guaranteed to contrast with
            warnAccent in both schemes. */}
        <Icon name="warning" size={16} color={theme.colors.surface} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '700', color: theme.colors.onWarnSurface }}>
          {t('clients.detail.redFlagTitle', { count })}
        </Text>
        <Text style={{ fontSize: 12, color: theme.colors.onWarnSurface }}>
          {t('clients.detail.redFlagBody')}
        </Text>
      </View>
      <Button
        label={t('clients.detail.redFlagAction')}
        variant="link"
        onPress={onReview}
        style={{ paddingHorizontal: theme.space[2] }}
      />
    </View>
  );
}

/**
 * PT client detail — red-flag card above the stats (warn, not danger, per
 * the annotation), essentials from `intakeSummary()`, intake status that
 * shows counts only while pending/in_progress and never response content
 * (the UI-side half of M2's RLS guarantee), and state actions behind an
 * inline confirm card (same pattern as settings' MFA-unenroll confirm).
 *
 * "Start session" is pinned to the foot of the screen rather than sitting at the
 * bottom of the scroll body, where a client with a full intake pushed it two
 * screens down.
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
  const program = useClientActiveProgram(params.id);
  const { submitting, error: actionError, setError: setActionError, run } = useAsyncSubmit();
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  // Last 3 for the preview; the "See all" route reads the full 50.
  const sessions = useSessionHistory(params.id, 3);
  // The footer becomes Resume rather than Start when one of them is still
  // running — starting again would only hand back the same row anyway
  // (start_workout_session resumes), and this says so before the tap.
  const inProgress = sessions.items.find((s) => s.status === 'in_progress') ?? null;

  const back = (
    <Button
      label={t('clients.title')}
      icon="chevronBack"
      variant="link"
      onPress={() => router.back()}
    />
  );

  // Gated on the program fetch too. Without it the body painted while that
  // query was still in flight, so the Week tile showed "—" and the header
  // subtitle silently omitted the program name before both popped in — a
  // mid-week-3 client indistinguishable from an unprogrammed one.
  if (loading || program.loading) {
    return (
      <Screen padded={false}>
        <NavHeader leading={back} divider={false} />
        <Spinner />
      </Screen>
    );
  }

  if (error || !client) {
    return (
      <Screen padded={false}>
        <NavHeader leading={back} divider={false} />
        <View style={{ padding: theme.space[4] }}>
          <Banner variant="danger" message={error ?? t('clients.offlineError.body')} />
        </View>
      </Screen>
    );
  }

  const displayName = clientUser?.display_name ?? client.invite_name ?? client.invite_email ?? '—';
  const flagCount = intake?.red_flags && Array.isArray(intake.red_flags) ? intake.red_flags.length : 0;
  const hasSubmittedIntake = intake !== null;
  const waiverSigned = intake?.state === 'waiver_signed';
  const startSessionEnabled = hasSubmittedIntake;

  const clientProgram = program.program;
  const programWeek = clientProgram
    ? weekCompletion(
        { duration_weeks: clientProgram.duration_weeks, start_date: clientProgram.start_date },
        new Date(),
      ).currentWeek
    : null;

  const intakeStat = hasSubmittedIntake
    ? t('clients.detail.stats.intakeDone')
    : progress
      ? `${progress.answeredSections}/${progress.totalSections}`
      : t('clients.detail.stats.none');

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
        const targetState =
          confirmAction === 'pause' ? 'paused' : confirmAction === 'deactivate' ? 'deactivated' : 'active';
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

  const essentials: { label: string; value: string }[] = summary
    ? [
        { label: t('clients.detail.ageLabel'), value: String(summary.ageYears ?? '—') },
        { label: t('clients.detail.sexLabel'), value: summary.sex ?? '—' },
        {
          label: t('clients.detail.heightLabel'),
          value: withUnit(summary.height, t(unitSystem === 'imperial' ? 'units.inch' : 'units.cm')),
        },
        {
          label: t('clients.detail.weightLabel'),
          value: withUnit(summary.weight, t(unitSystem === 'imperial' ? 'units.lb' : 'units.kg')),
        },
        { label: t('clients.detail.goalLabel'), value: summary.primaryGoal ?? '—' },
      ]
    : [];

  return (
    <Screen padded={false}>
      <NavHeader leading={back} divider={false} />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.space[4],
          paddingBottom: theme.space[5],
          gap: theme.space[4],
        }}
      >
        <Row style={{ gap: theme.space[4], paddingHorizontal: 4 }}>
          <Avatar name={displayName} photoUrl={clientUser?.avatar_url} size={60} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={{ fontSize: 21, fontWeight: '800', letterSpacing: -0.3 }}
            >
              {displayName}
            </Text>
            <Text tone="muted" style={{ fontSize: 13 }}>
              {t('clients.stateLabels.' + client.state)}
              {clientProgram ? ` · ${clientProgram.name}` : ''}
            </Text>
          </View>
        </Row>

        {flagCount > 0 ? (
          <RedFlagCard
            count={flagCount}
            onReview={() =>
              router.push({ pathname: '/(app)/clients/[id]/intake', params: { id: client.id } })
            }
          />
        ) : null}

        {actionError ? <Banner variant="danger" message={actionError} /> : null}
        {/* A failed program fetch used to be indistinguishable from "no program
            assigned": the Week tile read "—" and the name vanished, with no
            banner anywhere on the screen to say a request had failed. */}
        {program.error ? <Banner variant="danger" message={t('clients.offlineError.body')} /> : null}

        <Row style={{ gap: theme.space[2], alignItems: 'stretch' }}>
          <StatTile label={t('clients.detail.stats.since')} value={shortMonthYear(client.created_at)} />
          <StatTile
            label={t('clients.detail.stats.week')}
            value={programWeek === null ? t('clients.detail.stats.none') : String(programWeek)}
          />
          <StatTile
            label={t('clients.detail.stats.intake')}
            value={intakeStat}
            tone={hasSubmittedIntake ? 'neutral' : 'accent'}
          />
        </Row>

        {essentials.length > 0 ? (
          <View style={{ gap: theme.space[2] }}>
            <SectionLabel>{t('clients.detail.essentialsTitle')}</SectionLabel>
            <SectionCard>
              {essentials.map((entry, index) => (
                <ListRow
                  key={entry.label}
                  minHeight={48}
                  title={entry.label}
                  chevron={false}
                  isLast={index === essentials.length - 1}
                  trailing={
                    <Text numeric style={{ fontSize: 14, fontWeight: '600' }}>
                      {entry.value}
                    </Text>
                  }
                />
              ))}
            </SectionCard>
          </View>
        ) : null}

        <View style={{ gap: theme.space[2] }}>
          <SectionLabel>{t('clients.detail.intakeTitle')}</SectionLabel>
          <SectionCard>
            <ListRow
              title={t('clients.detail.intakeTitle')}
              subtitle={
                !progress
                  ? t('clients.detail.intakeNotStarted')
                  : hasSubmittedIntake
                    ? undefined
                    : t('clients.detail.intakeProgress', {
                        answered: progress.answeredSections,
                        total: progress.totalSections,
                      })
              }
              chevron={hasSubmittedIntake}
              onPress={
                hasSubmittedIntake
                  ? () => router.push({ pathname: '/(app)/clients/[id]/intake', params: { id: client.id } })
                  : undefined
              }
              trailing={
                hasSubmittedIntake ? (
                  <Tag label={t('clients.detail.stats.intakeDone')} tone="success" />
                ) : undefined
              }
              isLast={!hasSubmittedIntake}
            />
            {hasSubmittedIntake ? (
              <ListRow
                leading={<Icon name="document" size={19} color={theme.colors.textMuted} />}
                title={t('clients.detail.waiverHeading')}
                chevron={false}
                trailing={
                  <Tag
                    label={
                      waiverSigned
                        ? t('clients.detail.waiverTagSigned')
                        : t('clients.detail.waiverTagUnsigned')
                    }
                    tone={waiverSigned ? 'success' : 'warn'}
                  />
                }
                isLast
              />
            ) : null}
          </SectionCard>
        </View>

        <View style={{ gap: theme.space[2] }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionLabel>{t('clients.detail.sessionsHeading')}</SectionLabel>
            {sessions.items.length > 0 ? (
              <Button
                label={t('common.seeAll')}
                variant="link"
                onPress={() =>
                  router.push({ pathname: '/(app)/clients/[id]/sessions', params: { id: client.id } })
                }
              />
            ) : null}
          </Row>
          {sessions.items.length > 0 ? (
            <SessionList items={sessions.items} limit={3} />
          ) : sessions.loading ? (
            // Not `isEmpty ? empty : list`: while the first fetch is in flight
            // items is [] and isEmpty is false, which rendered an empty bordered
            // card — a SectionCard with no rows in it.
            <Skeleton height={64} radius={14} />
          ) : (
            <Card>
              <Text tone="secondary">{t('clients.detail.sessionsEmpty')}</Text>
            </Card>
          )}
        </View>

        <View style={{ gap: theme.space[2] }}>
          <SectionLabel>{t('clients.detail.manageHeading')}</SectionLabel>
          <SectionCard>
            {client.state === 'invited' ? (
              <ListRow
                title={t('clients.detail.resendInvite')}
                onPress={() => void handleResend()}
                // The only row here that fires an RPC straight from the tap —
                // the other four just open the confirm card, whose Button maps
                // `loading` to disabled. useAsyncSubmit has no in-flight bail,
                // so without this a double tap resent the invite twice.
                disabled={submitting}
                chevron={false}
                trailing={<Icon name="mail" size={19} color={theme.colors.textMuted} />}
              />
            ) : null}
            {client.state === 'invited' ? (
              <ListRow
                title={t('clients.detail.revokeInvite')}
                onPress={() => setConfirmAction('revoke')}
                chevron={false}
                trailing={<Icon name="trash" size={19} color={theme.colors.dangerAccent} />}
                isLast
              />
            ) : null}
            {client.state === 'active' || client.state === 'accepted' ? (
              <ListRow
                title={t('clients.detail.pause')}
                onPress={() => setConfirmAction('pause')}
                chevron={false}
                trailing={<Icon name="clock" size={19} color={theme.colors.textMuted} />}
              />
            ) : null}
            {client.state === 'paused' || client.state === 'deactivated' ? (
              <ListRow
                title={t('clients.detail.reactivate')}
                onPress={() => setConfirmAction('reactivate')}
                chevron={false}
                trailing={<Icon name="check" size={19} color={theme.colors.successAccent} />}
                isLast={client.state === 'deactivated'}
              />
            ) : null}
            {client.state !== 'deactivated' && client.state !== 'invited' ? (
              <ListRow
                title={t('clients.detail.deactivate')}
                onPress={() => setConfirmAction('deactivate')}
                chevron={false}
                trailing={<Icon name="trash" size={19} color={theme.colors.dangerAccent} />}
                isLast
              />
            ) : null}
          </SectionCard>
        </View>

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
                tone="danger"
                loading={submitting}
                onPress={() => void handleConfirm()}
                style={{ flex: 1 }}
              />
            </Row>
          </Card>
        ) : null}
      </ScrollView>

      <FooterBar>
        <Button
          label={inProgress ? t('clients.detail.resumeSession') : t('clients.detail.startSession')}
          size="lg"
          disabled={!startSessionEnabled}
          onPress={() => {
            if (inProgress) {
              router.push({ pathname: '/(app)/sessions/[id]', params: { id: inProgress.id } });
            } else {
              setStartOpen(true);
            }
          }}
        />
        {/* Only the blocked caption is left. The enabled one used to read "coming
            in M4" — it has arrived, and a caption under a live CTA is noise. */}
        {!startSessionEnabled ? (
          <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            {t('clients.detail.startSessionBlocked')}
          </Text>
        ) : null}
      </FooterBar>

      <StartSessionSheet
        visible={startOpen}
        clientId={client.id}
        viewerIsPt
        onDismiss={() => setStartOpen(false)}
      />
    </Screen>
  );
}

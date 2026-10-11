import {
  bookingErrorKey, bookingState, canClientChange, canMarkNoShow, noShowUnlocksAt, seriesProgress,
  type BookingErrorCode,
} from '@forge/shared';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Avatar, Banner, BottomSheet, Button, ChipRow, EmptyState, NavHeader, Screen, SegmentedPill, Skeleton, Tag, Text,
} from '../../ui';
import { StartSessionSheet } from '../logging/StartSessionSheet';
import { useOffline } from '../offline/offlineContext';
import { dayLabel, timeLabel, untilLabel } from './format';
import { OfflineNote } from './OfflineNote';
import { cancelBooking, markNoShow, type Scope } from './scheduleApi';
import { useBookingDetail } from './useBookingDetail';
import { useNow } from './useNow';

type Sheet = 'late' | 'cancel' | 'noshow' | null;
const REASONS = ['ill', 'clash', 'travel'] as const;

/**
 * One booking, for the PT. Start session is the only accent action. No-show
 * stays locked until 15 minutes after the start and says when it unlocks.
 * Cancel inside the cutoff states time left vs. the policy first, then lets
 * the PT decide whether it counts. Destructive actions sit last.
 */
export function BookingDetailBody({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const offline = useOffline();
  const d = useBookingDetail(id);
  const now = useNow(15_000);
  const locale = i18n.language;

  const [sheet, setSheet] = useState<Sheet>(null);
  const [counted, setCounted] = useState(true);
  const [reason, setReason] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('one');
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BookingErrorCode | null>(null);

  const back = () => router.dismissTo('/(app)/(tabs)/schedule');
  const wrap = (children: ReactNode) =>
    embedded ? (
      <View style={{ flex: 1 }}>{children}</View>
    ) : (
      <Screen padded={false}>
        <NavHeader
          title={t('schedule.detail.title')}
          leading={<Button label={t('schedule.detail.back')} variant="link" icon="chevronBack" onPress={back} />}
          trailing={
            d.booking?.status === 'scheduled' && offline.online ? (
              <Button
                label={t('schedule.detail.edit')}
                variant="link"
                tone="accent"
                onPress={() => router.push({ pathname: '/(app)/schedule/[id]/edit', params: { id } })}
              />
            ) : undefined
          }
        />
        {children}
      </Screen>
    );

  if (d.loading) return wrap(<View style={{ padding: 18 }}><Skeleton height={280} radius={14} /></View>);
  if (d.error) {
    return wrap(
      <EmptyState
        icon="alert"
        tone="danger"
        title={t('schedule.detail.errorTitle')}
        body={t('schedule.detail.errorBody')}
        actionLabel={t('schedule.retry')}
        onAction={d.refetch}
      />,
    );
  }
  if (!d.booking) {
    return wrap(
      <EmptyState
        icon="calendar"
        title={t('schedule.detail.removedTitle')}
        body={t('schedule.detail.removedBody')}
        actionLabel={embedded ? undefined : t('schedule.detail.backToSchedule')}
        onAction={embedded ? undefined : back}
      />,
    );
  }

  const b = d.booking;
  const state = bookingState(b.status, d.isSelf);
  const name = d.isSelf ? t('schedule.me') : d.clientName;
  const cutoff = d.policy?.cutoffHours ?? 12;
  // For the PT, "late" is exactly when a client could no longer change it.
  const late = !canClientChange(b.starts_at, cutoff, now);
  const noShowOk = canMarkNoShow(b.starts_at, now);
  const scheduled = b.status === 'scheduled';
  const progress = d.series.length ? seriesProgress(d.series, b.starts_at) : null;
  const every = b.recurrence_rule?.includes('INTERVAL=2') ? 2 : 1;
  const writable = scheduled && offline.online && !busy;

  async function doCancel() {
    setBusy(true);
    setError(null);
    const r = await cancelBooking(b.id, scope, late ? counted : null, reason ? t(`schedule.detail.reasons.${reason}`) : null);
    setBusy(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    setSheet(null);
    d.refetch();
  }

  async function doNoShow() {
    setBusy(true);
    setError(null);
    const r = await markNoShow(b.id);
    setBusy(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    setSheet(null);
    d.refetch();
  }

  const actionRow = (label: string, sub: string | null, onPress: () => void, enabled: boolean, danger = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        opacity: enabled ? 1 : 0.5,
      }}
    >
      <Text style={{ flex: 1, fontWeight: '600', color: danger ? theme.colors.dangerAccent : theme.colors.textPrimary }}>{label}</Text>
      {sub ? (
        <Text variant="caption" tone="muted">
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );

  return wrap(
    <>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: theme.space[3], paddingBottom: theme.space[6], gap: theme.space[4] }}>
        {!offline.online ? <OfflineNote title={t('schedule.detail.offline')} body={t('schedule.detail.offlineBody')} /> : null}
        {error ? <Banner variant="danger" message={t(bookingErrorKey(error))} /> : null}
        <Tag label={t(`schedule.states.${state}`)} tone={state === 'noshow' ? 'warn' : state === 'checked' ? 'success' : state === 'booked' ? 'accent' : 'neutral'} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name={name ?? '?'} size={48} />
          <View style={{ flex: 1 }}>
            <Text variant="h3">{name ?? ''}</Text>
            <Text variant="caption" tone="muted">
              {dayLabel(b.starts_at, locale)}
            </Text>
          </View>
        </View>
        <Text numeric style={{ fontSize: 28, fontWeight: '800' }}>
          {timeLabel(b.starts_at)} – {timeLabel(b.ends_at)}
        </Text>
        {progress && progress.total > 1 ? (
          <Text tone="muted">{t('schedule.detail.repeats', { every, left: progress.left, total: progress.total })}</Text>
        ) : null}
        {d.programName && b.client_id ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => (d.isSelf ? router.push('/(app)/me') : router.push({ pathname: '/(app)/clients/[id]', params: { id: b.client_id! } }))}
            style={{ padding: 14, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceRaised, gap: 2 }}
          >
            <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: theme.colors.textMuted }}>{t('schedule.detail.program')}</Text>
            <Text style={{ fontWeight: '700' }}>{d.programName}</Text>
          </Pressable>
        ) : null}
        {scheduled && b.client_id ? (
          <Button label={t('schedule.detail.startSession')} variant="primary" size="lg" onPress={() => setStarting(true)} />
        ) : null}
        {scheduled ? (
          <View>
            {actionRow(t('schedule.detail.reschedule'), null, () => router.push({ pathname: '/(app)/schedule/[id]/edit', params: { id } }), writable)}
            {d.isSelf
              ? null
              : actionRow(
                  t('schedule.detail.noShow'),
                  noShowOk ? null : t('schedule.detail.noShowLocked', { time: timeLabel(noShowUnlocksAt(b.starts_at).toISOString()) }),
                  () => setSheet('noshow'),
                  writable && noShowOk,
                )}
            {actionRow(t('schedule.detail.cancel'), null, () => setSheet(late && !d.isSelf ? 'late' : 'cancel'), writable, true)}
          </View>
        ) : null}
      </ScrollView>

      {b.client_id ? (
        <StartSessionSheet
          visible={starting}
          clientId={b.client_id}
          viewerIsPt
          // From a pushed screen the Programs TAB must be reached by dismissing, not pushing (PITFALLS N9).
          onNoProgram={() => router.dismissTo('/(app)/(tabs)/programs')}
          onDismiss={() => setStarting(false)}
        />
      ) : null}

      <BottomSheet visible={sheet === 'cancel'} onDismiss={() => setSheet(null)} dismissLabel={t('schedule.detail.keep')}>
        <Text variant="h3">{t('schedule.detail.cancelTitle')}</Text>
        {progress && progress.left > 1 ? (
          <SegmentedPill
            items={[
              { label: t('schedule.detail.cancelScopeOne'), value: 'one' },
              { label: t('schedule.detail.cancelScopeFollowing'), value: 'following' },
            ]}
            selected={scope}
            onChange={(v) => setScope(v as Scope)}
          />
        ) : null}
        <Button label={t('schedule.detail.cancel')} variant="ghost" tone="danger" loading={busy} onPress={() => void doCancel()} />
        <Button label={t('schedule.detail.keep')} variant="link" onPress={() => setSheet(null)} />
      </BottomSheet>

      <BottomSheet visible={sheet === 'late'} onDismiss={() => setSheet(null)} dismissLabel={t('schedule.detail.keep')}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Tag tone="warn" label={t('schedule.detail.lateStarts', { time: untilLabel(Date.parse(b.starts_at) - now) })} />
          <Tag label={t('schedule.detail.lateCutoff', { hours: cutoff })} />
        </View>
        <Text variant="h3">{t('schedule.detail.lateTitle')}</Text>
        <Text tone="muted">{name ? t('schedule.detail.lateBody', { name }) : t('schedule.detail.lateBodyNoName')}</Text>
        <SegmentedPill
          items={[
            { label: t('schedule.detail.counts'), value: 'counts' },
            { label: t('schedule.detail.waive'), value: 'waive' },
          ]}
          selected={counted ? 'counts' : 'waive'}
          onChange={(v) => setCounted(v === 'counts')}
        />
        <Text variant="caption" tone="muted">
          {counted
            ? name
              ? t('schedule.detail.countsNote', { name })
              : t('schedule.detail.countsNoteNoName')
            : name
              ? t('schedule.detail.waiveNote', { name })
              : t('schedule.detail.waiveNoteNoName')}
        </Text>
        <Text variant="caption" tone="muted">
          {t('schedule.detail.reason')}
        </Text>
        <ChipRow
          options={REASONS.map((r) => t(`schedule.detail.reasons.${r}`))}
          selected={reason ? [t(`schedule.detail.reasons.${reason}`)] : []}
          onToggle={(label) => {
            const hit = REASONS.find((r) => t(`schedule.detail.reasons.${r}`) === label) ?? null;
            setReason((cur) => (cur === hit ? null : hit));
          }}
        />
        <Button label={t('schedule.detail.cancel')} variant="ghost" tone="danger" loading={busy} onPress={() => void doCancel()} />
        <Button label={t('schedule.detail.keep')} variant="link" onPress={() => setSheet(null)} />
      </BottomSheet>

      <BottomSheet visible={sheet === 'noshow'} onDismiss={() => setSheet(null)} dismissLabel={t('schedule.detail.notYet')}>
        <Text variant="h3">{name ? t('schedule.detail.noShowTitle', { name }) : t('schedule.detail.noShowTitleNoName')}</Text>
        <Text tone="muted">{t('schedule.detail.noShowBody', { time: timeLabel(b.starts_at) })}</Text>
        <Button label={t('schedule.detail.noShow')} variant="ghost" tone="danger" loading={busy} onPress={() => void doNoShow()} />
        <Button label={t('schedule.detail.notYet')} variant="link" onPress={() => setSheet(null)} />
      </BottomSheet>
    </>,
  );
}

import { bookingErrorKey, bookingState, canClientChange, cancelDeadline, type BookingErrorCode } from '@forge/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { useOffline } from '../../../lib/offline/offlineContext';
import { dayLabel, deadlineLabel, timeLabel } from '../../../lib/schedule/format';
import { OfflineNote } from '../../../lib/schedule/OfflineNote';
import { cancelBooking, type BookingRow } from '../../../lib/schedule/scheduleApi';
import { useMyBookings } from '../../../lib/schedule/useMyBookings';
import { useNow } from '../../../lib/schedule/useNow';
import { useTheme } from '../../../theme/ThemeProvider';
import { Banner, BottomSheet, Button, EmptyState, NavHeader, Screen, SegmentedPill, Skeleton, Text } from '../../../ui';

export default function MyBookings() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const now = useNow();
  const data = useMyBookings(auth.user?.id);
  const locale = i18n.language;
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [confirm, setConfirm] = useState<BookingRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BookingErrorCode | null>(null);
  const cutoff = data.policy?.cutoffHours ?? 12;
  const ptName = data.coach?.ptName ?? null;

  const lengthOf = (b: BookingRow) => b.length_min ?? Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000);
  const withPt = (b: BookingRow) =>
    ptName ? t('bookings.withPt', { length: lengthOf(b), name: ptName }) : t('bookings.withPtNoName', { length: lengthOf(b) });

  async function doCancel() {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    const r = await cancelBooking(confirm.id, 'one', null, null);
    setBusy(false);
    setConfirm(null);
    if (r.error) setError(r.error);
    data.refetch();
  }

  const pastLabel = (b: BookingRow) => {
    if (b.status === 'cancelled' && b.cancel_counted) return t('bookings.pastStates.lateCounted');
    const s = bookingState(b.status, false);
    return s === 'noshow' ? t('bookings.pastStates.noshow') : s === 'cancelled' ? t('bookings.pastStates.cancelled') : t('bookings.pastStates.done');
  };

  const upcoming = () => {
    const [next, ...later] = data.upcoming;
    if (!next) {
      return (
        <EmptyState
          icon="calendar"
          title={t('bookings.emptyTitle')}
          body={t('bookings.emptyBody')}
          actionLabel={data.coach ? t('bookings.emptyCta') : undefined}
          onAction={data.coach ? () => router.push({ pathname: '/(app)/bookings/book', params: { from: 'mine' } }) : undefined}
        />
      );
    }
    const ok = canClientChange(next.starts_at, cutoff, now);
    const deadline = cancelDeadline(next.starts_at, cutoff);
    const can = ok && offline.online && !busy;
    return (
      <View style={{ gap: theme.space[4] }}>
        <View style={{ padding: 16, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceRaised, gap: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: theme.colors.textMuted }}>{t('bookings.next')}</Text>
          <Text variant="h3">{dayLabel(next.starts_at, locale)}</Text>
          <Text numeric style={{ fontSize: 22, fontWeight: '800' }}>
            {timeLabel(next.starts_at)} – {timeLabel(next.ends_at)}
          </Text>
          <Text tone="muted">{withPt(next)}</Text>
          {ok ? (
            <Text variant="caption" tone="muted">
              {t('bookings.freeUntil', { deadline: deadlineLabel(deadline, locale) })}
            </Text>
          ) : (
            <View style={{ padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.warnSurface, gap: 2 }}>
              <Text style={{ fontWeight: '700', color: theme.colors.onWarnSurface }}>{t('bookings.tooLateTitle')}</Text>
              <Text style={{ color: theme.colors.onWarnSurface }}>
                {t('bookings.tooLateBody', { hours: cutoff, time: timeLabel(deadline.toISOString()) })}
              </Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              label={t('bookings.reschedule')}
              variant="ghost"
              disabled={!can}
              onPress={() => router.push({ pathname: '/(app)/bookings/book', params: { move: next.id } })}
            />
            <Button label={t('bookings.cancel')} variant="ghost" tone="danger" disabled={!can} onPress={() => setConfirm(next)} />
          </View>
        </View>
        {later.length ? (
          <View style={{ gap: 6 }}>
            <Text style={{ fontWeight: '700' }}>{t('bookings.later')}</Text>
            {later.map((b) => (
              <View key={b.id} style={{ flexDirection: 'row', minHeight: 44, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                <Text style={{ flex: 1 }}>{dayLabel(b.starts_at, locale)}</Text>
                <Text numeric>{timeLabel(b.starts_at)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {data.coach ? (
          <Button
            label={t('bookings.emptyCta')}
            variant="link"
            onPress={() => router.push({ pathname: '/(app)/bookings/book', params: { from: 'mine' } })}
          />
        ) : null}
      </View>
    );
  };

  const past = () => (
    <View style={{ gap: 6 }}>
      {data.past.map((b) => (
        <View key={b.id} style={{ minHeight: 52, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
          <View style={{ flexDirection: 'row' }}>
            <Text style={{ flex: 1 }}>{dayLabel(b.starts_at, locale)}</Text>
            <Text numeric>{timeLabel(b.starts_at)}</Text>
          </View>
          <Text variant="caption" tone="muted">
            {pastLabel(b)}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <Screen padded={false}>
      <NavHeader
        title={t('bookings.title')}
        leading={<Button label={t('common.back')} variant="link" icon="chevronBack" onPress={() => router.dismissTo('/')} />}
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: theme.space[3], paddingBottom: theme.space[6], gap: theme.space[4] }}>
        <SegmentedPill
          items={[
            { label: t('bookings.upcoming'), value: 'upcoming' },
            { label: t('bookings.past'), value: 'past' },
          ]}
          selected={tab}
          onChange={(v) => setTab(v as 'upcoming' | 'past')}
        />
        {!offline.online && data.fetchedAt ? (
          <OfflineNote title={t('bookings.offline', { time: timeLabel(data.fetchedAt) })} body={t('bookings.offlineBody')} />
        ) : null}
        {error ? <Banner variant="danger" message={t(bookingErrorKey(error))} /> : null}
        {data.loading ? (
          <Skeleton height={220} radius={14} />
        ) : data.error ? (
          <EmptyState
            icon="alert"
            tone="danger"
            title={t('bookings.errorTitle')}
            body={t('bookings.errorBody')}
            actionLabel={t('schedule.retry')}
            onAction={data.refetch}
          />
        ) : !data.coach && data.upcoming.length === 0 && data.past.length === 0 ? (
          <EmptyState icon="users" title={t('bookings.book.noCoachTitle')} body={t('bookings.book.noCoachBody')} />
        ) : tab === 'upcoming' ? (
          upcoming()
        ) : (
          past()
        )}
      </ScrollView>
      <BottomSheet visible={confirm !== null} onDismiss={() => setConfirm(null)} dismissLabel={t('bookings.keep')}>
        <Text variant="h3">{t('bookings.cancelTitle')}</Text>
        {confirm ? (
          <Text tone="muted">
            {t('bookings.cancelBody', { deadline: deadlineLabel(cancelDeadline(confirm.starts_at, cutoff), locale) })}
          </Text>
        ) : null}
        <Button label={t('bookings.cancelConfirm')} variant="ghost" tone="danger" loading={busy} onPress={() => void doCancel()} />
        <Button label={t('bookings.keep')} variant="link" onPress={() => setConfirm(null)} />
      </BottomSheet>
    </Screen>
  );
}

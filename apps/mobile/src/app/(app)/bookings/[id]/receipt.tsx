import { formatAmount, receiptLabel } from '@forge/shared';
import { router, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Share, View } from 'react-native';
import { useAuth } from '../../../../lib/auth/AuthProvider';
import { useBookingForClient } from '../../../../lib/checkin/useBookingForClient';
import { useOffline } from '../../../../lib/offline/offlineContext';
import { dayLabel, timeLabel } from '../../../../lib/schedule/format';
import { OfflineNote } from '../../../../lib/schedule/OfflineNote';
import { useTheme } from '../../../../theme/ThemeProvider';
import { Button, EmptyState, NavHeader, Screen, Skeleton, Text } from '../../../../ui';

/**
 * Design screen 13. Layout only, no payment state: every figure and the
 * receipt number are mono, and the amount is what the coach recorded (spec
 * D8, D9). Share sends text through the OS sheet; the PDF waits for M6 (D14).
 * The booking's PT can open it too — RLS already lets them read the row.
 */
export default function Receipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const d = useBookingForClient(id);
  const isPt = auth.user?.role !== 'client';

  const back = () => (isPt ? router.dismissTo({ pathname: '/(app)/schedule/[id]', params: { id: id ?? '' } }) : router.dismissTo('/(app)/bookings'));
  const header = (trailing?: ReactNode) => (
    <NavHeader
      title={t('receipt.title')}
      leading={<Button label={isPt ? t('checkin.back') : t('receipt.back')} variant="link" icon="chevronBack" onPress={back} />}
      trailing={trailing}
    />
  );

  if (d.loading) {
    return (
      <Screen padded={false}>
        {header()}
        <View style={{ padding: 18 }}>
          <Skeleton height={380} radius={18} />
        </View>
      </Screen>
    );
  }
  if (d.error && !d.booking) {
    return (
      <Screen padded={false}>
        {header()}
        <EmptyState icon="alert" tone="danger" title={t('receipt.errorTitle')} body={t('receipt.errorBody')} actionLabel={t('schedule.retry')} onAction={d.refetch} />
      </Screen>
    );
  }
  const b = d.booking;
  if (!b || b.status !== 'completed' || b.receipt_no === null) {
    return (
      <Screen padded={false}>
        {header()}
        <EmptyState
          icon="document"
          title={t('receipt.emptyTitle')}
          body={t('receipt.emptyBody')}
          actionLabel={isPt ? undefined : t('receipt.emptyCta')}
          onAction={isPt ? undefined : () => router.dismissTo('/(app)/bookings')}
        />
      </Screen>
    );
  }

  const length = b.length_min ?? Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000);
  const number = receiptLabel(b.receipt_no, b.starts_at);
  const amount = formatAmount(b.amount_cents);
  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: t('receipt.date'), value: dayLabel(b.starts_at, i18n.language) },
    { label: t('receipt.time'), value: timeLabel(b.starts_at) + ' – ' + timeLabel(b.ends_at), mono: true },
    ...(isPt && d.clientName ? [{ label: t('receipt.client'), value: d.clientName }] : []),
    ...(d.coachName ? [{ label: t('receipt.coach'), value: d.coachName }] : []),
    { label: t('receipt.session'), value: t('receipt.sessionValue', { length }) },
    ...(d.dayLabel ? [{ label: t('receipt.program'), value: d.dayLabel }] : []),
  ];

  async function share() {
    const lines = [
      `${t('receipt.brand')} ${t('receipt.kicker')} ${number}`,
      ...rows.map((r) => `${r.label}: ${r.value}`),
      `${t('receipt.amount')}: ${amount ?? t('receipt.notRecorded')}`,
      t('receipt.note'),
    ];
    await Share.share({ message: lines.join('\n') });
  }

  return (
    <Screen padded={false}>
      {header(
        offline.online ? <Button label={t('receipt.share')} variant="link" tone="accent" icon="share" onPress={() => void share()} /> : undefined,
      )}
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }}>
        {!offline.online ? <OfflineNote title={t('receipt.offline')} body={t('receipt.offlineBody')} /> : null}
        <View style={{ padding: 20, borderRadius: 18, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, gap: 14 }}>
          <View style={{ gap: 4 }}>
            <Text style={{ fontWeight: '900', letterSpacing: 2, color: theme.colors.accent }}>{t('receipt.brand')}</Text>
            <Text numeric style={{ fontSize: 12, letterSpacing: 1, color: theme.colors.textMuted }}>
              {t('receipt.kicker')} {number}
            </Text>
          </View>
          <View style={{ height: 1, backgroundColor: theme.colors.border }} />
          {rows.map((r) => (
            <View key={r.label} style={{ flexDirection: 'row', gap: 12 }}>
              <Text tone="muted" style={{ width: 84 }}>
                {r.label}
              </Text>
              <Text numeric={r.mono} style={{ flex: 1, fontWeight: '600' }}>
                {r.value}
              </Text>
            </View>
          ))}
          <View style={{ height: 1, backgroundColor: theme.colors.border }} />
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={{ flex: 1, fontWeight: '700' }}>{t('receipt.amount')}</Text>
            <Text numeric testID="receipt-amount" style={{ fontSize: amount ? 26 : 16, fontWeight: '800', color: amount ? theme.colors.textPrimary : theme.colors.textMuted }}>
              {amount ?? t('receipt.notRecorded')}
            </Text>
          </View>
          <Text variant="caption" tone="muted">
            {t('receipt.note')}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

import { seriesProgress } from '@forge/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BookingForm } from '../../../../lib/schedule/BookingForm';
import { useBookingDetail } from '../../../../lib/schedule/useBookingDetail';
import { Button, EmptyState, NavHeader, Screen, Skeleton } from '../../../../ui';

export default function EditBooking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const d = useBookingDetail(id);
  if (d.loading) {
    return (
      <Screen>
        <Skeleton height={320} radius={14} />
      </Screen>
    );
  }
  if (!d.booking || d.booking.status !== 'scheduled') {
    return (
      <Screen>
        <NavHeader
          leading={<Button label={t('schedule.detail.back')} variant="link" icon="chevronBack" onPress={() => router.dismissTo('/(app)/(tabs)/schedule')} />}
        />
        <EmptyState icon="calendar" title={t('schedule.detail.removedTitle')} body={t('schedule.detail.removedBody')} />
      </Screen>
    );
  }
  const { left } = seriesProgress(d.series, d.booking.starts_at);
  return <BookingForm mode="edit" booking={d.booking} clientName={d.clientName} isSelf={d.isSelf} seriesLeft={left} />;
}

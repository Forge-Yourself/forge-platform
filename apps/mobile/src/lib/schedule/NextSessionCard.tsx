import { isCheckInOpen } from '@forge/shared';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, Text } from '../../ui';
import { useAuth } from '../auth/AuthProvider';
import { dayLabel, timeLabel } from './format';
import { useMyBookings } from './useMyBookings';
import { useNow } from './useNow';

/** The client's way into booking: their next session, or a way to book one. Hidden until they have a coach. */
export function NextSessionCard() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const data = useMyBookings(auth.user?.id);
  const now = useNow(30_000);
  if (data.loading || (!data.coach && data.upcoming.length === 0)) return null;
  const next = data.upcoming[0];
  // M5b: from 30 min before the start, the card's job is the scan in (and, once checked in, the scan out).
  const canScan = !!next && (next.status === 'scheduled' || next.status === 'checked_in') && isCheckInOpen(next.starts_at, next.ends_at, now);
  return (
    <View style={{ padding: 16, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceRaised, gap: 8 }}>
      <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: theme.colors.textMuted }}>{t('bookings.home.next')}</Text>
      {next ? (
        <>
          <Text variant="h3">{dayLabel(next.starts_at, i18n.language)}</Text>
          <Text numeric>
            {timeLabel(next.starts_at)} – {timeLabel(next.ends_at)}
          </Text>
          {next.status === 'checked_in' ? <Text tone="secondary">{t('checkin.steps.checkedIn')}</Text> : null}
          {canScan ? <Button label={t('scan.button')} icon="qr" size="lg" onPress={() => router.push('/(app)/bookings/scan')} /> : null}
        </>
      ) : (
        <Text tone="muted">{t('bookings.home.none')}</Text>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {data.coach ? <Button label={t('bookings.home.book')} variant="ghost" onPress={() => router.push('/(app)/bookings/book')} /> : null}
        <Button label={t('bookings.home.mine')} variant="link" onPress={() => router.push('/(app)/bookings')} />
      </View>
    </View>
  );
}

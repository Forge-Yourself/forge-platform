import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, Text } from '../../ui';
import { useAuth } from '../auth/AuthProvider';
import { dayLabel, timeLabel } from './format';
import { useMyBookings } from './useMyBookings';

/** The client's way into booking: their next session, or a way to book one. Hidden until they have a coach. */
export function NextSessionCard() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const data = useMyBookings(auth.user?.id);
  if (data.loading || (!data.coach && data.upcoming.length === 0)) return null;
  const next = data.upcoming[0];
  return (
    <View style={{ padding: 16, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceRaised, gap: 8 }}>
      <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: theme.colors.textMuted }}>{t('bookings.home.next')}</Text>
      {next ? (
        <>
          <Text variant="h3">{dayLabel(next.starts_at, i18n.language)}</Text>
          <Text numeric>
            {timeLabel(next.starts_at)} – {timeLabel(next.ends_at)}
          </Text>
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

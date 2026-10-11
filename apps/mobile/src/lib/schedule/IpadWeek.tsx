import { addDays, localDayKey, minuteOfDay } from '@forge/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, CalendarBlock, IconButton, Screen, Skeleton, Text } from '../../ui';
import { useAuth } from '../auth/AuthProvider';
import { blockProps } from './blockProps';
import { BookingDetailBody } from './BookingDetailBody';
import { dayLabel } from './format';
import { useSchedule } from './useSchedule';

const FIRST = 6 * 60;
const LAST = 21 * 60;
const PX = 1; // 60 pt per hour
const GUTTER = 48;

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * A real week grid on iPad, starting today. Block height is the booking
 * length. Selecting a block fills the right pane with booking detail;
 * nothing navigates away (design, iPad schedule). Same state colours and ME
 * hatch as the phone, through the same CalendarBlock.
 */
export function IpadWeek() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const [range] = useState(() => {
    const today = startOfToday();
    return { today, to: addDays(today, 7) };
  });
  const data = useSchedule(auth.user?.id, range.today, range.to);
  const [selected, setSelected] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(range.today, i));
  const hours = Array.from({ length: (LAST - FIRST) / 60 + 1 }, (_, i) => FIRST / 60 + i);

  return (
    <Screen padded={false}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 12 }}>
            <Text variant="h2" style={{ flex: 1 }}>
              {t('schedule.title')}
            </Text>
            <Button label={t('schedule.hours')} variant="ghost" onPress={() => router.push('/(app)/schedule/availability')} />
            <IconButton icon="plus" accessibilityLabel={t('schedule.newBooking')} onPress={() => router.push('/(app)/schedule/new')} />
          </View>
          <View style={{ flexDirection: 'row', paddingStart: GUTTER }}>
            {days.map((d) => (
              <Text key={localDayKey(d)} style={{ flex: 1, textAlign: 'center', fontWeight: '700', paddingBottom: 6 }}>
                {dayLabel(d, i18n.language)}
              </Text>
            ))}
          </View>
          {data.loading ? (
            <View style={{ padding: 18 }}>
              <Skeleton height={400} radius={14} />
            </View>
          ) : (
            <ScrollView>
              <View style={{ flexDirection: 'row', height: (LAST - FIRST) * PX + 20 }}>
                <View style={{ width: GUTTER }}>
                  {hours.map((h) => (
                    <Text
                      key={h}
                      numeric
                      tone="muted"
                      style={{ position: 'absolute', top: (h * 60 - FIRST) * PX - 7, fontSize: 11, width: GUTTER - 6, textAlign: 'right' }}
                    >
                      {String(h).padStart(2, '0')}:00
                    </Text>
                  ))}
                </View>
                {days.map((d) => {
                  const key = localDayKey(d);
                  const items = data.items.filter((i) => localDayKey(new Date(i.startsAt)) === key);
                  return (
                    <View key={key} style={{ flex: 1, borderStartWidth: 1, borderStartColor: theme.colors.border }}>
                      {items.map((item) => {
                        const start = Math.max(FIRST, minuteOfDay(new Date(item.startsAt)));
                        const end = Math.min(LAST, minuteOfDay(new Date(item.endsAt)) || LAST);
                        return (
                          <View key={item.id} style={{ position: 'absolute', top: (start - FIRST) * PX, left: 2, right: 2 }}>
                            <CalendarBlock
                              {...blockProps(item, t)}
                              minHeight={Math.max(28, (end - start) * PX)}
                              selected={item.id === selected}
                              onPress={() => setSelected(item.id)}
                            />
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </View>
        <View style={{ width: 380, borderStartWidth: 1, borderStartColor: theme.colors.border }}>
          {selected ? (
            <BookingDetailBody key={selected} id={selected} embedded />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {t('schedule.emptyBody')}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Screen>
  );
}

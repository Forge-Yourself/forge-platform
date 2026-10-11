import { addDays, dayRows, hhmm, localDayKey, minuteOfDay, type DayRow } from '@forge/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { useOffline } from '../../../lib/offline/offlineContext';
import { blockProps } from '../../../lib/schedule/blockProps';
import { dayLabel, dowLabel, timeLabel } from '../../../lib/schedule/format';
import { OfflineNote } from '../../../lib/schedule/OfflineNote';
import { stateStyle } from '../../../lib/schedule/stateStyle';
import { useNow } from '../../../lib/schedule/useNow';
import { useSchedule, type ScheduleItem } from '../../../lib/schedule/useSchedule';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Button, CalendarBlock, EmptyState, IconButton, MonthGrid, OpenGapRow, Screen, SegmentedPill, Skeleton, Text,
} from '../../../ui';

type Mode = 'day' | 'week' | 'month';

/** 2026-10-12 is a Monday; seven days from it give Monday-first labels in any locale. */
const MONDAY = new Date(2026, 9, 12);

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const openDetail = (id: string) => router.push({ pathname: '/(app)/schedule/[id]', params: { id } });

export function PhoneSchedule() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const now = useNow();
  const [mode, setMode] = useState<Mode>('day');
  // One fetch serves all three views: the month so far and the coming week.
  const [range] = useState(() => {
    const today = startOfToday();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const weekEnd = addDays(today, 7);
    return { today, from: first, to: weekEnd > nextMonth ? weekEnd : nextMonth };
  });
  const [monthDay, setMonthDay] = useState(range.today.getDate());
  const data = useSchedule(auth.user?.id, range.from, range.to);
  const locale = i18n.language;

  const itemsOn = (key: string) => data.items.filter((i) => localDayKey(new Date(i.startsAt)) === key);
  const windowsOn = (key: string) =>
    data.windows
      .filter((w) => w.date === key)
      .map((w) => ({ startMin: minuteOfDay(new Date(w.start)), endMin: minuteOfDay(new Date(w.end)) || 1440 }));

  const todayKey = localDayKey(range.today);
  const weekItems = data.items.filter((i) => {
    const s = Date.parse(i.startsAt);
    return s >= range.today.getTime() && s < addDays(range.today, 7).getTime();
  });

  const newAt = (date: string, startMin: number) =>
    router.push({ pathname: '/(app)/schedule/new', params: { date, time: hhmm(startMin) } });

  const renderRow = (row: DayRow<ScheduleItem>, key: string, i: number) => {
    if (row.kind === 'now') {
      return (
        <View key={'now' + i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numeric style={{ fontSize: 12, fontWeight: '700', color: theme.colors.accentText }}>
            {hhmm(row.min)}
          </Text>
          <View style={{ flex: 1, height: 2, backgroundColor: theme.colors.accent }} />
        </View>
      );
    }
    if (row.kind === 'gap') {
      return (
        <OpenGapRow
          key={'gap' + row.startMin}
          label={t('schedule.open', { range: `${hhmm(row.startMin)} – ${hhmm(row.endMin)}` })}
          actionLabel={t('schedule.openBook')}
          onPress={() => newAt(key, row.startMin)}
        />
      );
    }
    return <CalendarBlock key={row.item.id} {...blockProps(row.item, t)} onPress={() => openDetail(row.item.id)} />;
  };

  const dayView = () => {
    const rows = dayRows(
      windowsOn(todayKey),
      itemsOn(todayKey).map((item) => ({
        startMin: minuteOfDay(new Date(item.startsAt)),
        endMin: minuteOfDay(new Date(item.endsAt)) || 1440,
        item,
        occupies: item.state !== 'cancelled',
      })),
      minuteOfDay(new Date(now)),
    );
    return <View style={{ gap: 8 }}>{rows.map((r, i) => renderRow(r, todayKey, i))}</View>;
  };

  const weekView = () => (
    <View style={{ gap: theme.space[4] }}>
      {Array.from({ length: 7 }, (_, i) => {
        const day = addDays(range.today, i);
        const key = localDayKey(day);
        const items = itemsOn(key);
        return (
          <View key={key} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700' }}>{dayLabel(day, locale)}</Text>
              <Text numeric tone="muted">
                {items.filter((x) => x.state !== 'cancelled').length}
              </Text>
            </View>
            {items.length === 0 && windowsOn(key).length === 0 ? (
              <Text variant="caption" tone="muted">
                {t('schedule.weekNoHours')}
              </Text>
            ) : null}
            {items.map((item) => (
              <CalendarBlock key={item.id} {...blockProps(item, t)} minHeight={52} onPress={() => openDetail(item.id)} />
            ))}
          </View>
        );
      })}
    </View>
  );

  const monthView = () => {
    const y = range.today.getFullYear();
    const m = range.today.getMonth();
    const dots: Record<number, string[]> = {};
    for (const item of data.items) {
      const d = new Date(item.startsAt);
      if (d.getMonth() !== m) continue;
      (dots[d.getDate()] ??= []).push(stateStyle(item.state, theme.colors).bar);
    }
    const selKey = localDayKey(new Date(y, m, monthDay));
    const items = itemsOn(selKey);
    return (
      <View style={{ gap: theme.space[3] }}>
        <MonthGrid
          year={y}
          month0={m}
          dowLabels={Array.from({ length: 7 }, (_, i) => dowLabel(addDays(MONDAY, i), locale))}
          dots={dots}
          selected={monthDay}
          today={range.today.getDate()}
          onSelect={setMonthDay}
        />
        <Text style={{ fontWeight: '700' }}>{dayLabel(new Date(y, m, monthDay), locale)}</Text>
        {items.length === 0 ? (
          <Text variant="caption" tone="muted">
            {windowsOn(selKey).length === 0 ? t('schedule.monthNone') : t('schedule.monthNothing')}
          </Text>
        ) : (
          items.map((item) => (
            <CalendarBlock key={item.id} {...blockProps(item, t)} minHeight={52} onPress={() => openDetail(item.id)} />
          ))
        )}
      </View>
    );
  };

  const showEmpty = !data.loading && !data.error && mode !== 'month' && weekItems.length === 0;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: theme.space[4], paddingBottom: theme.space[6], gap: theme.space[4] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <View style={{ flex: 1 }}>
            <Text variant="h2">{t('schedule.title')}</Text>
            <Text variant="caption" tone="muted">
              {dayLabel(range.today, locale)}
            </Text>
          </View>
          <Button label={t('schedule.hours')} variant="ghost" onPress={() => router.push('/(app)/schedule/availability')} />
          <IconButton icon="plus" accessibilityLabel={t('schedule.newBooking')} onPress={() => router.push('/(app)/schedule/new')} />
        </View>

        <SegmentedPill
          items={[
            { label: t('schedule.views.day'), value: 'day' },
            { label: t('schedule.views.week'), value: 'week' },
            { label: t('schedule.views.month'), value: 'month' },
          ]}
          selected={mode}
          onChange={(v) => setMode(v as Mode)}
        />

        {!offline.online && data.fetchedAt ? (
          <OfflineNote title={t('schedule.offlineBanner', { time: timeLabel(data.fetchedAt) })} body={t('schedule.offlineBody')} />
        ) : null}

        {data.loading ? (
          <View style={{ gap: 8 }}>
            <Skeleton height={64} radius={12} />
            <Skeleton height={64} radius={12} />
            <Skeleton height={64} radius={12} />
          </View>
        ) : data.error ? (
          <EmptyState
            icon="alert"
            tone="danger"
            title={t('schedule.errorTitle')}
            body={t('schedule.errorBody')}
            actionLabel={t('schedule.retry')}
            onAction={data.refetch}
          />
        ) : showEmpty ? (
          <View style={{ gap: theme.space[2] }}>
            <EmptyState
              icon="calendar"
              title={t('schedule.emptyTitle')}
              body={data.hasHours ? t('schedule.emptyBody') : t('schedule.emptyBodyNoHours')}
              actionLabel={t('schedule.newBooking')}
              onAction={() => router.push('/(app)/schedule/new')}
            />
            {!data.hasHours ? (
              <Button label={t('schedule.setHours')} variant="link" onPress={() => router.push('/(app)/schedule/availability')} />
            ) : null}
          </View>
        ) : mode === 'day' ? (
          dayView()
        ) : mode === 'week' ? (
          weekView()
        ) : (
          monthView()
        )}
      </ScrollView>
    </Screen>
  );
}

export default function ScheduleTab() {
  return <PhoneSchedule />;
}

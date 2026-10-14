import { addDays, bookingErrorKey, buildIcs, cancelDeadline, localDayKey, slotCountsByDay, type BookingErrorCode } from '@forge/shared';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { nudgeCalendarSync } from '../../../lib/calendar/api';
import { shareIcs } from '../../../lib/calendar/share';
import { useOffline } from '../../../lib/offline/offlineContext';
import { dayLabel, deadlineLabel, dowLabel, timeLabel } from '../../../lib/schedule/format';
import { OfflineNote } from '../../../lib/schedule/OfflineNote';
import { createBooking, rescheduleBooking, type BookingRow } from '../../../lib/schedule/scheduleApi';
import { useMyBookings } from '../../../lib/schedule/useMyBookings';
import { useOpenSlots } from '../../../lib/schedule/useOpenSlots';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Banner, Button, DayStrip, EmptyState, FooterBar, Icon, NavHeader, Screen, SegmentedPill, Skeleton, SlotGrid, Text,
} from '../../../ui';

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * The client books (or, with ?move=, moves) one session inside their coach's
 * open slots. The policy sits beside the button, before commitment. A slot
 * taken in the meantime keeps the day and length and outlines the nearest
 * open times; an empty week offers the next one rather than a dead end.
 */
export default function BookSession() {
  const { move, from } = useLocalSearchParams<{ move?: string; from?: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const data = useMyBookings(auth.user?.id);
  const locale = i18n.language;

  const moving = move ? (data.upcoming.find((b) => b.id === move) ?? null) : null;
  const [id] = useState(() => Crypto.randomUUID());
  const [today] = useState(startOfToday);
  const [length, setLength] = useState<number | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayPick, setDayPick] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [taken, setTaken] = useState<{ label: string; at: number } | null>(null);
  const [error, setError] = useState<BookingErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<BookingRow | null>(null);

  // M5c: ask the server to refresh the coach's Google busy times, so the
  // slots this screen loads next reflect their calendar (spec D8, D11).
  useEffect(() => nudgeCalendarSync(), []);

  const policy = data.policy;
  const len = moving?.length_min ?? length ?? (policy ? (policy.lengths.includes(60) ? 60 : (policy.lengths[0] ?? null)) : null);
  const maxOffset = Math.max(0, (policy?.windowWeeks ?? 1) - 1);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, weekOffset * 7 + i));
  const slots = useOpenSlots(data.coach?.ptUserId ?? null, localDayKey(days[0]!), localDayKey(days[6]!), len, moving?.id);
  const counts = slotCountsByDay(slots.slots);
  const dayKey = dayPick ?? days.map(localDayKey).find((k) => (counts[k] ?? 0) > 0) ?? localDayKey(days[0]!);
  const daySlots = slots.slots.filter((s) => s.date === dayKey);
  const outlined = taken
    ? [...daySlots].sort((a, b) => Math.abs(Date.parse(a.startsAt) - taken.at) - Math.abs(Date.parse(b.startsAt) - taken.at)).slice(0, 2).map((s) => s.startsAt)
    : [];
  const leave = () => (moving || from === 'mine' ? router.dismissTo('/(app)/bookings') : router.dismissTo('/'));

  async function submit() {
    if (!picked || !len || !data.coach) return;
    setBusy(true);
    setError(null);
    const r = moving ? await rescheduleBooking(moving.id, picked, 'one') : await createBooking({ id, clientId: data.coach.clientId, startsAt: picked, length: len });
    setBusy(false);
    if (r.error) {
      if (r.error === 'slot_taken' || r.error === 'outside_hours') {
        setTaken({ label: timeLabel(picked), at: Date.parse(picked) });
        setPicked(null);
        slots.refetch();
      } else {
        setError(r.error);
      }
      return;
    }
    setDone(r.data[0] ?? null);
  }

  // ?move= names a booking that is no longer upcoming (cancelled, passed, or
  // never ours). Without this guard the screen would quietly book a NEW session.
  if (move && !data.loading && !moving && !done) {
    return (
      <Screen>
        <NavHeader leading={<Button label={t('common.back')} variant="link" icon="chevronBack" onPress={leave} />} />
        <EmptyState icon="calendar" title={t('schedule.detail.removedTitle')} body={t('schedule.errors.bookingClosed')} />
      </Screen>
    );
  }

  if (done) {
    const ptName = data.coach?.ptName;
    const minutes = done.length_min ?? len ?? 0;
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, padding: 24 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.successSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={28} color={theme.colors.onSuccessSurface} />
          </View>
          <Text variant="h2">{moving ? t('bookings.book.doneMoved') : t('bookings.book.doneTitle')}</Text>
          <Text numeric>
            {dayLabel(done.starts_at, locale)} · {timeLabel(done.starts_at)} – {timeLabel(done.ends_at)}
          </Text>
          <Text tone="muted">
            {ptName ? t('bookings.book.doneLength', { length: minutes, name: ptName }) : t('bookings.book.doneLengthNoName', { length: minutes })}
          </Text>
          {policy ? (
            <Text variant="caption" tone="muted">
              {t('bookings.book.doneDeadline', { deadline: deadlineLabel(cancelDeadline(done.starts_at, policy.cutoffHours), locale) })}
            </Text>
          ) : null}
        </View>
        <View style={{ gap: 8 }}>
          <Button
            label={t('calendar.addToCalendar')}
            variant="ghost"
            size="lg"
            onPress={() =>
              void shareIcs(
                'forge-session.ics',
                buildIcs(
                  [
                    {
                      uid: done.id,
                      title: ptName ? t('calendar.clientEventTitle', { name: ptName }) : t('calendar.clientEventTitleNoName'),
                      start: done.starts_at,
                      end: done.ends_at,
                      sequence: Math.floor(Date.parse(done.updated_at) / 1000),
                    },
                  ],
                  new Date(),
                ),
                t('calendar.addToCalendar'),
              )
            }
          />
          <Button label={t('bookings.book.seeMine')} variant="primary" size="lg" onPress={() => router.replace('/(app)/bookings')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <NavHeader
        title={moving ? t('bookings.book.titleMove') : t('bookings.book.title')}
        leading={<Button label={t('common.back')} variant="link" icon="chevronBack" onPress={leave} />}
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: theme.space[3], paddingBottom: theme.space[6], gap: theme.space[4] }}>
        {!offline.online ? <OfflineNote title={t('bookings.book.offline')} body={t('bookings.book.offlineBody')} /> : null}
        {error ? <Banner variant="danger" message={t(bookingErrorKey(error))} /> : null}
        {data.loading ? (
          <Skeleton height={320} radius={14} />
        ) : !data.coach ? (
          <EmptyState icon="users" title={t('bookings.book.noCoachTitle')} body={t('bookings.book.noCoachBody')} />
        ) : (
          <>
            <Text tone="muted">
              {data.coach.ptName
                ? t('bookings.book.with', { name: data.coach.ptName, tz: policy?.timezone ?? '' })
                : t('bookings.book.withNoName', { tz: policy?.timezone ?? '' })}
            </Text>
            {policy && !moving ? (
              <View style={{ gap: 8 }}>
                <Text variant="caption" tone="muted">
                  {t('bookings.book.length')}
                </Text>
                <SegmentedPill
                  items={policy.lengths.map((l) => ({ label: `${l} ${t('schedule.form.min')}`, value: String(l) }))}
                  selected={String(len)}
                  onChange={(v) => {
                    setLength(Number(v));
                    setPicked(null);
                    setTaken(null);
                  }}
                />
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                label={t('bookings.book.thisWeek')}
                variant={weekOffset === 0 ? 'ghost' : 'link'}
                onPress={() => {
                  setWeekOffset(0);
                  setDayPick(null);
                  setPicked(null);
                }}
              />
              <Button
                label={`${t('bookings.book.nextWeek')} ›`}
                variant={weekOffset > 0 ? 'ghost' : 'link'}
                disabled={weekOffset >= maxOffset}
                onPress={() => {
                  setWeekOffset((w) => Math.min(maxOffset, w + 1));
                  setDayPick(null);
                  setPicked(null);
                }}
              />
            </View>
            <DayStrip
              days={days.map((d) => {
                const key = localDayKey(d);
                return { key, dow: dowLabel(d, locale), date: String(d.getDate()), count: slots.loading ? null : (counts[key] ?? 0) };
              })}
              selected={dayKey}
              onSelect={(k) => {
                setDayPick(k);
                setPicked(null);
              }}
            />
            {slots.error ? (
              <EmptyState
                icon="alert"
                tone="danger"
                title={t('bookings.book.errorTitle')}
                body={t('bookings.book.errorBody')}
                actionLabel={t('schedule.retry')}
                onAction={slots.refetch}
              />
            ) : !slots.loading && slots.slots.length === 0 ? (
              <EmptyState
                icon="calendar"
                title={t('bookings.book.noneTitle')}
                body={t('bookings.book.noneBody')}
                actionLabel={weekOffset < maxOffset ? t('bookings.book.noneCta') : undefined}
                onAction={weekOffset < maxOffset ? () => setWeekOffset((w) => w + 1) : undefined}
              />
            ) : (
              <View style={{ gap: 8 }}>
                {taken ? (
                  <Banner variant="warn" message={`${t('bookings.book.takenTitle', { time: taken.label })} — ${t('bookings.book.takenBody')}`} />
                ) : null}
                <Text style={{ fontWeight: '700' }}>{dayLabel(dayKey, locale)}</Text>
                <SlotGrid
                  slots={daySlots.map((s) => ({ key: s.startsAt, label: timeLabel(s.startsAt) }))}
                  selected={picked}
                  outlined={outlined}
                  onSelect={setPicked}
                />
              </View>
            )}
          </>
        )}
      </ScrollView>
      {data.coach ? (
        <FooterBar>
          <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            {policy?.cutoffHours ? t('bookings.book.policy', { hours: policy.cutoffHours }) : t('bookings.book.policyZero')}
          </Text>
          <Button
            label={
              picked
                ? moving
                  ? t('bookings.book.ctaMove', { time: timeLabel(picked) })
                  : t('bookings.book.cta', { time: timeLabel(picked) })
                : t('bookings.book.ctaPick')
            }
            variant="primary"
            size="lg"
            loading={busy}
            disabled={!picked || busy || !offline.online}
            onPress={() => void submit()}
          />
        </FooterBar>
      ) : null}
    </Screen>
  );
}

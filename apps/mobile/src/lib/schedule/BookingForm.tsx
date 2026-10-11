import {
  addDays, bookingErrorKey, localDayKey, slotCountsByDay, type BookingErrorCode,
} from '@forge/shared';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Avatar, Banner, BottomSheet, Button, DateField, DayStrip, EmptyState, FooterBar, MeasureStepper, NavHeader, Screen,
  SegmentedPill, SlotGrid, Tag, Text,
} from '../../ui';
import { useAuth } from '../auth/AuthProvider';
import { fetchRoster, type ClientListItem } from '../clients/useClientList';
import { useOffline } from '../offline/offlineContext';
import { dayLabel, dowLabel, timeLabel } from './format';
import { OfflineNote } from './OfflineNote';
import { createBooking, fetchPolicy, rescheduleBooking, type BookingPolicy, type BookingRow, type Scope } from './scheduleApi';
import { useOpenSlots } from './useOpenSlots';
import { useSeriesPreview } from './useSeriesPreview';

export type BookingFormProps =
  | { mode: 'new'; initialClientId?: string; initialDate?: string; initialTime?: string }
  | { mode: 'edit'; booking: BookingRow; clientName: string | null; isSelf: boolean; seriesLeft: number };

type Repeat = 'none' | '1' | '2';
const WEEK = 7 * 86_400_000;

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * The PT's create and move screen: client, length, day, time, repeat — the
 * order a PT says it out loud (design note). Only lengths from Availability
 * appear; the day strip shows open counts; a series lists every date before
 * saving, with the DST warning on the first one after a clock change.
 */
export function BookingForm(props: BookingFormProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const locale = i18n.language;
  const pt = auth.user?.id ?? null;
  const edit = props.mode === 'edit' ? props.booking : null;

  const [id] = useState(() => Crypto.randomUUID());
  const [today] = useState(startOfToday);
  const [roster, setRoster] = useState<ClientListItem[] | null>(null);
  const [policy, setPolicy] = useState<BookingPolicy | null>(null);
  useEffect(() => {
    if (!pt) return;
    let live = true;
    void Promise.all([fetchRoster(pt), fetchPolicy(pt)]).then(([r, p]) => {
      if (!live) return;
      setRoster(r.rows.filter((c) => c.state === 'active' || c.state === 'accepted'));
      setPolicy(p.error ? null : p.data);
    });
    return () => {
      live = false;
    };
  }, [pt]);

  const initialDay =
    props.mode === 'new' && props.initialDate ? props.initialDate : edit ? localDayKey(new Date(edit.starts_at)) : localDayKey(today);
  const [clientId, setClientId] = useState<string | null>(edit?.client_id ?? (props.mode === 'new' ? (props.initialClientId ?? null) : null));
  const [picking, setPicking] = useState(false);
  const [length, setLength] = useState<number | null>(edit?.length_min ?? null);
  const [weekOffset, setWeekOffset] = useState(() =>
    Math.max(0, Math.floor((new Date(initialDay + 'T12:00:00').getTime() - today.getTime()) / WEEK)),
  );
  const [dayKey, setDayKey] = useState(initialDay);
  const [picked, setPicked] = useState<string | null>(edit?.starts_at ?? null);
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [ends, setEnds] = useState<'count' | 'date'>('count');
  const [count, setCount] = useState(8);
  const [until, setUntil] = useState('');
  const [error, setError] = useState<BookingErrorCode | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);

  const effectiveLength = length ?? (policy ? (policy.lengths.includes(60) ? 60 : (policy.lengths[0] ?? null)) : null);
  const weekStart = addDays(today, weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const slots = useOpenSlots(pt, localDayKey(days[0]!), localDayKey(days[6]!), effectiveLength, edit?.id);
  const counts = slotCountsByDay(slots.slots);
  const daySlots = slots.slots.filter((s) => s.date === dayKey);
  // A gap tap arrives with a time; it becomes the selection once that slot exists (derived, not an effect).
  const initialTime = props.mode === 'new' ? props.initialTime : undefined;
  const selected = picked ?? (initialTime ? (daySlots.find((s) => timeLabel(s.startsAt) === initialTime)?.startsAt ?? null) : null);

  const series = useSeriesPreview(
    props.mode === 'new' && repeat !== 'none' && selected && effectiveLength && (ends === 'count' || until)
      ? {
          start: selected,
          length: effectiveLength,
          everyWeeks: repeat === '1' ? 1 : 2,
          count: ends === 'count' ? count : null,
          until: ends === 'date' ? until : null,
        }
      : null,
  );
  const firstDst = series.rows.find((r) => r.afterOffsetChange) ?? null;
  const seriesConflict = series.rows.some((r) => r.conflict);

  const client = roster?.find((c) => c.id === clientId) ?? null;
  const clientLabel =
    props.mode === 'edit' ? (props.isSelf ? t('schedule.me') : (props.clientName ?? '')) : client ? (client.isSelf ? t('schedule.me') : client.displayName) : null;

  const cta =
    props.mode === 'edit'
      ? selected
        ? t('schedule.form.ctaMove', { time: timeLabel(selected) })
        : t('schedule.form.ctaPick')
      : !selected
        ? t('schedule.form.ctaPick')
        : repeat === 'none'
          ? t('schedule.form.ctaOne', { time: timeLabel(selected) })
          : t('schedule.form.ctaSeries', { count: series.rows.length });

  const blocked =
    !offline.online || submitting || !selected || !effectiveLength || !clientId || (repeat !== 'none' && (series.loading || seriesConflict || series.rows.length === 0));

  async function submitNew() {
    if (!selected || !effectiveLength || !clientId) return;
    setSubmitting(true);
    setError(null);
    const r = await createBooking({
      id,
      clientId,
      startsAt: selected,
      length: effectiveLength,
      ...(repeat !== 'none'
        ? { everyWeeks: repeat === '1' ? (1 as const) : (2 as const), ...(ends === 'count' ? { count } : { until }) }
        : {}),
    });
    setSubmitting(false);
    if (r.error) {
      setError(r.error);
      if (r.error === 'slot_taken' || r.error === 'outside_hours') {
        setPicked(null);
        slots.refetch();
      }
      return;
    }
    router.replace({ pathname: '/(app)/schedule/[id]', params: { id } });
  }

  async function submitMove(scope: Scope) {
    if (!edit || !selected) return;
    setScopeOpen(false);
    setSubmitting(true);
    setError(null);
    const r = await rescheduleBooking(edit.id, selected, scope);
    setSubmitting(false);
    if (r.error) {
      setError(r.error);
      if (r.error === 'slot_taken') {
        setPicked(null);
        slots.refetch();
      }
      return;
    }
    router.replace({ pathname: '/(app)/schedule/[id]', params: { id: edit.id } });
  }

  const onCta = () => {
    if (props.mode === 'new') void submitNew();
    else if (props.seriesLeft > 1) setScopeOpen(true);
    else void submitMove('one');
  };

  const leave = () =>
    edit ? router.dismissTo({ pathname: '/(app)/schedule/[id]', params: { id: edit.id } }) : router.dismissTo('/(app)/(tabs)/schedule');

  if (props.mode === 'new' && roster && roster.length === 0) {
    return (
      <Screen>
        <NavHeader leading={<Button label={t('schedule.form.cancel')} variant="link" onPress={leave} />} />
        <EmptyState
          icon="users"
          title={t('schedule.form.noClientsTitle')}
          body={t('schedule.form.noClientsBody')}
          actionLabel={t('schedule.form.noClientsCta')}
          onAction={() => router.push('/(app)/clients/invite')}
        />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <NavHeader
        title={props.mode === 'edit' ? t('schedule.form.titleEdit') : t('schedule.form.titleNew')}
        divider
        leading={<Button label={t('schedule.form.cancel')} variant="link" onPress={leave} />}
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: theme.space[3], paddingBottom: theme.space[6], gap: theme.space[4] }}>
        {!offline.online ? <OfflineNote title={t('schedule.form.offline')} body={t('schedule.form.offlineBody')} /> : null}
        {error ? <Banner variant="danger" message={t(bookingErrorKey(error))} /> : null}

        <View style={{ gap: 8 }}>
          <Text variant="caption" tone="muted">
            {t('schedule.form.client')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar name={clientLabel ?? '?'} size={40} />
            <Text style={{ flex: 1, fontWeight: '700' }}>{clientLabel ?? t('schedule.form.pickClient')}</Text>
            {props.mode === 'new' ? <Button label={t('schedule.form.change')} variant="link" onPress={() => setPicking(true)} /> : null}
          </View>
        </View>

        {policy ? (
          <View style={{ gap: 8 }}>
            <Text variant="caption" tone="muted">
              {t('schedule.form.length')}
            </Text>
            {/* A move keeps its length, so edit shows only that one (a disabled pill would read "Coming soon"). */}
            <SegmentedPill
              items={(edit?.length_min ? [edit.length_min] : policy.lengths).map((l) => ({
                label: `${l} ${t('schedule.form.min')}`,
                value: String(l),
              }))}
              selected={String(effectiveLength)}
              onChange={(v) => {
                setLength(Number(v));
                setPicked(null);
              }}
            />
          </View>
        ) : null}

        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>
              {t('schedule.form.day')}
            </Text>
            {weekOffset > 0 ? <Button label="‹" variant="link" onPress={() => setWeekOffset((w) => w - 1)} /> : null}
            <Button label="›" variant="link" onPress={() => setWeekOffset((w) => w + 1)} />
          </View>
          <DayStrip
            days={days.map((d) => {
              const key = localDayKey(d);
              return { key, dow: dowLabel(d, locale), date: String(d.getDate()), count: slots.loading ? null : (counts[key] ?? 0) };
            })}
            selected={dayKey}
            onSelect={(k) => {
              setDayKey(k);
              setPicked(null);
            }}
          />
        </View>

        <View style={{ gap: 8 }}>
          <Text variant="caption" tone="muted">
            {t('schedule.form.time', { date: dayLabel(dayKey, locale) })}
          </Text>
          {slots.error ? (
            <EmptyState
              icon="alert"
              tone="danger"
              title={t('schedule.form.slotsErrorTitle')}
              body={t('schedule.form.slotsErrorBody')}
              actionLabel={t('schedule.retry')}
              onAction={slots.refetch}
            />
          ) : !slots.loading && daySlots.length === 0 ? (
            <Text variant="caption" tone="muted">
              {t('schedule.form.noTime')}
            </Text>
          ) : (
            <SlotGrid
              slots={daySlots.map((s) => ({ key: s.startsAt, label: timeLabel(s.startsAt) }))}
              selected={selected}
              onSelect={setPicked}
            />
          )}
        </View>

        {props.mode === 'new' ? (
          <View style={{ gap: 8 }}>
            <Text variant="caption" tone="muted">
              {t('schedule.form.repeat')}
            </Text>
            <SegmentedPill
              items={[
                { label: t('schedule.form.repeatNone'), value: 'none' },
                { label: t('schedule.form.repeatWeekly'), value: '1' },
                { label: t('schedule.form.repeatBiweekly'), value: '2' },
              ]}
              selected={repeat}
              onChange={(v) => setRepeat(v as Repeat)}
            />
            {repeat !== 'none' ? (
              <View style={{ gap: theme.space[3] }}>
                <SegmentedPill
                  items={[
                    { label: t('schedule.form.endsCount'), value: 'count' },
                    { label: t('schedule.form.endsDate'), value: 'date' },
                  ]}
                  selected={ends}
                  onChange={(v) => setEnds(v as 'count' | 'date')}
                />
                {ends === 'count' ? (
                  <MeasureStepper
                    value={t('schedule.form.sessions', { count })}
                    unit=""
                    onDecrement={() => setCount((c) => Math.max(2, c - 1))}
                    onIncrement={() => setCount((c) => Math.min(26, c + 1))}
                    decrementLabel={t('schedule.availability.less')}
                    incrementLabel={t('schedule.availability.more')}
                  />
                ) : (
                  <DateField
                    label={t('schedule.form.endsOn')}
                    value={until}
                    minDate={dayKey}
                    onChange={setUntil}
                    placeholder={t('common.datePicker.open')}
                    locale={locale}
                    labels={{
                      open: t('common.datePicker.open'),
                      title: t('common.datePicker.title'),
                      clear: t('common.datePicker.clear'),
                      done: t('common.datePicker.done'),
                      previousMonth: t('common.datePicker.previousMonth'),
                      nextMonth: t('common.datePicker.nextMonth'),
                      chooseYear: t('common.datePicker.chooseYear'),
                    }}
                  />
                )}
                {firstDst ? (
                  <Banner
                    variant="warn"
                    message={`${t('schedule.form.dstTitle', { date: dayLabel(firstDst.startsAt, locale) })} — ${t('schedule.form.dstBody')}`}
                  />
                ) : null}
                {seriesConflict ? <Banner variant="danger" message={t('schedule.form.seriesTaken')} /> : null}
                {series.error ? <Banner variant="danger" message={t(bookingErrorKey(series.error))} /> : null}
                {series.rows.length ? (
                  <View style={{ gap: 4 }}>
                    <Text style={{ fontWeight: '700' }}>{t('schedule.form.seriesTitle')}</Text>
                    {series.rows.map((r) => (
                      <View key={r.n} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 }}>
                        <Text numeric tone="muted" style={{ width: 24 }}>
                          {String(r.n).padStart(2, '0')}
                        </Text>
                        <Text style={{ flex: 1 }}>{dayLabel(r.startsAt, locale)}</Text>
                        {r.afterOffsetChange ? <Tag tone="warn" label={t('schedule.form.afterChange')} /> : null}
                        {r.conflict ? <Tag tone="danger" label={t('schedule.form.taken')} /> : null}
                        <Text numeric>{timeLabel(r.startsAt)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <FooterBar>
        <Button label={cta} variant="primary" size="lg" loading={submitting} disabled={blocked} onPress={onCta} />
      </FooterBar>

      <BottomSheet visible={picking} onDismiss={() => setPicking(false)} dismissLabel={t('schedule.form.cancel')}>
        <Text variant="h3">{t('schedule.form.pickClient')}</Text>
        <ScrollView style={{ maxHeight: 360 }}>
          {[...(roster ?? [])]
            .sort((a, b) => Number(b.isSelf) - Number(a.isSelf))
            .map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                onPress={() => {
                  setClientId(c.id);
                  setPicking(false);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 }}
              >
                <Avatar name={c.isSelf ? t('schedule.me') : c.displayName} size={32} />
                <Text style={{ flex: 1, fontWeight: c.id === clientId ? '700' : '400' }}>{c.isSelf ? t('schedule.me') : c.displayName}</Text>
              </Pressable>
            ))}
        </ScrollView>
      </BottomSheet>

      {props.mode === 'edit' ? (
        <BottomSheet visible={scopeOpen} onDismiss={() => setScopeOpen(false)} dismissLabel={t('schedule.form.keep')}>
          <Text variant="h3">{t('schedule.form.scopeTitle')}</Text>
          <Button label={t('schedule.form.scopeOne')} variant="ghost" onPress={() => void submitMove('one')} />
          <Button
            label={`${t('schedule.form.scopeFollowing')} · ${t('schedule.form.scopeFollowingSub', { count: props.seriesLeft })}`}
            variant="ghost"
            onPress={() => void submitMove('following')}
          />
          <Button label={t('schedule.form.keep')} variant="link" onPress={() => setScopeOpen(false)} />
        </BottomSheet>
      ) : null}
    </Screen>
  );
}

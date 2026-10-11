import {
  ALL_LENGTHS, bookingErrorKey, breakBefore, copyMondayToWeekdays, DEFAULT_RULES, dayRanges, durationLabel, hhmm, localDayKey,
  parseHhmm, stepRule, toggleLength, validateHours, weeklyMinutes,
  type BookingRules, type ExceptionInput, type HoursRange, type RuleKey,
} from '@forge/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { useOffline } from '../../../lib/offline/offlineContext';
import { dayLabel, dowLabel } from '../../../lib/schedule/format';
import { OfflineNote } from '../../../lib/schedule/OfflineNote';
import { saveAvailability } from '../../../lib/schedule/scheduleApi';
import { useAvailability } from '../../../lib/schedule/useAvailability';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Banner, BottomSheet, Button, DateField, EmptyState, MeasureStepper, MonthGrid, NavHeader, Screen, SegmentedPill,
  Skeleton, Tag, Text, TimeRangePill, Toggle,
} from '../../../ui';

type Tab = 'hours' | 'exceptions' | 'rules';
const ROW_ORDER = [1, 2, 3, 4, 5, 6, 0];
/** 2026-10-11 is a Sunday, so + dow gives that weekday's name in any locale. */
const SUNDAY = new Date(2026, 9, 11);
const STEP = 15;
const LAST = 23 * 60 + 45;

const shift = (hm: string, by: number) => hhmm(Math.min(LAST, Math.max(0, (parseHhmm(hm) ?? 0) + by)));
const sameRange = (a: HoursRange, b: HoursRange) => a.dow === b.dow && a.start === b.start && a.end === b.end;

export default function AvailabilityScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const data = useAvailability(auth.user?.id);
  const locale = i18n.language;

  const [tab, setTab] = useState<Tab>('hours');
  const [seeded, setSeeded] = useState(0);
  const [hours, setHours] = useState<HoursRange[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionInput[]>([]);
  const [rules, setRules] = useState<BookingRules>(DEFAULT_RULES);
  // Seed the draft from each successful load during render, behind a version guard (never from an effect).
  if (data.version > 0 && data.version !== seeded) {
    setSeeded(data.version);
    setHours(data.hours);
    setExceptions(data.exceptions);
    setRules(data.rules);
  }

  // The range editor keeps the row it opened from, so Done/Remove find it however far both ends moved.
  const [editing, setEditing] = useState<{ original: HoursRange; draft: HoursRange } | null>(null);
  const [exDraft, setExDraft] = useState<(ExceptionInput & { existing: boolean }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ variant: 'success' | 'danger'; message: string } | null>(null);
  const [flagged, setFlagged] = useState<Record<string, number>>({});
  const [today] = useState(() => new Date());

  const dayName = (dow: number) => dowLabel(new Date(SUNDAY.getFullYear(), SUNDAY.getMonth(), SUNDAY.getDate() + dow), locale);

  const setDay = (dow: number, on: boolean) =>
    setHours((h) => (on ? (dayRanges(h, dow).length ? h : [...h, { dow, start: '06:00', end: '12:00' }]) : h.filter((r) => r.dow !== dow)));

  const addRange = (dow: number) =>
    setHours((h) => {
      const last = dayRanges(h, dow).at(-1);
      const start = last ? Math.min(LAST - 60, (parseHhmm(last.end) ?? 0) + 60) : 6 * 60;
      const end = Math.min(LAST, start + 120);
      return end > start ? [...h, { dow, start: hhmm(start), end: hhmm(end) }] : h;
    });

  const replaceRange = (old: HoursRange, next: HoursRange | null) =>
    setHours((h) => {
      const i = h.findIndex((r) => sameRange(r, old));
      if (i === -1) return h;
      const copy = [...h];
      if (next) copy[i] = next;
      else copy.splice(i, 1);
      return copy;
    });

  async function save() {
    setNotice(null);
    const check = validateHours(hours);
    if (!check.ok) {
      setTab('hours');
      setNotice({ variant: 'danger', message: t(bookingErrorKey(check.code)) });
      return;
    }
    setSaving(true);
    const r = await saveAvailability(hours, exceptions, rules);
    setSaving(false);
    if (r.error) {
      setNotice({ variant: 'danger', message: t(bookingErrorKey(r.error)) });
      return;
    }
    const byDay: Record<string, number> = {};
    for (const b of r.data) {
      const k = localDayKey(new Date(b.startsAt));
      byDay[k] = (byDay[k] ?? 0) + 1;
    }
    setFlagged(byDay);
    setNotice({
      variant: 'success',
      message: r.data.length ? t('schedule.availability.savedFlagged', { count: r.data.length }) : t('schedule.availability.saved'),
    });
    data.refetch();
  }

  const hoursTab = () => (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="caption" tone="muted">
        {t('schedule.availability.weeklyTotal', { total: durationLabel(weeklyMinutes(hours)), tz: data.timezone })}
      </Text>
      {hours.length === 0 ? (
        <EmptyState
          icon="clock"
          title={t('schedule.availability.emptyTitle')}
          body={t('schedule.availability.emptyBody')}
          actionLabel={t('schedule.availability.emptyCta')}
          onAction={() => setDay(1, true)}
        />
      ) : null}
      {ROW_ORDER.map((dow) => {
        const ranges = dayRanges(hours, dow);
        return (
          <View key={dow} style={{ gap: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <Toggle label={dayName(dow)} value={ranges.length > 0} onValueChange={(on) => setDay(dow, on)} />
            {ranges.length === 0 ? (
              <Text variant="caption" tone="muted">
                {t('schedule.availability.unavailable')}
              </Text>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {ranges.map((r, i) => (
                  <View key={r.start} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {breakBefore(ranges, i) ? (
                      <TimeRangePill
                        variant="break"
                        label={t('schedule.availability.breakLabel', { length: durationLabel(breakBefore(ranges, i)!) })}
                      />
                    ) : null}
                    <TimeRangePill label={`${r.start} – ${r.end}`} onPress={() => setEditing({ original: r, draft: r })} />
                  </View>
                ))}
                <TimeRangePill label={t('schedule.availability.add')} onPress={() => addRange(dow)} />
              </View>
            )}
          </View>
        );
      })}
      <Button label={t('schedule.availability.copyMonday')} variant="link" onPress={() => setHours((h) => copyMondayToWeekdays(h))} />
    </View>
  );

  const exceptionsTab = () => {
    const y = today.getFullYear();
    const m = today.getMonth();
    const dots: Record<number, string[]> = {};
    for (const x of exceptions) {
      const d = new Date(x.date + 'T12:00:00');
      if (d.getFullYear() === y && d.getMonth() === m) {
        dots[d.getDate()] = [x.kind === 'off' ? theme.colors.textMuted : theme.colors.accent];
      }
    }
    const open = (date: string) => {
      const found = exceptions.find((x) => x.date === date);
      setExDraft(found ? { ...found, existing: true } : { date, kind: 'off', ranges: null, existing: false });
    };
    return (
      <View style={{ gap: theme.space[3] }}>
        <MonthGrid
          year={y}
          month0={m}
          dowLabels={ROW_ORDER.map(dayName)}
          dots={dots}
          selected={null}
          today={today.getDate()}
          onSelect={(day) => {
            if (day >= today.getDate()) open(localDayKey(new Date(y, m, day)));
          }}
        />
        <Text style={{ fontWeight: '700' }}>{t('schedule.availability.upcoming')}</Text>
        {exceptions.length === 0 ? (
          <Text variant="caption" tone="muted">
            {t('schedule.availability.noExceptions')}
          </Text>
        ) : (
          [...exceptions]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((x) => (
              <Pressable
                key={x.date}
                accessibilityRole="button"
                onPress={() => open(x.date)}
                style={{ gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, fontWeight: '600' }}>{dayLabel(x.date, locale)}</Text>
                  <Tag tone={x.kind === 'off' ? 'neutral' : 'accent'} label={x.kind === 'off' ? t('schedule.availability.dayOff') : t('schedule.availability.extra')} />
                </View>
                {x.kind === 'extra' && x.ranges ? (
                  <Text variant="caption" tone="muted" numeric>
                    {x.ranges.map((r) => `${r.start} – ${r.end}`).join(', ')}
                  </Text>
                ) : null}
                {flagged[x.date] ? (
                  <Text variant="caption" style={{ color: theme.colors.onWarnSurface }}>
                    {t('schedule.availability.flagged', { count: flagged[x.date] })}
                  </Text>
                ) : null}
              </Pressable>
            ))
        )}
        <Button label={t('schedule.availability.addException')} variant="link" onPress={() => open(localDayKey(today))} />
      </View>
    );
  };

  const ruleRow = (key: RuleKey, label: string, value: string, help: string) => (
    <View key={key} style={{ gap: 6 }}>
      <Text style={{ fontWeight: '600' }}>{label}</Text>
      <MeasureStepper
        value={value}
        unit=""
        onDecrement={() => setRules((r) => stepRule(r, key, -1))}
        onIncrement={() => setRules((r) => stepRule(r, key, 1))}
        decrementLabel={t('schedule.availability.less')}
        incrementLabel={t('schedule.availability.more')}
      />
      <Text variant="caption" tone="muted">
        {help}
      </Text>
    </View>
  );

  const rulesTab = () => (
    <View style={{ gap: theme.space[4] }}>
      <View style={{ gap: 8 }}>
        <Text style={{ fontWeight: '600' }}>{t('schedule.availability.lengthsTitle')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {ALL_LENGTHS.map((len) => {
            const on = rules.lengths.includes(len);
            return (
              <Pressable
                key={len}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setRules((r) => ({ ...r, lengths: toggleLength(r.lengths, len) }))}
                style={{
                  flex: 1,
                  minHeight: theme.touchTarget,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: theme.radius.md,
                  borderWidth: 1.5,
                  borderColor: on ? theme.colors.accent : theme.colors.border,
                  backgroundColor: on ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
                }}
              >
                <Text numeric style={{ fontWeight: '700', color: on ? theme.colors.onAccentSurfaceSoft : theme.colors.textPrimary }}>
                  {len}
                </Text>
                <Text style={{ fontSize: 11, color: on ? theme.colors.onAccentSurfaceSoft : theme.colors.textMuted }}>
                  {t('schedule.availability.min')}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text variant="caption" tone="muted">
          {t('schedule.availability.lengthsHelp')}
        </Text>
      </View>
      {ruleRow(
        'bufferMin',
        t('schedule.availability.buffer'),
        t('schedule.availability.bufferValue', { min: rules.bufferMin }),
        rules.bufferMin ? t('schedule.availability.bufferHelp', { min: rules.bufferMin }) : t('schedule.availability.bufferHelpZero'),
      )}
      {ruleRow(
        'windowWeeks',
        t('schedule.availability.window'),
        t('schedule.availability.windowValue', { weeks: rules.windowWeeks }),
        t('schedule.availability.windowHelp', { weeks: rules.windowWeeks }),
      )}
      {ruleRow(
        'cutoffHours',
        t('schedule.availability.cutoff'),
        t('schedule.availability.cutoffValue', { hours: rules.cutoffHours }),
        rules.cutoffHours ? t('schedule.availability.cutoffHelp', { hours: rules.cutoffHours }) : t('schedule.availability.cutoffHelpZero'),
      )}
    </View>
  );

  return (
    <Screen padded={false}>
      <NavHeader
        title={t('schedule.availability.title')}
        divider
        leading={
          <Button
            label={t('schedule.detail.back')}
            variant="link"
            icon="chevronBack"
            onPress={() => router.dismissTo('/(app)/(tabs)/schedule')}
          />
        }
        trailing={
          <Button
            label={t('schedule.availability.save')}
            variant="link"
            tone="accent"
            loading={saving}
            disabled={saving || !offline.online || data.loading || !!data.error}
            onPress={() => void save()}
          />
        }
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: theme.space[3], paddingBottom: theme.space[6], gap: theme.space[4] }}>
        <SegmentedPill
          items={[
            { label: t('schedule.availability.tabs.hours'), value: 'hours' },
            { label: t('schedule.availability.tabs.exceptions'), value: 'exceptions' },
            { label: t('schedule.availability.tabs.rules'), value: 'rules' },
          ]}
          selected={tab}
          onChange={(v) => setTab(v as Tab)}
        />
        {!offline.online ? (
          <OfflineNote title={t('schedule.availability.offline')} body={t('schedule.availability.offlineBody')} />
        ) : null}
        {notice ? <Banner variant={notice.variant} message={notice.message} /> : null}
        {data.loading ? (
          <Skeleton height={320} radius={14} />
        ) : data.error ? (
          <EmptyState
            icon="alert"
            tone="danger"
            title={t('schedule.availability.errorTitle')}
            body={t('schedule.availability.errorBody')}
            actionLabel={t('schedule.retry')}
            onAction={data.refetch}
          />
        ) : tab === 'hours' ? (
          hoursTab()
        ) : tab === 'exceptions' ? (
          exceptionsTab()
        ) : (
          rulesTab()
        )}
      </ScrollView>

      <BottomSheet visible={editing !== null} onDismiss={() => setEditing(null)} dismissLabel={t('schedule.availability.done')}>
        {editing ? (
          <View style={{ gap: theme.space[3] }}>
            <Text variant="h3">{dayName(editing.draft.dow)}</Text>
            <Text style={{ fontWeight: '600' }}>{t('schedule.availability.from')}</Text>
            <MeasureStepper
              value={editing.draft.start}
              unit=""
              onDecrement={() => setEditing((e) => (e ? { ...e, draft: { ...e.draft, start: shift(e.draft.start, -STEP) } } : e))}
              onIncrement={() => setEditing((e) => (e ? { ...e, draft: { ...e.draft, start: shift(e.draft.start, STEP) } } : e))}
              decrementLabel={t('schedule.availability.earlier')}
              incrementLabel={t('schedule.availability.later')}
            />
            <Text style={{ fontWeight: '600' }}>{t('schedule.availability.to')}</Text>
            <MeasureStepper
              value={editing.draft.end}
              unit=""
              onDecrement={() => setEditing((e) => (e ? { ...e, draft: { ...e.draft, end: shift(e.draft.end, -STEP) } } : e))}
              onIncrement={() => setEditing((e) => (e ? { ...e, draft: { ...e.draft, end: shift(e.draft.end, STEP) } } : e))}
              decrementLabel={t('schedule.availability.earlier')}
              incrementLabel={t('schedule.availability.later')}
            />
            <Button
              label={t('schedule.availability.done')}
              variant="primary"
              onPress={() => {
                replaceRange(editing.original, editing.draft);
                setEditing(null);
              }}
            />
            <Button
              label={t('schedule.availability.remove')}
              variant="link"
              tone="danger"
              onPress={() => {
                replaceRange(editing.original, null);
                setEditing(null);
              }}
            />
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet visible={exDraft !== null} onDismiss={() => setExDraft(null)} dismissLabel={t('schedule.availability.done')}>
        {exDraft ? (
          <View style={{ gap: theme.space[3] }}>
            <DateField
              label={t('schedule.availability.exceptionDate')}
              value={exDraft.date}
              minDate={localDayKey(today)}
              onChange={(date) => setExDraft((d) => (d ? { ...d, date } : d))}
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
            <Text style={{ fontWeight: '600' }}>{t('schedule.availability.exceptionKind')}</Text>
            <SegmentedPill
              items={[
                { label: t('schedule.availability.dayOff'), value: 'off' },
                { label: t('schedule.availability.extra'), value: 'extra' },
              ]}
              selected={exDraft.kind}
              onChange={(v) =>
                setExDraft((d) =>
                  d ? { ...d, kind: v as 'off' | 'extra', ranges: v === 'extra' ? (d.ranges ?? [{ start: '17:00', end: '19:00' }]) : null } : d,
                )
              }
            />
            {exDraft.kind === 'extra' && exDraft.ranges?.[0] ? (
              <View style={{ gap: 6 }}>
                <MeasureStepper
                  value={exDraft.ranges[0].start}
                  unit=""
                  onDecrement={() => setExDraft((d) => (d?.ranges ? { ...d, ranges: [{ ...d.ranges[0]!, start: shift(d.ranges[0]!.start, -STEP) }] } : d))}
                  onIncrement={() => setExDraft((d) => (d?.ranges ? { ...d, ranges: [{ ...d.ranges[0]!, start: shift(d.ranges[0]!.start, STEP) }] } : d))}
                  decrementLabel={t('schedule.availability.earlier')}
                  incrementLabel={t('schedule.availability.later')}
                />
                <MeasureStepper
                  value={exDraft.ranges[0].end}
                  unit=""
                  onDecrement={() => setExDraft((d) => (d?.ranges ? { ...d, ranges: [{ ...d.ranges[0]!, end: shift(d.ranges[0]!.end, -STEP) }] } : d))}
                  onIncrement={() => setExDraft((d) => (d?.ranges ? { ...d, ranges: [{ ...d.ranges[0]!, end: shift(d.ranges[0]!.end, STEP) }] } : d))}
                  decrementLabel={t('schedule.availability.earlier')}
                  incrementLabel={t('schedule.availability.later')}
                />
              </View>
            ) : null}
            <Button
              label={t('schedule.availability.done')}
              variant="primary"
              onPress={() => {
                const { existing: _existing, ...x } = exDraft;
                setExceptions((all) => [...all.filter((e) => e.date !== x.date), x]);
                setExDraft(null);
              }}
            />
            {exDraft.existing ? (
              <Button
                label={t('schedule.availability.remove')}
                variant="link"
                tone="danger"
                onPress={() => {
                  setExceptions((all) => all.filter((e) => e.date !== exDraft.date));
                  setExDraft(null);
                }}
              />
            ) : null}
          </View>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

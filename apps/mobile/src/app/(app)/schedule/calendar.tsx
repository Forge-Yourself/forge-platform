import { addDays, buildIcs, eventTitle } from '@forge/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import {
  connectGoogle,
  disconnectGoogle,
  fetchLink,
  fetchOverlaps,
  fetchQueueCount,
  parseGcalResult,
  setBusyCalendars,
  syncNow,
  type CalendarLink,
  type GcalResult,
} from '../../../lib/calendar/api';
import { shareIcs } from '../../../lib/calendar/share';
import { fetchRoster } from '../../../lib/clients/useClientList';
import { useOffline } from '../../../lib/offline/offlineContext';
import { timeLabel } from '../../../lib/schedule/format';
import { OfflineNote } from '../../../lib/schedule/OfflineNote';
import { fetchPtBookings } from '../../../lib/schedule/scheduleApi';
import { useTheme } from '../../../theme/ThemeProvider';
import { Banner, BottomSheet, Button, EmptyState, Icon, NavHeader, Screen, SectionCard, SectionLabel, Skeleton, Text } from '../../../ui';

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

type Loaded = { link: CalendarLink | null; queued: number; overlaps: number };

const RESULT_BANNER: Record<GcalResult, { variant: 'success' | 'danger' | 'info'; key: string } | null> = {
  connected: { variant: 'success', key: 'calendar.result.connected' },
  nocalendars: null,
  denied: { variant: 'info', key: 'calendar.result.denied' },
  scopes: { variant: 'danger', key: 'calendar.result.scopes' },
  error: { variant: 'danger', key: 'calendar.result.error' },
  not_configured: { variant: 'danger', key: 'calendar.result.notConfigured' },
  unreachable: { variant: 'danger', key: 'calendar.unreachableTitle' },
  cancelled: null,
};

/**
 * Design screen 06 · Calendar sync. Not connected · Connected · Sync stopped
 * · No calendars found · Couldn't reach Google · Offline, with the .ics
 * export in every state so a PT who won't connect Google still gets a
 * calendar (design note). Google itself is only ever touched by apps/web.
 */
export default function CalendarSync() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const params = useLocalSearchParams<{ gcal?: string }>();
  const userId = auth.user?.id;

  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [result, setResult] = useState<GcalResult | null>(() => parseGcalResult(`?gcal=${params.gcal ?? ''}`));
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [exportState, setExportState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const seq = useRef(0);

  const read = useCallback(async (): Promise<Loaded | null> => {
    if (!userId) return null;
    const today = startOfToday();
    const [link, queued, ov] = await Promise.all([
      fetchLink(userId),
      fetchQueueCount(userId),
      fetchOverlaps(today.toISOString(), addDays(today, 7).toISOString()).catch(() => ({ data: null })),
    ]);
    if (link.error !== null) return null;
    return { link: link.data, queued, overlaps: new Set((ov.data ?? []).map((o) => o.bookingId)).size };
  }, [userId]);

  const load = useCallback(
    async (opts: { sync?: boolean } = {}) => {
      const mine = ++seq.current;
      const first = await read();
      if (mine !== seq.current) return;
      setLoadError(first === null);
      if (first) setData(first);

      // Opening the screen is a nudge (spec D8): bring Google up to date, then
      // show what it said. A failure here is the "Couldn't reach Google" banner.
      if (opts.sync && first?.link && offline.online) {
        const status = await syncNow(false);
        if (mine !== seq.current) return;
        setUnreachable(status === 'unreachable');
        if (status === 'synced' || status === 'revoked') {
          const after = await read();
          if (mine === seq.current && after) setData(after);
        }
      }
    },
    [read, offline.online],
  );

  useFocusEffect(
    useCallback(() => {
      void load({ sync: true });
      return () => {
        seq.current++;
      };
    }, [load]),
  );

  async function connect(selectAccount = false) {
    setBusy(true);
    setResult(null);
    const r = await connectGoogle({ selectAccount });
    setBusy(false);
    setResult(r);
    await load();
  }

  async function disconnect() {
    setSheet(false);
    setBusy(true);
    const ok = await disconnectGoogle();
    setBusy(false);
    if (!ok) setSaveError(true);
    setResult(null);
    await load();
  }

  async function toggleCalendar(id: string) {
    if (!data?.link) return;
    const on = data.link.busyCalendarIds.includes(id);
    const next = on ? data.link.busyCalendarIds.filter((x) => x !== id) : [...data.link.busyCalendarIds, id];
    setSaveError(false);
    setData({ ...data, link: { ...data.link, busyCalendarIds: next } });
    if (!(await setBusyCalendars(next))) {
      setSaveError(true);
      await load();
      return;
    }
    // A new tick should block slots now, not in five minutes.
    const status = await syncNow(true);
    setUnreachable(status === 'unreachable');
  }

  async function exportIcs() {
    if (!userId) return;
    setExportState('busy');
    const today = startOfToday();
    const [b, roster] = await Promise.all([
      fetchPtBookings(userId, today.toISOString(), addDays(today, 28).toISOString()),
      fetchRoster(userId),
    ]);
    if (b.error || roster.error) {
      setExportState('error');
      return;
    }
    const byId = Object.fromEntries(roster.rows.map((r) => [r.id, r]));
    const events = (b.data ?? [])
      .filter((row) => row.status !== 'cancelled')
      .map((row) => {
        const c = row.client_id ? byId[row.client_id] : undefined;
        return {
          uid: row.id,
          title: eventTitle(c?.displayName, c?.isSelf ?? false),
          start: row.starts_at,
          end: row.ends_at,
          sequence: Math.floor(Date.parse(row.updated_at) / 1000),
        };
      });
    const ok = await shareIcs('forge-sessions.ics', buildIcs(events, new Date()), t('calendar.exportTitle')).catch(() => false);
    setExportState(ok ? 'done' : 'error');
  }

  const header = (
    <NavHeader
      title={t('calendar.title')}
      leading={<Button label={t('calendar.back')} variant="link" icon="chevronBack" onPress={() => router.dismissTo('/(app)/(tabs)/schedule')} />}
    />
  );

  const link = data?.link ?? null;
  const banner = result ? RESULT_BANNER[result] : null;
  const locked = !offline.online || busy;

  const notConnected = (
    <View style={{ gap: theme.space[3] }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          overflow: 'hidden',
        }}
      >
        <View style={{ height: 14, backgroundColor: theme.colors.accent }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text numeric style={{ fontWeight: '700', fontSize: 18 }}>
            {new Date().getDate()}
          </Text>
        </View>
      </View>
      <Text variant="h2">{t('calendar.connectTitle')}</Text>
      <Text tone="muted">{t('calendar.connectBody')}</Text>
      <SectionCard>
        {(
          [
            ['forgeToGoogle', 'forgeToGoogleBody'],
            ['googleToForge', 'googleToForgeBody'],
            ['private', 'privateBody'],
          ] as const
        ).map(([title, body], i) => (
          <View key={title} style={{ padding: 14, gap: 2, borderBottomWidth: i < 2 ? 1 : 0, borderBottomColor: theme.colors.border }}>
            <Text style={{ fontWeight: '700' }}>{t(`calendar.${title}`)}</Text>
            <Text variant="caption" tone="muted">
              {t(`calendar.${body}`)}
            </Text>
          </View>
        ))}
      </SectionCard>
      <Button label={t('calendar.connect')} variant="primary" size="lg" loading={busy} disabled={locked} onPress={() => void connect()} />
    </View>
  );

  const stopped = (l: CalendarLink) => {
    const time = l.errorAt ? timeLabel(l.errorAt) : '';
    return (
      <View style={{ gap: theme.space[2] }}>
        <View style={{ padding: 14, borderRadius: theme.radius.lg, backgroundColor: theme.colors.dangerSurface, gap: 4 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color: theme.colors.onDangerSurface }}>
            {t('calendar.stoppedLabel', { time })}
          </Text>
          <Text style={{ fontWeight: '700' }}>{t('calendar.stoppedTitle')}</Text>
          <Text tone="muted">
            {data && data.queued > 0 ? t('calendar.stoppedBody', { count: data.queued, time }) : t('calendar.stoppedBodyNone', { time })}
          </Text>
        </View>
        <Button label={t('calendar.reconnect')} variant="primary" size="lg" loading={busy} disabled={locked} onPress={() => void connect()} />
        <Button label={t('calendar.disconnectInstead')} variant="link" disabled={locked} onPress={() => setSheet(true)} />
      </View>
    );
  };

  const connected = (l: CalendarLink) => {
    const sub = l.lastSyncedAt
      ? l.googleEmail
        ? t('calendar.connectedSub', { email: l.googleEmail, time: timeLabel(l.lastSyncedAt) })
        : t('calendar.connectedSubNoEmail', { time: timeLabel(l.lastSyncedAt) })
      : l.googleEmail
        ? t('calendar.connectedSubNever', { email: l.googleEmail })
        : t('calendar.connectedSubNeverNoEmail');
    return (
      <View style={{ gap: theme.space[2] }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            padding: 14,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.successAccent }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700' }}>{t('calendar.connected')}</Text>
            <Text variant="caption" tone="muted">
              {sub}
            </Text>
          </View>
        </View>

        {data && data.overlaps > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(app)/schedule/overlaps')}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 12,
              paddingHorizontal: 14,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.warnSurface,
            }}
          >
            <Text style={{ fontWeight: '700', color: theme.colors.onWarnSurface }}>{t('calendar.overlaps', { count: data.overlaps })}</Text>
            <Text style={{ fontWeight: '600', color: theme.colors.onWarnSurface }}>{t('calendar.review')} ›</Text>
          </Pressable>
        ) : null}

        {l.calendars.length === 0 ? (
          <EmptyState
            icon="calendar"
            title={t('calendar.noCalendarsTitle')}
            body={t('calendar.noCalendarsBody')}
            actionLabel={offline.online ? t('calendar.useAnother') : undefined}
            onAction={offline.online ? () => void connect(true) : undefined}
          />
        ) : (
          <View style={{ gap: theme.space[2], marginTop: theme.space[3] }}>
            <SectionLabel>{t('calendar.busyLabel')}</SectionLabel>
            <SectionCard>
              {l.calendars.map((c, i) => {
                const on = l.busyCalendarIds.includes(c.id);
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: locked }}
                    // react-native-web drops accessibilityState; aria-checked reaches the DOM.
                    aria-checked={on}
                    accessibilityLabel={c.summary}
                    disabled={locked}
                    onPress={() => void toggleCalendar(c.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      minHeight: 56,
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderBottomWidth: i < l.calendars.length - 1 ? 1 : 0,
                      borderBottomColor: theme.colors.border,
                      opacity: locked ? 0.6 : 1,
                    }}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        borderWidth: 2,
                        borderColor: on ? theme.colors.accent : theme.colors.border,
                        backgroundColor: on ? theme.colors.accent : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {on ? <Icon name="check" size={14} color={theme.colors.onAccent} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '600' }}>{c.summary}</Text>
                      {c.primary ? (
                        <Text variant="caption" tone="muted">
                          {t('calendar.primary')}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </SectionCard>
          </View>
        )}

        <View style={{ gap: theme.space[2], marginTop: theme.space[3] }}>
          <SectionLabel>{t('calendar.writeLabel')}</SectionLabel>
          <View
            style={{
              minHeight: 52,
              paddingHorizontal: 14,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text style={{ fontWeight: '600' }}>{t('calendar.forgeCalendar')}</Text>
            <Text variant="caption" tone="muted">
              {t('calendar.newCalendar')}
            </Text>
          </View>
        </View>
        <Button label={t('calendar.disconnect')} variant="link" tone="danger" disabled={locked} onPress={() => setSheet(true)} />
      </View>
    );
  };

  return (
    <Screen padded={false}>
      {header}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: theme.space[2], paddingBottom: theme.space[6], gap: theme.space[3] }}>
        {!offline.online ? <OfflineNote title={t('calendar.offline')} body={t('calendar.offlineBody')} /> : null}
        {banner ? <Banner variant={banner.variant} message={t(banner.key)} /> : null}
        {saveError ? <Banner variant="danger" message={t('calendar.saveError')} /> : null}
        {unreachable && offline.online ? (
          <View style={{ padding: 14, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceRaised, gap: 2 }}>
            <Text style={{ fontWeight: '700' }}>{t('calendar.unreachableTitle')}</Text>
            <Text variant="caption" tone="muted">
              {t('calendar.unreachableBody')}
            </Text>
          </View>
        ) : null}

        {loadError ? (
          <EmptyState
            icon="alert"
            tone="danger"
            title={t('calendar.errorTitle')}
            body={t('calendar.errorBody')}
            actionLabel={t('schedule.retry')}
            actionVariant="ghost"
            onAction={() => void load()}
          />
        ) : !data ? (
          <View style={{ gap: 8 }}>
            <Skeleton height={64} radius={12} />
            <Skeleton height={160} radius={12} />
          </View>
        ) : !link ? (
          notConnected
        ) : link.status === 'error' ? (
          stopped(link)
        ) : (
          connected(link)
        )}

        <View
          style={{
            marginTop: theme.space[3],
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 12,
            paddingStart: 14,
            paddingEnd: 10,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700' }}>{t('calendar.exportTitle')}</Text>
            <Text variant="caption" tone="muted">
              {exportState === 'done' ? t('calendar.exported') : exportState === 'error' ? t('calendar.exportError') : t('calendar.exportBody')}
            </Text>
          </View>
          <Button label={t('calendar.exportCta')} variant="ghost" loading={exportState === 'busy'} onPress={() => void exportIcs()} />
        </View>
      </ScrollView>

      <BottomSheet visible={sheet} onDismiss={() => setSheet(false)} dismissLabel={t('calendar.sheetKeep')}>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="h3">{t('calendar.sheetTitle')}</Text>
          <Text tone="muted">{t('calendar.sheetBody')}</Text>
          <Button label={t('calendar.sheetConfirm')} variant="primary" tone="danger" size="lg" onPress={() => void disconnect()} />
          <Button label={t('calendar.sheetKeep')} variant="link" onPress={() => setSheet(false)} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

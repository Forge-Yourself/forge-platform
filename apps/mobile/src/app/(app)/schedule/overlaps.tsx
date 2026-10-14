import { addDays, overlapGeometry, type Pct } from '@forge/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { fetchOverlaps, keepOverlap, type Overlap } from '../../../lib/calendar/api';
import { fetchRoster } from '../../../lib/clients/useClientList';
import { useOffline } from '../../../lib/offline/offlineContext';
import { dayLabel, timeLabel } from '../../../lib/schedule/format';
import { fetchPtBookings } from '../../../lib/schedule/scheduleApi';
import { useTheme } from '../../../theme/ThemeProvider';
import { Banner, Button, EmptyState, NavHeader, Screen, Skeleton, Text } from '../../../ui';

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

type Row = Overlap & { name: string; isSelf: boolean; clientId: string | null };

const pct = (p: Pct) => ({ left: `${p.left * 100}%` as const, width: `${p.width * 100}%` as const });

/**
 * Design screen 06 · conflict. Each overlap this week is drawn as two bars on
 * one time axis, so the clash is visible without reading times. Move opens
 * the booking's move form; Keep both records the pair so it stops showing.
 * The client is never told (design copy).
 */
export default function Overlaps() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const userId = auth.user?.id;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [keepError, setKeepError] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!userId) return;
    const mine = ++seq.current;
    const today = startOfToday();
    // Bookings for their client ids, the roster for names.
    const [ov, roster, b] = await Promise.all([
      fetchOverlaps(today.toISOString(), addDays(today, 7).toISOString()),
      fetchRoster(userId),
      fetchPtBookings(userId, today.toISOString(), addDays(today, 7).toISOString()),
    ]);
    if (mine !== seq.current) return;
    if (ov.data === null || roster.error) {
      setError(true);
      return;
    }
    setError(false);
    const clientOf = Object.fromEntries((b.data ?? []).map((x) => [x.id, x.client_id]));
    const byId = Object.fromEntries(roster.rows.map((r) => [r.id, r]));
    setRows(
      ov.data.map((o) => {
        const clientId = clientOf[o.bookingId] ?? null;
        const c = clientId ? byId[clientId] : undefined;
        return { ...o, clientId, name: c?.isSelf ? t('schedule.me') : (c?.displayName ?? ''), isSelf: c?.isSelf ?? false };
      }),
    );
  }, [userId, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        seq.current++;
      };
    }, [load]),
  );

  async function keep(r: Row) {
    setKeepError(false);
    if (!(await keepOverlap(r.bookingId, r.busyId))) {
      setKeepError(true);
      return;
    }
    await load();
  }

  const header = (
    // No title: the h2 below says what this is, and Back already names Calendar sync.
    <NavHeader
      leading={<Button label={t('calendar.title')} variant="link" icon="chevronBack" onPress={() => router.dismissTo('/(app)/schedule/calendar')} />}
    />
  );

  const card = (r: Row) => {
    const g = overlapGeometry({ start: r.bookingStart, end: r.bookingEnd }, { start: r.busyStart, end: r.busyEnd });
    const firstName = r.isSelf ? '' : r.name.trim().split(/\s+/)[0] ?? '';
    return (
      <View key={r.bookingId + r.busyId} style={{ gap: theme.space[2] }}>
        <View style={{ padding: 14, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
          <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: theme.colors.textMuted }}>
            {dayLabel(r.bookingStart, i18n.language).toUpperCase()}
          </Text>
          {/* The axis reads left to right in every locale, like a clock face. */}
          <View style={{ direction: 'ltr', height: 96, marginTop: 14 }}>
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', justifyContent: 'space-between' }}>
              {g.ticks.map((tick) => (
                <Text key={tick} numeric style={{ fontSize: 10.5, color: theme.colors.textMuted }}>
                  {timeLabel(tick)}
                </Text>
              ))}
            </View>
            <View
              style={{
                position: 'absolute',
                top: 22,
                height: 30,
                ...pct(g.a),
                borderRadius: 5,
                backgroundColor: theme.colors.accentSurfaceSoft,
                borderLeftWidth: 3,
                borderLeftColor: theme.colors.accent,
                justifyContent: 'center',
                paddingHorizontal: 8,
                overflow: 'hidden',
              }}
            >
              <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: theme.colors.onAccentSurfaceSoft }}>
                {r.name || t('schedule.me')}
              </Text>
            </View>
            <View
              style={{
                position: 'absolute',
                top: 58,
                height: 30,
                ...pct(g.b),
                borderRadius: 5,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderLeftWidth: 3,
                borderLeftColor: theme.colors.textMuted,
                justifyContent: 'center',
                paddingHorizontal: 8,
                overflow: 'hidden',
              }}
            >
              <Svg style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
                <Defs>
                  <Pattern id="forge-gcal-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <Rect width="6" height="12" fill={theme.colors.surfaceRaised} />
                  </Pattern>
                </Defs>
                <Rect width="100%" height="100%" fill="url(#forge-gcal-hatch)" />
              </Svg>
              <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: theme.colors.textSecondary }}>
                {r.title ? t('calendar.googleBar', { title: r.title }) : t('calendar.googleBarNoTitle')}
              </Text>
            </View>
            {g.overlap ? (
              <View
                style={{
                  position: 'absolute',
                  top: 18,
                  bottom: 4,
                  ...pct(g.overlap),
                  backgroundColor: 'rgba(199,120,0,0.16)',
                  borderLeftWidth: 1.5,
                  borderRightWidth: 1.5,
                  borderStyle: 'dashed',
                  borderColor: theme.colors.warnAccent,
                }}
              />
            ) : null}
          </View>
          <Text style={{ marginTop: 8, fontWeight: '600', color: theme.colors.onWarnSurface }}>
            {t('calendar.overlapRange', { range: `${timeLabel(r.overlapStart)} – ${timeLabel(r.overlapEnd)}`, min: g.overlapMin })}
          </Text>
        </View>
        <Button
          label={firstName ? t('calendar.move', { name: firstName }) : t('calendar.moveNoName')}
          variant="primary"
          size="lg"
          disabled={!offline.online}
          onPress={() => router.push({ pathname: '/(app)/schedule/[id]/edit', params: { id: r.bookingId, from: 'overlaps' } })}
        />
        <Button label={t('calendar.keep')} variant="ghost" size="lg" disabled={!offline.online} onPress={() => void keep(r)} />
        <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {firstName ? t('calendar.notTold', { name: firstName }) : t('calendar.notToldNoName')}
        </Text>
      </View>
    );
  };

  return (
    <Screen padded={false}>
      {header}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: theme.space[2], paddingBottom: theme.space[6], gap: theme.space[4] }}>
        {keepError ? <Banner variant="danger" message={t('calendar.saveError')} /> : null}
        {error ? (
          <EmptyState icon="alert" tone="danger" title={t('calendar.errorTitle')} body={t('calendar.errorBody')} actionLabel={t('schedule.retry')} actionVariant="ghost" onAction={() => void load()} />
        ) : !rows ? (
          <Skeleton height={220} radius={12} />
        ) : rows.length === 0 ? (
          <EmptyState icon="calendar" title={t('calendar.overlapsNoneTitle')} body={t('calendar.overlapsNoneBody')} />
        ) : (
          <>
            <View style={{ gap: 4 }}>
              <Text variant="h2">{t('calendar.overlaps', { count: new Set(rows.map((r) => r.bookingId)).size })}</Text>
              <Text tone="muted">{t('calendar.overlapsBody')}</Text>
            </View>
            {rows.map(card)}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

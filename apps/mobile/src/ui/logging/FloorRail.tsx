import { formatElapsed, remainingSec, restPhase, type WeekRow } from '@forge/shared';
import { router } from 'expo-router';
import { memo, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { StartSessionSheet } from '../../lib/logging/StartSessionSheet';
import { restStore } from '../../lib/logging/restStore';
import { usePtFloor, type LiveRow, type PtFloor } from '../../lib/logging/usePtFloor';
import { OFFLINE } from '../../lib/offline/cachedFetch';
import { useTheme } from '../../theme/ThemeProvider';
import { Avatar } from '../Avatar';
import { Banner } from '../Banner';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { formatClock } from '../RestTimer';
import { Skeleton } from '../Skeleton';
import { Text } from '../Text';

function Section({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{ fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4, color: theme.colors.textMuted, marginTop: 14, marginBottom: 6, paddingHorizontal: 14 }}
    >
      {children}
    </Text>
  );
}

/**
 * A live session's row owns its own second-by-second clock, so ticking stays
 * local to the rows that show one — the rest of the rail (avatars, This week,
 * the headers) redraws only when the floor data itself changes, not every
 * second. Memoised so a parent re-render with unchanged row data is a no-op.
 */
const LiveSessionRow = memo(function LiveSessionRow({ row, selected, onPress }: { row: LiveRow; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const rests = useSyncExternalStore(restStore.subscribe, restStore.getSnapshot, restStore.getSnapshot);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const rest = rests.rests[row.sessionId];
  const clock = Math.max(now, rests.at);
  const subline =
    rest && restPhase(rest, clock) === 'running'
      ? t('logging.console.resting', { time: formatClock(remainingSec(rest, clock)) })
      : row.startedAt
        ? formatElapsed(Math.floor((clock - new Date(row.startedAt).getTime()) / 1000))
        : '';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 60,
        paddingHorizontal: 14,
        backgroundColor: selected ? theme.colors.accentSurfaceSoft : 'transparent',
        borderStartWidth: 3,
        borderStartColor: selected ? theme.colors.accent : 'transparent',
      }}
    >
      <Avatar name={row.clientName} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700' }}>
          {row.clientName ?? t('logging.console.clientFallback')}
        </Text>
        <Text numeric numberOfLines={1} style={{ fontSize: 11.5, color: theme.colors.textMuted }}>
          {subline}
        </Text>
      </View>
    </Pressable>
  );
});

/** A This-week row never ticks, so it only needs to re-render when its own data changes. */
const WeekClientRow = memo(function WeekClientRow({ row, onStart }: { row: WeekRow; onStart: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 14 }}>
      <Avatar name={row.clientName} size={32} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '600' }}>
          {row.clientName ?? t('logging.console.clientFallback')}
        </Text>
        <Text numeric style={{ fontSize: 11.5, color: theme.colors.textMuted }}>
          {t('logging.console.weekOpen', { week: row.week, n: row.openDays })}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onStart}
        style={{ minHeight: 44, minWidth: 64, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5, borderColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.accentText }}>{t('logging.console.start')}</Text>
      </Pressable>
    </View>
  );
});

/**
 * Live, then This week (spec D9). The rail on the console and the body of the
 * phone switcher: one list, two containers. `onPick` swaps the session in
 * place; Start goes through the existing StartSessionSheet. `floor` is owned
 * by the caller (FloorRail / SwitcherSheet) — this list never calls
 * `usePtFloor` itself, so mounting it twice never runs the pipeline twice.
 */
export function FloorList({ currentSessionId, onPick, floor }: { currentSessionId: string | null; onPick: (sessionId: string) => void; floor: PtFloor }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [starting, setStarting] = useState<string | null>(null);

  if (floor.loading) {
    return (
      <View style={{ padding: 14, gap: 10 }}>
        <Skeleton height={56} />
        <Skeleton height={56} />
      </View>
    );
  }

  if (floor.error) {
    return (
      <View style={{ padding: 14, gap: 10 }}>
        <Banner variant="danger" message={floor.error === OFFLINE ? t('logging.offline.needsConnection') : t('logging.console.loadError')} />
        <Button label={t('common.retry')} variant="link" onPress={() => void floor.refetch()} />
      </View>
    );
  }

  return (
    <>
      <Section>{t('logging.console.live')}</Section>
      {floor.live.length === 0 ? (
        <Text tone="muted" style={{ fontSize: 12.5, paddingHorizontal: 14 }}>
          {t('logging.console.noLive')}
        </Text>
      ) : (
        floor.live.map((l) => (
          <LiveSessionRow key={l.sessionId} row={l} selected={l.sessionId === currentSessionId} onPress={() => onPick(l.sessionId)} />
        ))
      )}

      <Section>{t('logging.console.thisWeek')}</Section>
      {floor.week.length === 0 ? (
        <Text tone="muted" style={{ fontSize: 12.5, paddingHorizontal: 14 }}>
          {t('logging.console.noWeek')}
        </Text>
      ) : (
        floor.week.map((w) => <WeekClientRow key={w.clientId} row={w} onStart={() => setStarting(w.clientId)} />)
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/(app)/(tabs)/clients')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 14, marginTop: 10 }}
      >
        <Icon name="users" size={18} color={theme.colors.textSecondary} />
        <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '600', color: theme.colors.textSecondary }}>{t('logging.console.allClients')}</Text>
        <Icon name="chevron" size={16} color={theme.colors.textMuted} />
      </Pressable>

      {starting ? <StartSessionSheet visible clientId={starting} viewerIsPt onDismiss={() => setStarting(null)} /> : null}
    </>
  );
}

/** Prototype `ipad_console` rail, 250pt. The mirror line sits here because it is about the client's device. */
export function FloorRail({ currentSessionId, mirror }: { currentSessionId: string; mirror: { joined: boolean; devices: number } }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const floor = usePtFloor(true);
  return (
    <View style={{ width: 250, borderEndWidth: 1, borderEndColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
      <Text accessibilityRole="header" numeric style={{ fontSize: 15, fontWeight: '800', paddingHorizontal: 14, paddingTop: 16 }}>
        {t('logging.console.today', { n: floor.live.length + floor.week.length })}
      </Text>
      <ScrollView>
        <FloorList currentSessionId={currentSessionId} onPick={(id) => router.setParams({ id })} floor={floor} />
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: mirror.joined ? theme.colors.successAccent : theme.colors.textMuted }} />
        <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
          {!mirror.joined
            ? t('logging.console.mirrorOff')
            : mirror.devices > 0
              ? t('logging.console.mirrorOn', { n: mirror.devices })
              : t('logging.console.mirrorOnNoCount')}
        </Text>
      </View>
    </View>
  );
}

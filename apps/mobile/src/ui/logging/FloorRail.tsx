import { formatElapsed, remainingSec, restPhase } from '@forge/shared';
import { router } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { StartSessionSheet } from '../../lib/logging/StartSessionSheet';
import { restStore } from '../../lib/logging/restStore';
import { usePtFloor, type LiveRow } from '../../lib/logging/usePtFloor';
import { useTheme } from '../../theme/ThemeProvider';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { formatClock } from '../RestTimer';
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
 * Live, then This week (spec D9). The rail on the console and the body of the
 * phone switcher: one list, two containers. `onPick` swaps the session in
 * place; Start goes through the existing StartSessionSheet.
 */
export function FloorList({ currentSessionId, onPick }: { currentSessionId: string | null; onPick: (sessionId: string) => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const floor = usePtFloor(true);
  const rests = useSyncExternalStore(restStore.subscribe, restStore.getSnapshot, restStore.getSnapshot);
  const [now, setNow] = useState(() => Date.now());
  const [starting, setStarting] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  function subline(l: LiveRow): string {
    const rest = rests.rests[l.sessionId];
    const clock = Math.max(now, rests.at);
    if (rest && restPhase(rest, clock) === 'running') return t('logging.console.resting', { time: formatClock(remainingSec(rest, clock)) });
    return l.startedAt ? formatElapsed(Math.floor((clock - new Date(l.startedAt).getTime()) / 1000)) : '';
  }

  return (
    <>
      <Section>{t('logging.console.live')}</Section>
      {floor.live.length === 0 ? (
        <Text tone="muted" style={{ fontSize: 12.5, paddingHorizontal: 14 }}>
          {t('logging.console.noLive')}
        </Text>
      ) : (
        floor.live.map((l) => {
          const on = l.sessionId === currentSessionId;
          return (
            <Pressable
              key={l.sessionId}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => onPick(l.sessionId)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                minHeight: 60,
                paddingHorizontal: 14,
                backgroundColor: on ? theme.colors.accentSurfaceSoft : 'transparent',
                borderStartWidth: 3,
                borderStartColor: on ? theme.colors.accent : 'transparent',
              }}
            >
              <Avatar name={l.clientName} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700' }}>
                  {l.clientName ?? t('logging.console.clientFallback')}
                </Text>
                <Text numeric numberOfLines={1} style={{ fontSize: 11.5, color: theme.colors.textMuted }}>
                  {subline(l)}
                </Text>
              </View>
            </Pressable>
          );
        })
      )}

      <Section>{t('logging.console.thisWeek')}</Section>
      {floor.week.length === 0 ? (
        <Text tone="muted" style={{ fontSize: 12.5, paddingHorizontal: 14 }}>
          {t('logging.console.noWeek')}
        </Text>
      ) : (
        floor.week.map((w) => (
          <View key={w.clientId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 14 }}>
            <Avatar name={w.clientName} size={32} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '600' }}>
                {w.clientName ?? t('logging.console.clientFallback')}
              </Text>
              <Text numeric style={{ fontSize: 11.5, color: theme.colors.textMuted }}>
                {t('logging.console.weekOpen', { week: w.week, n: w.openDays })}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setStarting(w.clientId)}
              style={{ minHeight: 44, minWidth: 64, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5, borderColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.accentText }}>{t('logging.console.start')}</Text>
            </Pressable>
          </View>
        ))
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
        <FloorList currentSessionId={currentSessionId} onPick={(id) => router.setParams({ id })} />
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

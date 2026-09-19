import type { OutboxEntry, SessionRow } from '@forge/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { mapLoggingError } from '../../lib/logging/loggingErrors';
import { engine } from '../../lib/offline/engine';
import { useOffline } from '../../lib/offline/offlineContext';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, NavHeader, Row, Screen, Text } from '../../ui';

/** One row per session: the outbox grouped by the session its entries belong to. */
type Group = {
  sessionId: string;
  entries: OutboxEntry[];
  session: SessionRow | null;
  name: string | null;
};

async function loadGroups(): Promise<Group[]> {
  const bySession = new Map<string, OutboxEntry[]>();
  for (const e of await engine.entries()) {
    const list = bySession.get(e.sessionId);
    if (list) list.push(e);
    else bySession.set(e.sessionId, [e]);
  }
  const groups: Group[] = [];
  for (const [sessionId, entries] of bySession) {
    const session = await engine.localSession(sessionId);
    const name = session
      ? ((await engine.getCache<{ name: string | null }>('clientName:' + session.client_id))?.value.name ?? null)
      : null;
    groups.push({ sessionId, entries, session, name });
  }
  return groups;
}

/**
 * Prototype `sync`. A status banner that states what is waiting (not that
 * something failed, unless it did), the local-first guarantee, then one row
 * per session. A refused write is the only thing that asks for a decision:
 * Retry, or Discard. Re-reads on every engine change, so a background drain
 * updates the rows in place.
 */
export default function SyncQueueScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const offline = useOffline();
  const [groups, setGroups] = useState<Group[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void loadGroups().then((g) => {
        if (!cancelled) setGroups(g);
      });
    load();
    const unsubscribe = engine.subscribe((e) => {
      if (e.type === 'changed') load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const queued = offline.status.pending + offline.status.failed;
  const firstPending = groups.flatMap((g) => g.entries).find((e) => e.state === 'pending')?.seq ?? null;

  function when(iso: string): string {
    const d = new Date(iso);
    const time = d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString()
      ? time
      : d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }) + ' ' + time;
  }

  // ── Banner ────────────────────────────────────────────────────────────────
  const tone =
    queued === 0 ? 'synced' : offline.authPaused || offline.status.failed > 0 ? 'failed' : !offline.online ? 'offline' : 'syncing';
  const banner = {
    synced: { bg: theme.colors.successSurface, bd: theme.colors.successAccent, fg: theme.colors.onSuccessSurface, dot: theme.colors.successAccent },
    failed: { bg: theme.colors.dangerSurface, bd: theme.colors.dangerAccent, fg: theme.colors.onDangerSurface, dot: theme.colors.dangerAccent },
    offline: { bg: theme.colors.accentSurfaceSoft, bd: theme.colors.warnAccent, fg: theme.colors.onAccentSurfaceSoft, dot: theme.colors.warnAccent },
    syncing: { bg: theme.colors.surfaceRaised, bd: theme.colors.border, fg: theme.colors.textPrimary, dot: theme.colors.accent },
  }[tone];
  const bannerTitle =
    tone === 'synced'
      ? t('logging.offline.bannerSynced')
      : offline.authPaused
        ? t('logging.offline.authPaused', { count: queued })
        : tone === 'failed'
          ? t('logging.offline.bannerFailed', { count: offline.status.failed })
          : tone === 'offline'
            ? t('logging.offline.bannerOffline', { count: queued })
            : t('logging.offline.bannerSyncing', { count: queued });
  const bannerSub =
    tone === 'syncing'
      ? t('logging.offline.subSyncing')
      : offline.syncedAt
        ? t('logging.offline.subLastSynced', { time: when(offline.syncedAt) })
        : t('logging.offline.subNeverSynced');
  const canRetry = tone === 'offline' || (tone === 'failed' && !offline.authPaused);

  function retryNow() {
    if (offline.status.failed > 0) void engine.retryAll().then(offline.drainNow);
    else offline.drainNow();
  }

  function retryGroup(g: Group) {
    void (async () => {
      // The start first: retry(start) also frees the ops it had parked.
      const failed = g.entries.filter((e) => e.state === 'failed').sort((a, b) => (a.op === 'start' ? -1 : b.op === 'start' ? 1 : 0));
      for (const e of failed) await engine.retry(e.seq);
      offline.drainNow();
    })();
  }

  function discardGroup(g: Group) {
    void (async () => {
      const start = g.entries.find((e) => e.op === 'start');
      // Discarding a start removes its whole session; otherwise each entry goes.
      if (start) await engine.discard(start.seq);
      else for (const e of g.entries) await engine.discard(e.seq);
    })();
  }

  const back = (
    <Button
      label={t('common.back')}
      variant="link"
      icon="chevronBack"
      onPress={() => (router.canGoBack() ? router.back() : router.dismissTo('/'))}
    />
  );

  return (
    <Screen padded={false}>
      <NavHeader leading={back} title={t('logging.offline.queueTitle')} divider={false} />
      <View style={{ paddingHorizontal: 16, paddingTop: 6 }}>
        <Row
          style={{
            gap: 10,
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: 12,
            backgroundColor: banner.bg,
            borderWidth: 1,
            borderColor: banner.bd,
          }}
        >
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: banner.dot }} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: banner.fg }}>{bannerTitle}</Text>
            <Text style={{ fontSize: 11.5, color: theme.colors.textSecondary, marginTop: 2 }}>{bannerSub}</Text>
          </View>
          {canRetry ? <Button label={t('logging.offline.retryNow')} variant="ghost" onPress={retryNow} /> : null}
        </Row>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 24 }}>
        <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '800', letterSpacing: -0.3 }}>
          {t('logging.offline.pendingTitle')}
        </Text>
        <Text style={{ fontSize: 13.5, lineHeight: 21, color: theme.colors.textSecondary, marginTop: 6, marginBottom: 18 }}>
          {t('logging.offline.pendingBody')}
        </Text>

        {groups.length === 0 ? (
          <Text tone="secondary">{t('logging.offline.queueEmpty')}</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {groups.map((g) => {
              const failed = g.entries.filter((e) => e.state === 'failed');
              const sets = g.entries.filter((e) => e.op === 'log_set').length;
              const at = when(g.session?.started_at ?? g.entries[0]?.createdAt ?? new Date().toISOString());
              const sending = offline.online && firstPending !== null && g.entries.some((e) => e.seq === firstPending);
              const status =
                failed.length > 0
                  ? t('logging.offline.stateFailed')
                  : sending
                    ? t('logging.offline.statusSending')
                    : t('logging.offline.statusQueued');
              const statusColor =
                failed.length > 0 ? theme.colors.dangerAccent : sending ? theme.colors.accentText : theme.colors.textMuted;
              const firstError = failed[0]?.lastError ?? null;
              return (
                <View
                  key={g.sessionId}
                  style={{
                    padding: 12,
                    gap: 8,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: failed.length > 0 ? theme.colors.dangerAccent : theme.colors.border,
                    backgroundColor: theme.colors.surfaceRaised,
                  }}
                >
                  <Row style={{ gap: 11 }}>
                    <View
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 9,
                        backgroundColor: theme.colors.surfaceSunken,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.textSecondary }}>◉</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700' }}>
                        {g.name ? t('logging.offline.rowSession', { name: g.name }) : t('logging.offline.rowSessionNoName')}
                      </Text>
                      <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
                        {sets > 0
                          ? t('logging.offline.rowSets', { count: sets, time: at })
                          : t('logging.offline.rowChanges', { count: g.entries.length, time: at })}
                      </Text>
                    </View>
                    <Text
                      style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase', color: statusColor }}
                    >
                      {status}
                    </Text>
                  </Row>
                  {failed.length > 0 ? (
                    <>
                      <Text variant="caption" style={{ color: theme.colors.dangerAccent }}>
                        {firstError?.code === 'start_failed'
                          ? t('logging.offline.errorStartFailed')
                          : mapLoggingError(firstError, t)}
                      </Text>
                      <Row style={{ gap: 16 }}>
                        <Button label={t('logging.offline.retry')} variant="link" onPress={() => retryGroup(g)} />
                        <Button
                          label={t('logging.offline.discard')}
                          variant="link"
                          tone="danger"
                          onPress={() => discardGroup(g)}
                        />
                      </Row>
                    </>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

import {
  checkinErrorKey, isCheckInOpen, parseCheckinPayload, type CheckinErrorCode, type PendingCheckInArgs,
} from '@forge/shared';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { checkIn } from '../../../lib/checkin/api';
import { pendingQueue } from '../../../lib/checkin/pending';
import { StartSessionSheet } from '../../../lib/logging/StartSessionSheet';
import { useOffline } from '../../../lib/offline/offlineContext';
import { dayLabel, timeLabel } from '../../../lib/schedule/format';
import { OfflineNote } from '../../../lib/schedule/OfflineNote';
import { useMyBookings } from '../../../lib/schedule/useMyBookings';
import { useNow } from '../../../lib/schedule/useNow';
import { useTheme } from '../../../theme/ThemeProvider';
import { Button, CodeCells, EmptyState, Icon, NavHeader, NumericKeypad, Screen, Skeleton, Text } from '../../../ui';

type Outcome =
  | { kind: 'in'; at: string; bookingId: string }
  | { kind: 'out'; at: string; bookingId: string }
  | { kind: 'already' }
  | { kind: 'saved' }
  | { kind: 'error'; code: CheckinErrorCode | 'not_qr' };

const EMBER = '#E8631A';
const OK = '#2E8B57';
const WARN = '#C77800';

/**
 * Design screen 11. A dark camera surface with an ember frame; scanning needs
 * no tap. Every failure says what happened and what to do next, and a wrong
 * booking names only the scanner's own session (spec D4). With no signal the
 * scan is kept on this phone and confirmed on reconnect (D10).
 */
export default function Scan() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const { from } = useLocalSearchParams<{ from?: string }>();
  // Two entry points (Today's card, My bookings): Close returns to the one used.
  const close = () => (from === 'mine' ? router.dismissTo('/(app)/bookings') : router.dismissTo('/'));
  const now = useNow(15_000);
  const data = useMyBookings(auth.user?.id);
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'camera' | 'code'>('camera');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [starting, setStarting] = useState(false);
  const inflight = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  const name = data.coach?.ptName ?? null;
  const open = data.upcoming.find((b) => isCheckInOpen(b.starts_at, b.ends_at, now)) ?? null;
  const mine = open ?? data.upcoming[0] ?? null;
  const when = mine ? dayLabel(mine.starts_at, i18n.language) + ', ' + timeLabel(mine.starts_at) : null;
  const denied = !!permission && !permission.granted && !permission.canAskAgain;
  const showCode = mode === 'code' || denied;

  // Each scan is its own entry, keyed by scan time first: the door scan and
  // the check-out scan of one booking must both survive, and drain (which
  // walks keys in order) must send them in the order they were made.
  const pendingKey = (args: PendingCheckInArgs) => args.p_at + ':' + (args.p_booking_id ?? 'code:' + args.p_code);

  async function submit(args: PendingCheckInArgs) {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      if (!offline.online) {
        await pendingQueue.enqueue({ kind: 'check_in', key: pendingKey(args), args });
        setOutcome({ kind: 'saved' });
        return;
      }
      const r = await checkIn(args);
      if (r.error === 'offline') {
        await pendingQueue.enqueue({ kind: 'check_in', key: pendingKey(args), args });
        setOutcome({ kind: 'saved' });
      } else if (r.error) {
        setOutcome({ kind: 'error', code: r.error });
      } else if (r.data.outcome === 'checked_out') {
        setOutcome({ kind: 'out', at: r.data.checkedOutAt ?? args.p_at, bookingId: r.data.bookingId });
      } else if (r.data.outcome === 'checked_in') {
        setOutcome({ kind: 'in', at: r.data.checkedInAt ?? args.p_at, bookingId: r.data.bookingId });
      } else {
        setOutcome({ kind: 'already' });
      }
      data.refetch();
    } finally {
      setBusy(false);
      inflight.current = false;
    }
  }

  function onScanned(e: BarcodeScanningResult) {
    if (inflight.current || outcome) return;
    const p = parseCheckinPayload(e.data);
    if (!p) {
      setOutcome({ kind: 'error', code: 'not_qr' });
      return;
    }
    void submit({ p_booking_id: p.bookingId, p_code: p.code, p_window: p.window, p_at: new Date().toISOString() });
  }

  function submitCode() {
    if (code.length !== 6) return;
    // The window is left to the server, which tries the last few minutes (typing takes time).
    void submit({ p_booking_id: null, p_code: code, p_window: null, p_at: new Date().toISOString() });
  }

  const reset = () => {
    setOutcome(null);
    setCode('');
  };

  const header = (
    <NavHeader
      title={t('scan.title')}
      leading={<Button label={t('scan.close')} variant="link" icon="close" onPress={() => close()} />}
    />
  );

  if (data.loading) {
    return (
      <Screen padded={false}>
        {header}
        <View style={{ padding: 18 }}>
          <Skeleton height={320} radius={18} />
        </View>
      </Screen>
    );
  }

  // With no signal and no cached list (the offline beta off) the booking can't
  // be checked here, so the scanner stays up: a scan queues in PendingQueue
  // and the server decides on reconnect.
  if (!open && !outcome && data.error !== 'offline') {
    return (
      <Screen padded={false}>
        {header}
        <EmptyState
          icon="calendar"
          title={t('scan.emptyTitle')}
          body={t('scan.emptyBody')}
          actionLabel={t('scan.emptyCta')}
          onAction={() => router.replace('/(app)/bookings')}
        />
      </Screen>
    );
  }

  const nn = (key: string) => (name ? t(key, { name, when }) : t(key + 'NoName', { when }));
  let card: { tone: 'ok' | 'warn'; title: string; body: string; action: string; onAction: () => void } | null = null;
  if (outcome?.kind === 'in') {
    card = {
      tone: 'ok',
      title: t('scan.successTitle', { time: timeLabel(outcome.at) }),
      body: name ? t('scan.successBody', { name }) : t('scan.successBodyNoName'),
      action: t('scan.openWorkout'),
      onAction: () => setStarting(true),
    };
  } else if (outcome?.kind === 'out') {
    const bookingId = outcome.bookingId;
    card = {
      tone: 'ok',
      title: t('scan.checkedOutTitle', { time: timeLabel(outcome.at) }),
      body: t('scan.checkedOutBody'),
      action: t('scan.rateNow'),
      onAction: () => router.replace({ pathname: '/(app)/bookings/[id]/rate', params: { id: bookingId, ...(from ? { from } : {}) } }),
    };
  } else if (outcome?.kind === 'already') {
    card = { tone: 'ok', title: t('scan.alreadyTitle'), body: '', action: t('scan.openWorkout'), onAction: () => setStarting(true) };
  } else if (outcome?.kind === 'saved') {
    card = { tone: 'warn', title: t('scan.savedTitle'), body: nn('scan.offlineBody'), action: t('scan.close'), onAction: () => close() };
  } else if (outcome?.kind === 'error') {
    const c = outcome.code;
    const title =
      c === 'not_qr' ? t('scan.notQr') : c === 'wrong_booking' ? t('checkin.errors.wrongBooking') : t(checkinErrorKey(c));
    const body =
      c === 'wrong_booking'
        ? when
          ? nn('scan.wrongBody')
          : name
            ? t('scan.wrongBodyNoBooking', { name })
            : t('scan.wrongBodyNoBookingNoName')
        : c === 'code_expired'
          ? nn('scan.expiredBody')
          : c === 'bad_code'
            ? nn('scan.badCodeBody')
            : t('scan.genericBody');
    card = { tone: 'warn', title, body, action: showCode ? t('scan.tryAgain') : t('scan.scanAgain'), onAction: reset };
  }

  const resultCard = card ? (
    <View
      accessibilityLiveRegion="polite"
      style={{ padding: 18, borderRadius: 16, backgroundColor: theme.colors.surface, gap: 10, alignItems: 'flex-start' }}
    >
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: card.tone === 'ok' ? OK : WARN,
          }}
        >
          <Icon name={card.tone === 'ok' ? 'check' : 'alert'} size={22} color="#FFFFFF" strokeWidth={2.6} />
        </View>
        <Text style={{ flex: 1, fontWeight: '800', fontSize: 16 }}>{card.title}</Text>
      </View>
      {card.body ? <Text tone="secondary">{card.body}</Text> : null}
      <Button label={card.action} size="lg" onPress={card.onAction} />
    </View>
  ) : null;

  const clientId = open?.client_id ?? data.coach?.clientId ?? null;

  return (
    <Screen padded={false}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14, flexGrow: 1 }}>
        {!offline.online ? <OfflineNote title={t('scan.offline')} body={nn('scan.offlineBody')} /> : null}
        {showCode ? (
          <View style={{ gap: 14 }}>
            {denied ? (
              <View style={{ gap: 4 }}>
                <Text variant="h3">{t('scan.deniedTitle')}</Text>
                <Text tone="secondary">{nn('scan.deniedBody')}</Text>
              </View>
            ) : null}
            {resultCard ?? (
              <>
                <Text style={{ fontWeight: '700' }}>{t('scan.codeLabel')}</Text>
                <CodeCells code={code} />
                <NumericKeypad onKey={(d) => setCode((c) => (c.length < 6 ? c + d : c))} onDelete={() => setCode((c) => c.slice(0, -1))} />
                <Button label={t('scan.checkIn')} size="lg" loading={busy} disabled={code.length !== 6} onPress={submitCode} />
              </>
            )}
            {denied && Platform.OS !== 'web' ? (
              <Button label={t('scan.allowCamera')} variant="link" onPress={() => void Linking.openSettings()} />
            ) : null}
            {!denied && !resultCard ? <Button label={t('scan.useCamera')} variant="link" onPress={() => setMode('camera')} /> : null}
          </View>
        ) : (
          <View style={{ gap: 14, flex: 1 }}>
            <View style={{ borderRadius: 18, overflow: 'hidden', backgroundColor: '#0F131C', aspectRatio: 0.8 }}>
              {permission?.granted && !outcome ? (
                <CameraView
                  style={{ flex: 1 }}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={busy ? undefined : onScanned}
                />
              ) : null}
              <View
                pointerEvents="none"
                style={{ position: 'absolute', top: '18%', left: '15%', right: '15%', aspectRatio: 1, borderRadius: 18, borderWidth: 3, borderColor: card ? (card.tone === 'ok' ? OK : WARN) : EMBER }}
              />
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 18, alignItems: 'center', paddingHorizontal: 16 }}>
                {resultCard ? null : (
                  <>
                    <Text style={{ color: '#FFFFFF', fontWeight: '700', textAlign: 'center' }}>
                      {name ? t('scan.point', { name }) : t('scan.pointNoName')}
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12.5 }}>{t('scan.auto')}</Text>
                  </>
                )}
              </View>
            </View>
            {resultCard}
            {!resultCard ? <Button label={t('scan.enterCode')} variant="ghost" onPress={() => setMode('code')} /> : null}
          </View>
        )}
      </ScrollView>
      {clientId ? (
        <StartSessionSheet visible={starting} clientId={clientId} viewerIsPt={false} onDismiss={() => setStarting(false)} />
      ) : null}
    </Screen>
  );
}


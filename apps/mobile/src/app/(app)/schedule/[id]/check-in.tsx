import {
  checkinCode, checkinErrorKey, checkInOpensAt, formatCheckinPayload, groupCode, isCheckInOpen, secondsLeft, windowOf,
  type CheckinErrorCode,
} from '@forge/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { checkInByHand, checkOut } from '../../../../lib/checkin/api';
import { getCheckinKey } from '../../../../lib/checkin/keys';
import { QrCode } from '../../../../lib/checkin/QrCode';
import { useCheckInView } from '../../../../lib/checkin/useCheckInView';
import { StartSessionSheet } from '../../../../lib/logging/StartSessionSheet';
import { useOffline } from '../../../../lib/offline/offlineContext';
import { timeLabel } from '../../../../lib/schedule/format';
import { OfflineNote } from '../../../../lib/schedule/OfflineNote';
import { useNow } from '../../../../lib/schedule/useNow';
import { useTheme } from '../../../../theme/ThemeProvider';
import { Banner, Button, EmptyState, Icon, NavHeader, Screen, Skeleton, Text } from '../../../../ui';

const POLL_MS = 3000;
const STEPS = ['waiting', 'scanned', 'checkedIn', 'checkedOut'] as const;

/**
 * Design screen 05. The PT holds the phone up; the client scans or types the
 * six digits. The code is computed on this phone from the cached secret, so it
 * rotates with no signal (spec D1, D2). While online the screen re-reads the
 * booking every 3 s, so a scan flips it to Checked in without a tap (D11).
 */
export default function CheckIn() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const offline = useOffline();
  const now = useNow(1000);
  const v = useCheckInView(id);
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CheckinErrorCode | null>(null);

  const b = v.booking;
  const startsAt = b?.starts_at;
  const status = b?.status;

  useEffect(() => {
    if (!id || !startsAt) return;
    let cancelled = false;
    void getCheckinKey(id, startsAt)
      .catch(() => null)
      .then((k) => {
        if (!cancelled) setKey(k);
      });
    return () => {
      cancelled = true;
    };
  }, [id, startsAt]);

  const { poll } = v;
  const live = status === 'scheduled' || status === 'checked_in';
  useFocusEffect(
    useCallback(() => {
      if (!live) return undefined;
      const h = setInterval(poll, POLL_MS);
      return () => clearInterval(h);
    }, [live, poll]),
  );

  const back = () => router.dismissTo({ pathname: '/(app)/schedule/[id]', params: { id: id ?? '' } });
  const header = (
    <NavHeader
      title={t('checkin.title')}
      leading={<Button label={t('checkin.back')} variant="link" icon="chevronBack" onPress={back} />}
    />
  );

  if (v.loading) {
    return (
      <Screen padded={false}>
        {header}
        <View style={{ padding: 20 }}>
          <Skeleton height={360} radius={22} />
        </View>
      </Screen>
    );
  }
  if (!b) {
    return (
      <Screen padded={false}>
        {header}
        <EmptyState
          icon="calendar"
          title={v.error ? t('checkin.errorTitle') : t('checkin.closedTitle')}
          body={v.error ? t('checkin.errorBody') : t('checkin.closedBody')}
          actionLabel={t('checkin.backToSchedule')}
          onAction={() => router.dismissTo('/(app)/(tabs)/schedule')}
        />
      </Screen>
    );
  }

  const name = v.isSelf ? t('schedule.me') : v.clientName;
  const ci = v.checkIn;
  const step = status === 'completed' ? 3 : status === 'checked_in' ? 2 : 0;
  const open = isCheckInOpen(b.starts_at, b.ends_at, now);

  async function byHand() {
    setBusy(true);
    setError(null);
    const r = await checkInByHand(b!.id);
    setBusy(false);
    if (r.error) setError(r.error);
    v.poll();
  }

  async function doCheckOut() {
    setBusy(true);
    setError(null);
    const r = await checkOut(b!.id);
    setBusy(false);
    if (r.error) setError(r.error);
    v.poll();
  }

  const strip = (
    <View style={{ flexDirection: 'row', gap: 6, marginTop: 18, marginBottom: 22 }}>
      {STEPS.map((s, i) => (
        <View key={s} style={{ flex: 1, gap: 6 }}>
          <View
            style={{
              height: 4,
              borderRadius: 2,
              backgroundColor:
                i < step || (i === step && step === 3) ? theme.colors.successAccent : i === step ? theme.colors.accent : theme.colors.border,
            }}
          />
          <Text style={{ fontSize: 10.5, fontWeight: '600', textAlign: 'center', color: i <= step ? theme.colors.textPrimary : theme.colors.textMuted }}>
            {t(`checkin.steps.${s}`)}
          </Text>
        </View>
      ))}
    </View>
  );

  const bigTick = (soft: boolean) => (
    <View
      style={{
        width: 88,
        height: 88,
        borderRadius: 44,
        marginBottom: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: soft ? theme.colors.successSurface : theme.colors.successAccent,
      }}
    >
      <Icon name="check" size={40} color={soft ? theme.colors.onSuccessSurface : '#FFFFFF'} strokeWidth={3} />
    </View>
  );

  let body: ReactNode;
  if (status === 'cancelled' || status === 'no_show') {
    body = <EmptyState icon="calendar" title={t('checkin.closedTitle')} body={t('checkin.closedBody')} />;
  } else if (step === 3) {
    const from = ci?.checked_in_at ?? v.session?.startedAt ?? b.starts_at;
    const to = ci?.checked_out_at ?? v.session?.completedAt ?? b.ends_at;
    const min = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
    body = (
      <>
        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          {bigTick(true)}
          <Text style={{ fontSize: 22, fontWeight: '800' }}>{t('checkin.checkedOutTitle')}</Text>
          <Text tone="secondary" numeric style={{ marginTop: 6 }}>
            {t('checkin.checkedOutRange', { start: timeLabel(from), end: timeLabel(to), min })}
          </Text>
          <Text tone="muted" style={{ marginTop: 4, textAlign: 'center' }}>
            {[
              v.session?.dayLabel ? t('checkin.logged', { day: v.session.dayLabel }) : null,
              v.isSelf ? null : name ? t('checkin.ratingNext', { name }) : t('checkin.ratingNextNoName'),
            ]
              .filter(Boolean)
              .join(' ')}
          </Text>
        </View>
        <Button label={t('checkin.backToSchedule')} variant="ghost" size="lg" onPress={() => router.dismissTo('/(app)/(tabs)/schedule')} />
      </>
    );
  } else if (step === 2) {
    const diff = ci ? Math.round((Date.parse(ci.checked_in_at) - Date.parse(b.starts_at)) / 60_000) : 0;
    const at = ci ? timeLabel(ci.checked_in_at) : '';
    body = (
      <>
        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          {bigTick(false)}
          <Text style={{ fontSize: 22, fontWeight: '800', textAlign: 'center' }}>
            {name ? t('checkin.checkedInTitle', { name }) : t('checkin.checkedInTitleNoName')}
          </Text>
          {ci ? (
            <Text tone="secondary" numeric style={{ marginTop: 6 }}>
              {diff < 0
                ? t('checkin.early', { time: at, min: -diff })
                : diff > 0
                  ? t('checkin.late', { time: at, min: diff })
                  : t('checkin.onTime', { time: at })}
            </Text>
          ) : null}
        </View>
        {b.client_id ? <Button label={t('checkin.startSession')} size="lg" onPress={() => setStarting(true)} /> : null}
        <Button label={t('checkin.checkOut')} variant="link" loading={busy} disabled={!offline.online} onPress={() => void doCheckOut()} />
      </>
    );
  } else if (!open) {
    const before = now < checkInOpensAt(b.starts_at).getTime();
    body = (
      <EmptyState
        icon="calendar"
        title={t('checkin.emptyTitle')}
        body={t('checkin.emptyBody') + (before ? ' ' + t('checkin.opensAt', { time: timeLabel(checkInOpensAt(b.starts_at).toISOString()) }) : '')}
        actionLabel={t('checkin.backToSchedule')}
        onAction={() => router.dismissTo('/(app)/(tabs)/schedule')}
      />
    );
  } else if (key === undefined) {
    body = <Skeleton height={300} radius={22} />;
  } else if (key === null) {
    body = (
      <>
        <EmptyState icon="alert" tone="danger" title={t('checkin.errorTitle')} body={t('checkin.errorBody')} />
        <Button label={t('checkin.byHand')} variant="ghost" loading={busy} disabled={!offline.online} onPress={() => void byHand()} />
      </>
    );
  } else {
    const w = windowOf(now);
    const code = checkinCode(key, b.id, w);
    const secs = secondsLeft(now);
    body = (
      <>
        <View
          style={{
            alignSelf: 'center',
            backgroundColor: '#FFFFFF',
            borderRadius: 22,
            padding: 18,
            borderWidth: 1,
            borderColor: '#E5E8ED',
          }}
        >
          <QrCode value={formatCheckinPayload(b.id, w, code)} size={236} label={t('checkin.qrLabel', { code: groupCode(code) })} />
        </View>
        <Text tone="muted" style={{ textAlign: 'center', marginTop: 14, fontSize: 12.5 }}>
          {t('checkin.newCodeIn', { time: secs === 60 ? '1:00' : '0:' + String(secs).padStart(2, '0') })}
        </Text>
        <View style={{ marginTop: 22, padding: 14, borderRadius: 12, backgroundColor: theme.colors.surfaceRaised, alignItems: 'center' }}>
          <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: theme.colors.textMuted }}>{t('checkin.fallbackLabel')}</Text>
          <Text numeric testID="checkin-code" style={{ fontSize: 30, fontWeight: '700', letterSpacing: 4, marginTop: 6 }}>
            {groupCode(code)}
          </Text>
        </View>
        <Button label={t('checkin.byHand')} variant="link" loading={busy} disabled={!offline.online} onPress={() => void byHand()} />
        {!offline.online ? (
          <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            {t('checkin.byHandOffline')}
          </Text>
        ) : null}
      </>
    );
  }

  return (
    <Screen padded={false}>
      {header}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24, gap: 8 }}>
        {!offline.online && step < 2 ? <OfflineNote title={t('checkin.offline')} body={t('checkin.offlineBody')} /> : null}
        {error ? <Banner variant="danger" message={t(checkinErrorKey(error))} /> : null}
        <Text style={{ textAlign: 'center', fontSize: 17, fontWeight: '700' }}>{name ?? ''}</Text>
        <Text tone="secondary" style={{ textAlign: 'center', fontSize: 13 }}>
          <Text numeric tone="secondary" style={{ fontSize: 13 }}>
            {timeLabel(b.starts_at)} – {timeLabel(b.ends_at)}
          </Text>
          {v.programName ? ' · ' + v.programName : ''}
        </Text>
        {strip}
        {body}
      </ScrollView>
      {b.client_id ? (
        <StartSessionSheet
          visible={starting}
          clientId={b.client_id}
          viewerIsPt
          onNoProgram={() => router.dismissTo('/(app)/(tabs)/programs')}
          onDismiss={() => setStarting(false)}
        />
      ) : null}
    </Screen>
  );
}

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { rateBooking } from '../../../../lib/checkin/api';
import { pendingQueue } from '../../../../lib/checkin/pending';
import { rateDismissedKey, useBookingForClient } from '../../../../lib/checkin/useBookingForClient';
import { setStoredValue } from '../../../../lib/deviceStore';
import { useOffline } from '../../../../lib/offline/offlineContext';
import { OfflineNote } from '../../../../lib/schedule/OfflineNote';
import { useTheme } from '../../../../theme/ThemeProvider';
import { Button, EmptyState, Icon, NavHeader, Screen, Skeleton, Tag, Text, TextField } from '../../../../ui';

type Step = 'rate' | 'comment' | 'tip' | 'thanks';
const TIPS = ['$5', '$10', '$15'];

/**
 * Design screen 12. One tap on a number submits the rating; the comment and
 * the tip are optional follow-ups. The tip step is a placeholder so payments
 * slot in later without reflowing the sheet. A rating made with no signal is
 * kept on this phone and sent on reconnect (spec D10).
 */
export default function RateSession() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const offline = useOffline();
  const d = useBookingForClient(id);
  const [step, setStep] = useState<Step>('rate');
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [queued, setQueued] = useState(false);
  const [busy, setBusy] = useState(false);

  // Opened from My bookings (or a scan started there), Close goes back there.
  const close = () => (from === 'mine' ? router.dismissTo('/(app)/bookings') : router.dismissTo('/'));
  const header = (
    <NavHeader
      title={t('rate.title')}
      leading={<Button label={t('rate.close')} variant="link" icon="close" onPress={close} />}
    />
  );

  async function send(value: number, text: string | null): Promise<void> {
    if (!id) return;
    void setStoredValue(rateDismissedKey(id), '1');
    if (offline.online) {
      const r = await rateBooking(id, value, text);
      if (!r.error) return;
      if (r.error !== 'offline') {
        // Permanent refusal (not ratable, not yours): nothing to retry.
        return;
      }
    }
    await pendingQueue.enqueue({ kind: 'rate', key: id, args: { p_id: id, p_rating: value, p_comment: text } });
    setQueued(true);
  }

  async function pick(value: number) {
    setRating(value);
    setBusy(true);
    await send(value, null);
    setBusy(false);
    setStep('comment');
  }

  async function submitComment() {
    const text = comment.trim();
    if (text && rating) {
      setBusy(true);
      await send(rating, text);
      setBusy(false);
    }
    setStep('tip');
  }

  async function notNow() {
    if (id) await setStoredValue(rateDismissedKey(id), '1');
    close();
  }

  if (d.loading) {
    return (
      <Screen padded={false}>
        {header}
        <View style={{ padding: 18 }}>
          <Skeleton height={260} radius={18} />
        </View>
      </Screen>
    );
  }

  const b = d.booking;
  if (!b || b.status !== 'completed') {
    return (
      <Screen padded={false}>
        {header}
        <EmptyState icon="inbox" title={t('rate.emptyTitle')} body={t('rate.emptyBody')} actionLabel={t('rate.close')} onAction={close} />
      </Screen>
    );
  }

  const name = d.coachName;
  const length = b.length_min ?? Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000);
  const current = rating ?? b.rating;

  return (
    <Screen padded={false}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {!offline.online || queued ? <OfflineNote title={t('rate.offline')} body={t('rate.offlineBody')} /> : null}
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: theme.colors.textMuted }}>
            {t('rate.kicker').toUpperCase()}
          </Text>
          <Text variant="h2">{t('rate.question')}</Text>
          <Text tone="secondary">
            {[d.dayLabel, name ? t('rate.sub', { length, name }) : t('rate.subNoName', { length })].filter(Boolean).join(' · ')}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[1, 2, 3, 4, 5].map((n) => {
            const on = n === current;
            return (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityLabel={t('rate.target', { n })}
                accessibilityState={{ selected: on, disabled: busy || step !== 'rate' }}
                disabled={busy || step !== 'rate'}
                onPress={() => void pick(n)}
                style={{
                  flex: 1,
                  height: 56,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderColor: on ? theme.colors.accent : theme.colors.border,
                  backgroundColor: on ? theme.colors.accent : theme.colors.surface,
                }}
              >
                <Text numeric style={{ fontSize: 20, fontWeight: '800', color: on ? '#FFFFFF' : theme.colors.textPrimary }}>
                  {n}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="caption" tone="muted">
            {t('rate.low')}
          </Text>
          <Text variant="caption" tone="muted">
            {t('rate.high')}
          </Text>
        </View>

        {step === 'rate' ? <Button label={t('rate.notNow')} variant="link" onPress={() => void notNow()} /> : null}

        {step !== 'rate' && current ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={18} color={theme.colors.successAccent} strokeWidth={2.6} />
            <Text numeric style={{ fontWeight: '700' }}>
              {current} · {t('rate.sent')}
            </Text>
          </View>
        ) : null}

        {step === 'comment' ? (
          <View style={{ gap: 10 }}>
            <TextField
              label={name ? t('rate.commentLabel', { name }) : t('rate.commentLabelNoName')}
              value={comment}
              onChangeText={setComment}
              multiline
              maxLength={500}
            />
            <Button label={t('rate.continue')} loading={busy} onPress={() => void submitComment()} />
            <Button label={t('rate.skip')} variant="link" onPress={() => setStep('tip')} />
          </View>
        ) : null}

        {step === 'tip' ? (
          <View style={{ gap: 10, padding: 16, borderRadius: 14, backgroundColor: theme.colors.surfaceRaised }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontWeight: '700', flex: 1 }}>{t('rate.tipTitle')}</Text>
              <Tag label={t('rate.comingSoon')} />
            </View>
            <Text tone="secondary">{t('rate.tipBody')}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[...TIPS, t('rate.tipOther')].map((x) => (
                <View
                  key={x}
                  accessibilityState={{ disabled: true }}
                  style={{ flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}
                >
                  <Text numeric>{x}</Text>
                </View>
              ))}
            </View>
            <Button label={t('rate.done')} onPress={() => setStep('thanks')} />
          </View>
        ) : null}

        {step === 'thanks' ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 12 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.successSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={30} color={theme.colors.onSuccessSurface} strokeWidth={3} />
            </View>
            <Text variant="h3" style={{ textAlign: 'center' }}>
              {name ? t('rate.thanks', { name }) : t('rate.thanksNoName')}
            </Text>
            {b.receipt_no !== null ? (
              <>
                <Text tone="secondary">{t('rate.receiptReady')}</Text>
                <Button
                  label={t('rate.viewReceipt')}
                  size="lg"
                  onPress={() => router.replace({ pathname: '/(app)/bookings/[id]/receipt', params: { id: b.id } })}
                />
              </>
            ) : null}
            <Button label={t('rate.close')} variant="link" onPress={close} />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

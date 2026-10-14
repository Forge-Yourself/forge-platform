import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { fetchReminders, REMINDER_DEFAULTS, saveReminder, type ReminderKey } from '../../../lib/checkin/api';
import { useOffline } from '../../../lib/offline/offlineContext';
import { OfflineNote } from '../../../lib/schedule/OfflineNote';
import { fetchPolicy } from '../../../lib/schedule/scheduleApi';
import { useTheme } from '../../../theme/ThemeProvider';
import { Banner, Button, EmptyState, ListRow, NavHeader, Screen, SectionCard, SectionLabel, Skeleton, Text, Toggle } from '../../../ui';

const CLIENT_ROWS: { key: ReminderKey; title: string; sub: string }[] = [
  { key: 'client_24h', title: 'reminders.c24', sub: 'reminders.c24Sub' },
  { key: 'client_2h', title: 'reminders.c2', sub: 'reminders.c2Sub' },
  { key: 'client_change', title: 'reminders.cChange', sub: 'reminders.cChangeSub' },
];
const PT_ROWS: { key: ReminderKey; title: string; sub: string }[] = [
  { key: 'pt_agenda', title: 'reminders.pAgenda', sub: 'reminders.pAgendaSub' },
  { key: 'pt_book', title: 'reminders.pBook', sub: 'reminders.pBookSub' },
  { key: 'pt_late', title: 'reminders.pLate', sub: 'reminders.pLateSub' },
];

/**
 * Design screen 07. Copy only in M5: the choices are saved, nothing is sent
 * until push notifications ship (spec D13), and the banner says so first so
 * no PT assumes their clients were reminded. Each toggle saves on its own;
 * offline the toggles lock rather than queue (M5a's availability precedent).
 */
export default function Reminders() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const [values, setValues] = useState<Record<ReminderKey, boolean>>(REMINDER_DEFAULTS);
  const [cutoff, setCutoff] = useState(12);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const seq = useRef(0);
  const userId = auth.user?.id;

  const load = useCallback(() => {
    if (!userId) return () => {};
    const mine = ++seq.current;
    void Promise.all([fetchReminders(userId), fetchPolicy(userId)]).then(([r, p]) => {
      if (mine !== seq.current) return;
      setLoading(false);
      if (r.error) {
        setLoadError(true);
        return;
      }
      setLoadError(false);
      setValues(r.data);
      if (!p.error) setCutoff(p.data.cutoffHours);
    });
    return () => {
      seq.current++;
    };
  }, [userId]);
  useFocusEffect(load);

  async function flip(key: ReminderKey, next: boolean) {
    setSaveError(false);
    setValues((v) => ({ ...v, [key]: next }));
    const r = await saveReminder(key, next);
    if (r.error) {
      setValues((v) => ({ ...v, [key]: !next }));
      setSaveError(true);
    }
  }

  const header = (
    <NavHeader
      title={t('reminders.title')}
      leading={<Button label={t('reminders.back')} variant="link" icon="chevronBack" onPress={() => router.dismissTo('/(app)/settings')} />}
    />
  );

  const section = (label: string, rows: typeof CLIENT_ROWS) => (
    <View style={{ gap: theme.space[2] }}>
      <SectionLabel>{label}</SectionLabel>
      <SectionCard>
        {rows.map((row, i) => (
          <ListRow
            key={row.key}
            title={t(row.title)}
            subtitle={t(row.sub, { hours: cutoff })}
            isLast={i === rows.length - 1}
            trailing={
              <Toggle label={t(row.title)} value={values[row.key]} disabled={!offline.online} onValueChange={(v) => void flip(row.key, v)} />
            }
          />
        ))}
      </SectionCard>
    </View>
  );

  const noneForClients = !values.client_24h && !values.client_2h && !values.client_change;

  return (
    <Screen padded={false}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 18, gap: theme.space[4] }}>
        <View style={{ padding: 14, borderRadius: theme.radius.lg, backgroundColor: theme.colors.warnSurface, gap: 4 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color: theme.colors.onWarnSurface }}>{t('reminders.bannerTitle')}</Text>
          <Text style={{ color: theme.colors.onWarnSurface }}>{t('reminders.bannerBody')}</Text>
        </View>
        {!offline.online ? <OfflineNote title={t('reminders.offline')} body={t('reminders.offlineBody')} /> : null}
        {saveError ? <Banner variant="danger" message={t('reminders.saveError')} /> : null}
        {loading ? (
          <Skeleton height={320} radius={14} />
        ) : loadError ? (
          <EmptyState icon="alert" tone="danger" title={t('reminders.errorTitle')} body={t('reminders.errorBody')} actionLabel={t('schedule.retry')} onAction={load} />
        ) : (
          <>
            {noneForClients ? (
              <EmptyState
                icon="clock"
                title={t('reminders.emptyTitle')}
                body={t('reminders.emptyBody')}
                actionLabel={offline.online ? t('reminders.emptyCta') : undefined}
                onAction={offline.online ? () => void flip('client_24h', true) : undefined}
              />
            ) : null}
            {section(t('reminders.toClients'), CLIENT_ROWS)}
            {section(t('reminders.toYou'), PT_ROWS)}
            <Text variant="caption" tone="muted">
              {t('reminders.footer', { hours: cutoff })}
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

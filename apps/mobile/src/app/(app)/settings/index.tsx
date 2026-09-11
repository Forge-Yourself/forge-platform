import { quietHoursSchema, userProfileSchema, type Database, type Locale } from '@forge/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { logAccountEvent } from '../../../lib/auth/audit';
import { unenrollMfaFactor } from '../../../lib/auth/mfa';
import { refreshAuthProfile } from '../../../lib/auth/refreshProfile';
import { useAsyncSubmit } from '../../../lib/forms/useAsyncSubmit';
import { setLocale } from '../../../lib/i18n';
import { supabase } from '../../../lib/supabase';
import { useTheme } from '../../../theme/ThemeProvider';
import { Banner, Button, Card, ListRow, Row, Screen, SectionCard, SegmentedPill, Text, Toggle } from '../../../ui';

type UsersUpdate = Database['public']['Tables']['users']['Update'];
type NotificationPreferencesInsert = Database['public']['Tables']['notification_preferences']['Insert'];

/**
 * Channels the "Quiet hours" master toggle actually suppresses. Matches
 * docs/Forge_Architecture.html's D-notifications acceptance criteria ("Quiet hours
 * suppress push/SMS"); email and in_app are left untouched by this screen.
 */
const QUIET_HOURS_CHANNELS = ['push', 'sms'] as const;

/**
 * Every `chk_np_category` value (db/schema.sql) EXCEPT 'session_reminder'. This screen
 * never writes a session_reminder row, in either direction — that's what makes the
 * copy ("Session reminders still come through") true rather than aspirational. M1 has
 * no per-category UI (that's M9), so one shared quiet-hours window is applied uniformly
 * across the other 12 categories on the two interruptive channels above.
 */
const QUIET_HOURS_CATEGORIES = [
  'checkin',
  'billing',
  'streak',
  'pr',
  'nudge',
  'form_check',
  'intake',
  'announcement',
  'challenge',
  'badge',
  'system',
  'marketing',
] as const;

const DEFAULT_QUIET_START = '22:00';
const DEFAULT_QUIET_END = '07:00';

/** Steps a 'HH:MM' string by +/- 30 minutes, wrapping at the day boundary. */
function stepTime(value: string, deltaMinutes: number): string {
  const [h, m] = value.split(':').map(Number);
  const total = (((h * 60 + m + deltaMinutes) % 1440) + 1440) % 1440;
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

function TimeTile({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: t.space[2] }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Row style={{ gap: t.space[2] }}>
        <Button
          label="–"
          variant="ghost"
          disabled={disabled}
          onPress={() => onChange(stepTime(value, -30))}
          style={{ minWidth: 36, paddingHorizontal: t.space[2] }}
        />
        <View
          style={{
            minWidth: 76,
            paddingVertical: t.space[2],
            borderRadius: t.radius.md,
            borderWidth: 1.5,
            borderColor: t.colors.borderStrong,
            alignItems: 'center',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Text numeric style={{ fontSize: 17, fontWeight: '700' }}>
            {value}
          </Text>
        </View>
        <Button
          label="+"
          variant="ghost"
          disabled={disabled}
          onPress={() => onChange(stepTime(value, 30))}
          style={{ minWidth: 36, paddingHorizontal: t.space[2] }}
        />
      </Row>
    </View>
  );
}

/**
 * Task 11 — account settings. Preferences (language/units/appearance), Quiet hours,
 * Account (profile edit + two-factor), Privacy (consent withdrawal), and sign out.
 * Every control here auto-saves on change — there is no separate Save button, matching
 * how a settings screen (as opposed to a form like profile-edit) normally behaves.
 */
export default function Settings() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const userId = auth.user?.id;
  const { error, setError, run } = useAsyncSubmit();

  const [locale, setLocaleState] = useState<Locale>((i18n.language as Locale) ?? 'en');
  const [unitSystem, setUnitSystem] = useState(auth.user?.unit_system ?? 'metric');
  const [consentAnalytics, setConsentAnalytics] = useState(auth.user?.consent_analytics ?? false);
  const [consentMarketing, setConsentMarketing] = useState(auth.user?.consent_marketing ?? false);
  const [consentAiTraining, setConsentAiTraining] = useState(auth.user?.consent_ai_training ?? false);

  const [quietEnabled, setQuietEnabled] = useState(false);
  const [quietStart, setQuietStart] = useState(DEFAULT_QUIET_START);
  const [quietEnd, setQuietEnd] = useState(DEFAULT_QUIET_END);
  const [quietLoaded, setQuietLoaded] = useState(false);

  // supabase.auth.mfa.listFactors() called directly (rather than trusting
  // auth.mfaFactors) because AuthProvider only refetches factors on SIGNED_IN /
  // USER_UPDATED / INITIAL_SESSION — verifying a new TOTP factor elevates AAL via a
  // MFA_CHALLENGE_VERIFIED event, which AuthProvider does NOT refetch factors on. This
  // screen re-mounts fresh every time it's navigated to (plain Stack, no tabs), so a
  // mount-time fetch is enough to keep it accurate without touching AuthProvider.
  const [totpFactorId, setTotpFactorId] = useState<string | null>(
    auth.mfaFactors?.totp?.[0]?.id ?? null,
  );
  const [unenrollOpen, setUnenrollOpen] = useState(false);
  const [unenrollError, setUnenrollError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    void supabase.auth.mfa.listFactors().then(({ data }) => {
      if (!cancelled) setTotpFactorId(data?.totp?.[0]?.id ?? null);
    });

    void supabase
      .from('notification_preferences')
      .select('quiet_start, quiet_end')
      .eq('user_id', userId)
      .eq('channel', 'push')
      .eq('category', 'checkin')
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.quiet_start && data.quiet_end) {
          setQuietEnabled(true);
          setQuietStart(data.quiet_start.slice(0, 5));
          setQuietEnd(data.quiet_end.slice(0, 5));
        }
        setQuietLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function saveUsers(payload: UsersUpdate) {
    if (!userId) return;
    const { error: updateError } = await supabase.from('users').update(payload).eq('id', userId);
    if (updateError) {
      setError(t('settings.error'));
      return;
    }
    // A plain table write fires none of the auth events AuthProvider listens for
    // (see lib/auth/refreshProfile.ts) — without this, useAuth().user stays stale
    // here the same way profile-edit.tsx's users.update() needed it.
    await refreshAuthProfile();
  }

  async function handleLocaleChange(next: Locale) {
    setLocaleState(next);
    setError(null);
    await run(async () => {
      const result = userProfileSchema.safeParse({ locale: next });
      if (!result.success) {
        setError(t('settings.error'));
        return;
      }
      await setLocale(next);
      await saveUsers(result.data);
    });
  }

  async function handleUnitSystemChange(next: string) {
    setUnitSystem(next);
    setError(null);
    await run(async () => {
      const result = userProfileSchema.safeParse({ unit_system: next });
      if (!result.success) {
        setError(t('settings.error'));
        return;
      }
      await saveUsers(result.data);
    });
  }

  async function handleConsentChange(
    key: 'consent_analytics' | 'consent_marketing' | 'consent_ai_training',
    setter: (v: boolean) => void,
    next: boolean,
  ) {
    setter(next);
    setError(null);
    await run(async () => {
      const result = userProfileSchema.safeParse({ [key]: next });
      if (!result.success) {
        setError(t('settings.error'));
        return;
      }
      await saveUsers(result.data);
    });
  }

  async function saveQuietHours(enabled: boolean, from: string, until: string) {
    if (!userId) return;
    setError(null);
    await run(async () => {
      if (enabled) {
        const result = quietHoursSchema.safeParse({ quiet_start: from, quiet_end: until });
        if (!result.success) {
          setError(t('settings.error'));
          return;
        }
      }
      const rows: NotificationPreferencesInsert[] = QUIET_HOURS_CHANNELS.flatMap((channel) =>
        QUIET_HOURS_CATEGORIES.map((category) => ({
          user_id: userId,
          channel,
          category,
          quiet_start: enabled ? from : null,
          quiet_end: enabled ? until : null,
        })),
      );
      const { error: upsertError } = await supabase
        .from('notification_preferences')
        .upsert(rows, { onConflict: 'user_id,channel,category' });
      if (upsertError) setError(t('settings.error'));
    });
  }

  function handleQuietToggle(next: boolean) {
    setQuietEnabled(next);
    void saveQuietHours(next, quietStart, quietEnd);
  }

  function handleQuietStartChange(next: string) {
    setQuietStart(next);
    if (quietEnabled) void saveQuietHours(true, next, quietEnd);
  }

  function handleQuietEndChange(next: string) {
    setQuietEnd(next);
    if (quietEnabled) void saveQuietHours(true, quietStart, next);
  }

  async function handleTwoFactorPress() {
    if (totpFactorId) {
      setUnenrollOpen(true);
      return;
    }
    router.push('/(onboarding)/mfa-enroll');
  }

  async function handleUnenrollConfirm() {
    if (!totpFactorId) return;
    setUnenrollError(null);
    await run(async () => {
      const result = await unenrollMfaFactor(totpFactorId);
      if (!result.success) {
        setUnenrollError(t('settings.account.unenrollError'));
        return;
      }
      setTotpFactorId(null);
      setUnenrollOpen(false);
      // Gate's AAL check reads the session, not the user row — but AuthProvider's
      // mfaFactors cache is refreshed as a side effect of this (loadProfile refetches
      // both users and factors together), so anything else reading useAuth().mfaFactors
      // picks up the change too.
      await refreshAuthProfile();
    });
  }

  async function handleSignOut() {
    setError(null);
    await run(async () => {
      // Must happen BEFORE signOut() — log_account_event needs an authenticated
      // session, which is gone the instant signOut() resolves.
      await logAccountEvent('user_logout');
      await supabase.auth.signOut();
    });
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: theme.space[5], paddingBottom: theme.space[6] }}>
        <Text variant="h2">{t('settings.title')}</Text>

        {error ? <Banner variant="danger" message={error} /> : null}

        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" tone="muted">
            {t('settings.preferences.heading')}
          </Text>
          <SectionCard>
            <ListRow
              title={t('settings.preferences.languageLabel')}
              subtitle={t('settings.preferences.languageSubtitle')}
              trailing={
                <SegmentedPill
                  items={[
                    { label: 'EN', value: 'en' },
                    { label: 'AR', value: 'ar' },
                  ]}
                  selected={locale}
                  onChange={(v) => void handleLocaleChange(v as Locale)}
                />
              }
            />
            <ListRow
              title={t('settings.preferences.unitsLabel')}
              trailing={
                <SegmentedPill
                  items={[
                    { label: 'kg', value: 'metric' },
                    { label: 'lb', value: 'imperial' },
                  ]}
                  selected={unitSystem}
                  onChange={(v) => void handleUnitSystemChange(v)}
                />
              }
            />
            <ListRow
              title={t('settings.preferences.appearanceLabel')}
              subtitle={t('settings.preferences.appearanceSubtitle')}
              trailing={
                <SegmentedPill
                  items={[
                    { label: t('settings.preferences.appearanceSystem'), value: 'system' },
                    { label: t('settings.preferences.appearanceLight'), value: 'light' },
                    { label: t('settings.preferences.appearanceDark'), value: 'dark' },
                  ]}
                  selected={theme.appearanceOverride}
                  onChange={(v) => void theme.setAppearanceOverride(v as 'system' | 'light' | 'dark')}
                />
              }
            />
          </SectionCard>
          <Text variant="caption" tone="muted">
            {t('settings.preferences.languageNote')}
          </Text>
        </View>

        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" tone="muted">
            {t('settings.quietHours.heading')}
          </Text>
          <SectionCard>
            <ListRow
              title={t('settings.quietHours.muteLabel')}
              subtitle={t('settings.quietHours.muteSubtitle')}
              trailing={
                <Toggle
                  label={t('settings.quietHours.muteLabel')}
                  value={quietEnabled}
                  onValueChange={handleQuietToggle}
                  disabled={!quietLoaded}
                />
              }
            />
            <View style={{ paddingVertical: theme.space[4], paddingHorizontal: theme.space[4] }}>
              <Row style={{ justifyContent: 'space-around', gap: theme.space[4] }}>
                <TimeTile
                  label={t('settings.quietHours.from')}
                  value={quietStart}
                  disabled={!quietEnabled}
                  onChange={handleQuietStartChange}
                />
                <TimeTile
                  label={t('settings.quietHours.until')}
                  value={quietEnd}
                  disabled={!quietEnabled}
                  onChange={handleQuietEndChange}
                />
              </Row>
            </View>
          </SectionCard>
        </View>

        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" tone="muted">
            {t('settings.account.heading')}
          </Text>
          <SectionCard>
            <ListRow
              title={t('settings.account.editProfile')}
              onPress={() => router.push('/(app)/profile-edit')}
              trailing={<Text tone="muted">›</Text>}
            />
            <ListRow
              title={t('settings.account.twoFactor')}
              onPress={() => void handleTwoFactorPress()}
              trailing={
                <View
                  style={{
                    paddingHorizontal: theme.space[2],
                    paddingVertical: 4,
                    borderRadius: theme.radius.pill,
                    backgroundColor: totpFactorId ? theme.colors.successSurface : theme.colors.surfaceRaised,
                    borderWidth: totpFactorId ? 0 : 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <Text
                    numeric
                    style={{ fontSize: 12, fontWeight: '700' }}
                    tone={totpFactorId ? 'primary' : 'muted'}
                  >
                    {totpFactorId ? t('settings.account.twoFactorOn') : t('settings.account.twoFactorOff')}
                  </Text>
                </View>
              }
            />
          </SectionCard>

          {unenrollOpen ? (
            <Card style={{ borderColor: theme.colors.dangerAccent, gap: theme.space[3] }}>
              <Text variant="bodyBold">{t('settings.account.unenrollTitle')}</Text>
              <Text tone="secondary">{t('settings.account.unenrollBody')}</Text>
              {unenrollError ? <Banner variant="danger" message={unenrollError} /> : null}
              <Row style={{ gap: theme.space[3] }}>
                <Button
                  label={t('settings.account.unenrollCancel')}
                  variant="ghost"
                  onPress={() => setUnenrollOpen(false)}
                  style={{ flex: 1 }}
                />
                <Button
                  label={t('settings.account.unenrollConfirm')}
                  onPress={() => void handleUnenrollConfirm()}
                  style={{ flex: 1 }}
                />
              </Row>
            </Card>
          ) : null}
        </View>

        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" tone="muted">
            {t('settings.consents.heading')}
          </Text>
          <SectionCard>
            <ListRow
              title={t('settings.consents.analyticsLabel')}
              subtitle={t('settings.consents.analyticsSubtitle')}
              trailing={
                <Toggle
                  label={t('settings.consents.analyticsLabel')}
                  value={consentAnalytics}
                  onValueChange={(v) => void handleConsentChange('consent_analytics', setConsentAnalytics, v)}
                />
              }
            />
            <ListRow
              title={t('settings.consents.marketingLabel')}
              subtitle={t('settings.consents.marketingSubtitle')}
              trailing={
                <Toggle
                  label={t('settings.consents.marketingLabel')}
                  value={consentMarketing}
                  onValueChange={(v) => void handleConsentChange('consent_marketing', setConsentMarketing, v)}
                />
              }
            />
            <ListRow
              title={t('settings.consents.aiTrainingLabel')}
              subtitle={t('settings.consents.aiTrainingSubtitle')}
              trailing={
                <Toggle
                  label={t('settings.consents.aiTrainingLabel')}
                  value={consentAiTraining}
                  onValueChange={(v) => void handleConsentChange('consent_ai_training', setConsentAiTraining, v)}
                />
              }
            />
          </SectionCard>
        </View>

        <Button
          label={t('settings.signOut')}
          variant="ghost"
          onPress={() => void handleSignOut()}
          style={{ borderColor: theme.colors.dangerAccent }}
        />
      </ScrollView>
    </Screen>
  );
}

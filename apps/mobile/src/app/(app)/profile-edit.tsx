import type { Database } from '@forge/shared';
import { ptProfileSchema, userProfileSchema } from '@forge/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, View } from 'react-native';
import { useAuth } from '../../lib/auth/AuthProvider';
import { refreshAuthProfile } from '../../lib/auth/refreshProfile';
import { useAsyncSubmit } from '../../lib/forms/useAsyncSubmit';
import { Avatar } from '../../lib/profile/Avatar';
import { CertificationsEditor } from '../../lib/profile/CertificationsEditor';
import { usePtProfileData } from '../../lib/profile/usePtProfileData';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, Button, Card, ChipRow, Row, Screen, Text, TextField } from '../../ui';

const SUPPORT_EMAIL = 'support@forge.app';

type UsersUpdate = Database['public']['Tables']['users']['Update'];
type PtProfilesInsert = Database['public']['Tables']['pt_profiles']['Insert'];

// Same canonical, non-localized option lists as (onboarding)/pt-profile — see that
// screen's comment on why ChipRow's lack of a value/label split rules out i18n here.
const SPECIALIZATION_OPTIONS = [
  'Strength Training',
  'Weight Loss',
  'Bodybuilding',
  'Powerlifting',
  'Mobility & Recovery',
  'Sports Performance',
  'Pre/Postnatal',
  'Nutrition Coaching',
  'Group Classes',
  'Rehab',
];

const LANGUAGE_OPTIONS = ['Arabic', 'English', 'French', 'Armenian'];

/**
 * Writes ONLY the RLS-granted column lists:
 *   - public.users: display_name, avatar_url, phone (userProfileSchema's grant list —
 *     never `role`).
 *   - public.pt_profiles: bio, specializations, languages, profile_photo_url
 *     (ptProfileSchema — never `hourly_rate_cents`/`currency`, Forge is never
 *     merchant-of-record between PT and client).
 * A write outside either list fails at the RLS/column-grant layer with 42501 — that's
 * the DB doing its job, not a bug to route around (see Task 10 plan Step 4).
 */
export default function ProfileEdit() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const userId = auth.user?.id;
  const isPt = auth.user?.role === 'pt';
  const { ptProfile, certifications, refetch } = usePtProfileData(isPt ? userId : undefined);
  const { submitting, error, setError, run } = useAsyncSubmit();
  const [saved, setSaved] = useState(false);
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);

  const [displayName, setDisplayName] = useState(auth.user?.display_name ?? '');
  const [phone, setPhone] = useState(auth.user?.phone ?? '');
  const [avatarUrl, setAvatarUrl] = useState(auth.user?.avatar_url ?? '');

  const [bio, setBio] = useState(ptProfile?.bio ?? '');
  const [specializations, setSpecializations] = useState<string[]>(ptProfile?.specializations ?? []);
  const [languages, setLanguages] = useState<string[]>(ptProfile?.languages ?? []);
  const [photoUrl, setPhotoUrl] = useState(ptProfile?.profile_photo_url ?? '');

  function toggle(list: string[], setList: (v: string[]) => void, option: string) {
    setList(list.includes(option) ? list.filter((o) => o !== option) : [...list, option]);
  }

  async function handleSave() {
    setError(null);
    setSaved(false);
    if (!userId) return;

    // userProfileSchema/ptProfileSchema mirror the RLS-granted column lists exactly
    // (Task 4) — validating against them here, not just at the DB, means a bad value
    // (e.g. a non-URL pasted into the photo field) surfaces as a normal form error
    // instead of a 42501/constraint failure from Postgres.
    const userResult = userProfileSchema.safeParse({
      ...(displayName.trim().length > 0 ? { display_name: displayName.trim() } : {}),
      ...(avatarUrl.trim().length > 0 ? { avatar_url: avatarUrl.trim() } : {}),
      ...(phone.trim().length > 0 ? { phone: phone.trim() } : {}),
    });
    if (!userResult.success) {
      setError(userResult.error.issues[0]?.message ?? t('profileEdit.error'));
      return;
    }

    const ptResult = isPt
      ? ptProfileSchema.safeParse({
          bio,
          specializations,
          languages,
          ...(photoUrl.trim().length > 0 ? { profile_photo_url: photoUrl.trim() } : {}),
        })
      : null;
    if (ptResult && !ptResult.success) {
      setError(ptResult.error.issues[0]?.message ?? t('profileEdit.error'));
      return;
    }

    await run(async () => {
      const userPayload: UsersUpdate = { ...userResult.data };
      if (phone.trim().length === 0) userPayload.phone = null;

      const { error: userError } = await supabase.from('users').update(userPayload).eq('id', userId);
      if (userError) {
        setError(t('profileEdit.error'));
        return;
      }

      if (isPt && ptResult?.success) {
        const ptPayload: PtProfilesInsert = { user_id: userId, ...ptResult.data };
        if (photoUrl.trim().length === 0) ptPayload.profile_photo_url = null;

        const { error: ptError } = await supabase
          .from('pt_profiles')
          .upsert(ptPayload, { onConflict: 'user_id' });
        if (ptError) {
          setError(t('profileEdit.error'));
          return;
        }
      }

      await refreshAuthProfile();
      await refetch();
      setSaved(true);
    });
  }

  function handleCancel() {
    router.back();
  }

  return (
    <Screen style={{ padding: 0 }}>
      <Row
        style={{
          justifyContent: 'space-between',
          paddingHorizontal: theme.space[5],
          paddingVertical: theme.space[3],
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Button label={t('common.cancel')} variant="ghost" size="md" onPress={handleCancel} />
        <Text variant="bodyBold">{t('profileEdit.title')}</Text>
        <Button label={t('common.save')} variant="ghost" size="md" onPress={handleSave} disabled={submitting} />
      </Row>

      <ScrollView contentContainerStyle={{ padding: theme.space[5], gap: theme.space[5] }}>
        {error ? <Banner variant="danger" message={error} /> : null}
        {saved ? <Banner variant="success" message={t('profileEdit.saved')} /> : null}

        <View style={{ alignItems: 'center' }}>
          <Avatar displayName={displayName || auth.user?.display_name} photoUrl={photoUrl || avatarUrl} />
        </View>

        <View>
          <Text variant="label" tone="muted" style={{ marginBottom: theme.space[3] }}>
            {t('profileEdit.accountSection')}
          </Text>
          <TextField
            label={t('profileEdit.displayNameLabel')}
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
          />
          <TextField
            label={t('profileEdit.phoneLabel')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <TextField
            label={t('profileEdit.photoUrlLabel')}
            value={avatarUrl}
            onChangeText={setAvatarUrl}
            autoCapitalize="none"
            keyboardType="url"
          />
        </View>

        {isPt ? (
          <>
            <View>
              <Text variant="label" tone="muted" style={{ marginBottom: theme.space[3] }}>
                {t('profileEdit.ptSection')}
              </Text>
              <TextField
                label={t('profileEdit.bioLabel')}
                value={bio}
                onChangeText={(v) => setBio(v.slice(0, 300))}
                multiline
                numberOfLines={4}
              />
              <Text tone="muted" variant="caption" style={{ textAlign: 'right', marginTop: -theme.space[3] }}>
                {bio.length} / 300
              </Text>
              <TextField
                label={t('profileEdit.photoUrlLabel')}
                value={photoUrl}
                onChangeText={setPhotoUrl}
                autoCapitalize="none"
                keyboardType="url"
              />

              <Text variant="label" tone="muted" style={{ marginTop: theme.space[2], marginBottom: theme.space[2] }}>
                {t('profileEdit.specializationsLabel')}
              </Text>
              <ChipRow
                options={SPECIALIZATION_OPTIONS}
                selected={specializations}
                onToggle={(option) => toggle(specializations, setSpecializations, option)}
              />

              <Text variant="label" tone="muted" style={{ marginTop: theme.space[4], marginBottom: theme.space[2] }}>
                {t('profileEdit.languagesLabel')}
              </Text>
              <ChipRow
                options={LANGUAGE_OPTIONS}
                selected={languages}
                onToggle={(option) => toggle(languages, setLanguages, option)}
              />
            </View>

            <View>
              <Text variant="label" tone="muted" style={{ marginBottom: theme.space[3] }}>
                {t('profileEdit.certificationsSection')}
              </Text>
              <CertificationsEditor
                userId={userId}
                certifications={certifications}
                onChange={refetch}
                allowDelete
              />
            </View>
          </>
        ) : null}

        <Button
          label={t('profileEdit.deleteAccount')}
          variant="ghost"
          onPress={() => setDeleteSheetOpen(true)}
          style={{ borderColor: theme.colors.dangerAccent, marginTop: theme.space[4] }}
        />
        {/* TODO(M10): real GDPR account-deletion job — this button only opens a
            support-contact message; there is no self-service deletion in M1. */}

        {deleteSheetOpen ? (
          <Card style={{ borderColor: theme.colors.dangerAccent, gap: theme.space[3] }}>
            <Text variant="bodyBold">{t('profileEdit.deleteAccount')}</Text>
            <Text tone="secondary">{t('profileEdit.deleteAccountBody')}</Text>
            <Row style={{ gap: theme.space[3] }}>
              <Button
                label={t('profileEdit.deleteAccountClose')}
                variant="ghost"
                onPress={() => setDeleteSheetOpen(false)}
                style={{ flex: 1 }}
              />
              <Button
                label={t('profileEdit.deleteAccountContact')}
                onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Delete%20my%20Forge%20account`)}
                style={{ flex: 1 }}
              />
            </Row>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

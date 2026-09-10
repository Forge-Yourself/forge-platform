import type { Database } from '@forge/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useAuth } from '../../lib/auth/AuthProvider';
import { refreshAuthProfile } from '../../lib/auth/refreshProfile';
import { useAsyncSubmit } from '../../lib/forms/useAsyncSubmit';
import { Avatar } from '../../lib/profile/Avatar';
import { CertificationsEditor } from '../../lib/profile/CertificationsEditor';
import { LANGUAGE_OPTIONS, SPECIALIZATION_OPTIONS, toggleOption } from '../../lib/profile/options';
import { usePtProfileData } from '../../lib/profile/usePtProfileData';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, Button, Card, ChipRow, FormScreen, Row, StepProgress, Text, TextField } from '../../ui';

const TOTAL_STEPS = 4;
const BIO_MAX = 300;

type PtProfilesInsert = Database['public']['Tables']['pt_profiles']['Insert'];

/**
 * Onboarding step 2 — 4 sub-steps, sticky Back/Continue footer, per-step Skip.
 * "Skip" means "skip this step's fields", not "skip onboarding" — there's no way to
 * bypass the wizard entirely, only to leave individual optional fields blank; step 4
 * always reaches a real Finish action (see handleFinish) regardless of which fields
 * were filled in along the way.
 *
 * Each step's Continue progressively upserts into `pt_profiles` (rather than
 * deferring everything to the end) so a PT who closes the app mid-wizard doesn't lose
 * earlier steps — matches the design brief's "progressive" budget. Certifications
 * (step 2) are written immediately by CertificationsEditor's own insert, one row at a
 * time, rather than batched with Continue.
 */
export default function PtProfile() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const userId = auth.user?.id;
  const { ptProfile, certifications, refetch } = usePtProfileData(userId);
  const { submitting, error, setError, run } = useAsyncSubmit();

  const [step, setStep] = useState(1);

  // Step 1 — prefilled from whatever's already there (sign-up's display name, an
  // earlier partial pass through this wizard).
  const [displayName, setDisplayName] = useState(auth.user?.display_name ?? '');
  const [bio, setBio] = useState(ptProfile?.bio ?? '');

  // Steps 3 & 4 — chip selections.
  const [specializations, setSpecializations] = useState<string[]>(ptProfile?.specializations ?? []);
  const [languages, setLanguages] = useState<string[]>(ptProfile?.languages ?? []);

  async function upsertPtProfile(partial: Omit<PtProfilesInsert, 'user_id'>) {
    if (!userId) return;
    const { error: upsertError } = await supabase
      .from('pt_profiles')
      .upsert({ user_id: userId, ...partial }, { onConflict: 'user_id' });
    if (upsertError) throw upsertError;
    await refreshAuthProfile();
    await refetch();
  }

  function goNext() {
    if (step < TOTAL_STEPS) setStep(step + 1);
  }

  async function handleSaveStep1() {
    setError(null);
    await run(async () => {
      try {
        if (userId && displayName.trim().length > 0 && displayName.trim() !== auth.user?.display_name) {
          const { error: userError } = await supabase
            .from('users')
            .update({ display_name: displayName.trim() })
            .eq('id', userId);
          if (userError) throw userError;
        }
        await upsertPtProfile({ bio });
        goNext();
      } catch {
        setError(t('onboarding.ptProfile.error'));
      }
    });
  }

  async function handleSaveStep3() {
    setError(null);
    await run(async () => {
      try {
        await upsertPtProfile({ specializations });
        goNext();
      } catch {
        setError(t('onboarding.ptProfile.error'));
      }
    });
  }

  /** Step 4's finish action — the one write every path through this wizard must reach. */
  async function handleFinish(saveLanguages: boolean) {
    setError(null);
    await run(async () => {
      try {
        if (saveLanguages) {
          await upsertPtProfile({ languages });
        }
        if (userId) {
          const { error: finishError } = await supabase
            .from('users')
            .update({ onboarding_completed: true })
            .eq('id', userId);
          if (finishError) throw finishError;
        }
        await refreshAuthProfile();
        // No manual navigation — the gate reacts to onboarding_completed=true and
        // renders (app) on its own.
      } catch {
        setError(t('onboarding.ptProfile.error'));
      }
    });
  }

  function handleBack() {
    if (step > 1) setStep(step - 1);
  }

  function handleContinue() {
    if (step === 1) return void handleSaveStep1();
    if (step === 2) return goNext();
    if (step === 3) return void handleSaveStep3();
    return void handleFinish(true);
  }

  function handleSkip() {
    if (step < TOTAL_STEPS) return goNext();
    return void handleFinish(false);
  }

  const stepTitleKey = ['step1', 'step2', 'step3', 'step4'][step - 1] as
    | 'step1'
    | 'step2'
    | 'step3'
    | 'step4';

  return (
    <FormScreen
      footer={
        <View style={{ gap: theme.space[2] }}>
          {error ? <Banner variant="danger" message={error} /> : null}
          <Row style={{ gap: theme.space[3] }}>
            {step > 1 ? (
              <Button label={t('common.back')} variant="ghost" onPress={handleBack} style={{ flex: 1 }} />
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <Button
              label={step === TOTAL_STEPS ? t('onboarding.ptProfile.step4.finish') : t('common.continue')}
              onPress={handleContinue}
              disabled={submitting}
              style={{ flex: 1 }}
            />
          </Row>
          <Button label={t('common.skip')} variant="ghost" onPress={handleSkip} disabled={submitting} />
        </View>
      }
    >
      <Text variant="label" tone="muted" style={{ marginBottom: theme.space[2] }}>
        {t('onboarding.ptProfile.stepOf', { step, total: TOTAL_STEPS })}
      </Text>
      <View style={{ marginBottom: theme.space[4] }}>
        <StepProgress
          progress={step / TOTAL_STEPS}
          label={t('onboarding.ptProfile.stepOf', { step, total: TOTAL_STEPS })}
        />
      </View>
      <Text variant="h2" style={{ marginBottom: theme.space[5] }}>
        {t(`onboarding.ptProfile.${stepTitleKey}.title`)}
      </Text>

      {step === 1 ? (
        <>
          <View style={{ alignItems: 'center', marginBottom: theme.space[5] }}>
            <View style={{ marginBottom: theme.space[3] }}>
              <Avatar displayName={displayName || auth.user?.display_name} />
            </View>
            <Button
              label={t('onboarding.ptProfile.step1.addPhoto')}
              variant="ghost"
              size="md"
              // Avatar upload is deferred to M4's Storage layer (no bucket/policy
              // exists yet) — this deliberately does nothing beyond surfacing the
              // note below, rather than pretending to accept a photo it can't store.
              onPress={() => {}}
            />
            <Text tone="muted" variant="caption" style={{ marginTop: theme.space[1] }}>
              {t('onboarding.ptProfile.step1.addPhotoNote')}
            </Text>
          </View>

          <TextField
            label={t('onboarding.ptProfile.step1.displayNameLabel')}
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
          />

          <TextField
            label={t('onboarding.ptProfile.step1.bioLabel')}
            value={bio}
            onChangeText={(v) => setBio(v.slice(0, BIO_MAX))}
            placeholder={t('onboarding.ptProfile.step1.bioPlaceholder')}
            multiline
            numberOfLines={4}
          />
          <Text tone="muted" variant="caption" style={{ textAlign: 'right', marginTop: -theme.space[3] }}>
            {bio.length} / {BIO_MAX}
          </Text>
        </>
      ) : null}

      {step === 2 ? (
        <CertificationsEditor userId={userId} certifications={certifications} onChange={refetch} />
      ) : null}

      {step === 3 ? (
        <>
          <Text variant="label" tone="muted" style={{ marginBottom: theme.space[2] }}>
            {t('onboarding.ptProfile.step3.specializationsLabel')}
          </Text>
          <View style={{ marginBottom: theme.space[5] }}>
            <ChipRow
              options={SPECIALIZATION_OPTIONS}
              selected={specializations}
              onToggle={(option) => toggleOption(specializations, setSpecializations, option)}
            />
          </View>
          <Banner variant="info" message={t('onboarding.ptProfile.step3.pricingNote')} />
        </>
      ) : null}

      {step === 4 ? (
        <>
          <Text variant="label" tone="muted" style={{ marginBottom: theme.space[2] }}>
            {t('onboarding.ptProfile.step4.languagesLabel')}
          </Text>
          <View style={{ marginBottom: theme.space[5] }}>
            <ChipRow
              options={LANGUAGE_OPTIONS}
              selected={languages}
              onToggle={(option) => toggleOption(languages, setLanguages, option)}
            />
          </View>
          <Card>
            <Text variant="bodyBold">{t('onboarding.ptProfile.step4.summaryTitle')}</Text>
            <Text tone="secondary">{t('onboarding.ptProfile.step4.summaryBody')}</Text>
          </Card>
        </>
      ) : null}
    </FormScreen>
  );
}

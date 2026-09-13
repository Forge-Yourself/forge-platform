import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useAuth } from '../../lib/auth/AuthProvider';
import { refreshAuthProfile } from '../../lib/auth/refreshProfile';
import { useAsyncSubmit } from '../../lib/forms/useAsyncSubmit';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, Button, ChoiceCard, Screen, SectionLabel, Text } from '../../ui';

type SelfServiceRole = 'pt' | 'client';

/**
 * Onboarding step 1 — not in the original design prototype; built from the two-card
 * pattern at docs/Forge_DesignSystem.html ~L602-624. Only 'pt'/'client' are offered:
 * `gym_account` is a valid `users.role` value but has no v1 self-service signup path
 * (M7 builds the gym-invite flow that creates those), and `admin` has none at all —
 * `set_initial_role()` itself rejects anything else (0004_m1_identity.sql).
 *
 * Timing decision (`onboarding_completed`): `set_initial_role()` only ever writes
 * `users.role` — it never touches `onboarding_completed`. That's correct for a PT:
 * (onboarding)/pt-profile is still ahead of them, and the gate (app/_layout.tsx)
 * routes a role='pt' user with onboarding_completed=false straight there. But a
 * CLIENT has no further M1 onboarding step — there's no intake/profile screen for
 * clients until M2's client-facing work — so if this screen left
 * onboarding_completed alone for that branch, the gate would have nowhere to send a
 * client next: it isn't 'pt', so the pt-profile carve-out doesn't apply, and
 * onboarding_completed is still false, so the catch-all keeps redirecting back to
 * this same screen forever. This screen closes that gap explicitly by setting
 * onboarding_completed=true itself, but ONLY on the client branch.
 */
export default function Role() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const [selected, setSelected] = useState<SelfServiceRole | null>(null);
  const { submitting, error, setError, run } = useAsyncSubmit();

  async function handleContinue() {
    if (!selected) return;
    setError(null);

    await run(async () => {
      const { error: rpcError } = await supabase.rpc('set_initial_role', { p_role: selected });
      if (rpcError) {
        setError(t('onboarding.role.error'));
        return;
      }

      if (selected === 'client' && auth.user) {
        const { error: updateError } = await supabase
          .from('users')
          .update({ onboarding_completed: true })
          .eq('id', auth.user.id);
        if (updateError) {
          setError(t('onboarding.role.error'));
          return;
        }
      }

      // Both the RPC above and the plain UPDATE just above are raw table writes, not
      // an `auth.updateUser()` call — neither fires USER_UPDATED, so useAuth().user
      // (and the gate that reads it) would otherwise stay stale.
      await refreshAuthProfile();

      // 'pt' needs no navigation: the gate has an ACTIVE redirect for role='pt' with
      // onboarding_completed=false, and sends them to (onboarding)/pt-profile itself
      // once the refreshed state lands.
      //
      // 'client' does need it. Once onboarding_completed flips true the gate falls
      // through to its last branch, which is a passive <Slot/> (app/_layout.tsx) —
      // that re-renders whatever route already matched, i.e. THIS screen. The DB
      // write succeeds, the refresh lands, and the user sits on the role picker
      // watching nothing happen. Same hand-off, for the same reason, as
      // pt-profile.tsx's handleFinish and mfa-enroll.tsx's handleVerified.
      if (selected === 'client') {
        router.replace('/');
      }
    });
  }

  return (
    <Screen>
      <SectionLabel>{t('onboarding.role.step')}</SectionLabel>
      <Text variant="h2" style={{ marginBottom: theme.space[2] }}>
        {t('onboarding.role.title')}
      </Text>
      <Text tone="secondary" style={{ marginBottom: theme.space[6] }}>
        {t('onboarding.role.subtitle')}
      </Text>

      {error ? (
        <View style={{ marginBottom: theme.space[4] }}>
          <Banner variant="danger" message={error} />
        </View>
      ) : null}

      <View accessibilityRole="radiogroup" style={{ gap: theme.space[3] }}>
        <ChoiceCard
          title={t('onboarding.role.ptTitle')}
          subtitle={t('onboarding.role.ptSubtitle')}
          selected={selected === 'pt'}
          onPress={() => setSelected('pt')}
        />
        <ChoiceCard
          title={t('onboarding.role.clientTitle')}
          subtitle={t('onboarding.role.clientSubtitle')}
          selected={selected === 'client'}
          onPress={() => setSelected('client')}
        />
      </View>

      <Button
        label={t('onboarding.role.continue')}
        size="lg"
        onPress={handleContinue}
        loading={submitting}
        disabled={!selected}
        style={{ marginTop: theme.space[6] }}
      />
    </Screen>
  );
}

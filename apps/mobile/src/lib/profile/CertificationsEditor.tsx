import { ptCertificationSchema } from '@forge/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, Button, Card, Row, Text, TextField } from '../../ui';
import { supabase } from '../supabase';
import type { PtCertificationRow } from './usePtProfileData';

export type CertificationsEditorProps = {
  userId: string | undefined;
  certifications: PtCertificationRow[];
  /** Called after a successful insert (and delete, when `allowDelete` is set) so the
   * caller's own `pt_certifications` read (usePtProfileData's `refetch`) picks it up. */
  onChange: () => void | Promise<void>;
  /** profile-edit allows removing a cert added earlier; the onboarding wizard doesn't
   * surface delete — there's nothing to undo yet on a brand-new list. */
  allowDelete?: boolean;
};

/**
 * The "cards + dashed add row + small inline insert form" certification editor,
 * shared by (onboarding)/pt-profile (step 2) and (app)/profile-edit — both screens
 * need the identical insert flow against `pt_certifications`, and profile-edit adds
 * delete on top of it.
 *
 * Every row's status is 'unverified' in M1 (the table's own DEFAULT — no upload or
 * admin review pipeline exists yet), so the status badge is intentionally neutral,
 * never colored as though a review were in progress.
 */
export function CertificationsEditor({
  userId,
  certifications,
  onChange,
  allowDelete = false,
}: CertificationsEditorProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const [adding, setAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [issuer, setIssuer] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Neither parent screen gates its own Continue/Skip/Finish on this component's
  // `submitting` — a user can advance the wizard (or leave profile-edit) while an
  // insert/delete here is still in flight, unmounting this component mid-await. The
  // write itself still completes server-side; this guard only stops the trailing
  // setState calls and onChange()/refetch() from firing against unmounted state.
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleAdd() {
    setFormError(null);
    const result = ptCertificationSchema.safeParse({
      name,
      issuer: issuer.trim() || undefined,
      expires_on: expiresOn.trim() || undefined,
    });
    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? t('onboarding.ptProfile.step2.nameRequired'));
      return;
    }
    if (!userId) return;

    setSubmitting(true);
    try {
      const { error } = await supabase.from('pt_certifications').insert({
        pt_user_id: userId,
        name: result.data.name,
        issuer: result.data.issuer ?? null,
        expires_on: result.data.expires_on ?? null,
      });
      if (!mountedRef.current) return;
      if (error) {
        setFormError(t('onboarding.ptProfile.error'));
        return;
      }
      setName('');
      setIssuer('');
      setExpiresOn('');
      setAdding(false);
      await onChange();
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setSubmitting(true);
    try {
      const { error } = await supabase.from('pt_certifications').delete().eq('id', id);
      if (!mountedRef.current) return;
      if (!error) await onChange();
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  }

  return (
    <View style={{ gap: theme.space[3] }}>
      {certifications.length === 0 ? (
        <Text tone="muted">{t('onboarding.ptProfile.step2.empty')}</Text>
      ) : (
        certifications.map((cert) => (
          <Card key={cert.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="bodyBold" style={{ flex: 1 }}>
                {cert.name}
              </Text>
              <View
                style={{
                  paddingHorizontal: theme.space[2],
                  paddingVertical: 3,
                  borderRadius: theme.radius.pill,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surfaceSunken,
                }}
              >
                <Text variant="caption" tone="muted">
                  {t('onboarding.ptProfile.step2.statusUnverified')}
                </Text>
              </View>
            </Row>
            {cert.issuer || cert.expires_on ? (
              <Text tone="muted" variant="caption">
                {[cert.issuer, cert.expires_on].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
            {allowDelete ? (
              <Button
                label={t('profileEdit.removeCertification')}
                variant="ghost"
                size="md"
                onPress={() => void handleDelete(cert.id)}
                disabled={submitting}
                style={{ marginTop: theme.space[2], alignSelf: 'flex-start' }}
              />
            ) : null}
          </Card>
        ))
      )}

      {adding ? (
        <Card style={{ gap: theme.space[3] }}>
          {formError ? <Banner variant="danger" message={formError} /> : null}
          <TextField
            label={t('onboarding.ptProfile.step2.nameLabel')}
            value={name}
            onChangeText={setName}
          />
          <TextField
            label={t('onboarding.ptProfile.step2.issuerLabel')}
            value={issuer}
            onChangeText={setIssuer}
          />
          <TextField
            label={t('onboarding.ptProfile.step2.expiresLabel')}
            value={expiresOn}
            onChangeText={setExpiresOn}
            placeholder="2027-06-01"
            autoCapitalize="none"
          />
          <Row style={{ gap: theme.space[3] }}>
            <Button
              label={t('common.cancel')}
              variant="ghost"
              onPress={() => {
                setAdding(false);
                setFormError(null);
              }}
              style={{ flex: 1 }}
            />
            <Button
              label={t('onboarding.ptProfile.step2.saveCertification')}
              onPress={() => void handleAdd()}
              disabled={submitting}
              style={{ flex: 1 }}
            />
          </Row>
        </Card>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.ptProfile.step2.addCertification')}
          onPress={() => setAdding(true)}
          style={{
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: theme.colors.borderStrong,
            borderRadius: theme.radius.md,
            padding: theme.space[4],
            alignItems: 'center',
            minHeight: theme.touchTarget,
            justifyContent: 'center',
          }}
        >
          <Text tone="secondary" variant="bodyBold">
            {t('onboarding.ptProfile.step2.addCertification')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../lib/auth/AuthProvider';
import { Avatar } from '../../lib/profile/Avatar';
import { usePtProfileData } from '../../lib/profile/usePtProfileData';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, Button, Card, Row, Screen, Skeleton, Text } from '../../ui';

type RoleKey = 'pt' | 'client' | 'gym_account' | 'admin';

/**
 * Read-only profile view for both personas. PT-specific fields (bio, certifications,
 * specializations, languages) only render when `role === 'pt'` — a client has none of
 * those columns to show.
 */
export default function Profile() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const isPt = auth.user?.role === 'pt';
  const { loading, error, ptProfile, certifications, refetch } = usePtProfileData(
    isPt ? auth.user?.id : undefined,
  );

  // Client accounts have no pt_profiles/pt_certifications rows to wait on — only a PT
  // profile fetch (or AuthProvider itself still resolving) should show the skeleton.
  const showLoading = auth.status === 'loading' || (isPt && loading);

  if (showLoading) {
    return (
      <Screen>
        <View style={{ alignItems: 'center', marginBottom: theme.space[5] }}>
          <Skeleton width={88} height={88} radius={44} />
        </View>
        <Skeleton height={24} width="60%" />
        <View style={{ height: theme.space[3] }} />
        <Skeleton height={16} width="40%" />
        <View style={{ height: theme.space[6] }} />
        <Skeleton height={80} />
      </Screen>
    );
  }

  if (isPt && error) {
    return (
      <Screen>
        <Banner variant="danger" message={t('profile.loadFailed')} />
        <Button
          label={t('common.retry')}
          variant="ghost"
          onPress={() => void refetch()}
          style={{ marginTop: theme.space[4] }}
        />
      </Screen>
    );
  }

  const roleKey: RoleKey = (auth.user?.role as RoleKey | undefined) ?? 'client';

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: theme.space[5] }}>
        <View style={{ alignItems: 'center' }}>
          <View style={{ marginBottom: theme.space[3] }}>
            <Avatar
              displayName={auth.user?.display_name}
              photoUrl={ptProfile?.profile_photo_url ?? auth.user?.avatar_url}
            />
          </View>
          <Text variant="h2">{auth.user?.display_name}</Text>
        </View>

        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text tone="secondary">{t('profile.emailLabel')}</Text>
            <Text>{auth.user?.email}</Text>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text tone="secondary">{t('profile.roleLabel')}</Text>
            <Text>{t(`profile.roles.${roleKey}`)}</Text>
          </Row>
        </Card>

        {isPt ? (
          <>
            <Card>
              <Text variant="label" tone="muted">
                {t('profile.bioLabel')}
              </Text>
              <Text>{ptProfile?.bio || t('profile.bioEmpty')}</Text>
            </Card>

            <Card>
              <Text variant="label" tone="muted">
                {t('profile.specializationsLabel')}
              </Text>
              <Text>
                {ptProfile?.specializations?.length
                  ? ptProfile.specializations.join(', ')
                  : t('profile.specializationsEmpty')}
              </Text>
            </Card>

            <Card>
              <Text variant="label" tone="muted">
                {t('profile.languagesLabel')}
              </Text>
              <Text>
                {ptProfile?.languages?.length ? ptProfile.languages.join(', ') : t('profile.languagesEmpty')}
              </Text>
            </Card>

            <Card>
              <Text variant="label" tone="muted" style={{ marginBottom: theme.space[1] }}>
                {t('profile.certificationsLabel')}
              </Text>
              {certifications.length === 0 ? (
                <Text tone="muted">{t('profile.certificationsEmpty')}</Text>
              ) : (
                certifications.map((cert) => (
                  <View key={cert.id} style={{ marginBottom: theme.space[2] }}>
                    <Text variant="bodyBold">{cert.name}</Text>
                    {cert.issuer || cert.expires_on ? (
                      <Text tone="muted" variant="caption">
                        {[cert.issuer, cert.expires_on].filter(Boolean).join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                ))
              )}
            </Card>
          </>
        ) : null}

        <Button
          label={t('profile.editButton')}
          onPress={() => router.push('/(app)/profile-edit')}
        />
      </ScrollView>
    </Screen>
  );
}

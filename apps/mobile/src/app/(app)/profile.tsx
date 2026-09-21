import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../lib/auth/AuthProvider';
import { usePtProfileData } from '../../lib/profile/usePtProfileData';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Avatar,
  Banner,
  Button,
  FooterBar,
  Icon,
  ListRow,
  NavHeader,
  Screen,
  SectionCard,
  SectionLabel,
  Skeleton,
  Tag,
  Text,
} from '../../ui';

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

  const back = (
    <Button label={t('common.back')} icon="chevronBack" variant="link" onPress={() => router.back()} />
  );

  if (showLoading) {
    return (
      <Screen padded={false}>
        <NavHeader leading={back} divider={false} />
        <View style={{ padding: theme.space[5], alignItems: 'center', gap: theme.space[3] }}>
          <Skeleton width={88} height={88} radius={44} />
          <Skeleton height={24} width="60%" />
          <Skeleton height={16} width="40%" />
          <View style={{ height: theme.space[4] }} />
          <Skeleton height={80} />
        </View>
      </Screen>
    );
  }

  if (isPt && error) {
    return (
      <Screen padded={false}>
        <NavHeader leading={back} divider={false} />
        <View style={{ padding: theme.space[5], gap: theme.space[4] }}>
          <Banner variant="danger" message={t('profile.loadFailed')} />
          <Button label={t('common.retry')} variant="ghost" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  const roleKey: RoleKey = (auth.user?.role as RoleKey | undefined) ?? 'client';

  const specializations = ptProfile?.specializations ?? [];
  const languages = ptProfile?.languages ?? [];

  return (
    <Screen padded={false}>
      <NavHeader leading={back} divider={false} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.space[4],
          paddingBottom: theme.space[5],
          gap: theme.space[4],
        }}
      >
        <View style={{ alignItems: 'center', gap: theme.space[2], paddingVertical: theme.space[3] }}>
          <Avatar
            name={auth.user?.display_name}
            photoUrl={ptProfile?.profile_photo_url ?? auth.user?.avatar_url}
            size={88}
          />
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{ fontSize: 23, fontWeight: '800', letterSpacing: -0.4 }}
          >
            {auth.user?.display_name}
          </Text>
          <Tag label={t(`profile.roles.${roleKey}`).toUpperCase()} tone="accent" />
        </View>

        <SectionCard>
          <ListRow
            leading={<Icon name="mail" size={19} color={theme.colors.textMuted} />}
            title={t('profile.emailLabel')}
            chevron={false}
            isLast
            trailing={
              <Text numeric numberOfLines={1} tone="secondary" style={{ fontSize: 13, maxWidth: 190 }}>
                {auth.user?.email}
              </Text>
            }
          />
        </SectionCard>

        {/*
          The second way into the PT's own training record. It appears only
          once the record exists — creating it belongs to the Today screen's
          card, so there is exactly one place that can mint the row.
        */}
        {isPt && auth.selfClientId !== null ? (
          <SectionCard>
            <ListRow
              leading={<Icon name="user" size={19} color={theme.colors.textMuted} />}
              title={t('me.profileRow')}
              onPress={() => router.push('/(app)/me')}
              isLast
            />
          </SectionCard>
        ) : null}

        {isPt ? (
          <>
            <View style={{ gap: theme.space[2] }}>
              <SectionLabel>{t('profile.bioLabel')}</SectionLabel>
              <Text
                tone={ptProfile?.bio ? 'secondary' : 'muted'}
                style={{ fontSize: 14, lineHeight: 21, paddingHorizontal: 4 }}
              >
                {ptProfile?.bio || t('profile.bioEmpty')}
              </Text>
            </View>

            <View style={{ gap: theme.space[2] }}>
              <SectionLabel>{t('profile.specializationsLabel')}</SectionLabel>
              {specializations.length === 0 ? (
                <Text tone="muted" style={{ paddingHorizontal: 4 }}>
                  {t('profile.specializationsEmpty')}
                </Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 4 }}>
                  {specializations.map((item) => (
                    <Tag key={item} label={item} />
                  ))}
                </View>
              )}
            </View>

            <View style={{ gap: theme.space[2] }}>
              <SectionLabel>{t('profile.languagesLabel')}</SectionLabel>
              {languages.length === 0 ? (
                <Text tone="muted" style={{ paddingHorizontal: 4 }}>
                  {t('profile.languagesEmpty')}
                </Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 4 }}>
                  {languages.map((item) => (
                    <Tag key={item} label={item} />
                  ))}
                </View>
              )}
            </View>

            <View style={{ gap: theme.space[2] }}>
              <SectionLabel>{t('profile.certificationsLabel')}</SectionLabel>
              {certifications.length === 0 ? (
                <Text tone="muted" style={{ paddingHorizontal: 4 }}>
                  {t('profile.certificationsEmpty')}
                </Text>
              ) : (
                <SectionCard>
                  {certifications.map((cert, index) => (
                    <ListRow
                      key={cert.id}
                      leading={<Icon name="shield" size={19} color={theme.colors.textMuted} />}
                      title={cert.name}
                      subtitle={[cert.issuer, cert.expires_on].filter(Boolean).join(' · ') || undefined}
                      chevron={false}
                      isLast={index === certifications.length - 1}
                    />
                  ))}
                </SectionCard>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>

      <FooterBar>
        <Button
          label={t('profile.editButton')}
          icon="edit"
          size="lg"
          onPress={() => router.push('/(app)/profile-edit')}
        />
      </FooterBar>
    </Screen>
  );
}

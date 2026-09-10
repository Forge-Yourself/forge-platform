import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, Screen, Text } from '../../ui';

/**
 * MFA is OFFERED here, not FORCED — "Set up two-factor" navigates to
 * (onboarding)/mfa-enroll (Task 9's screen; still a placeholder from Task 6's plan
 * until Task 9 lands). "Skip for now" just lets the gate's normal flow continue.
 */
export default function VerifySuccess() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Screen>
      <View
        accessible
        accessibilityLabel={t('auth.verifySuccess.title')}
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          backgroundColor: theme.colors.successSurface,
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'center',
          marginBottom: theme.space[6],
        }}
      >
        <Text style={{ color: theme.colors.onSuccessSurface, fontSize: 34, fontWeight: '700' }}>
          ✓
        </Text>
      </View>

      <Text variant="h2" style={{ textAlign: 'center', marginBottom: theme.space[7] }}>
        {t('auth.verifySuccess.title')}
      </Text>

      <Button
        label={t('auth.verifySuccess.setupMfa')}
        size="lg"
        onPress={() => router.push('/(onboarding)/mfa-enroll')}
      />

      <Button
        label={t('auth.verifySuccess.skip')}
        variant="ghost"
        onPress={() => router.replace('/')}
        style={{ marginTop: theme.space[3] }}
      />
    </Screen>
  );
}

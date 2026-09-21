import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { SessionHistoryScreen } from '../../../lib/logging/SessionHistoryScreen';

/**
 * Every workout the PT has logged against their own record — the "See all"
 * behind the last-3 preview on /me. The body is shared with client detail's
 * own history route; only the back target and the title differ.
 */
export default function MySessions() {
  const { t } = useTranslation();
  const auth = useAuth();

  return (
    <SessionHistoryScreen
      clientId={auth.selfClientId ?? undefined}
      title={t('me.sessionsTitle')}
      onBack={() => router.dismissTo('/(app)/me')}
    />
  );
}

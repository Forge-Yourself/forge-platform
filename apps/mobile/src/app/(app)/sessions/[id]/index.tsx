import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSessionController } from '../../../../lib/logging/useSessionController';
import { OFFLINE } from '../../../../lib/offline/cachedFetch';
import { useTheme } from '../../../../theme/ThemeProvider';
import { Button, EmptyState, NavHeader, Screen, Skeleton } from '../../../../ui';
import { PhoneSession } from '../../../../ui/logging/PhoneSession';
import { SessionSummary } from '../../../../ui/logging/SessionSummary';

/**
 * One route, both personas, state-driven (M4a spec §5.3). The body is keyed
 * on the id, so switching session in place (the console rail, M4d) remounts
 * the controller instead of carrying one session's draft into another.
 */
export default function SessionScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  return <SessionBody key={params.id} sessionId={params.id} />;
}

function SessionBody({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = useSessionController(sessionId);
  const back = <Button label={t('common.back')} variant="link" icon="chevronBack" onPress={c.goBack} />;

  if (c.data.loading) {
    return (
      <Screen padded={false}>
        <NavHeader leading={back} divider={false} />
        <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
          <Skeleton height={120} />
          <Skeleton height={56} />
        </View>
      </Screen>
    );
  }
  if (c.data.error || !c.session) {
    return (
      <Screen padded={false}>
        <NavHeader leading={back} divider={false} />
        <EmptyState
          icon="alert"
          tone="danger"
          // No signal and not on this device: that is not a missing session.
          title={c.data.error === OFFLINE ? t('logging.offline.needsConnection') : t('logging.session.notFound')}
          body={c.data.error === OFFLINE ? t('logging.offline.needsConnectionBody') : t('logging.session.notFoundBody')}
          actionLabel={t('common.back')}
          actionVariant="ghost"
          onAction={() => router.dismissTo('/')}
        />
      </Screen>
    );
  }
  if (!c.inProgress) return <SessionSummary c={c} />;
  return <PhoneSession c={c} />;
}

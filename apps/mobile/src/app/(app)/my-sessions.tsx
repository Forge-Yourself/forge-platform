import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SessionList } from '../../lib/logging/SessionList';
import { useSessionHistory } from '../../lib/logging/useSessionHistory';
import { NeedsConnection } from '../../lib/offline/NeedsConnection';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, Button, EmptyState, NavHeader, Screen, Skeleton } from '../../ui';

export default function MySessions() {
  return (
    <NeedsConnection pushed>
      <MySessionsInner />
    </NeedsConnection>
  );
}

/**
 * The client's own workout history — the "See all" behind Recent workouts on
 * Today (spec §5.4).
 *
 * The hook is called with no client id on purpose: RLS returns exactly the
 * signed-in client's own sessions, so the filter is the policy rather than a
 * client-side `eq` somebody could later drop.
 *
 * Back is `dismissTo` (PITFALLS N15) — Today is a tab, so there may be nothing
 * to pop on a cold deep link.
 */
function MySessionsInner() {
  const { t } = useTranslation();
  const theme = useTheme();
  const history = useSessionHistory(undefined);

  const back = (
    <Button
      label={t('common.back')}
      variant="link"
      icon="chevronBack"
      onPress={() => router.dismissTo('/')}
    />
  );

  return (
    <Screen padded={false}>
      <NavHeader leading={back} title={t('logging.history.myTitle')} divider />
      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[3] }}>
        {history.loading ? <Skeleton height={68} /> : null}
        {history.error ? <Banner variant="danger" message={t('logging.history.error')} /> : null}
        {history.isEmpty ? (
          <EmptyState
            icon="clock"
            title={t('logging.history.empty')}
            body={t('logging.history.emptyBody')}
          />
        ) : null}
        {history.items.length > 0 ? (
          <View>
            <SessionList items={history.items} />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

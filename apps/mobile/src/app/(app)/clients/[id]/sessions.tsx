import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SessionList } from '../../../../lib/logging/SessionList';
import { useSessionHistory } from '../../../../lib/logging/useSessionHistory';
import { useTheme } from '../../../../theme/ThemeProvider';
import { Banner, Button, EmptyState, NavHeader, Screen, Skeleton } from '../../../../ui';

/**
 * Every session for one client — the "See all" behind the last-3 preview on
 * client detail (spec §5.4).
 *
 * Back is `dismissTo`, not `router.back()`: this route is reachable from a
 * notification or a cold deep link with nothing beneath it, and `back()` there
 * pops to nowhere (PITFALLS N15).
 */
export default function ClientSessions() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const history = useSessionHistory(params.id);

  const back = (
    <Button
      label={t('common.back')}
      variant="link"
      icon="chevronBack"
      onPress={() => router.dismissTo({ pathname: '/(app)/clients/[id]', params: { id: params.id } })}
    />
  );

  return (
    <Screen padded={false}>
      <NavHeader leading={back} title={t('logging.history.title')} divider />
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

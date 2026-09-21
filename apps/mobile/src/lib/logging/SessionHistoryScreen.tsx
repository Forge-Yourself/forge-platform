import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { NeedsConnection } from '../offline/NeedsConnection';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, Button, EmptyState, NavHeader, Screen, Skeleton } from '../../ui';
import { SessionList } from './SessionList';
import { useSessionHistory } from './useSessionHistory';

export type SessionHistoryScreenProps = {
  clientId: string | undefined;
  /** Where the back control goes. Each route owns its own, per PITFALLS N15. */
  onBack: () => void;
  title?: string;
};

/**
 * Every session for one client, as a component rather than a route.
 *
 * Two routes render it — a PT's client detail "See all" and the PT's own
 * `/me` — and they differ only in where Back goes and what the header says.
 * Sharing the body is what stops the two drifting; the alternative is a
 * second copy that quietly stops matching the first (PITFALLS N13).
 */
export function SessionHistoryScreen({ clientId, onBack, title }: SessionHistoryScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const history = useSessionHistory(clientId);

  const back = <Button label={t('common.back')} variant="link" icon="chevronBack" onPress={onBack} />;

  return (
    <NeedsConnection pushed>
      <Screen padded={false}>
        <NavHeader leading={back} title={title ?? t('logging.history.title')} divider />
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
    </NeedsConnection>
  );
}

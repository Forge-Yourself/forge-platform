import { router, useLocalSearchParams } from 'expo-router';
import { SessionHistoryScreen } from '../../../../lib/logging/SessionHistoryScreen';

/**
 * Every session for one client — the "See all" behind the last-3 preview on
 * client detail (spec §5.4). The body lives in SessionHistoryScreen, shared
 * with the PT's own `/me/sessions`.
 *
 * Back is `dismissTo`, not `router.back()`: this route is reachable from a
 * notification or a cold deep link with nothing beneath it, and `back()` there
 * pops to nowhere (PITFALLS N15).
 */
export default function ClientSessions() {
  const params = useLocalSearchParams<{ id: string }>();

  return (
    <SessionHistoryScreen
      clientId={params.id}
      onBack={() => router.dismissTo({ pathname: '/(app)/clients/[id]', params: { id: params.id } })}
    />
  );
}

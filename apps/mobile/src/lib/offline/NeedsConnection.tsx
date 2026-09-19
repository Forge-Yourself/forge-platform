import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, Screen } from '../../ui';
import { useOffline } from './offlineContext';

/**
 * Wraps a screen that has no offline path. With the switch effective and no
 * signal it shows why, instead of that screen's generic load error. A pushed
 * screen gets a Back action (PITFALLS N1, N15); a tab does not need one.
 */
export function NeedsConnection({ children, pushed = false }: { children: ReactNode; pushed?: boolean }) {
  const { t } = useTranslation();
  const o = useOffline();
  if (!o.effective || o.online) return children;
  return (
    <Screen>
      <EmptyState
        icon="alert"
        title={t('logging.offline.needsConnection')}
        body={t('logging.offline.needsConnectionBody')}
        {...(pushed ? { actionLabel: t('common.back'), actionVariant: 'ghost' as const, onAction: () => router.dismissTo('/') } : {})}
      />
    </Screen>
  );
}

import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { OfflineChip, type OfflineChipProps } from '../../ui';
import { useOffline } from './offlineContext';

/**
 * Spec §7. Hidden when the switch is off, or when online with nothing queued.
 * Priority: signed-out pause, then failures, then offline, then syncing.
 * `style` is the caller's spacing: the chip renders nothing when hidden, so
 * a margin on the caller's side would leave a gap behind.
 */
export function OfflineStatusChip({ style }: { style?: StyleProp<ViewStyle> } = {}) {
  const { t } = useTranslation();
  const o = useOffline();
  const queued = o.status.pending + o.status.failed;
  if (!o.effective && queued === 0) return null;
  if (o.online && queued === 0) return null;

  let tone: OfflineChipProps['tone'];
  let label: string;
  if (o.authPaused) {
    tone = 'failed';
    label = t('logging.offline.authPaused', { count: queued });
  } else if (o.status.failed > 0) {
    tone = 'failed';
    label = t('logging.offline.chipPending', { count: queued });
  } else if (!o.online) {
    tone = 'offline';
    label =
      queued > 0
        ? t('logging.offline.chipPending', { count: queued })
        : o.warmedAt
          ? t('logging.offline.chipOffline', {
              time: new Date(o.warmedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            })
          : t('logging.offline.chipOfflineNever');
  } else {
    tone = 'syncing';
    label = t('logging.offline.chipSyncing', { count: queued });
  }

  return (
    <View style={style}>
      <OfflineChip tone={tone} label={label} onPress={() => router.push('/(app)/sync-queue')} />
    </View>
  );
}

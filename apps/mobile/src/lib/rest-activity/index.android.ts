import { Linking, PermissionsAndroid, Platform } from 'react-native';
import Native from '../../../modules/forge-rest-activity';
import type { RestActivity } from './types';

export type { RestActivity, RestActivityPayload, RestActivityStatus } from './types';

/** The local Kotlin module (M4d spec §6.4). Taps are queued natively and drained on foreground. */
export const restActivity: RestActivity = {
  isAvailable: () => Native !== null,
  show: async (p) => {
    await Native?.show({ sessionId: p.sessionId, endsAt: p.endsAt, title: p.title, text: p.text, url: p.url, ...p.labels });
  },
  end: async () => {
    await Native?.end();
  },
  drainActions: async () => (Native ? await Native.drainActions() : []),
  status: async () => (Native ? await Native.status() : 'unavailable'),
  requestPermission: async () => {
    if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
  },
  openSettings: (status) => {
    if (status === 'inexact') Native?.openExactAlarmSettings();
    else void Linking.openSettings();
  },
  addActionListener: () => () => {},
};

import * as Notifications from 'expo-notifications';
import { addUserInteractionListener, type LiveActivity } from 'expo-widgets';
import { Linking } from 'react-native';
import RestLiveActivity, { type RestLiveProps } from './RestLiveActivity';
import type { RestActivity, RestActivityPayload } from './types';

export type { RestActivity, RestActivityPayload, RestActivityStatus } from './types';

let current: LiveActivity<RestLiveProps> | null = null;
let zeroId: string | null = null;

function propsOf(p: RestActivityPayload): RestLiveProps {
  return {
    sessionId: p.sessionId,
    startedAt: p.startedAt,
    endsAt: p.endsAt,
    kicker: p.kicker,
    title: p.title,
    text: p.text,
    plus30: p.labels.plus30,
    skip: p.labels.skip,
  };
}

async function cancelZero() {
  if (zeroId) await Notifications.cancelScheduledNotificationAsync(zeroId).catch(() => undefined);
  zeroId = null;
}

/**
 * expo-widgets Live Activity (M4d spec §6.5). The zero cue is a local
 * notification scheduled at endsAt, because a Live Activity cannot play a
 * sound. Untested on a device until an Apple developer account exists.
 */
export const restActivity: RestActivity = {
  isAvailable: () => true,
  show: async (p) => {
    const props = propsOf(p);
    try {
      current ??= RestLiveActivity.getInstances()[0] ?? null;
      if (current) await current.update(props);
      else current = RestLiveActivity.start(props, p.url);
    } catch {
      current = null; // Live Activities off in Settings, or unsupported: the in-app timer still works
    }
    await cancelZero();
    zeroId = await Notifications.scheduleNotificationAsync({
      content: { title: p.labels.doneTitle, body: p.labels.doneBody, sound: 'timer_done.wav' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(p.endsAt) },
    }).catch(() => null);
  },
  end: async () => {
    await cancelZero();
    const all = [...RestLiveActivity.getInstances(), ...(current ? [current] : [])];
    current = null;
    await Promise.all(all.map((a) => a.end('immediate').catch(() => undefined)));
  },
  drainActions: async () => [],
  status: async () => ((await Notifications.getPermissionsAsync()).granted ? 'ok' : 'notifications_off'),
  requestPermission: async () => {
    await Notifications.requestPermissionsAsync();
  },
  openSettings: () => {
    void Linking.openSettings();
  },
  addActionListener: (listener) => {
    const sub = addUserInteractionListener((e) => {
      if (e.source !== 'RestActivity') return;
      const [action, sessionId] = e.target.split(':');
      if ((action === 'plus30' || action === 'skip') && sessionId) listener({ sessionId, action, at: e.timestamp });
    });
    return () => sub.remove();
  },
};

import type { RestActivity } from './types';

export type { RestActivity, RestActivityPayload, RestActivityStatus } from './types';

/** Web and anything without the native side: the in-app timer is the whole feature. */
export const restActivity: RestActivity = {
  isAvailable: () => false,
  show: async () => {},
  end: async () => {},
  drainActions: async () => [],
  status: async () => 'unavailable',
  requestPermission: async () => {},
  openSettings: () => {},
  addActionListener: () => () => {},
};

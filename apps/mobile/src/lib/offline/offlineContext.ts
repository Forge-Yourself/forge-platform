import type { QueueStatus } from '@forge/shared';
import { createContext, use } from 'react';

export type OfflineContextValue = {
  /** The server allows offline logging for this user (spec §4.3). */
  available: boolean;
  /** Available and switched on on this device. Every offline branch keys off this. */
  effective: boolean;
  online: boolean;
  status: QueueStatus;
  authPaused: boolean;
  warmedAt: string | null;
  /** When a drain last delivered something from this device. */
  syncedAt: string | null;
  setDeviceChoice: (next: boolean) => Promise<'ok' | 'queue_not_empty'>;
  discardAllAndDisable: () => Promise<void>;
  drainNow: () => void;
};

export const OfflineContext = createContext<OfflineContextValue>({
  available: false,
  effective: false,
  online: true,
  status: { pending: 0, failed: 0 },
  authPaused: false,
  warmedAt: null,
  syncedAt: null,
  setDeviceChoice: async () => 'ok',
  discardAllAndDisable: async () => {},
  drainNow: () => {},
});

export function useOffline(): OfflineContextValue {
  return use(OfflineContext);
}

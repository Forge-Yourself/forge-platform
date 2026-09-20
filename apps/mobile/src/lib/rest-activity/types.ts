import type { RestAction } from '@forge/shared';

/** What the lock screen shows for one rest; built by payload.ts in the app's language. */
export type RestActivityPayload = {
  sessionId: string;
  /** endsAt − totalMs: the lower bound of the iOS timer range. */
  startedAt: number;
  endsAt: number;
  kicker: string;
  title: string;
  text: string;
  /** Deep link back to the session: forge://sessions/<id>. */
  url: string;
  labels: {
    plus30: string;
    skip: string;
    channel: string;
    channelDone: string;
    doneTitle: string;
    doneBody: string;
  };
};

export type RestActivityStatus = 'ok' | 'notifications_off' | 'inexact' | 'unavailable';

/**
 * The lock-screen rest (M4d spec §6.3), one implementation per platform:
 * index.android.ts (the local Kotlin module), index.ios.ts (an expo-widgets
 * Live Activity), index.ts (web and Expo Go: nothing). Every method is safe to
 * call when the native side is missing.
 */
export interface RestActivity {
  isAvailable(): boolean;
  /** Replaces whatever is showing. */
  show(payload: RestActivityPayload): Promise<void>;
  end(): Promise<void>;
  /** Lock-screen taps recorded while JS was away; the queue empties as it is read. */
  drainActions(): Promise<RestAction[]>;
  status(): Promise<RestActivityStatus>;
  requestPermission(): Promise<void>;
  /** Opens the system setting that fixes `status`. */
  openSettings(status: RestActivityStatus): void;
  /** Taps delivered live, while the app process is up (iOS). Returns an unsubscribe. */
  addActionListener(listener: (action: RestAction) => void): () => void;
}

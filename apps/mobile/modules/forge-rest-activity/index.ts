import { requireOptionalNativeModule } from 'expo';

export type NativeRestAction = { sessionId: string; action: 'plus30' | 'skip'; at: number };

type ForgeRestActivityNative = {
  show(payload: {
    sessionId: string;
    endsAt: number;
    title: string;
    text: string;
    url: string;
    plus30: string;
    skip: string;
    channel: string;
    channelDone: string;
    doneTitle: string;
    doneBody: string;
  }): Promise<void>;
  end(): Promise<void>;
  drainActions(): Promise<NativeRestAction[]>;
  status(): Promise<'ok' | 'notifications_off' | 'inexact'>;
  openExactAlarmSettings(): void;
};

/** Null in Expo Go, on web, and in any build made before this module existed. */
export default requireOptionalNativeModule<ForgeRestActivityNative>('ForgeRestActivity');

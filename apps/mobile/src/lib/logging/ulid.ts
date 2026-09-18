import { makeUlid } from '@forge/shared';
import * as Crypto from 'expo-crypto';

/**
 * A fresh ULID for a set. expo-crypto's getRandomBytes is the platform CSPRNG
 * on iOS/Android and window.crypto on web; the pure encoder lives in shared so
 * it is unit-tested without a device.
 */
export function newUlid(): string {
  return makeUlid(Date.now(), Crypto.getRandomBytes(10));
}

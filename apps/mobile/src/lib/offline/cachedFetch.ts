import { engine } from './engine';

/** Error sentinel a fetcher returns when the request never reached the server. */
export const OFFLINE = 'offline';

/**
 * Read-through cache for the screens that must work offline (spec §5.4).
 * Switch off: exactly the fetcher. Switch on: a good result is stored under
 * `key`; a network failure (or no signal at all) returns the stored one.
 * Only results with `error === null` are ever stored.
 */
export async function cachedFetch<T extends { error: string | null }>(
  opts: { enabled: boolean; online: boolean },
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  if (!opts.enabled) return fetcher();
  if (!opts.online) {
    const hit = await engine.getCache<T>(key);
    if (hit) return hit.value;
  }
  const result = await fetcher();
  if (result.error === OFFLINE) {
    const hit = await engine.getCache<T>(key);
    return hit?.value ?? result;
  }
  if (result.error === null) await engine.putCache(key, result);
  return result;
}

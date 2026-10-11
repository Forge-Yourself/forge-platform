import { isOriginAllowed } from '@/lib/cors';

/**
 * Where the OAuth callback may send the browser back to (M5c spec D2): the
 * app's own scheme, or a web origin the API already trusts for CORS (the Expo
 * web dev server). Anything else would make the callback an open redirect.
 */
export function isReturnToAllowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'forge:') return true;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return isOriginAllowed(url.origin);
}

/** Appends `gcal=<result>` without disturbing the rest of the URL. */
export function withResult(returnTo: string, result: string): string {
  const url = new URL(returnTo);
  url.searchParams.set('gcal', result);
  return url.toString();
}

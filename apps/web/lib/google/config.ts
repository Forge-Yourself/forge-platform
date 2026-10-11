/**
 * Google OAuth settings, all from Vercel's environment (M5c plan, Global
 * Constraints). Null when any is missing: the connect route then answers 503
 * `not_configured` and nothing else in the app changes.
 *
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET  — the "Web application" OAuth client
 *   GOOGLE_TOKEN_KEY                         — 32 random bytes, base64 (lib/google/seal.ts)
 *   GOOGLE_REDIRECT_ORIGIN (optional)        — pins the callback origin; defaults to the request's
 *
 * The redirect URI registered in Google Cloud must be exactly
 * `<origin>/api/google/callback`.
 */
export type GoogleConfig = { clientId: string; clientSecret: string; tokenKey: string; redirectUri: string };

export function googleConfig(requestUrl: string): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const tokenKey = process.env.GOOGLE_TOKEN_KEY;
  if (!clientId || !clientSecret || !tokenKey) return null;
  const origin = (process.env.GOOGLE_REDIRECT_ORIGIN ?? new URL(requestUrl).origin).replace(/\/$/, '');
  return { clientId, clientSecret, tokenKey, redirectUri: `${origin}/api/google/callback` };
}

/**
 * Cross-origin access for the `/api/*` routes the Expo app calls.
 *
 * On iOS and Android `fetch` has no same-origin policy, so the mobile app talked
 * to `/api/waiver`, `/api/waiver/[intakeId]` and `/api/ai/program-draft` happily
 * and nothing here was needed. On `expo start --web` the same code runs in a
 * browser at `http://localhost:8081`, and every one of those calls sends an
 * `Authorization` header — which makes it a non-simple request, so the browser
 * sends a `OPTIONS` preflight first. Next answers a preflight to a route with no
 * `OPTIONS` export with a 405, the preflight fails, and the app sees an opaque
 * "CORS error" with no status: the waiver screen's generic
 * `waiver.submitError` over a signature that never left the device.
 *
 * WHY NO CREDENTIALS: every one of these routes authenticates from a Bearer
 * token in the Authorization header, never from a cookie. So
 * `Access-Control-Allow-Credentials` is deliberately NOT set — with it, and an
 * echoed origin, a third-party page could drive the cookie-authenticated
 * `/admin` surface from the user's own session. Without it the browser sends no
 * cookies cross-origin at all, and a caller has to already hold a token, which
 * an attacker's page cannot obtain from here.
 */

/**
 * Local Expo/Next dev servers, allowed by default so that
 * `expo start --web` works against a deployed API without extra setup. Any
 * origin here is a server the developer is already running on their own
 * machine; a hostile page cannot forge an `Origin` header to match one.
 *
 * Set `ALLOWED_ORIGINS` (comma-separated) to REPLACE this list entirely — that
 * is the production knob for locking the API down to known web origins. Under
 * NODE_ENV=production this pattern is not a fallback at all: an unset
 * ALLOWED_ORIGINS denies every cross-origin caller. See isOriginAllowed.
 */
const DEV_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS = 'authorization, content-type';
const MAX_AGE_SECONDS = '86400';

function configuredOrigins(): string[] | null {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  if (!raw) return null;
  const origins = raw
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return origins.length > 0 ? origins : null;
}

export function isOriginAllowed(origin: string): boolean {
  const configured = configuredOrigins();
  if (configured) return configured.includes(origin);
  // No ALLOWED_ORIGINS set. In dev that means "let the local Expo web server
  // through". In production it must mean "allow nothing" rather than "allow
  // anything served from localhost": a page running on the user's own machine
  // — a dependency's dev server, an Electron app, an extension page — sends a
  // genuine `http://localhost:PORT` origin, and would otherwise be handed
  // every unauthenticated /api response from the DEPLOYED API (GET /api/health
  // has no auth check at all). The variable is unset on Vercel today, so this
  // fallback was live in production.
  if (process.env.NODE_ENV === 'production') return false;
  return DEV_ORIGIN_PATTERN.test(origin);
}

/**
 * The headers to add to a cross-origin response, or null when the request is
 * same-origin (no `Origin` header) or the origin is not allowed. Returning null
 * rather than throwing is deliberate: a disallowed origin gets the normal
 * response without CORS headers, and the BROWSER refuses it. That is the same
 * outcome as today for anything not on the list, and it keeps server-to-server
 * callers — which send no `Origin` and are not subject to CORS — working.
 */
export function corsHeaders(origin: string | null): Record<string, string> | null {
  if (!origin || !isOriginAllowed(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': MAX_AGE_SECONDS,
    // The allowed origin varies per request, so any shared cache in front of
    // this must key on it or it will serve one caller's headers to another.
    Vary: 'Origin',
  };
}

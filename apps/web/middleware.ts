import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders } from '@/lib/cors';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * CORS is handled here rather than per route so that every `/api/*` response —
 * including the several dozen early `Response.json(..., { status })` returns in
 * the AI broker — carries the same headers, and so that a preflight never
 * reaches a route at all. See lib/cors.ts for why no credentials are allowed.
 */
export async function middleware(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith('/api/');
  const cors = isApi ? corsHeaders(request.headers.get('origin')) : null;

  // A preflight carries no credentials and must not cost a Supabase round-trip.
  if (isApi && request.method === 'OPTIONS') {
    // 204 with no CORS headers for a disallowed origin: the browser rejects it,
    // which is exactly what a preflight is for.
    return new NextResponse(null, { status: 204, headers: cors ?? undefined });
  }

  const response = await updateSession(request);

  if (cors) {
    for (const [key, value] of Object.entries(cors)) {
      response.headers.set(key, value);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and image optimization
     * files. Session refresh only needs to run on navigable pages.
     */
    // The two escapes below are DOUBLED on purpose. A JS string literal
    // collapses a single backslash-dot to a bare dot, which matches ANY
    // character — so with one backslash `/admin/users/abcpng` and
    // `/join/xyzsvg` were excluded from middleware entirely, losing the
    // unauthenticated-/admin redirect, the Supabase session-cookie refresh
    // and the CORS headers. Doubled, the regex sees a literal dot.
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

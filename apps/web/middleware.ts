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
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

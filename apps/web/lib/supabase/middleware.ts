import type { Database } from '@forge/shared';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Refreshes the Supabase session cookie on every matched request and blocks
 * unauthenticated access to `/admin/*`.
 *
 * This is NOT the security boundary — it only checks that a session exists.
 * Whether that session belongs to an admin (vs. a PT/client sharing the same
 * auth pool) is re-checked by the pages themselves (`/admin`,
 * `/admin/users/[id]`), which is the only place a role check can be trusted.
 *
 * Uses `getUser()`, not `getSession()` — per Supabase's own SSR guidance,
 * `getSession()` reads the JWT straight out of the cookie without revalidating
 * it against the auth server, which is unsafe to rely on in middleware.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  if (!url || !anonKey) {
    // Misconfigured deployment — fail closed on /admin rather than silently
    // letting requests through with no session check.
    if (request.nextUrl.pathname.startsWith('/admin')) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/login';
      return NextResponse.redirect(redirectUrl);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith('/admin')) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}

import type { Database } from '@forge/shared';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server Component / Server Action Supabase client. Reads and writes the
 * session via Next.js's `cookies()` API. Always the anon key — admin reads
 * are authorized by the caller's own session under RLS (`is_admin()`), never
 * by the service-role key.
 *
 * The env check happens here, not at module scope, so a build without
 * `.env.local` can still statically collect page data for routes that import
 * this module.
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env.local',
    );
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component, which cannot set cookies.
          // Harmless as long as middleware.ts is refreshing sessions.
        }
      },
    },
  });
}

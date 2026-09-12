import type { Database } from '@forge/shared';
import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client for Client Components. Session tokens live in
 * cookies (not localStorage) so the server components and middleware below
 * see the same session — this is the standard `@supabase/ssr` pattern.
 *
 * Always the anon key. RLS (`is_admin()`, `0003_rls.sql`) is what grants an
 * admin session broader reads — the service-role key must never be used here.
 *
 * The env check is inside the function body (not at module scope) so a build
 * without `.env.local` can still statically collect page data for routes
 * that import this module — the error only surfaces if the client is
 * actually constructed without the vars set.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env.local',
    );
  }

  return createBrowserClient<Database>(url, anonKey);
}

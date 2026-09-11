import type { Database } from '@forge/shared';
import { createClient } from '@supabase/supabase-js';

/**
 * Anon-key Supabase client scoped to a caller-supplied bearer token, for API
 * routes hit directly by the Expo app (no browser cookies to read — see
 * lib/supabase/{client,server}.ts for the cookie-based pattern the admin
 * pages use instead). RLS evaluates `auth.uid()` from this token, so a query
 * through this client is exactly as authorized as the mobile app's own
 * direct Supabase calls would be — this is the "does the caller actually own
 * this row" check for the waiver routes, never the service-role client.
 */
export function createBearerClient(bearerToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY — copy .env.example to .env.local');
  }

  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${bearerToken}` } },
  });
}

/** Extracts the bearer token from a Request's Authorization header, or null. */
export function getBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

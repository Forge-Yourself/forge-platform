import type { Database } from '@forge/shared';
import { createClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client using SUPABASE_SERVICE_ROLE_KEY — bypasses
 * RLS entirely. First real use of this key anywhere in this repo (M2): the
 * waiver API routes need it for two things Storage and RLS's own column
 * checks otherwise block a client from doing themselves — uploading into the
 * private `waivers` bucket, and stamping `waiver_pdf_url`/`signed_at`/
 * `state='waiver_signed'` on `intake_forms` (blocked by
 * `intake_forms_client_update`'s own WITH CHECK, by design — see
 * 0005_m2_clients_intake.sql).
 *
 * NEVER import this from a Client Component, and never send this key to the
 * browser. Every route that uses it must independently authorize the caller
 * first, using their own bearer token against the anon-key client (see
 * `createBearerClient` in this same directory) — this client has no concept
 * of "the caller", it can read and write everything.
 *
 * `persistSession: false` because there's no browser/cookie context here to
 * persist a session into, and none is needed — every call is a one-shot
 * server-to-server request authorized by the service-role key itself.
 */
export function createServiceClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — copy .env.example to .env.local');
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

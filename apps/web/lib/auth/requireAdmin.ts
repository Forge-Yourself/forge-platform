import type { Database } from '@forge/shared';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';

/**
 * The re-check middleware promises but doesn't perform: middleware only confirms a
 * session exists, so every /admin page independently verifies `users.role = 'admin'`
 * for the signed-in caller before rendering anything — a PT session that made it past
 * middleware gets bounced here. Shared by every /admin page rather than repeated
 * per-page, so the check (and any future change to it, e.g. an audit-log write on
 * every admin page view) lives in one place.
 *
 * Calls `redirect()` and never returns if the caller isn't a signed-in admin —
 * `redirect()` throws, so it aborts the calling Server Component's render the same
 * way it would inline. Returns the caller's `User` on success.
 */
export async function requireAdmin(supabase: SupabaseClient<Database>): Promise<User> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();

  if (!profile || profile.role !== 'admin') {
    await supabase.auth.signOut();
    redirect('/login');
  }

  return user;
}

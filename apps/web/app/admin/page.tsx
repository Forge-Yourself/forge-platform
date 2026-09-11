import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import * as ui from '@/lib/ui/styles';
import { AdminUserSearch } from './user-search';

// Every admin page depends on the caller's live session/role — never
// statically prerender it.
export const dynamic = 'force-dynamic';

/**
 * The re-check middleware promises but doesn't perform: middleware only
 * confirms a session exists, so every /admin page independently verifies
 * `users.role = 'admin'` for the signed-in caller before rendering anything.
 * A PT session that made it past middleware gets bounced here.
 */
export default async function AdminPage() {
  const supabase = await createClient();

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

  return (
    <main style={ui.page}>
      <p style={ui.kicker}>Forge</p>
      <h1 style={ui.h1}>User search</h1>
      <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
        Search by email or display name. Read-only — quarantine tooling and mutations arrive in
        M10.
      </p>
      <AdminUserSearch />
    </main>
  );
}

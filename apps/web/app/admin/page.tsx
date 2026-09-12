import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import * as ui from '@/lib/ui/styles';
import { AdminSignOut } from './sign-out';
import { AdminUserSearch } from './user-search';

// Every admin page depends on the caller's live session/role — never
// statically prerender it.
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const supabase = await createClient();
  await requireAdmin(supabase);

  return (
    <main style={ui.page}>
      <p style={ui.kicker}>Forge</p>
      <h1 style={ui.h1}>User search</h1>
      <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
        Search by email or display name. Read-only — quarantine tooling and mutations arrive in
        M10.
      </p>
      <nav style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
        <Link href="/admin/programs" style={ui.link}>
          Programs
        </Link>
        <Link href="/admin/ai-generations" style={ui.link}>
          AI generations
        </Link>
        <span style={{ marginInlineStart: 'auto' }}>
          <AdminSignOut />
        </span>
      </nav>
      <AdminUserSearch />
    </main>
  );
}

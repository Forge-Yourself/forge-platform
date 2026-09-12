import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createClient } from '@/lib/supabase/server';
import * as ui from '@/lib/ui/styles';
import { AdminProgramFilter } from './program-filter';

export const dynamic = 'force-dynamic';

export default async function AdminProgramsPage() {
  const supabase = await createClient();
  await requireAdmin(supabase);

  return (
    <main style={ui.page}>
      <p style={ui.kicker}>Forge</p>
      <h1 style={ui.h1}>Programs</h1>
      <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
        Every program on the platform, read-only. Support and compliance surface — there are no
        mutations here, by design.
      </p>
      <AdminProgramFilter />
    </main>
  );
}

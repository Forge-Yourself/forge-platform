import { parseOfflineMode } from '@forge/shared';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createClient } from '@/lib/supabase/server';
import * as ui from '@/lib/ui/styles';
import { setOfflineMode } from './actions';

// Every admin page depends on the caller's live session/role — never
// statically prerender it.
export const dynamic = 'force-dynamic';

const MODES = [
  { value: 'off', label: 'Off', help: 'Nobody sees offline logging. Queues already on devices still drain.' },
  { value: 'beta', label: 'Beta', help: 'Only users with the offline beta flag (set on their user page).' },
  { value: 'all', label: 'Everyone', help: 'Every user can switch it on in Settings.' },
] as const;

/**
 * M4b: the offline-logging switch (spec §4.3). The one write goes through
 * admin_set_offline_logging, an is_admin()-guarded RPC, under the admin's own
 * session — no service-role key here.
 */
export default async function AdminSettingsPage() {
  const supabase = await createClient();
  await requireAdmin(supabase);
  const { data } = await supabase
    .from('app_config')
    .select('value, updated_at')
    .eq('key', 'offline_logging')
    .maybeSingle();
  const current = parseOfflineMode(data?.value);

  return (
    <main style={ui.page}>
      <p style={ui.kicker}>Forge</p>
      <h1 style={ui.h1}>Settings</h1>
      <p style={{ margin: 0 }}>
        <Link href="/admin" style={ui.link}>
          ← Back to search
        </Link>
      </p>

      <section style={ui.card}>
        <h2 style={{ ...ui.h2, marginBottom: 'var(--s-3)' }}>Offline logging</h2>
        <p style={{ margin: 0 }}>
          Current: <strong>{current}</strong>
          <span style={ui.muted}>
            {data?.updated_at ? ` · changed ${new Date(data.updated_at).toLocaleString()}` : ''}
          </span>
        </p>
        {MODES.map((m) => (
          <form
            key={m.value}
            action={setOfflineMode}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}
          >
            <input type="hidden" name="mode" value={m.value} />
            <button type="submit" disabled={m.value === current} style={m.value === current ? ui.buttonSecondary : ui.button}>
              {m.label}
            </button>
            <span style={ui.muted}>{m.help}</span>
          </form>
        ))}
      </section>
    </main>
  );
}

import { ulidTimeMs, type Database } from '@forge/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createClient } from '@/lib/supabase/server';
import * as ui from '@/lib/ui/styles';

export const dynamic = 'force-dynamic';

/**
 * One workout session, read-only, every set with who logged it. Reads under
 * the admin's own session via the is_admin() branch on workout_sessions_select,
 * sets_select and exercise_prs_select (0015). No service-role key.
 */
export default async function AdminSessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  await requireAdmin(supabase);

  const { data: session } = await supabase.from('workout_sessions').select('*').eq('id', id).maybeSingle();
  if (!session) notFound();

  type SetRow = Database['public']['Tables']['sets']['Row'];
  const [{ data: sets }, { data: prs }, { data: client }] = await Promise.all([
    supabase.from('sets').select('*').eq('workout_session_id', id).order('created_at', { ascending: true }),
    supabase.from('exercise_prs').select('pr_type, value, set_id').eq('client_id', session.client_id),
    supabase.from('clients').select('id, client_user_id, invite_name, invite_email').eq('id', session.client_id).maybeSingle(),
  ]);
  const setRows: SetRow[] = sets ?? [];
  const exerciseIds = [...new Set(setRows.map((s) => s.exercise_id))];
  const userIds = [
    ...new Set(
      [session.logged_by_user_id, ...setRows.map((s) => s.logged_by_user_id), client?.client_user_id].filter(
        (v): v is string => !!v,
      ),
    ),
  ];
  const [{ data: exercises }, { data: users }] = await Promise.all([
    exerciseIds.length ? supabase.from('exercises').select('id, name').in('id', exerciseIds) : Promise.resolve({ data: [] }),
    userIds.length ? supabase.from('users').select('id, display_name').in('id', userIds) : Promise.resolve({ data: [] }),
  ]);
  const exerciseName = Object.fromEntries((exercises ?? []).map((e) => [e.id, e.name]));
  const userName = Object.fromEntries((users ?? []).map((u) => [u.id, u.display_name]));
  const prBySet: Record<string, string[]> = {};
  for (const p of prs ?? []) {
    if (!p.set_id) continue;
    (prBySet[p.set_id] ??= []).push(p.pr_type);
  }
  const clientLabel = (client?.client_user_id ? userName[client.client_user_id] : undefined) ?? client?.invite_name ?? client?.invite_email ?? session.client_id;

  return (
    <main style={ui.page}>
      <p style={ui.kicker}>Workout session</p>
      <h1 style={ui.h1}>{clientLabel}</h1>
      {client?.client_user_id ? (
        <p style={{ margin: 0 }}>
          <Link href={`/admin/users/${client.client_user_id}`} style={ui.link}>
            ← Back to user
          </Link>
        </p>
      ) : null}

      <section style={ui.card}>
        <div style={ui.fieldRow}>
          <span style={ui.label}>Status</span>
          <span>{session.status}</span>
        </div>
        <div style={ui.fieldRow}>
          <span style={ui.label}>Started</span>
          <span>{session.started_at ? new Date(session.started_at).toLocaleString() : '—'}</span>
        </div>
        <div style={ui.fieldRow}>
          <span style={ui.label}>Completed</span>
          <span>{session.completed_at ? new Date(session.completed_at).toLocaleString() : '—'}</span>
        </div>
        <div style={ui.fieldRow}>
          <span style={ui.label}>Duration</span>
          <span>{session.duration_min === null ? '—' : `${session.duration_min} min`}</span>
        </div>
        <div style={ui.fieldRow}>
          <span style={ui.label}>Started by</span>
          <span>
            {userName[session.logged_by_user_id] ?? session.logged_by_user_id}
            {session.is_pt_led ? ' (PT-led)' : ''}
          </span>
        </div>
        <div style={ui.fieldRow}>
          <span style={ui.label}>Program day</span>
          <span>
            {session.week_number === null ? 'Freestyle' : `${session.day_label ?? `Day ${session.day_number}`} · Week ${session.week_number}`}
            {session.program_day_id === null && session.week_number !== null ? ' (day since rebuilt)' : ''}
          </span>
        </div>
        <div style={ui.fieldRow}>
          <span style={ui.label}>Rating</span>
          <span>{session.rating ?? '—'}</span>
        </div>
        <div style={ui.fieldRow}>
          <span style={ui.label}>PT notes</span>
          <span>{session.pt_notes ?? '—'}</span>
        </div>
        <div style={ui.fieldRow}>
          <span style={ui.label}>Client notes</span>
          <span>{session.session_notes ?? '—'}</span>
        </div>
      </section>

      <h2 style={ui.h2}>Sets</h2>
      {setRows.length === 0 ? (
        <p style={ui.muted}>No sets logged.</p>
      ) : (
        <table style={ui.table}>
          <thead>
            <tr>
              <th style={ui.th}>Exercise</th>
              <th style={ui.th}>Set</th>
              <th style={ui.th}>Weight (kg)</th>
              <th style={ui.th}>Reps</th>
              <th style={ui.th}>RPE</th>
              <th style={ui.th}>Logged by</th>
              <th style={ui.th}>Device</th>
              <th style={ui.th}>PR</th>
              <th style={ui.th}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {setRows.map((s) => (
              <tr key={s.id}>
                <td style={ui.td}>{exerciseName[s.exercise_id] ?? s.exercise_id}</td>
                <td style={ui.td}>{s.is_warmup ? 'warm-up' : s.set_number}</td>
                <td style={ui.td}>{s.weight_kg ?? '—'}</td>
                <td style={ui.td}>
                  {s.reps ?? '—'}
                  {/* M4b D6: minted on the device after the session was finished. */}
                  {session.completed_at !== null && ulidTimeMs(s.id) > new Date(session.completed_at).getTime() ? (
                    <span style={ui.muted}> late</span>
                  ) : null}
                </td>
                <td style={ui.td}>{s.rpe ?? '—'}</td>
                <td style={ui.td}>{userName[s.logged_by_user_id] ?? s.logged_by_user_id}</td>
                <td style={ui.td}>{s.device_id ?? '—'}</td>
                <td style={ui.td}>{prBySet[s.id]?.join(', ') ?? ''}</td>
                <td style={ui.td}>{s.notes ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

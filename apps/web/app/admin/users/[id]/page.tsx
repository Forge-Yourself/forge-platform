import type { Database } from '@forge/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import * as ui from '@/lib/ui/styles';
import { setOfflineBeta } from './actions';

// Every admin page depends on the caller's live session/role — never
// statically prerender it.
export const dynamic = 'force-dynamic';

/**
 * Admin detail view. One mutation: the M4b offline-logging beta card, which
 * goes through admin_set_offline_beta, an `is_admin()`-guarded RPC. Quarantine
 * tooling is M10. Runs under the admin's own anon-key session (RLS
 * `is_admin()`), same as `/admin`.
 */
export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  await requireAdmin(supabase);

  const { data: target, error } = await supabase
    .from('users')
    .select(
      'id, email, display_name, role, auth_provider, locale, unit_system, timezone, onboarding_completed, consent_analytics, consent_marketing, consent_ai_training, is_quarantined, quarantine_reason, is_deleted, deleted_at, created_at, offline_logging_beta',
    )
    .eq('id', id)
    .maybeSingle();

  if (error || !target) {
    notFound();
  }

  type PtProfileFields = Pick<
    Database['public']['Tables']['pt_profiles']['Row'],
    'bio' | 'certifications' | 'specializations' | 'languages' | 'years_experience' | 'is_published' | 'slug'
  >;
  let ptProfile: PtProfileFields | null = null;

  type PtCertification = Pick<
    Database['public']['Tables']['pt_certifications']['Row'],
    'id' | 'name' | 'issuer' | 'expires_on' | 'status'
  >;
  let ptCertifications: PtCertification[] = [];

  if (target.role === 'pt') {
    const { data } = await supabase
      .from('pt_profiles')
      .select('bio, certifications, specializations, languages, years_experience, is_published, slug')
      .eq('user_id', id)
      .maybeSingle();
    ptProfile = data ?? null;

    // pt_profiles.certifications (TEXT[], above) is the older column — the app's
    // only certification-editing UI (apps/mobile CertificationsEditor, Task 10)
    // writes exclusively to this newer pt_certifications table instead, so THIS
    // is what actually reflects what a PT has on file, status included.
    const { data: certs } = await supabase
      .from('pt_certifications')
      .select('id, name, issuer, expires_on, status')
      .eq('pt_user_id', id)
      .order('created_at', { ascending: true });
    ptCertifications = certs ?? [];
  }

  // M3: the PT's AI credit wallet and program count, for support cases
  // ("where did my credits go"). Read-only like the rest of this page —
  // grant_ai_credits exists as an admin RPC for support to call directly,
  // and a UI for it is M10 quarantine-tooling territory.
  type WalletRow = Pick<
    Database['public']['Tables']['ai_credit_wallets']['Row'],
    'balance' | 'total_purchased' | 'total_consumed' | 'total_refunded' | 'low_balance_warned_at'
  >;
  let wallet: WalletRow | null = null;
  let programCount = 0;

  if (target.role === 'pt') {
    const [{ data: walletRow }, { count }] = await Promise.all([
      supabase
        .from('ai_credit_wallets')
        .select('balance, total_purchased, total_consumed, total_refunded, low_balance_warned_at')
        .eq('user_id', id)
        .maybeSingle(),
      supabase
        .from('programs')
        .select('id', { head: true, count: 'exact' })
        .eq('author_user_id', id),
    ]);
    wallet = walletRow ?? null;
    programCount = count ?? 0;
  }

  // M2 (Task 17): a PT's roster and a client's intake state, for support
  // cases. Read-only, same posture as the rest of this page — the admin's
  // own session already has full read via is_admin() in every relevant
  // policy (0003_rls.sql, 0005_m2_clients_intake.sql), so this never uses
  // SUPABASE_SERVICE_ROLE_KEY, matching this page's existing convention.
  type RosterRow = Pick<
    Database['public']['Tables']['clients']['Row'],
    'id' | 'invite_email' | 'invite_name' | 'state' | 'created_at'
  >;
  let roster: RosterRow[] = [];

  type IntakeStatus = {
    ptName: string | null;
    intakeState: string | null;
    flagCount: number;
    waiverSigned: boolean;
  };
  let intakeStatus: IntakeStatus | null = null;

  if (target.role === 'pt') {
    const { data } = await supabase
      .from('clients')
      .select('id, invite_email, invite_name, state, created_at')
      .eq('pt_user_id', id)
      .order('created_at', { ascending: false });
    roster = data ?? [];
  }

  // M4a (Task 14): a client's logged session history, for support cases.
  // Read-only, same posture as the rest of this page — the is_admin() branch
  // on workout_sessions_select / sets_select is what permits it.
  type SessionRow = Pick<
    Database['public']['Tables']['workout_sessions']['Row'],
    | 'id'
    | 'status'
    | 'started_at'
    | 'completed_at'
    | 'duration_min'
    | 'is_pt_led'
    | 'day_label'
    | 'week_number'
    | 'day_number'
    | 'logged_by_user_id'
  >;
  let sessions: (SessionRow & { setCount: number; loggedBy: string })[] = [];

  type BodyRow = Pick<
    Database['public']['Tables']['body_metrics']['Row'],
    'id' | 'measured_at' | 'weight_kg' | 'body_fat_pct' | 'circumferences' | 'recorded_by_user_id'
  >;
  let body: { rows: BodyRow[]; photosTotal: number; photosShared: number; plateau: boolean } | null = null;
  let clientRow: { id: string; pt_user_id: string } | null = null;

  if (target.role === 'client') {
    const { data } = await supabase
      .from('clients')
      .select('id, pt_user_id')
      .eq('client_user_id', id)
      .maybeSingle();
    clientRow = data ?? null;

    if (clientRow) {
      const [{ data: ptUser }, { data: intake }] = await Promise.all([
        supabase.from('users').select('display_name').eq('id', clientRow.pt_user_id).maybeSingle(),
        supabase
          .from('intake_forms')
          .select('state, red_flags, waiver_pdf_url')
          .eq('client_id', clientRow.id)
          .maybeSingle(),
      ]);

      intakeStatus = {
        ptName: ptUser?.display_name ?? null,
        intakeState: intake?.state ?? null,
        flagCount: Array.isArray(intake?.red_flags) ? intake.red_flags.length : 0,
        waiverSigned: !!intake?.waiver_pdf_url,
      };

      const { data: rows } = await supabase
        .from('workout_sessions')
        .select(
          'id, status, started_at, completed_at, duration_min, is_pt_led, day_label, week_number, day_number, logged_by_user_id',
        )
        .eq('client_id', clientRow.id)
        // started_at is nullable — Postgres sorts NULLS FIRST on DESC by default,
        // which would float M5's future `programmed` rows to the top.
        .order('started_at', { ascending: false, nullsFirst: false })
        .limit(50);
      const list = rows ?? [];
      const ids = list.map((r) => r.id);
      const loggerIds = [...new Set(list.map((r) => r.logged_by_user_id))];

      const [countResults, { data: loggers }] = await Promise.all([
        // One HEAD count per session rather than one row per set: the per-set
        // query silently truncates at PostgREST's max_rows (1000) for a busy client.
        Promise.all(
          ids.map((sessionId) =>
            supabase.from('sets').select('id', { head: true, count: 'exact' }).eq('workout_session_id', sessionId),
          ),
        ),
        loggerIds.length
          ? supabase.from('users').select('id, display_name').in('id', loggerIds)
          : Promise.resolve({ data: [] }),
      ]);
      const counts: Record<string, number> = {};
      ids.forEach((sessionId, i) => {
        counts[sessionId] = countResults[i]?.count ?? 0;
      });
      const names = Object.fromEntries((loggers ?? []).map((u) => [u.id, u.display_name]));
      sessions = list.map((r) => ({
        ...r,
        setCount: counts[r.id] ?? 0,
        loggedBy: names[r.logged_by_user_id] ?? r.logged_by_user_id,
      }));

      const [{ data: bodyRows }, { count: photosTotal }, { count: photosShared }, { data: plateauFlag }] = await Promise.all([
        supabase
          .from('body_metrics')
          .select('id, measured_at, weight_kg, body_fat_pct, circumferences, recorded_by_user_id')
          .eq('client_id', clientRow.id)
          .order('measured_at', { ascending: false })
          .limit(20),
        supabase.from('progress_photos').select('id', { head: true, count: 'exact' }).eq('client_id', clientRow.id),
        supabase
          .from('progress_photos')
          .select('id', { head: true, count: 'exact' })
          .eq('client_id', clientRow.id)
          .eq('is_shared_with_pt', true),
        supabase.rpc('body_plateau', { p_client_id: clientRow.id }),
      ]);
      body = {
        rows: bodyRows ?? [],
        photosTotal: photosTotal ?? 0,
        photosShared: photosShared ?? 0,
        plateau: plateauFlag === true,
      };
    }
  }

  return (
    <main style={ui.page}>
      <p style={ui.kicker}>Forge</p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s-4)' }}>
        <h1 style={ui.h1}>{target.display_name}</h1>
        {target.is_deleted ? <span style={ui.dangerBadge}>deleted</span> : null}
        {target.is_quarantined ? <span style={ui.dangerBadge}>quarantined</span> : null}
      </div>
      <p style={{ margin: 0 }}>
        <Link href="/admin" style={ui.link}>
          ← Back to search
        </Link>
      </p>

      <section style={ui.card}>
        <h2 style={{ ...ui.h2, marginBottom: 'var(--s-3)' }}>Account</h2>
        <Field label="ID" value={target.id} mono />
        <Field label="Email" value={target.email} />
        <Field label="Role" value={target.role} />
        <Field label="Auth provider" value={target.auth_provider} />
        <Field label="Locale" value={target.locale} />
        <Field label="Unit system" value={target.unit_system} />
        <Field label="Timezone" value={target.timezone} />
        <Field label="Onboarding completed" value={target.onboarding_completed ? 'Yes' : 'No'} />
        <Field label="Created" value={new Date(target.created_at).toLocaleString()} />
        {target.is_deleted ? (
          <Field
            label="Deleted"
            value={target.deleted_at ? new Date(target.deleted_at).toLocaleString() : 'Yes'}
          />
        ) : null}
      </section>

      <section style={ui.card}>
        <h2 style={{ ...ui.h2, marginBottom: 'var(--s-3)' }}>Consents</h2>
        <Field label="Analytics" value={target.consent_analytics ? 'Granted' : 'Not granted'} />
        <Field label="Marketing" value={target.consent_marketing ? 'Granted' : 'Not granted'} />
        <Field label="AI training" value={target.consent_ai_training ? 'Granted' : 'Not granted'} />
      </section>

      <section style={ui.card}>
        <h2 style={{ ...ui.h2, marginBottom: 'var(--s-3)' }}>Quarantine</h2>
        <Field label="Quarantined" value={target.is_quarantined ? 'Yes' : 'No'} />
        <Field label="Reason" value={target.quarantine_reason ?? '—'} />
      </section>

      <section style={ui.card}>
        <h2 style={{ ...ui.h2, marginBottom: 'var(--s-3)' }}>Offline logging beta</h2>
        <form action={setOfflineBeta} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          <input type="hidden" name="userId" value={target.id} />
          <input type="hidden" name="enabled" value={target.offline_logging_beta ? 'false' : 'true'} />
          <span>{target.offline_logging_beta ? 'On' : 'Off'}</span>
          <button type="submit" style={ui.buttonSecondary}>
            {target.offline_logging_beta ? 'Turn off' : 'Turn on'}
          </button>
        </form>
        <p style={{ ...ui.muted, margin: 'var(--s-3) 0 0' }}>
          Only matters while the mode on <Link href="/admin/settings" style={ui.link}>Settings</Link> is Beta.
        </p>
      </section>

      {target.role === 'pt' ? (
        <section style={ui.card}>
          <h2 style={{ ...ui.h2, marginBottom: 'var(--s-3)' }}>PT profile</h2>
          {ptProfile ? (
            <>
              <Field label="Bio" value={ptProfile.bio ?? '—'} />
              <Field
                label="Specializations"
                value={ptProfile.specializations.length > 0 ? ptProfile.specializations.join(', ') : '—'}
              />
              <Field label="Languages" value={ptProfile.languages.join(', ')} />
              <Field label="Years of experience" value={ptProfile.years_experience?.toString() ?? '—'} />
              <Field label="Published" value={ptProfile.is_published ? 'Yes' : 'No'} />
              <Field label="Slug" value={ptProfile.slug ?? '—'} />
            </>
          ) : (
            <p style={ui.muted}>No PT profile row yet.</p>
          )}
        </section>
      ) : null}

      {target.role === 'pt' ? (
        <section style={ui.card}>
          <h2 style={{ ...ui.h2, marginBottom: 'var(--s-3)' }}>Certifications</h2>
          {ptCertifications.length === 0 ? (
            <p style={ui.muted}>No certifications added yet.</p>
          ) : (
            ptCertifications.map((cert) => (
              <div key={cert.id} style={ui.fieldRow}>
                <span>
                  {cert.name}
                  {cert.issuer ? ` · ${cert.issuer}` : ''}
                  {cert.expires_on ? ` · expires ${cert.expires_on}` : ''}
                </span>
                <span style={ui.muted}>{cert.status}</span>
              </div>
            ))
          )}
        </section>
      ) : null}

      {target.role === 'pt' ? (
        <section style={ui.card}>
          <h2 style={{ ...ui.h2, marginBottom: 'var(--s-3)' }}>Client roster</h2>
          {roster.length === 0 ? (
            <p style={ui.muted}>No clients invited yet.</p>
          ) : (
            roster.map((c) => (
              <div key={c.id} style={ui.fieldRow}>
                <span>{c.invite_name ?? c.invite_email ?? c.id}</span>
                <span style={ui.muted}>
                  {c.state} · {new Date(c.created_at).toLocaleDateString()}
                </span>
              </div>
            ))
          )}
        </section>
      ) : null}

      {target.role === 'pt' ? (
        <section style={ui.card}>
          <h2 style={{ ...ui.h2, marginBottom: 'var(--s-3)' }}>AI credits</h2>
          {wallet ? (
            <>
              <Field label="Balance" value={wallet.balance.toString()} />
              <Field label="Total purchased" value={wallet.total_purchased.toString()} />
              <Field label="Total consumed" value={wallet.total_consumed.toString()} />
              <Field label="Total refunded" value={wallet.total_refunded.toString()} />
              <Field
                label="Low-balance warned"
                value={
                  wallet.low_balance_warned_at
                    ? new Date(wallet.low_balance_warned_at).toLocaleString()
                    : '—'
                }
              />
            </>
          ) : (
            <p style={ui.muted}>No wallet — this account predates M3.</p>
          )}
          <Field label="Programs authored" value={programCount.toString()} />
          <p style={{ margin: 'var(--s-3) 0 0' }}>
            <Link href="/admin/programs" style={ui.link}>
              Browse all programs
            </Link>
          </p>
        </section>
      ) : null}

      {target.role === 'client' ? (
        <section style={ui.card}>
          <h2 style={{ ...ui.h2, marginBottom: 'var(--s-3)' }}>Intake</h2>
          {intakeStatus ? (
            <>
              <Field label="Trainer" value={intakeStatus.ptName ?? '—'} />
              <Field label="Intake state" value={intakeStatus.intakeState ?? 'not started'} />
              <Field label="Red flags" value={intakeStatus.flagCount.toString()} />
              <Field label="Waiver signed" value={intakeStatus.waiverSigned ? 'Yes' : 'No'} />
            </>
          ) : (
            <p style={ui.muted}>Not linked to a trainer yet.</p>
          )}
        </section>
      ) : null}

      {target.role === 'client' ? (
        <section style={ui.card}>
          <h2 style={{ ...ui.h2, marginBottom: 'var(--s-3)' }}>Sessions</h2>
          {sessions.length === 0 ? (
            <p style={ui.muted}>No sessions logged yet.</p>
          ) : (
            <table style={ui.table}>
              <thead>
                <tr>
                  <th style={ui.th}>Started</th>
                  <th style={ui.th}>Day</th>
                  <th style={ui.th}>Logged by</th>
                  <th style={ui.th}>Sets</th>
                  <th style={ui.th}>Duration</th>
                  <th style={ui.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td style={ui.td}>
                      <Link href={`/admin/sessions/${s.id}`} style={ui.link}>
                        {s.started_at ? new Date(s.started_at).toLocaleString() : '—'}
                      </Link>
                    </td>
                    <td style={ui.td}>
                      {s.week_number === null ? 'Freestyle' : `${s.day_label ?? `Day ${s.day_number}`} · Week ${s.week_number}`}
                    </td>
                    <td style={ui.td}>
                      {s.loggedBy}
                      {s.is_pt_led ? ' (PT)' : ''}
                    </td>
                    <td style={ui.td}>{s.setCount}</td>
                    <td style={ui.td}>{s.duration_min === null ? '—' : `${s.duration_min} min`}</td>
                    <td style={ui.td}>
                      <span style={s.status === 'in_progress' ? ui.neutralBadge : ui.badge}>{s.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
      {target.role === 'client' && body ? (
        <section style={ui.card}>
          <h2 style={{ ...ui.h2, marginBottom: 'var(--s-3)' }}>Body</h2>
          <Field label="Progress photos" value={`${body.photosTotal} total · ${body.photosShared} shared with PT`} />
          <Field label="Weight plateau" value={body.plateau ? 'yes — within 0.5% for 4 weeks' : 'no'} />
          <p style={ui.muted}>Photos are never shown here: admins see metadata only (M4c spec D9).</p>
          {body.rows.length === 0 ? (
            <p style={ui.muted}>No measurements yet.</p>
          ) : (
            <table style={ui.table}>
              <thead>
                <tr>
                  <th style={ui.th}>Measured</th>
                  <th style={ui.th}>Weight (kg)</th>
                  <th style={ui.th}>Body fat (%)</th>
                  <th style={ui.th}>Circumferences (cm)</th>
                  <th style={ui.th}>Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {body.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={ui.td}>{new Date(r.measured_at).toLocaleString()}</td>
                    <td style={ui.td}>{r.weight_kg ?? '—'}</td>
                    <td style={ui.td}>{r.body_fat_pct ?? '—'}</td>
                    <td style={ui.td}>
                      {r.circumferences && typeof r.circumferences === 'object' && !Array.isArray(r.circumferences)
                        ? Object.entries(r.circumferences).map(([k, v]) => `${k} ${String(v)}`).join(', ')
                        : '—'}
                    </td>
                    <td style={ui.td}>{r.recorded_by_user_id === id ? 'client' : 'PT'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
    </main>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={ui.fieldRow}>
      <span style={ui.label}>{label}</span>
      <span style={mono ? { fontFamily: 'var(--font-mono)' } : undefined}>{value}</span>
    </div>
  );
}

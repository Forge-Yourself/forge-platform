import type { Database } from '@forge/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import * as ui from '@/lib/ui/styles';

// Every admin page depends on the caller's live session/role — never
// statically prerender it.
export const dynamic = 'force-dynamic';

/**
 * Read-only admin detail view. No mutations here — quarantine tooling is
 * M10. Runs under the admin's own anon-key session (RLS `is_admin()`), same
 * as `/admin`.
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
      'id, email, display_name, role, auth_provider, locale, unit_system, timezone, onboarding_completed, consent_analytics, consent_marketing, consent_ai_training, is_quarantined, quarantine_reason, is_deleted, deleted_at, created_at',
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

  if (target.role === 'client') {
    const { data: clientRow } = await supabase
      .from('clients')
      .select('id, pt_user_id')
      .eq('client_user_id', id)
      .maybeSingle();

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

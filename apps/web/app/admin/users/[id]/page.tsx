import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: viewerProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!viewerProfile || viewerProfile.role !== 'admin') {
    await supabase.auth.signOut();
    redirect('/login');
  }

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

  let ptProfile: {
    bio: string | null;
    certifications: string[];
    specializations: string[];
    languages: string[];
    years_experience: number | null;
    is_published: boolean;
    slug: string | null;
  } | null = null;

  if (target.role === 'pt') {
    const { data } = await supabase
      .from('pt_profiles')
      .select('bio, certifications, specializations, languages, years_experience, is_published, slug')
      .eq('user_id', id)
      .maybeSingle();
    ptProfile = data ?? null;
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
                label="Certifications"
                value={ptProfile.certifications.length > 0 ? ptProfile.certifications.join(', ') : '—'}
              />
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

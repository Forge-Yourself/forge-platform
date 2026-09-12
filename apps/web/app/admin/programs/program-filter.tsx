'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import * as ui from '@/lib/ui/styles';

const PAGE_SIZE = 50;

type ProgramRow = {
  id: string;
  name: string;
  state: string;
  duration_weeks: number;
  is_template: boolean;
  is_ai_generated: boolean;
  created_at: string;
  author_user_id: string;
  client_id: string | null;
};

const STATES = ['all', 'draft', 'active', 'completed', 'archived'] as const;
type StateFilter = (typeof STATES)[number];

/**
 * Runs under the signed-in admin's own anon-key session, like every other
 * interactive piece of this surface. `programs_select`'s admin branch
 * (0007_m3_programming.sql) is what makes the read work — no service-role
 * key is used or needed here.
 */
export function AdminProgramFilter() {
  const [state, setState] = useState<StateFilter>('all');
  const [aiOnly, setAiOnly] = useState(false);
  const [rows, setRows] = useState<ProgramRow[]>([]);
  const [authors, setAuthors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const supabase = createClient();
    let builder = supabase
      .from('programs')
      .select('id, name, state, duration_weeks, is_template, is_ai_generated, created_at, author_user_id, client_id')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    if (state !== 'all') builder = builder.eq('state', state);
    if (aiOnly) builder = builder.eq('is_ai_generated', true);

    // Every setState is deferred into a .then() rather than run in this
    // effect's synchronous body — react-hooks/set-state-in-effect, the same
    // constraint the mobile hooks document.
    void Promise.resolve()
      .then(() => {
        if (!cancelled) {
          setLoading(true);
          setError(null);
        }
      })
      .then(() => builder)
      .then(async ({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) {
          setRows([]);
          setError(queryError.message);
          setLoading(false);
          return;
        }

        const programs = data ?? [];
        const authorIds = [...new Set(programs.map((p) => p.author_user_id))];
        let names: Record<string, string> = {};
        if (authorIds.length > 0) {
          const { data: users } = await supabase.from('users').select('id, display_name').in('id', authorIds);
          names = Object.fromEntries((users ?? []).map((u) => [u.id, u.display_name]));
        }

        if (!cancelled) {
          setRows(programs);
          setAuthors(names);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [state, aiOnly]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
      <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        {STATES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setState(value)}
            style={value === state ? ui.button : ui.buttonSecondary}
          >
            {value}
          </button>
        ))}
        <label style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center', marginLeft: 'var(--s-4)' }}>
          <input type="checkbox" checked={aiOnly} onChange={(e) => setAiOnly(e.target.checked)} />
          <span style={ui.muted}>AI-generated only</span>
        </label>
      </div>

      {error ? <p style={ui.errorText}>{error}</p> : null}
      {loading ? <p style={ui.muted}>Loading…</p> : null}

      {!loading && rows.length === 0 ? <p style={ui.muted}>No programs match that filter.</p> : null}

      {rows.length > 0 ? (
        <table style={ui.table}>
          <thead>
            <tr>
              <th style={ui.th}>Name</th>
              <th style={ui.th}>Author</th>
              <th style={ui.th}>State</th>
              <th style={ui.th}>Weeks</th>
              <th style={ui.th}>Kind</th>
              <th style={ui.th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={ui.td}>
                  <Link href={`/admin/programs/${row.id}`} style={ui.link}>
                    {row.name}
                  </Link>
                </td>
                <td style={ui.td}>{authors[row.author_user_id] ?? '—'}</td>
                <td style={ui.td}>{row.state}</td>
                <td style={ui.td}>{row.duration_weeks}</td>
                <td style={ui.td}>
                  {row.is_ai_generated ? <span style={ui.neutralBadge}>AI</span> : null}
                  {row.is_template ? <span style={ui.neutralBadge}>template</span> : null}
                  {!row.is_ai_generated && !row.is_template ? '—' : null}
                </td>
                <td style={ui.td}>{new Date(row.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

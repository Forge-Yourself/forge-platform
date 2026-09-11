'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import * as ui from '@/lib/ui/styles';

const PAGE_SIZE = 25;
// PostgREST's `max_rows` cap (Supabase default) — pagination cannot reach
// past it regardless of how many rows actually match.
const MAX_ROWS = 1000;

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  is_quarantined: boolean;
  is_deleted: boolean;
  created_at: string;
};

/**
 * Runs entirely under the signed-in admin's own anon-key session. The
 * `users_select` RLS policy (`0003_rls.sql:128-130`) grants admins full read
 * via `is_admin()`, so no service-role key is used or needed here.
 */
export function AdminUserSearch() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [results, setResults] = useState<UserRow[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the most recent accounts on first render, before any search term is
  // entered. `runSearch` is intentionally omitted from deps — it closes over
  // no reactive state that should re-trigger this on every render.
  useEffect(() => {
    void runSearch('', 0);
  }, []);

  async function runSearch(term: string, pageIndex: number) {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const from = pageIndex * PAGE_SIZE;
    const to = Math.min(from + PAGE_SIZE, MAX_ROWS) - 1;

    let builder = supabase
      .from('users')
      .select('id, email, display_name, role, is_quarantined, is_deleted, created_at', {
        count: 'exact',
      })
      .order('created_at', { ascending: false })
      .range(from, to);

    const trimmed = term.trim();
    if (trimmed.length > 0) {
      // Escape PostgREST/ilike wildcard characters so a literal `%` or `_`
      // in a search term is not treated as a wildcard.
      const escaped = trimmed.replace(/[%_,]/g, (match) => `\\${match}`);
      builder = builder.or(`email.ilike.%${escaped}%,display_name.ilike.%${escaped}%`);
    }

    const { data, error: searchError, count } = await builder;

    if (searchError) {
      setError('Search failed. Try again.');
      setResults([]);
      setTotalCount(null);
    } else {
      setResults(data ?? []);
      setTotalCount(count ?? null);
    }
    setLoading(false);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setPage(0);
    void runSearch(query, 0);
  }

  function goToPage(next: number) {
    setPage(next);
    void runSearch(query, next);
  }

  const cappedTotal = totalCount !== null ? Math.min(totalCount, MAX_ROWS) : null;
  const hasPrev = page > 0;
  const hasNext = cappedTotal !== null ? (page + 1) * PAGE_SIZE < cappedTotal : false;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-5)' }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 'var(--s-3)' }}>
        <input
          type="search"
          placeholder="Search email or display name…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ ...ui.input, flex: 1 }}
        />
        <button type="submit" style={ui.button} disabled={loading}>
          Search
        </button>
      </form>

      {error ? <p style={ui.errorText}>{error}</p> : null}

      <div style={ui.card}>
        <table style={ui.table}>
          <thead>
            <tr>
              <th style={ui.th}>Email</th>
              <th style={ui.th}>Display name</th>
              <th style={ui.th}>Role</th>
              <th style={ui.th}>Status</th>
              <th style={ui.th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr key={row.id}>
                <td style={ui.td}>
                  <Link href={`/admin/users/${row.id}`} style={ui.link}>
                    {row.email}
                  </Link>
                </td>
                <td style={ui.td}>{row.display_name}</td>
                <td style={ui.td}>{row.role}</td>
                <td style={ui.td}>
                  {row.is_deleted ? (
                    <span style={ui.dangerBadge}>deleted</span>
                  ) : row.is_quarantined ? (
                    <span style={ui.dangerBadge}>quarantined</span>
                  ) : (
                    <span style={ui.neutralBadge}>active</span>
                  )}
                </td>
                <td style={ui.td}>{new Date(row.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {!loading && results.length === 0 ? (
              <tr>
                <td style={ui.td} colSpan={5}>
                  <span style={ui.muted}>No users found.</span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
        <button
          type="button"
          onClick={() => goToPage(page - 1)}
          disabled={!hasPrev || loading}
          style={ui.buttonSecondary}
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => goToPage(page + 1)}
          disabled={!hasNext || loading}
          style={ui.buttonSecondary}
        >
          Next
        </button>
        <span style={ui.muted}>
          {cappedTotal !== null
            ? `Page ${page + 1} · ${cappedTotal.toLocaleString()}${
                totalCount !== null && totalCount > MAX_ROWS ? '+' : ''
              } match${cappedTotal === 1 ? '' : 'es'}`
            : loading
              ? 'Searching…'
              : ''}
        </span>
      </div>
    </div>
  );
}

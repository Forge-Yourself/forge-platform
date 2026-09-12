import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createClient } from '@/lib/supabase/server';
import * as ui from '@/lib/ui/styles';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

/**
 * Every AI generation, newest first.
 *
 * This page is EP-15's "unique ID logged per generation with PII-scrubbed
 * prompt/output" made checkable by a human — which is the only form in which
 * that acceptance criterion can actually be verified. A discarded draft
 * shows no result entity: the generation was billed, the program never
 * existed, and both facts are visible here.
 */
export default async function AdminAiGenerationsPage() {
  const supabase = await createClient();
  await requireAdmin(supabase);

  const { data: generations } = await supabase
    .from('ai_generations')
    .select('id, user_id, generation_type, model_id, latency_ms, input_tokens, output_tokens, credits_charged, was_refunded, result_entity_type, result_entity_id, created_at')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  const rows = generations ?? [];
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const { data: users } = userIds.length
    ? await supabase.from('users').select('id, display_name').in('id', userIds)
    : { data: [] };
  const names = Object.fromEntries((users ?? []).map((u) => [u.id, u.display_name]));

  return (
    <main style={ui.page}>
      <p style={ui.kicker}>Forge</p>
      <h1 style={ui.h1}>AI generations</h1>
      <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
        Every generation, with what it cost and what it produced. Prompts and outputs are stored
        scrubbed — open a program to read them.
      </p>

      {rows.length === 0 ? (
        <p style={ui.muted}>No generations yet.</p>
      ) : (
        <table style={ui.table}>
          <thead>
            <tr>
              <th style={ui.th}>When</th>
              <th style={ui.th}>User</th>
              <th style={ui.th}>Type</th>
              <th style={ui.th}>Model</th>
              <th style={ui.th}>Latency</th>
              <th style={ui.th}>Tokens</th>
              <th style={ui.th}>Credits</th>
              <th style={ui.th}>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={ui.td}>{new Date(row.created_at).toLocaleString()}</td>
                <td style={ui.td}>{names[row.user_id] ?? row.user_id}</td>
                <td style={ui.td}>{row.generation_type}</td>
                <td style={ui.td}>{row.model_id}</td>
                <td style={ui.td}>{row.latency_ms === null ? '—' : `${row.latency_ms} ms`}</td>
                <td style={ui.td}>
                  {row.input_tokens ?? '—'} / {row.output_tokens ?? '—'}
                </td>
                <td style={ui.td}>
                  {row.credits_charged}
                  {row.was_refunded ? <span style={ui.dangerBadge}>refunded</span> : null}
                </td>
                <td style={ui.td}>
                  {row.result_entity_type === 'program' && row.result_entity_id ? (
                    <Link href={`/admin/programs/${row.result_entity_id}`} style={ui.link}>
                      program
                    </Link>
                  ) : (
                    <span style={ui.muted}>— (draft discarded)</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

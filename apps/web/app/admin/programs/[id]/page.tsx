import { notFound } from 'next/navigation';
import { programTreeSchema } from '@forge/shared';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createClient } from '@/lib/supabase/server';
import * as ui from '@/lib/ui/styles';

export const dynamic = 'force-dynamic';

function specOf(exercise: {
  target_sets: number | null;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_rpe: number | null;
}): string {
  const reps =
    exercise.target_reps_min !== null && exercise.target_reps_max !== null && exercise.target_reps_min !== exercise.target_reps_max
      ? `${exercise.target_reps_min}-${exercise.target_reps_max}`
      : (exercise.target_reps_min ?? exercise.target_reps_max);
  const base = exercise.target_sets !== null && reps !== null ? `${exercise.target_sets} × ${reps}` : '—';
  return exercise.target_rpe !== null ? `${base} @ RPE ${exercise.target_rpe}` : base;
}

/**
 * One program, read-only, plus its AI generation when it has one.
 *
 * Everything here is read under the signed-in admin's own session — the
 * `OR public.is_admin()` branch on programs_select / program_*_select and
 * ai_generations_select is what permits it. No service-role key.
 */
export default async function AdminProgramDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  await requireAdmin(supabase);

  const { data: program } = await supabase
    .from('programs')
    .select('id, name, state, duration_weeks, is_template, is_ai_generated, ai_generation_id, start_date, author_user_id, client_id, created_at')
    .eq('id', id)
    .maybeSingle();

  if (!program) notFound();

  const { data: rawTree } = await supabase.rpc('program_tree', { p_program_id: id });
  const tree = programTreeSchema.safeParse(rawTree);

  const { data: generation } = program.ai_generation_id
    ? await supabase
        .from('ai_generations')
        .select('*')
        .eq('id', program.ai_generation_id)
        .maybeSingle()
    : { data: null };

  return (
    <main style={ui.page}>
      <p style={ui.kicker}>Program</p>
      <h1 style={ui.h1}>{program.name}</h1>

      <section style={ui.card}>
        <div style={ui.fieldRow}>
          <span style={ui.label}>State</span>
          <span>{program.state}</span>
        </div>
        <div style={ui.fieldRow}>
          <span style={ui.label}>Weeks</span>
          <span>{program.duration_weeks}</span>
        </div>
        <div style={ui.fieldRow}>
          <span style={ui.label}>Start date</span>
          <span>{program.start_date ?? '—'}</span>
        </div>
        <div style={ui.fieldRow}>
          <span style={ui.label}>Template</span>
          <span>{program.is_template ? 'yes' : 'no'}</span>
        </div>
        <div style={ui.fieldRow}>
          <span style={ui.label}>AI generated</span>
          <span>{program.is_ai_generated ? 'yes' : 'no'}</span>
        </div>
      </section>

      <h2 style={ui.h2}>Structure</h2>
      {!tree.success ? (
        <p style={ui.errorText}>program_tree returned an unexpected shape.</p>
      ) : (
        tree.data.weeks.map((week) => (
          <section key={week.id} style={ui.card}>
            <h3 style={{ margin: 0 }}>Week {week.week_number}</h3>
            {week.days.length === 0 ? <p style={ui.muted}>No days programmed.</p> : null}
            {week.days.map((day) => (
              <div key={day.id} style={{ marginTop: 'var(--s-4)' }}>
                <p style={ui.label}>
                  Day {day.day_number}
                  {day.label ? ` · ${day.label}` : ''}
                </p>
                {day.blocks.map((block) => (
                  <table key={block.id} style={{ ...ui.table, marginBottom: 'var(--s-3)' }}>
                    <thead>
                      <tr>
                        <th style={ui.th}>{block.label ?? block.block_type}</th>
                        <th style={ui.th}>Prescription</th>
                        <th style={ui.th}>Tempo</th>
                        <th style={ui.th}>Rest</th>
                      </tr>
                    </thead>
                    <tbody>
                      {block.exercises.map((exercise) => (
                        <tr key={exercise.id}>
                          <td style={ui.td}>{exercise.exercise_name}</td>
                          <td style={ui.td}>{specOf(exercise)}</td>
                          <td style={ui.td}>{exercise.tempo_prescribed ?? '—'}</td>
                          <td style={ui.td}>{exercise.rest_sec === null ? '—' : `${exercise.rest_sec}s`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              </div>
            ))}
          </section>
        ))
      )}

      {generation ? (
        <>
          <h2 style={ui.h2}>AI generation</h2>
          <section style={ui.card}>
            <div style={ui.fieldRow}>
              <span style={ui.label}>Generation id</span>
              <span>{generation.id}</span>
            </div>
            <div style={ui.fieldRow}>
              <span style={ui.label}>Model</span>
              <span>{generation.model_id}</span>
            </div>
            <div style={ui.fieldRow}>
              <span style={ui.label}>Tokens in / out</span>
              <span>
                {generation.input_tokens ?? '—'} / {generation.output_tokens ?? '—'}
              </span>
            </div>
            <div style={ui.fieldRow}>
              <span style={ui.label}>Latency</span>
              <span>{generation.latency_ms === null ? '—' : `${generation.latency_ms} ms`}</span>
            </div>
            <div style={ui.fieldRow}>
              <span style={ui.label}>Credits charged</span>
              <span>{generation.credits_charged}</span>
            </div>
            <div style={ui.fieldRow}>
              <span style={ui.label}>Refunded</span>
              <span>
                {generation.was_refunded ? <span style={ui.dangerBadge}>refunded</span> : 'no'}
                {generation.refund_reason ? ` · ${generation.refund_reason}` : ''}
              </span>
            </div>
          </section>

          <h2 style={ui.h2}>Scrubbed prompt</h2>
          <pre style={{ ...ui.card, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
            {generation.prompt_scrubbed ?? '—'}
          </pre>
          <h2 style={ui.h2}>Scrubbed output</h2>
          <pre style={{ ...ui.card, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
            {generation.output_scrubbed ?? '—'}
          </pre>
        </>
      ) : null}
    </main>
  );
}

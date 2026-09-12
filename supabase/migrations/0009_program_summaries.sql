-- =============================================================================
-- 0009 · program_summaries — the program list's row meta in one round trip
-- =============================================================================
-- The program list renders "4 weeks · 3 days/week · 21 exercises" per row.
-- duration_weeks is on programs, but the other two numbers are counts over the
-- child tables, and there is no way to get them in one PostgREST call:
--
--   * program_exercises.program_id belongs to a COMPOSITE foreign key
--     (block_id, program_id) -> program_blocks (id, program_id), so PostgREST
--     infers no direct programs -> program_exercises relationship to embed a
--     count through.
--   * The alternative embed chain (program_weeks -> program_days ->
--     program_blocks -> program_exercises) returns the entire skeleton of
--     every program just to count its leaves — O(rows) traffic for a list.
--   * Counting per program client-side is an N+1.
--
-- So the counts are computed where the data already is. This is the payoff
-- for 0007's denormalised program_id: both aggregates are a single indexed
-- scan (idx_pd_program, idx_pe_program) with no joins at all.
--
-- Invoker rights, not SECURITY DEFINER: programs_select is what decides which
-- rows come back — a PT's own programs plus anything assigned to them as a
-- client — and this function must not widen that by a single row.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.program_summaries()
RETURNS TABLE (
  id               UUID,
  name             VARCHAR,
  description      TEXT,
  state            VARCHAR,
  client_id        UUID,
  duration_weeks   SMALLINT,
  start_date       DATE,
  is_template      BOOLEAN,
  is_ai_generated  BOOLEAN,
  periodization    VARCHAR,
  created_at       TIMESTAMPTZ,
  days_per_week    INTEGER,
  exercise_count   INTEGER
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.id,
    p.name,
    p.description,
    p.state,
    p.client_id,
    p.duration_weeks,
    p.start_date,
    p.is_template,
    p.is_ai_generated,
    p.periodization,
    p.created_at,
    -- MAX days in any one week, matching programStats() in packages/shared:
    -- a deload week with two sessions must not make a 3-day program read as
    -- "2.7 days/week".
    COALESCE((
      SELECT max(week_days.day_count)
      FROM (
        SELECT count(*)::INTEGER AS day_count
        FROM public.program_days d
        WHERE d.program_id = p.id
        GROUP BY d.week_id
      ) week_days
    ), 0)::INTEGER AS days_per_week,
    (
      SELECT count(*)::INTEGER
      FROM public.program_exercises pe
      WHERE pe.program_id = p.id
    ) AS exercise_count
  FROM public.programs p
  ORDER BY p.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.program_summaries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.program_summaries() TO authenticated;

COMMIT;

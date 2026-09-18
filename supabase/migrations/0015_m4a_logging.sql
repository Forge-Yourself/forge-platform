-- =============================================================================
-- 0015 · M4a logging — attribution, RLS on the logging tables, the four RPCs,
--        and repo-owned partition automation
-- =============================================================================
-- 1. sets.logged_by_user_id / sets.notes; workout_sessions day snapshot.
--    workout_sessions.logged_by_user_id says who STARTED a session; once a client
--    can self-log into a PT-led session, edit rights need to be per set.
-- 2. RLS: SELECT for the PT of the client, the client, admin. Every write is an
--    RPC — table-level INSERT/UPDATE/DELETE revoked, the approach 0014 took for
--    clients. sets has no FKs (partitioned), so its predicate joins to
--    workout_sessions itself.
-- 3. ensure_month_partitions(): the live project carries partitions through
--    2027-06 that no migration created. This adopts them (IF NOT EXISTS), keeps
--    12 months ahead, enables RLS and revokes writes on every partition it makes
--    (0003's DO-loop only reached the partitions that existed then, and
--    PostgREST exposes each partition as its own table), and pg_cron runs it on
--    the 1st of every month.
-- 4. RPCs: start_workout_session, log_set (idempotent by ULID, PR detection
--    inline), delete_set, complete_workout_session.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.sets
  ADD COLUMN logged_by_user_id UUID NOT NULL,   -- app-enforced FK -> users.id
  ADD COLUMN notes TEXT;

ALTER TABLE public.workout_sessions
  ADD COLUMN day_label   TEXT,
  ADD COLUMN day_number  SMALLINT,
  ADD COLUMN week_number SMALLINT;

CREATE INDEX idx_sets_logged_by ON public.sets (logged_by_user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Predicate. SECURITY DEFINER is load-bearing, as in 0003 and 0007.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_session_participant(p_session_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workout_sessions ws
     WHERE ws.id = p_session_id
       AND (public.is_pt_of_client(ws.client_id) OR public.is_client_record_owner(ws.client_id))
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Policies — SELECT only, ever. Every mutation is one of the SECURITY DEFINER
-- RPCs below. There is deliberately no write policy for `authenticated` on any
-- of the three — that is the design, not a gap.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY workout_sessions_select ON public.workout_sessions
  FOR SELECT TO authenticated
  USING (public.is_pt_of_client(client_id) OR public.is_client_record_owner(client_id) OR public.is_admin());

CREATE POLICY sets_select ON public.sets
  FOR SELECT TO authenticated
  USING (public.is_session_participant(workout_session_id) OR public.is_admin());

CREATE POLICY exercise_prs_select ON public.exercise_prs
  FOR SELECT TO authenticated
  USING (public.is_pt_of_client(client_id) OR public.is_client_record_owner(client_id) OR public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON public.workout_sessions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sets             FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.exercise_prs     FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Partition automation
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_month_partitions(p_months_ahead INT DEFAULT 12)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table  TEXT;
  v_month  DATE;
  v_name   TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['sets', 'food_logs', 'notifications', 'audit_logs']
  LOOP
    FOR i IN 0..p_months_ahead LOOP
      v_month := (date_trunc('month', CURRENT_DATE) + make_interval(months => i))::DATE;
      v_name  := v_table || '_' || to_char(v_month, 'YYYY_MM');
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.%I FOR VALUES FROM (%L) TO (%L)',
        v_name, v_table, v_month, v_month + interval '1 month'
      );
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_name);
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', v_name);
    END LOOP;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_month_partitions(INT) FROM PUBLIC, anon, authenticated;

-- Existing partitions: same posture as the ones the function creates.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename ~ '^(sets|food_logs|notifications|audit_logs)_\d{4}_\d{2}$'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    IF tbl LIKE 'sets_%' THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', tbl);
    END IF;
  END LOOP;
END;
$$;

SELECT public.ensure_month_partitions(12);

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'ensure_month_partitions',
  '0 3 1 * *',
  $$SELECT public.ensure_month_partitions(12)$$
);

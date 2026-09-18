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

-- ─────────────────────────────────────────────────────────────────────────────
-- start_workout_session — returns the client's in-progress session if one
-- exists (cross-device resume, and what lets PT and client log into the same
-- session), else creates one. Snapshots week/day so history survives 0007's
-- ON DELETE SET NULL on program_day_id.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_workout_session(
  p_client_id      UUID,
  p_program_day_id UUID DEFAULT NULL
)
RETURNS public.workout_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_is_pt       BOOLEAN;
  v_is_client   BOOLEAN;
  v_row         public.workout_sessions;
  -- Scalars, not a RECORD: an unassigned RECORD raises "not assigned yet" the
  -- moment it is read, and it is never assigned for a freestyle session.
  v_day_label   TEXT;
  v_day_number  SMALLINT;
  v_week_number SMALLINT;
BEGIN
  v_is_pt     := public.is_pt_of_client(p_client_id);
  v_is_client := public.is_client_record_owner(p_client_id);
  IF NOT (v_is_pt OR v_is_client) THEN
    RAISE EXCEPTION 'not authorized for this client';
  END IF;

  SELECT * INTO v_row FROM public.workout_sessions
   WHERE client_id = p_client_id AND status = 'in_progress'
   ORDER BY started_at DESC
   LIMIT 1
   FOR UPDATE;
  IF v_row.id IS NOT NULL THEN
    RETURN v_row;
  END IF;

  IF p_program_day_id IS NOT NULL THEN
    SELECT d.label, d.day_number, w.week_number
      INTO v_day_label, v_day_number, v_week_number
      FROM public.program_days d
      JOIN public.program_weeks w ON w.id = d.week_id
      JOIN public.programs p ON p.id = d.program_id
     WHERE d.id = p_program_day_id AND p.client_id = p_client_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'program day does not belong to this client';
    END IF;
  END IF;

  INSERT INTO public.workout_sessions (
    client_id, logged_by_user_id, program_day_id, status, scheduled_date, started_at, is_pt_led,
    day_label, day_number, week_number
  )
  VALUES (
    p_client_id, auth.uid(), p_program_day_id, 'in_progress', CURRENT_DATE, NOW(), v_is_pt,
    v_day_label, v_day_number, v_week_number
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), c.client_user_id, 'workout_start', 'workout_session', v_row.id,
         jsonb_build_object('is_pt_led', v_is_pt, 'program_day_id', p_program_day_id)
    FROM public.clients c WHERE c.id = p_client_id;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_workout_session(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_workout_session(UUID, UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- log_set — idempotent by the client-generated ULID. An existing id is an
-- UPDATE (rights: PT of the client, or the set's own logger); a new id is an
-- INSERT that also evaluates PRs. PRs are computed against the client's other
-- non-warmup sets on this exercise, never re-evaluated on edit.
--
-- Reads the existing row's created_at first rather than ON CONFLICT: sets is
-- partitioned on created_at, so the conflict target would have to carry the
-- partition key the caller does not know.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_set(
  p_id          CHAR(26),
  p_session_id  UUID,
  p_exercise_id UUID,
  p_set_number  INTEGER,
  p_weight_kg   NUMERIC,
  p_reps        INTEGER,
  p_rpe         NUMERIC   DEFAULT NULL,
  p_notes       TEXT      DEFAULT NULL,
  p_is_warmup   BOOLEAN   DEFAULT FALSE,
  p_device_id   TEXT      DEFAULT NULL
)
RETURNS TABLE (set_row public.sets, new_prs TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session     public.workout_sessions;
  v_is_pt       BOOLEAN;
  v_existing    public.sets;
  v_row         public.sets;
  v_prs         TEXT[] := '{}';
  v_best_weight NUMERIC;
  v_best_reps   SMALLINT;
  v_best_volume NUMERIC;
BEGIN
  IF p_id !~ '^[0-9A-HJKMNP-TV-Z]{26}$' THEN
    RAISE EXCEPTION 'invalid set id' USING ERRCODE = '23514';
  END IF;
  IF p_weight_kg IS NULL AND p_reps IS NULL THEN
    RAISE EXCEPTION 'a set needs a weight or a rep count' USING ERRCODE = '23514';
  END IF;
  IF p_weight_kg IS NOT NULL AND (p_weight_kg < 0 OR p_weight_kg > 500) THEN
    RAISE EXCEPTION 'weight out of range' USING ERRCODE = '23514';
  END IF;
  IF p_reps IS NOT NULL AND (p_reps < 0 OR p_reps > 200) THEN
    RAISE EXCEPTION 'reps out of range' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_session FROM public.workout_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'session not found';
  END IF;
  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'session is not in progress' USING ERRCODE = '23514';
  END IF;

  v_is_pt := public.is_pt_of_client(v_session.client_id);
  IF NOT (v_is_pt OR public.is_client_record_owner(v_session.client_id)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.exercises e WHERE e.id = p_exercise_id AND e.is_active) THEN
    RAISE EXCEPTION 'exercise not found';
  END IF;

  SELECT * INTO v_existing FROM public.sets WHERE id = p_id LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.workout_session_id <> p_session_id THEN
      RAISE EXCEPTION 'set belongs to another session';
    END IF;
    IF NOT (v_is_pt OR v_existing.logged_by_user_id = auth.uid()) THEN
      RAISE EXCEPTION 'not authorized to change this set';
    END IF;

    UPDATE public.sets
       SET exercise_id = p_exercise_id, set_number = p_set_number::SMALLINT,
           weight_kg = p_weight_kg, reps = p_reps::SMALLINT, rpe = p_rpe, notes = p_notes,
           is_warmup = p_is_warmup, device_id = COALESCE(p_device_id, device_id),
           is_synced = TRUE, synced_at = NOW(), updated_at = NOW()
     WHERE id = p_id AND created_at = v_existing.created_at
     RETURNING * INTO v_row;

    set_row := v_row; new_prs := v_prs;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.sets (
    id, workout_session_id, exercise_id, set_number, weight_kg, reps, rpe, notes,
    is_warmup, is_synced, synced_at, device_id, logged_by_user_id
  )
  VALUES (
    p_id, p_session_id, p_exercise_id, p_set_number::SMALLINT, p_weight_kg, p_reps::SMALLINT, p_rpe, p_notes,
    p_is_warmup, TRUE, NOW(), p_device_id, auth.uid()
  )
  RETURNING * INTO v_row;

  IF NOT p_is_warmup THEN
    SELECT MAX(s.weight_kg), MAX(s.reps), MAX(s.weight_kg * s.reps)
      INTO v_best_weight, v_best_reps, v_best_volume
      FROM public.sets s
      JOIN public.workout_sessions ws ON ws.id = s.workout_session_id
     WHERE ws.client_id = v_session.client_id
       AND s.exercise_id = p_exercise_id
       AND s.is_warmup = FALSE
       AND s.id <> p_id;

    IF p_weight_kg IS NOT NULL AND p_weight_kg > COALESCE(v_best_weight, 0) THEN
      v_prs := v_prs || 'weight';
      INSERT INTO public.exercise_prs (client_id, exercise_id, pr_type, value, set_id)
      VALUES (v_session.client_id, p_exercise_id, 'weight', p_weight_kg, p_id);
    END IF;
    IF p_reps IS NOT NULL AND p_reps > COALESCE(v_best_reps, 0) THEN
      v_prs := v_prs || 'reps';
      INSERT INTO public.exercise_prs (client_id, exercise_id, pr_type, value, set_id)
      VALUES (v_session.client_id, p_exercise_id, 'reps', p_reps, p_id);
    END IF;
    IF p_weight_kg IS NOT NULL AND p_reps IS NOT NULL AND p_weight_kg * p_reps > COALESCE(v_best_volume, 0) THEN
      v_prs := v_prs || 'volume';
      INSERT INTO public.exercise_prs (client_id, exercise_id, pr_type, value, set_id)
      VALUES (v_session.client_id, p_exercise_id, 'volume', p_weight_kg * p_reps, p_id);
    END IF;
  END IF;

  set_row := v_row; new_prs := v_prs;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_set(CHAR, UUID, UUID, INTEGER, NUMERIC, INTEGER, NUMERIC, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_set(CHAR, UUID, UUID, INTEGER, NUMERIC, INTEGER, NUMERIC, TEXT, BOOLEAN, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- delete_set — PT of the client, or the set's own logger. Hard delete; the PR
-- rows it may have earned stay (documented limitation, spec §4.5).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_set(p_id CHAR(26))
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_set     public.sets;
  v_session public.workout_sessions;
BEGIN
  SELECT * INTO v_set FROM public.sets WHERE id = p_id LIMIT 1;
  IF v_set.id IS NULL THEN
    RAISE EXCEPTION 'set not found';
  END IF;
  SELECT * INTO v_session FROM public.workout_sessions WHERE id = v_set.workout_session_id;
  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'session is not in progress' USING ERRCODE = '23514';
  END IF;
  IF NOT (public.is_pt_of_client(v_session.client_id)
          OR (public.is_client_record_owner(v_session.client_id) AND v_set.logged_by_user_id = auth.uid())) THEN
    RAISE EXCEPTION 'not authorized to change this set';
  END IF;

  DELETE FROM public.sets WHERE id = p_id AND created_at = v_set.created_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_set(CHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_set(CHAR) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- complete_workout_session — PT of the client may complete any session; the
-- client only one they started (is_pt_led = FALSE). Already completed → the
-- row unchanged, no error: two devices finishing the same session is normal.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_workout_session(
  p_session_id UUID,
  p_rating     INTEGER  DEFAULT NULL,
  p_notes      TEXT     DEFAULT NULL
)
RETURNS public.workout_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row   public.workout_sessions;
  v_is_pt BOOLEAN;
BEGIN
  SELECT * INTO v_row FROM public.workout_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'session not found';
  END IF;

  v_is_pt := public.is_pt_of_client(v_row.client_id);
  IF NOT (v_is_pt OR (public.is_client_record_owner(v_row.client_id) AND v_row.is_pt_led = FALSE)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF v_row.status = 'completed' THEN
    RETURN v_row;
  END IF;

  UPDATE public.workout_sessions
     SET status = 'completed',
         completed_at = NOW(),
         duration_min = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at))) / 60))::SMALLINT,
         rating = p_rating::SMALLINT,
         pt_notes = CASE WHEN v_is_pt THEN p_notes ELSE pt_notes END,
         session_notes = CASE WHEN v_is_pt THEN session_notes ELSE p_notes END,
         updated_at = NOW()
   WHERE id = p_session_id
   RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), c.client_user_id, 'workout_complete', 'workout_session', v_row.id,
         jsonb_build_object('duration_min', v_row.duration_min, 'rating', v_row.rating)
    FROM public.clients c WHERE c.id = v_row.client_id;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_workout_session(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_workout_session(UUID, INTEGER, TEXT) TO authenticated;

COMMIT;

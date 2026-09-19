-- =============================================================================
-- 0016 · M4b offline + live mirror
-- =============================================================================
-- 1. start_workout_session takes a client-generated p_id (idempotent) and a
--    device p_started_at; complete_workout_session takes p_completed_at. Device
--    times are clamped to [NOW() - 24 h, NOW()]: an outbox replayed hours later
--    must not stamp replay time, and a device clock is trusted no further.
-- 2. log_set / delete_set accept completed sessions (spec D6): a set logged
--    offline after the PT pressed Finish appends; the session is not reopened.
-- 3. Broadcast triggers on sets and workout_sessions feed private Realtime
--    topics session:<uuid>; realtime.messages SELECT is limited to session
--    participants and admins. No INSERT policy: clients never broadcast.
-- 4. The offline-logging switch: app_config.offline_logging (off|beta|all),
--    users.offline_logging_beta (not in 0003's column grant, so admin-only),
--    and two is_admin()-guarded RPCs for /admin.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- start_workout_session: signature changes, so DROP + CREATE. CREATE OR
-- REPLACE with new params would leave the (UUID, UUID) overload behind and
-- PostgREST would refuse the ambiguous call.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION public.start_workout_session(UUID, UUID);

CREATE FUNCTION public.start_workout_session(
  p_client_id      UUID,
  p_program_day_id UUID        DEFAULT NULL,
  p_id             UUID        DEFAULT NULL,
  p_started_at     TIMESTAMPTZ DEFAULT NULL
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
  v_day_label   TEXT;
  v_day_number  SMALLINT;
  v_week_number SMALLINT;
  v_started     TIMESTAMPTZ;
BEGIN
  v_is_pt     := public.is_pt_of_client(p_client_id);
  v_is_client := public.is_client_record_owner(p_client_id);
  IF NOT (v_is_pt OR v_is_client) THEN
    RAISE EXCEPTION 'not authorized for this client';
  END IF;

  PERFORM 1 FROM public.clients WHERE id = p_client_id FOR UPDATE;

  -- Replay of an offline start: the same id twice is the same session.
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.workout_sessions WHERE id = p_id;
    IF v_row.id IS NOT NULL THEN
      IF v_row.client_id <> p_client_id THEN
        RAISE EXCEPTION 'session id belongs to another client' USING ERRCODE = '42501';
      END IF;
      RETURN v_row;
    END IF;
  END IF;

  -- M4a D4: one in-progress session per client. A device whose offline start
  -- loses this race gets the winner's id back and rewrites its local rows.
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
     WHERE d.id = p_program_day_id AND p.client_id = p_client_id
       AND p.state IN ('active', 'completed');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'program day does not belong to this client';
    END IF;
  END IF;

  v_started := LEAST(NOW(), GREATEST(NOW() - interval '24 hours', COALESCE(p_started_at, NOW())));

  INSERT INTO public.workout_sessions (
    id, client_id, logged_by_user_id, program_day_id, status, scheduled_date, started_at, is_pt_led,
    day_label, day_number, week_number
  )
  VALUES (
    COALESCE(p_id, uuid_v7()), p_client_id, auth.uid(), p_program_day_id, 'in_progress', v_started::DATE, v_started, v_is_pt,
    v_day_label, v_day_number, v_week_number
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), c.client_user_id, 'workout_start', 'workout_session', v_row.id,
         jsonb_build_object('is_pt_led', v_is_pt, 'program_day_id', p_program_day_id, 'client_generated_id', p_id IS NOT NULL)
    FROM public.clients c WHERE c.id = p_client_id;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_workout_session(UUID, UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_workout_session(UUID, UUID, UUID, TIMESTAMPTZ) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- log_set: 0015's body; the only change is in_progress → in_progress|completed.
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
  IF v_session.status NOT IN ('in_progress', 'completed') THEN
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
      v_prs := array_append(v_prs, 'weight');
      INSERT INTO public.exercise_prs (client_id, exercise_id, pr_type, value, set_id)
      VALUES (v_session.client_id, p_exercise_id, 'weight', p_weight_kg, p_id);
    END IF;
    IF p_reps IS NOT NULL AND p_reps > COALESCE(v_best_reps, 0) THEN
      v_prs := array_append(v_prs, 'reps');
      INSERT INTO public.exercise_prs (client_id, exercise_id, pr_type, value, set_id)
      VALUES (v_session.client_id, p_exercise_id, 'reps', p_reps, p_id);
    END IF;
    IF p_weight_kg IS NOT NULL AND p_reps IS NOT NULL AND p_weight_kg * p_reps > COALESCE(v_best_volume, 0) THEN
      v_prs := array_append(v_prs, 'volume');
      INSERT INTO public.exercise_prs (client_id, exercise_id, pr_type, value, set_id)
      VALUES (v_session.client_id, p_exercise_id, 'volume', p_weight_kg * p_reps, p_id);
    END IF;
  END IF;

  set_row := v_row; new_prs := v_prs;
  RETURN NEXT;
END;
$$;

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
  IF v_session.status NOT IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION 'session is not in progress' USING ERRCODE = '23514';
  END IF;
  IF NOT (public.is_pt_of_client(v_session.client_id)
          OR (public.is_client_record_owner(v_session.client_id) AND v_set.logged_by_user_id = auth.uid())) THEN
    RAISE EXCEPTION 'not authorized to change this set';
  END IF;

  DELETE FROM public.sets WHERE id = p_id AND created_at = v_set.created_at;
END;
$$;

DROP FUNCTION public.complete_workout_session(UUID, INTEGER, TEXT);

CREATE FUNCTION public.complete_workout_session(
  p_session_id   UUID,
  p_rating       INTEGER     DEFAULT NULL,
  p_notes        TEXT        DEFAULT NULL,
  p_completed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.workout_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row       public.workout_sessions;
  v_is_pt     BOOLEAN;
  v_started   TIMESTAMPTZ;
  v_completed TIMESTAMPTZ;
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

  v_started   := COALESCE(v_row.started_at, v_row.created_at);
  v_completed := LEAST(NOW(), GREATEST(v_started, NOW() - interval '24 hours', COALESCE(p_completed_at, NOW())));

  UPDATE public.workout_sessions
     SET status = 'completed',
         completed_at = v_completed,
         duration_min = LEAST(32767, GREATEST(1, ROUND(EXTRACT(EPOCH FROM (v_completed - v_started)) / 60)))::SMALLINT,
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

REVOKE EXECUTE ON FUNCTION public.complete_workout_session(UUID, INTEGER, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_workout_session(UUID, INTEGER, TEXT, TIMESTAMPTZ) TO authenticated;

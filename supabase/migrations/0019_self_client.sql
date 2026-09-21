-- =============================================================================
-- 0019 · The self client row — a PT trains themselves.
--
-- A PT has never been able to be a SUBJECT in Forge: their own weight, photos
-- and workouts had nowhere to live. They do now, and it costs no new policy.
--
-- Every write predicate from M3, M4a, M4b and M4c is the same disjunction:
--
--     public.is_pt_of_client(p_client_id) OR public.is_client_record_owner(p_client_id)
--
-- and neither helper reads users.role (0003_rls.sql:66-90). So a `clients` row
-- with pt_user_id = client_user_id = auth.uid() — a SELF ROW — satisfies both
-- disjuncts at once, and record_body_metric, start_workout_session, log_set,
-- complete_workout_session, record_progress_photo, set_photo_shared,
-- assign_program and the progress-photos storage.objects policies all accept
-- it unchanged. db/rls_assertions.sql proves each of those rather than
-- assuming them.
--
-- What this migration adds is the row's CREATION and its GUARD RAILS:
--
--   1. uq_clients_self       — at most one self row per PT.
--   2. ensure_self_client()  — the only way to mint one. Idempotent.
--   3. set_client_state()    — refuses the self row (see its comment: the
--                              motive is the assign picker, not security).
--   4. invite_client()       — refuses the caller's own address, which would
--                              otherwise mint a self row nothing can claim.
--
-- Deliberately NOT created: an intake_forms row. A PT does not PAR-Q
-- themselves, and the absence is handled — intake_progress returns no row,
-- useClientDetail uses maybeSingle, and the app renders "not started".
--
-- Deliberately NOT changed: start_workout_session evaluates v_is_pt first
-- (0016:47-51), so a self session is stamped is_pt_led = TRUE and its note
-- lands in pt_notes. That is correct — a PT training themselves is still
-- coaching — and it is what SessionSummary reads back for a role='pt' viewer.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) uq_clients_self — one self row per PT.
--
-- Partial, so it leaves ordinary rosters alone: a PT may still have any number
-- of clients, and the same person may be a client of several PTs. It indexes
-- only the rows where the PT and the subject are the same user.
--
-- Note what it deliberately does NOT catch: a row with client_user_id IS NULL
-- whose invite_email is the PT's own address. That shape is blocked in
-- invite_client below instead, because the index cannot see it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_self
  ON public.clients (pt_user_id)
  WHERE pt_user_id = client_user_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) ensure_self_client — mints (or returns) the caller's own client row.
--
-- Idempotent by design: the app calls it from a "train myself" CTA and may
-- call it again on any later boot without checking first.
--
-- Two details that are easy to get wrong:
--
--   * ON CONFLICT must REPEAT the index predicate. Inference against a partial
--     unique index fails with "no unique or exclusion constraint matching the
--     ON CONFLICT specification" without it, and a bare ON CONFLICT DO NOTHING
--     would silently swallow a primary-key collision too.
--
--   * RETURNING yields NO ROW on conflict, so the id has to be read back.
--     Hence the insert-then-IF-NULL-select shape rather than one statement.
--
-- The row is born 'active'. There is no invite to accept and no intake to
-- submit, so the 'invited' → 'accepted' → 'active' ladder every other client
-- climbs has nothing to do here.
--
-- 'client_accept' is the audit action: chk_audit_logs_action has no
-- self-specific verb, and accepting is what this row does in one step.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_self_client()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_client_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'pt') THEN
    RAISE EXCEPTION 'only a pt can train themselves in the app' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.clients (pt_user_id, client_user_id, state)
  VALUES (auth.uid(), auth.uid(), 'active')
  ON CONFLICT (pt_user_id) WHERE pt_user_id = client_user_id DO NOTHING
  RETURNING id INTO v_client_id;

  IF v_client_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
    VALUES (auth.uid(), auth.uid(), 'client_accept', 'client', v_client_id, jsonb_build_object('self', TRUE));
    RETURN v_client_id;
  END IF;

  SELECT id INTO v_client_id
    FROM public.clients
   WHERE pt_user_id = auth.uid() AND client_user_id = auth.uid();

  RETURN v_client_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_self_client() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_self_client() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (3) set_client_state — unchanged from 0005 except for the self-row guard.
--
-- Read the motive carefully, because it is NOT security. Neither
-- is_pt_of_client nor is_client_record_owner reads `state`, so a 'paused' or
-- 'deactivated' self row would still log sets and read photos exactly as
-- before — pausing yourself would protect nothing.
--
-- What it would do is break one screen silently. programs/[id]/assign.tsx
-- filters the roster to state IN ('active','accepted'), so a paused self row
-- vanishes from the ONLY screen that can give the PT a program, with nothing
-- anywhere to explain where it went. Refusing the transition outright is the
-- honest failure.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_client_state(p_client_id UUID, p_state TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pt          UUID;
  v_prev        TEXT;
  v_client_user UUID;
  v_action      TEXT;
BEGIN
  IF p_state NOT IN ('active', 'paused', 'deactivated') THEN
    RAISE EXCEPTION 'invalid target state: %', p_state;
  END IF;

  SELECT pt_user_id, state, client_user_id INTO v_pt, v_prev, v_client_user
    FROM public.clients WHERE id = p_client_id FOR UPDATE;

  IF v_pt IS NULL THEN
    RAISE EXCEPTION 'client not found';
  END IF;
  IF v_pt != auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF v_pt = v_client_user THEN
    RAISE EXCEPTION 'a pt cannot pause or deactivate their own training record';
  END IF;
  IF v_prev NOT IN ('accepted', 'active', 'paused', 'deactivated') THEN
    RAISE EXCEPTION 'client has not accepted the invite yet';
  END IF;

  UPDATE public.clients SET state = p_state, updated_at = NOW() WHERE id = p_client_id;

  -- 'active' has no dedicated audit action in the CHECK list — client_reactivate
  -- literally means "client is now active" and covers every transition into it,
  -- including the first one from 'accepted'.
  v_action := CASE p_state
    WHEN 'paused' THEN 'client_pause'
    WHEN 'deactivated' THEN 'client_deactivate'
    ELSE 'client_reactivate'
  END;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), v_client_user, v_action, 'client', p_client_id, jsonb_build_object('from', v_prev, 'to', p_state));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_client_state(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_client_state(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (4) invite_client — unchanged from 0005 except for the own-address guard.
--
-- Without it a PT can invite themselves, and the result is a row the index in
-- (1) cannot see (client_user_id IS NULL) and nothing can ever clear:
-- claim_client_invites is only ever called from the client home screen, which
-- a role='pt' account never renders. The row would sit at state='invited'
-- forever, and usePtDashboard would keep it on "Needs you" until the PT found
-- the revoke button.
--
-- public.users.email is CITEXT on both sides, so the comparison is already
-- case-insensitive.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invite_client(
  p_email CITEXT,
  p_name  TEXT DEFAULT NULL,
  p_tags  TEXT[] DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_client_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'pt') THEN
    RAISE EXCEPTION 'only a pt can invite a client';
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND email = p_email) THEN
    RAISE EXCEPTION 'that is your own address - use train myself instead';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.clients
     WHERE pt_user_id = auth.uid() AND invite_email = p_email AND state = 'invited'
  ) THEN
    RAISE EXCEPTION 'an invite to this address is already pending';
  END IF;

  INSERT INTO public.clients (pt_user_id, invite_email, invite_name, invite_expires_at, tags, state)
  VALUES (auth.uid(), p_email, NULLIF(trim(p_name), ''), NOW() + INTERVAL '7 days', COALESCE(p_tags, '{}'), 'invited')
  RETURNING id INTO v_client_id;

  INSERT INTO public.intake_forms (client_id, state, template_version, sections)
  VALUES (
    v_client_id, 'pending', '1.0',
    '[
      {"id":"parq","title":"PAR-Q"},
      {"id":"goals","title":"Goals"},
      {"id":"history","title":"Training history"},
      {"id":"anthropometrics","title":"Anthropometrics"},
      {"id":"dietary","title":"Dietary restrictions"}
    ]'::JSONB
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'client_invite', 'client', v_client_id, jsonb_build_object('invite_email', p_email));

  RETURN v_client_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invite_client(CITEXT, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_client(CITEXT, TEXT, TEXT[]) TO authenticated;

COMMIT;

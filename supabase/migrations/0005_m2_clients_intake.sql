-- =============================================================================
-- 0005 · M2 clients & intake
-- =============================================================================
-- Turns the dead `clients` / `client_pt_assignments` / `intake_forms` tables
-- (present since M0, RLS since 0003, untouched by any application code until
-- now) into a working invite -> claim -> intake -> waiver pipeline:
--   1. clients.invite_name — the name a PT types at invite time; the prototype's
--      invited-state list row shows a name and there was nowhere to put one.
--   2. chk_audit_logs_action gains four values this milestone's RPCs need.
--   3. clients_update is narrowed to the owning PT (+ admin). 0003 shipped a
--      client_user_id = auth.uid() branch too, but M2 is the first milestone
--      that gives a client a session able to reach this policy at all, and
--      that branch would let a client set their own state = 'active' with a
--      bare PostgREST call — sidestepping set_client_state() below entirely.
--      A client never needs direct write access to their own clients row:
--      claim_client_invites() (SECURITY DEFINER) does the one write a client
--      legitimately triggers.
--   4. intake_forms_all (FOR ALL, any state) is replaced by five narrower
--      policies. The client owns their row through SELECT and a
--      state-and-column-gated UPDATE; the PT can only reach it once it has
--      been submitted, and never before — this is EP-03's own promise to the
--      client ("your trainer can't see your answers until you submit"), and
--      the UPDATE policy's WITH CHECK is what stops a technically-savvy
--      client from just writing state = 'completed' directly, bypassing
--      submit_intake()'s server-side PAR-Q derivation below.
--   5. A private 'waivers' Storage bucket, reachable only by the service
--      role — every read is brokered through an apps/web API route that
--      authorizes against intake_forms first. Pulls Storage forward from M4.
--   6. Seven SECURITY DEFINER RPCs own every state transition on clients and
--      intake_forms, so audit_logs (policy-free, append-only) stays the one
--      source of truth for what happened and who did it:
--       - invite_client / resend_invite / revoke_invite — PT-side roster
--         management.
--       - claim_client_invites — a client links themselves by verified email
--         match on app boot; idempotent.
--       - set_client_state — PT-only active/paused/deactivated transitions.
--       - submit_intake — derives red flags server-side from the seven
--         PAR-Q answers; never trusts a client-supplied flag list.
--       - intake_progress — state + counts only, never response content;
--         this is the PT's sole pre-submit visibility into an in-progress
--         intake, and it has to be SECURITY DEFINER precisely because RLS
--         itself denies the PT that row until submission.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- clients.invite_name
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.clients ADD COLUMN invite_name VARCHAR(120);

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_logs — four new actions. audit_logs is PARTITION BY RANGE; a CHECK
-- added to the partitioned parent is inherited by every existing and future
-- partition automatically, so this one ALTER is enough.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_logs DROP CONSTRAINT chk_audit_logs_action;
ALTER TABLE public.audit_logs ADD CONSTRAINT chk_audit_logs_action CHECK (action IN (
  'user_register', 'user_login', 'user_logout', 'user_login_failed',
  'user_mfa_enable', 'user_mfa_disable', 'user_password_change',
  'user_delete', 'user_quarantine', 'user_unquarantine',
  'client_invite', 'client_accept', 'client_pause', 'client_deactivate',
  'client_reactivate', 'client_invite_revoke', 'intake_submit', 'waiver_sign',
  'pt_mode_create', 'pt_mode_switch',
  'master_sub_invite', 'master_sub_accept', 'master_sub_leave',
  'gym_create', 'gym_membership_invite', 'gym_membership_accept', 'gym_membership_leave',
  'program_create', 'program_assign', 'program_archive',
  'workout_start', 'workout_complete', 'workout_review',
  'booking_create', 'booking_cancel', 'booking_no_show', 'booking_complete',
  'check_in', 'check_out',
  'subscription_create', 'subscription_cancel', 'subscription_renew', 'subscription_tier_change',
  'charge_succeed', 'charge_fail', 'charge_refund',
  'ai_credit_purchase', 'ai_credit_consume', 'ai_credit_refund',
  'ai_generation_create',
  'gdpr_export', 'gdpr_delete',
  'admin_action'
));

-- ─────────────────────────────────────────────────────────────────────────────
-- clients_update — narrowed to the owning PT (+ admin). See header note 3.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY clients_update ON public.clients;
CREATE POLICY clients_update ON public.clients
  FOR UPDATE TO authenticated
  USING (pt_user_id = auth.uid() OR public.is_admin())
  WITH CHECK (pt_user_id = auth.uid() OR public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- intake_forms — five policies replacing intake_forms_all. See header note 4.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY intake_forms_all ON public.intake_forms;

CREATE POLICY intake_forms_client_select ON public.intake_forms
  FOR SELECT TO authenticated
  USING (public.is_client_record_owner(client_id));

-- The client can save progress while pending/in_progress, cannot write at all
-- once the state has moved past that (blocks post-submit tampering), and can
-- never set the five PT/system-owned columns themselves — those are written
-- only by submit_intake(), apps/web's service-role waiver route, or the PT's
-- own intake_forms_pt_review policy below.
CREATE POLICY intake_forms_client_update ON public.intake_forms
  FOR UPDATE TO authenticated
  USING (public.is_client_record_owner(client_id) AND state IN ('pending', 'in_progress'))
  WITH CHECK (
    public.is_client_record_owner(client_id)
    AND state IN ('pending', 'in_progress')
    AND red_flags IS NULL
    AND waiver_pdf_url IS NULL
    AND signed_at IS NULL
    AND reviewed_at IS NULL
    AND reviewed_by_id IS NULL
  );

CREATE POLICY intake_forms_pt_select ON public.intake_forms
  FOR SELECT TO authenticated
  USING (public.is_pt_of_client(client_id) AND state IN ('completed', 'red_flag_review', 'waiver_signed'));

CREATE POLICY intake_forms_pt_review ON public.intake_forms
  FOR UPDATE TO authenticated
  USING (public.is_pt_of_client(client_id) AND state IN ('completed', 'red_flag_review', 'waiver_signed'))
  WITH CHECK (public.is_pt_of_client(client_id) AND state IN ('completed', 'red_flag_review', 'waiver_signed'));

CREATE POLICY intake_forms_admin_all ON public.intake_forms
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- Private Storage bucket for waiver PDFs. No storage.objects policies for
-- `authenticated` — deliberately. The service role bypasses RLS in Supabase
-- by design, and every read is brokered through apps/web's signed-URL route
-- after an RLS-backed authorization check against intake_forms. Path
-- convention (enforced by the API route, not the DB):
--   waivers/<client_id>/<intake_form_id>.pdf
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('waivers', 'waivers', false)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- invite_client — PT creates a clients row and its paired intake_forms row
-- together. The `sections` literal here and packages/shared's
-- INTAKE_TEMPLATE_V1 are pinned together by template_version = '1.0'; a
-- future template change is a new version, never an edit in place.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- resend_invite — extends expiry, optionally re-points the invited address.
-- The recovery path for a client who signs up under a different email than
-- the one their PT invited.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resend_invite(p_client_id UUID, p_email CITEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pt    UUID;
  v_state TEXT;
BEGIN
  SELECT pt_user_id, state INTO v_pt, v_state FROM public.clients WHERE id = p_client_id FOR UPDATE;

  IF v_pt IS NULL THEN
    RAISE EXCEPTION 'client not found';
  END IF;
  IF v_pt != auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF v_state != 'invited' THEN
    RAISE EXCEPTION 'invite already claimed';
  END IF;

  UPDATE public.clients
     SET invite_expires_at = NOW() + INTERVAL '7 days',
         invite_email = COALESCE(p_email, invite_email),
         updated_at = NOW()
   WHERE id = p_client_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    auth.uid(), 'client_invite', 'client', p_client_id,
    jsonb_build_object('resent', TRUE, 're_pointed', p_email IS NOT NULL)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resend_invite(UUID, CITEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resend_invite(UUID, CITEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- revoke_invite — deletes an unclaimed invite (cascades intake_forms).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_invite(p_client_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pt    UUID;
  v_state TEXT;
BEGIN
  SELECT pt_user_id, state INTO v_pt, v_state FROM public.clients WHERE id = p_client_id FOR UPDATE;

  IF v_pt IS NULL THEN
    RAISE EXCEPTION 'client not found';
  END IF;
  IF v_pt != auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF v_state != 'invited' THEN
    RAISE EXCEPTION 'invite already claimed';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id)
  VALUES (auth.uid(), 'client_invite_revoke', 'client', p_client_id);

  DELETE FROM public.clients WHERE id = p_client_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_invite(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_invite(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- claim_client_invites — a client links every unclaimed, unexpired invite
-- addressed to their own VERIFIED email. Idempotent: call on every app boot.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_client_invites()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email     CITEXT;
  v_confirmed BOOLEAN;
  v_count     INTEGER := 0;
  v_row       RECORD;
BEGIN
  SELECT email, (email_confirmed_at IS NOT NULL)
    INTO v_email, v_confirmed
    FROM auth.users WHERE id = auth.uid();

  IF v_email IS NULL OR NOT v_confirmed THEN
    RETURN 0;
  END IF;

  FOR v_row IN
    SELECT id, pt_user_id FROM public.clients
     WHERE invite_email = v_email
       AND client_user_id IS NULL
       AND state = 'invited'
       AND invite_expires_at > NOW()
     FOR UPDATE
  LOOP
    UPDATE public.clients
       SET client_user_id = auth.uid(), state = 'accepted', updated_at = NOW()
     WHERE id = v_row.id;

    INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id)
    VALUES (auth.uid(), v_row.pt_user_id, 'client_accept', 'client', v_row.id);

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_client_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_client_invites() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- set_client_state — PT-only active/paused/deactivated transitions. Never
-- creates or claims a client, only transitions one already accepted.
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
-- submit_intake — derives red flags server-side from the seven fixed PAR-Q
-- keys. Never trusts a client-supplied flag list; the client-side
-- evaluateParq() in packages/shared is only for the inline "you answered
-- yes" treatment as the client fills the form, never the source of truth.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_intake(p_intake_id UUID, p_responses JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_client_id UUID;
  v_state     TEXT;
  v_pt        UUID;
  v_flags     JSONB := '[]'::JSONB;
  v_key       TEXT;
BEGIN
  SELECT f.client_id, f.state, c.pt_user_id INTO v_client_id, v_state, v_pt
    FROM public.intake_forms f
    JOIN public.clients c ON c.id = f.client_id
   WHERE f.id = p_intake_id
   FOR UPDATE;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'intake form not found';
  END IF;
  IF NOT public.is_client_record_owner(v_client_id) THEN
    RAISE EXCEPTION 'not authorized to submit this intake';
  END IF;
  IF v_state NOT IN ('pending', 'in_progress') THEN
    RAISE EXCEPTION 'intake already submitted';
  END IF;

  FOREACH v_key IN ARRAY ARRAY[
    'parq_heart', 'parq_chest_pain', 'parq_dizziness', 'parq_chronic_condition',
    'parq_medication', 'parq_musculoskeletal', 'parq_supervised'
  ]
  LOOP
    IF (p_responses #>> ARRAY['parq', v_key])::BOOLEAN IS TRUE THEN
      v_flags := v_flags || to_jsonb(v_key);
    END IF;
  END LOOP;

  UPDATE public.intake_forms
     SET responses    = p_responses,
         red_flags    = v_flags,
         submitted_at = NOW(),
         state        = CASE WHEN jsonb_array_length(v_flags) > 0
                              THEN 'red_flag_review' ELSE 'completed' END,
         updated_at   = NOW()
   WHERE id = p_intake_id;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  VALUES (
    auth.uid(), v_pt, 'intake_submit', 'intake_form', p_intake_id,
    jsonb_build_object('flag_count', jsonb_array_length(v_flags))
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_intake(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_intake(UUID, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- intake_progress — state + counts only, never response content. This is the
-- PT's sole pre-submit visibility into an in-progress intake. Must be
-- SECURITY DEFINER: RLS itself denies the PT that row until submission
-- (intake_forms_pt_select above), so is_pt_of_client() here is what actually
-- authorizes the read, not the table's own RLS. Returns zero rows for a
-- caller who isn't the client's PT, the same shape RLS itself would produce.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.intake_progress(p_client_id UUID)
RETURNS TABLE(state TEXT, answered_sections INTEGER, total_sections INTEGER, updated_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.state,
    (SELECT count(*)::INTEGER FROM jsonb_object_keys(f.responses)),
    jsonb_array_length(f.sections),
    f.updated_at
  FROM public.intake_forms f
  WHERE f.client_id = p_client_id
    AND public.is_pt_of_client(p_client_id);
$$;

REVOKE EXECUTE ON FUNCTION public.intake_progress(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.intake_progress(UUID) TO authenticated;

COMMIT;

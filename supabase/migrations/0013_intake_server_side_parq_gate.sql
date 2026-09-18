-- =============================================================================
-- 0013 · the PAR-Q gate moves to the server, and a `responses` value stops
--        being able to break the PT's client-detail screen
-- =============================================================================
-- Two findings from the post-M3 security review. Both are the same shape: the
-- database trusted the shape of `intake_forms.responses`, and the only thing
-- producing that shape was a React component the client controls.
--
-- (1) NO SERVER-SIDE PAR-Q GATE. submit_intake() checked existence, ownership
--     and state - never completeness. Its red-flag loop reads
--     `(p_responses #>> ARRAY['parq', v_key])::BOOLEAN IS TRUE`, and a missing
--     key is SQL NULL, so `NULL IS TRUE` is false: an EMPTY PAR-Q flags nothing
--     by construction. EXECUTE is granted to `authenticated`, so
--
--       supabase.rpc('submit_intake', { p_intake_id: <own row>, p_responses: {} })
--
--     wrote state='completed' with red_flags='[]', and 0010's activation block
--     then promoted the client to 'active'. The result is a client recorded as
--     medically screened with nothing screened - and on the PT's Today screen
--     they fall to reason:'waiver' (a paperwork nudge) instead of reason:'flags'
--     (a safety alert), so nobody is ever told.
--
--     The entire seven-question gate lived in one `disabled` prop on the
--     wizard's Continue button ((app)/intake/[id].tsx). A client-side gate in
--     front of an RPC the client can call directly is not a gate. It is
--     enforced here now, where it cannot be skipped.
--
-- (2) A SET-RETURNING FUNCTION ON A NON-ARRAY / NON-OBJECT.
--     intake_answered_sections() (0011, carried verbatim into 0012) calls
--     `jsonb_each(COALESCE(p_responses -> <section id>, '{}'::JSONB))`.
--     jsonb_each RAISES 22023 ('cannot call jsonb_each on a non-object') for a
--     string, number, array or JSON null - and a JSON null is not a SQL NULL,
--     so the COALESCE never fires for `{"goals": null}`. jsonb_array_elements()
--     over `p_sections` has the identical problem one line above it.
--
--     The client can store both shapes. `intake_forms_client_update`'s WITH
--     CHECK (0005) pins only red_flags / waiver_pdf_url / signed_at /
--     reviewed_at / reviewed_by_id - `responses` and `sections` are BOTH
--     client-writable - there is no CHECK constraint on either column, and
--     useIntakeForm.ts's saveProgress() is a plain PostgREST table update.
--     Once written, intake_progress() throws for that client on EVERY PT load;
--     useClientDetail checks only the client query's error, so `progress`
--     becomes null and the screen renders "intake not started" over a completed
--     intake, permanently, with no way to clear it from inside the app.
--
--     Fixed by normalising the value before it reaches the set-returning
--     function, rather than by relying on AND/CASE short-circuiting: Postgres
--     documents CASE as "not a general-purpose way to avoid errors", and a
--     set-returning function in a sub-SELECT is exactly where the planner may
--     evaluate the arm you meant to skip.
--
-- No table, column, policy or grant changes. Both existing functions keep their
-- exact signatures, volatility, SECURITY DEFINER status and grants.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- parq_question_ids - the seven ids, once.
--
-- This literal array had THREE copies in SQL (submit_intake in 0005/0010,
-- intake_answered_sections in 0011/0012) plus PARQ_QUESTIONS in
-- packages/shared/src/schemas/intake.ts. 0005's own header notes they are kept
-- in sync by hand. There is still no shared source across the SQL/TypeScript
-- boundary - that stays hand-synced - but there is no longer a reason for the
-- SQL side to hold three of them, and a seven-question safety screen is the
-- worst possible place for a list to drift between the function that flags it
-- and the function that counts it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.parq_question_ids()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $fn$
  SELECT ARRAY[
    'parq_heart', 'parq_chest_pain', 'parq_dizziness', 'parq_chronic_condition',
    'parq_medication', 'parq_musculoskeletal', 'parq_supervised'
  ]::TEXT[];
$fn$;

REVOKE EXECUTE ON FUNCTION public.parq_question_ids() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- jsonb_object_or_empty / jsonb_array_or_empty - the value when it really is
-- that container type, and an empty one otherwise.
--
-- The whole point is that jsonb_each() and jsonb_array_elements() are never
-- handed anything else. A SQL NULL, a JSON null, a string, a number and the
-- wrong container all collapse to the empty one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jsonb_object_or_empty(p_value JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $fn$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'object' THEN p_value ELSE '{}'::JSONB END;
$fn$;

CREATE OR REPLACE FUNCTION public.jsonb_array_or_empty(p_value JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $fn$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'array' THEN p_value ELSE '[]'::JSONB END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.jsonb_object_or_empty(JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.jsonb_array_or_empty(JSONB) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- (2) intake_answered_sections - 0012's PAR-Q fix kept verbatim; neither
-- set-returning call can be handed the wrong JSON type any more.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.intake_answered_sections(
  p_responses JSONB,
  p_sections  JSONB
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT count(*)::INTEGER
  FROM jsonb_array_elements(public.jsonb_array_or_empty(p_sections)) AS s(section)
  WHERE CASE
    WHEN s.section->>'id' = 'parq' THEN (
      -- coalesce INSIDE bool_and (0012): an unanswered id must aggregate as
      -- FALSE, not be skipped as NULL. bool_and ignores nulls, so without this
      -- a PAR-Q with one answer counted as all seven.
      SELECT coalesce(bool_and(
        coalesce(
          jsonb_typeof(public.jsonb_object_or_empty(p_responses -> 'parq') -> q) = 'boolean',
          FALSE
        )
      ), FALSE)
      FROM unnest(public.parq_question_ids()) AS q
    )
    ELSE EXISTS (
      SELECT 1
      FROM jsonb_each(
        public.jsonb_object_or_empty(p_responses -> (s.section->>'id'))
      ) AS kv(key, value)
      WHERE jsonb_typeof(kv.value) <> 'null'
        -- #>> '{}' unwraps a JSONB scalar to its text without the quotes that
        -- ::TEXT would leave on, so '""' and '"   "' both btrim to ''.
        AND NOT (jsonb_typeof(kv.value) = 'string' AND btrim(kv.value #>> '{}') = '')
        AND NOT (jsonb_typeof(kv.value) = 'array' AND jsonb_array_length(kv.value) = 0)
    )
  END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.intake_answered_sections(JSONB, JSONB) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- (1) submit_intake - unchanged from 0010 except for the PAR-Q gate and the
-- hardened flag loop. Restated in full because CREATE OR REPLACE FUNCTION has
-- no partial form; diff against 0010 to see that only the marked blocks differ.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_intake(p_intake_id UUID, p_responses JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_client_id UUID;
  v_state     TEXT;
  v_pt        UUID;
  v_flags     JSONB := '[]'::JSONB;
  v_parq      JSONB;
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

  -- -- NEW IN 0013 ----------------------------------------------------------
  -- The PAR-Q completeness gate. Every one of the seven ids must hold an
  -- explicit JSON boolean.
  --
  -- "Boolean", not merely "present": a string "yes", a number, or a null
  -- placeholder is not an answer to a safety screen, and the flag loop below
  -- would silently read every one of them as "No". Same rule as
  -- intake_answered_sections() above, and as parqResponsesSchema /
  -- intakeCompletion() in packages/shared/src/schemas/intake.ts.
  --
  -- ERRCODE 23514 (check_violation) rather than a bare RAISE, so the app can
  -- tell an incomplete submission apart from a genuine failure.
  v_parq := public.jsonb_object_or_empty(p_responses -> 'parq');

  FOREACH v_key IN ARRAY public.parq_question_ids()
  LOOP
    IF jsonb_typeof(v_parq -> v_key) IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'intake PAR-Q incomplete: % is unanswered', v_key
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  -- -- END NEW ---------------------------------------------------------------

  -- Flag derivation. Compares against the JSON literal `true` rather than
  -- casting `#>>` text to BOOLEAN: after the gate above every id is known to be
  -- a boolean, and the old cast would have raised 22P02 on any value that was
  -- not one, had it ever been allowed to reach here.
  FOREACH v_key IN ARRAY public.parq_question_ids()
  LOOP
    IF v_parq -> v_key = 'true'::JSONB THEN
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

  -- -- FROM 0010 -------------------------------------------------------------
  -- Promote the client out of 'accepted'. Guarded on the current state rather
  -- than written unconditionally: 'paused' and 'deactivated' are the PT's
  -- calls, and an intake submission is not consent to reverse them. A red flag
  -- does not block activation either - the PT is warned on the roster and the
  -- detail screen, and refusing to activate would leave them unable to program
  -- for exactly the client who needs the most attention.
  UPDATE public.clients
     SET state = 'active', updated_at = NOW()
   WHERE id = v_client_id
     AND state = 'accepted';
  -- -- END -------------------------------------------------------------------

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  VALUES (
    auth.uid(), v_pt, 'intake_submit', 'intake_form', p_intake_id,
    jsonb_build_object('flag_count', jsonb_array_length(v_flags))
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.submit_intake(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_intake(UUID, JSONB) TO authenticated;

COMMIT;

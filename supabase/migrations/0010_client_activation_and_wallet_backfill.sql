-- =============================================================================
-- 0010 · close the 'accepted' dead end, and backfill the wallets 0007 missed
-- =============================================================================
-- Two unrelated gaps found in the M0-M3 exit audit. Both are the same shape:
-- a row lands in a state nothing ever moves it out of, and the app has no way
-- to fix it from the inside.
--
-- (1) CLIENT ACTIVATION. claim_client_invites() (0005) sets state = 'accepted'
--     when a client links their account by verified email. Nothing anywhere
--     then promotes 'accepted' -> 'active': set_client_state() can write
--     'active', but the only UI that calls it is the client detail screen's
--     Reactivate button, which renders only for 'paused' and 'deactivated'.
--     So every genuinely-onboarded client stayed 'accepted' forever, and the
--     assign screen — which lists 'active' clients — could not see them. The
--     M2 -> M3 handoff dead-ended one step from the finish.
--
--     Submitting the intake is the right promotion point. It is the moment the
--     client stops being someone who accepted an invite and starts being
--     someone the PT can program for, it is exactly what EP-03 gates
--     "Start session" on already (clients/[id]/index.tsx), and it happens
--     inside a SECURITY DEFINER function that already holds a FOR UPDATE lock
--     on the client row's parent. Doing it here rather than in the app also
--     means the transition is atomic with the submission that justifies it.
--
--     Deliberately narrow: ONLY 'accepted' -> 'active'. A paused or deactivated
--     client who submits an intake stays paused or deactivated — those are the
--     PT's decisions and an intake submission must not silently undo them.
--
-- (2) AI CREDIT WALLETS. 0007 grants a wallet from two places: an AFTER INSERT
--     trigger on public.users, and set_initial_role(). Both only fire going
--     forward, and 0007 shipped no backfill — so every PT account created
--     during M1/M2 development has no ai_credit_wallets row at all. The AI
--     broker reads the balance under the caller's own token and returns 402
--     'insufficient credits' on a missing row, permanently, with no in-app
--     path to a fix (grant_ai_credits is admin-only and has no UI until M10).
--     The admin detail page even renders copy for this state ("No wallet —
--     this account predates M3") without offering a remedy.
--
--     ensure_ai_credit_wallet() is already idempotent (ON CONFLICT DO NOTHING),
--     so the backfill is just calling it for every PT that does not have one.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) submit_intake — unchanged from 0005 except for the activation block at
-- the end. Restated in full because CREATE OR REPLACE FUNCTION has no partial
-- form; diff against 0005 to see that only the marked block is new.
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

  -- ── NEW IN 0010 ────────────────────────────────────────────────────────────
  -- Promote the client out of 'accepted'. Guarded on the current state rather
  -- than written unconditionally: 'paused' and 'deactivated' are the PT's
  -- calls, and an intake submission is not consent to reverse them. A red flag
  -- does not block activation either — the PT is warned on the roster and the
  -- detail screen, and refusing to activate would leave them unable to program
  -- for exactly the client who needs the most attention.
  UPDATE public.clients
     SET state = 'active', updated_at = NOW()
   WHERE id = v_client_id
     AND state = 'accepted';
  -- ── END NEW ────────────────────────────────────────────────────────────────

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
-- (2) Wallet backfill. Idempotent — safe to re-run, and a no-op on a database
-- where every PT already has one.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_user   RECORD;
  v_count  INTEGER := 0;
BEGIN
  FOR v_user IN
    SELECT u.id
      FROM public.users u
      LEFT JOIN public.ai_credit_wallets w ON w.user_id = u.id
     WHERE u.role = 'pt'
       AND w.user_id IS NULL
  LOOP
    PERFORM public.ensure_ai_credit_wallet(v_user.id);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE '0010: granted a starting wallet to % pre-M3 PT account(s)', v_count;
END;
$$;

-- =============================================================================
-- 0014 · three authorization gaps from the 2026-09-18 backend security review
-- =============================================================================
-- Each one is the same shape as 0013: a guard existed, but lived somewhere
-- the caller could route around.
--
-- (1) refund_ai_credit() WAS CALLABLE BY THE GENERATION'S OWNER.
--     0007 granted EXECUTE to `authenticated` and its guard read
--     `IF v_user_id != auth.uid() AND NOT public.is_admin()`, so the PT who
--     paid for a generation could refund it. The grant existed for a planned
--     server-side refund-on-failure branch in /api/ai/program-draft that was
--     never built (route.ts:53-56 says so), and nothing in apps/ calls the
--     RPC. Meanwhile create_program_from_draft() never read was_refunded. So:
--
--       POST /api/ai/program-draft            -- Forge pays Anthropic, -1 credit
--       rpc('refund_ai_credit', {generation}) -- +1 credit
--       rpc('create_program_from_draft', ...) -- draft persisted anyway
--
--     repeated forever on the 10-credit starter wallet. Refund is admin-only
--     now, and a refunded generation can no longer be turned into a program.
--     If the route ever needs an automatic refund, it runs under the service
--     role, never the caller's bearer token.
--
-- (2) public.clients WAS DIRECTLY WRITABLE BY ANY AUTHENTICATED USER.
--     clients_insert (0003) and clients_update (0005) gate on
--     `pt_user_id = auth.uid()` and nothing else: no role check, no column
--     pinning, and — unlike users (0003 REVOKEs UPDATE and re-grants columns)
--     — no column-level grant at all. A bare PostgREST
--
--       INSERT INTO clients (pt_user_id, client_user_id, state)
--       VALUES (auth.uid(), <victim>, 'active')
--
--     from any account, `role='client'` included, skips invite_client()'s PT
--     check, claim_client_invites()'s verified-email match, set_client_state()'s
--     transition guard and every audit row. Every SECURITY DEFINER predicate
--     then trusts the forged row: is_pt_of_user(victim) opens users_select on
--     the victim's email, phone and consent flags; is_pt_of_client lets
--     assign_program / create_program_from_draft / the AI broker act on them;
--     is_program_visible shows the attacker's program in the victim's app.
--
--     All writes to clients already go through SECURITY DEFINER RPCs
--     (invite_client, resend_invite, revoke_invite, claim_client_invites,
--     set_client_state, submit_intake) which run as the table owner. Every
--     `from('clients')` call site in apps/ is a SELECT. So the table-level
--     INSERT/UPDATE/DELETE privileges are revoked outright and the three write
--     policies dropped — same approach 0003 took for users.role.
--
-- (3) claim_client_invites() TREATED email_confirmed_at AS PROOF OF OWNERSHIP.
--     It is not when [auth.email] enable_confirmations = false
--     (supabase/config.toml, off while Resend has no verified sender): GoTrue
--     stamps email_confirmed_at at signup for whatever address was typed. An
--     attacker who knows an invitee's address signs up with it, the app
--     claims the invite on boot, and they fill the intake and sign the waiver
--     as the victim while resend_invite() refuses the real one ("invite
--     already claimed").
--
--     The gate now requires evidence that ownership was actually established,
--     any one of:
--       · confirmation_sent_at IS NOT NULL — the email confirmation flow ran
--         (GoTrue leaves it NULL under autoconfirm);
--       · invited_at IS NOT NULL — an admin invite link was followed;
--       · an auth.identities row from a non-email provider (Google, Apple) —
--         the provider verified the address.
--     A password-only account created under autoconfirm matches none of these
--     and claims nothing. Consequence for development: while confirmations
--     stay off, email/password invite claiming does not work; Google sign-in
--     does. Test accounts created by SQL need confirmation_sent_at set (see
--     db/rls_assertions.sql fixtures).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) refund_ai_credit — admin only. Same body as 0007 otherwise.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refund_ai_credit(p_generation_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id  UUID;
  v_refunded BOOLEAN;
  v_credits  SMALLINT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT user_id, was_refunded, credits_charged INTO v_user_id, v_refunded, v_credits
    FROM public.ai_generations WHERE id = p_generation_id FOR UPDATE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'generation not found';
  END IF;
  IF v_refunded THEN
    RAISE EXCEPTION 'generation already refunded';
  END IF;

  UPDATE public.ai_generations SET was_refunded = TRUE, refund_reason = p_reason WHERE id = p_generation_id;

  UPDATE public.ai_credit_wallets
     SET balance = balance + v_credits, total_refunded = total_refunded + v_credits, updated_at = NOW()
   WHERE user_id = v_user_id;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), v_user_id, 'ai_credit_refund', 'ai_generation', p_generation_id, jsonb_build_object('reason', p_reason));
END;
$$;

-- Admins are members of `authenticated` too, so EXECUTE stays granted to that
-- role; the is_admin() check inside is what narrows it. Re-stated here so the
-- intent survives a reader who only opens this file.
REVOKE EXECUTE ON FUNCTION public.refund_ai_credit(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_ai_credit(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (1b) create_program_from_draft — a refunded generation is not a paid one.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_program_from_draft(
  p_client_id     UUID,
  p_generation_id UUID,
  p_payload       JSONB,
  p_name          VARCHAR DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_gen_user   UUID;
  v_refunded   BOOLEAN;
  v_program_id UUID;
  v_weeks      SMALLINT;
BEGIN
  SELECT user_id, was_refunded INTO v_gen_user, v_refunded
    FROM public.ai_generations WHERE id = p_generation_id;
  IF v_gen_user IS NULL THEN
    RAISE EXCEPTION 'generation not found';
  END IF;
  IF v_gen_user != auth.uid() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF v_refunded THEN
    RAISE EXCEPTION 'generation was refunded';
  END IF;
  IF NOT public.is_pt_of_client(p_client_id) THEN
    RAISE EXCEPTION 'not authorized for this client';
  END IF;

  v_weeks := COALESCE(jsonb_array_length(p_payload->'weeks'), 4)::SMALLINT;

  INSERT INTO public.programs (
    author_user_id, client_id, state, name, duration_weeks, is_ai_generated, ai_generation_id
  )
  VALUES (
    auth.uid(), p_client_id, 'draft', COALESCE(NULLIF(trim(p_name), ''), 'AI draft'), v_weeks,
    TRUE, p_generation_id
  )
  RETURNING id INTO v_program_id;

  PERFORM public.save_program(v_program_id, p_payload);

  UPDATE public.ai_generations SET result_entity_type = 'program', result_entity_id = v_program_id
   WHERE id = p_generation_id;

  RETURN v_program_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) clients — RPC-only for writes. SELECT policy untouched.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS clients_insert ON public.clients;
DROP POLICY IF EXISTS clients_update ON public.clients;
DROP POLICY IF EXISTS clients_delete ON public.clients;

REVOKE INSERT, UPDATE, DELETE ON public.clients FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (3) claim_client_invites — confirmed AND provably owned.
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
  v_proven    BOOLEAN;
  v_count     INTEGER := 0;
  v_row       RECORD;
BEGIN
  SELECT u.email,
         (u.email_confirmed_at IS NOT NULL),
         (   u.confirmation_sent_at IS NOT NULL
          OR u.invited_at IS NOT NULL
          OR EXISTS (
               SELECT 1 FROM auth.identities i
                WHERE i.user_id = u.id
                  AND i.provider NOT IN ('email', 'phone')
             )
         )
    INTO v_email, v_confirmed, v_proven
    FROM auth.users u WHERE u.id = auth.uid();

  IF v_email IS NULL OR NOT v_confirmed OR NOT v_proven THEN
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

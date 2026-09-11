-- =============================================================================
-- RLS assertion harness
-- =============================================================================
-- The stand-in for integration tests (implementation design D8): queries run as
-- the wrong user that must come back empty, paired with positive controls so the
-- suite cannot pass by denying everything.
--
-- Run:  psql "$PGURL" -v ON_ERROR_STOP=1 -f db/rls_assertions.sql
-- Everything happens inside a transaction that ends in ROLLBACK, so it leaves
-- no fixtures behind. Any failed expectation raises and aborts.
--
-- Each milestone appends its own cases here as it adds policies.
-- =============================================================================

BEGIN;

CREATE FUNCTION pg_temp.expect(label TEXT, expected BIGINT, query TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  actual BIGINT;
BEGIN
  EXECUTE query INTO actual;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL % — expected %, got %', label, expected, actual;
  END IF;
  RAISE NOTICE 'pass  %', label;
END;
$$;

CREATE FUNCTION pg_temp.act_as(user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id::TEXT, 'role', 'authenticated')::TEXT,
    TRUE
  );
END;
$$;

-- Runs `sql` and expects an RLS policy violation (a WITH CHECK failure on a
-- row that WAS visible via USING, not just a USING-filtered no-op update).
-- Built as a function taking `sql` as a real parameter — rather than a DO
-- block with a psql variable inlined in its body — because psql does NOT
-- interpolate `:'var'` inside dollar-quoted ($$...$$) text, only in plain
-- top-level statements; building `sql` via format() at the call site (where
-- substitution does apply) and passing it in here sidesteps that entirely.
CREATE FUNCTION pg_temp.expect_rls_block(label TEXT, sql TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE sql;
    RAISE EXCEPTION 'FAIL % — statement was not blocked', label;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'pass  %', label;
  END;
END;
$$;

-- Runs `sql` (typically a SELECT of a SECURITY DEFINER RPC) and expects it to
-- raise ANY exception — for this milestone's own RAISE EXCEPTION guards
-- (e.g. "not authorized"), which aren't RLS violations, so `insufficient_privilege`
-- doesn't apply. Same psql-substitution reasoning as expect_rls_block above.
CREATE FUNCTION pg_temp.expect_raises(label TEXT, sql TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE sql;
    RAISE EXCEPTION 'FAIL % — statement was not blocked', label;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL %' THEN
      RAISE;
    END IF;
    RAISE NOTICE 'pass  %', label;
  END;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixtures. Inserting into auth.users fires the signup trigger, so the profile
-- rows below are created the same way a real signup creates them.
-- ─────────────────────────────────────────────────────────────────────────────
\set pt_a       '11111111-1111-4111-8111-111111111111'
\set pt_b       '22222222-2222-4222-8222-222222222222'
\set client_a   '33333333-3333-4333-8333-333333333333'
\set client_b   '44444444-4444-4444-8444-444444444444'
\set client_row '55555555-5555-4555-8555-555555555555'
\set intake_row '66666666-6666-4666-8666-666666666666'

-- email_confirmed_at is set for all four (NOW()) — M2's claim_client_invites()
-- only links a VERIFIED email, so the fixtures need to represent real
-- confirmed accounts for that block below to mean anything.
INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at)
VALUES
  (:'pt_a',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-pt-a@forge-test.local',     '{"role":"pt","display_name":"PT A"}', NOW()),
  (:'pt_b',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-pt-b@forge-test.local',     '{"role":"pt","display_name":"PT B"}', NOW()),
  (:'client_a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-client-a@forge-test.local', '{"role":"client","display_name":"Client A"}', NOW()),
  (:'client_b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-client-b@forge-test.local', '{"role":"client","display_name":"Client B"}', NOW());

INSERT INTO public.clients (id, pt_user_id, client_user_id, state)
VALUES (:'client_row', :'pt_a', :'client_a', 'active');

INSERT INTO public.intake_forms (id, client_id, state)
VALUES (:'intake_row', :'client_row', 'in_progress');

-- ─────────────────────────────────────────────────────────────────────────────
-- M2 — the client's promise: a PT cannot read intake answers before submit,
-- and a client cannot forge that submission by writing the row directly.
-- Run BEFORE intake_row is flipped to 'completed' below, so every downstream
-- M0/M1 positive control still finds a submitted-looking form.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('PT A cannot read an in-progress intake', 0,
  'SELECT count(*) FROM public.intake_forms');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
SELECT pg_temp.expect_rls_block('client cannot advance intake state past in_progress directly',
  format('UPDATE public.intake_forms SET state = ''completed'' WHERE id = %L', :'intake_row'));
SELECT pg_temp.expect_rls_block('client cannot set red_flags directly',
  format('UPDATE public.intake_forms SET red_flags = ''["x"]''::jsonb WHERE id = %L', :'intake_row'));
SELECT pg_temp.expect('Client A can still save legitimate progress', 1,
  format('WITH u AS (
            UPDATE public.intake_forms SET responses = ''{"parq":{}}''::jsonb WHERE id = %L
            RETURNING 1
          ) SELECT count(*) FROM u', :'intake_row'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
SELECT pg_temp.expect('Client A cannot update their own clients row directly', 0,
  format('WITH u AS (
            UPDATE public.clients SET state = ''deactivated'' WHERE id = %L
            RETURNING 1
          ) SELECT count(*) FROM u', :'client_row'));
RESET ROLE;

-- Restore the baseline every M0/M1 assertion below expects: a submitted form.
UPDATE public.intake_forms SET state = 'completed' WHERE id = :'intake_row';

-- ─────────────────────────────────────────────────────────────────────────────
-- anon — the unauthenticated key. Should see nothing at all.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT pg_temp.expect('anon reads no users',       0, 'SELECT count(*) FROM public.users');
SELECT pg_temp.expect('anon reads no clients',     0, 'SELECT count(*) FROM public.clients');
SELECT pg_temp.expect('anon reads no intakes',     0, 'SELECT count(*) FROM public.intake_forms');
SELECT pg_temp.expect('anon reads no audit logs',  0, 'SELECT count(*) FROM public.audit_logs');
SELECT pg_temp.expect('anon reads no pt_profiles', 0, 'SELECT count(*) FROM public.pt_profiles');
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- PT B — a competing trainer. Must not reach PT A's roster.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_b');
SELECT pg_temp.expect('PT B cannot see PT A clients', 0,
  'SELECT count(*) FROM public.clients');
SELECT pg_temp.expect('PT B cannot see PT A intake forms', 0,
  'SELECT count(*) FROM public.intake_forms');
SELECT pg_temp.expect('PT B cannot see the client user row', 0,
  format('SELECT count(*) FROM public.users WHERE id = %L', :'client_a'));
SELECT pg_temp.expect('PT B sees only their own user row', 1,
  'SELECT count(*) FROM public.users');
SELECT pg_temp.expect('PT B cannot update PT A user row', 0,
  format('WITH u AS (UPDATE public.users SET display_name = %L WHERE id = %L RETURNING 1)
          SELECT count(*) FROM u', 'hijacked', :'pt_a'));
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Client B — another client. Must not reach client A's intake.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_b');
SELECT pg_temp.expect('Client B cannot see Client A intake', 0,
  'SELECT count(*) FROM public.intake_forms');
SELECT pg_temp.expect('Client B cannot see Client A client row', 0,
  'SELECT count(*) FROM public.clients');
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Positive controls — the people who SHOULD have access still do.
-- Without these the suite would pass even if every table were locked shut.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('PT A sees their own client', 1,
  'SELECT count(*) FROM public.clients');
SELECT pg_temp.expect('PT A sees the client intake form', 1,
  'SELECT count(*) FROM public.intake_forms');
SELECT pg_temp.expect('PT A sees self and their client user row', 2,
  'SELECT count(*) FROM public.users');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
SELECT pg_temp.expect('Client A sees their own client row', 1,
  'SELECT count(*) FROM public.clients');
SELECT pg_temp.expect('Client A sees their own intake form', 1,
  'SELECT count(*) FROM public.intake_forms');
SELECT pg_temp.expect('Client A can edit their own display name', 1,
  format('WITH u AS (UPDATE public.users SET display_name = %L WHERE id = %L RETURNING 1)
          SELECT count(*) FROM u', 'Renamed By Self', :'client_a'));
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- M2 (0006) — a client can read their own PT's user row (for ClientHome's
-- name/avatar), but not an unrelated PT's.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
SELECT pg_temp.expect('Client A can read PT A''s user row (their own trainer)', 1,
  format('SELECT count(*) FROM public.users WHERE id = %L', :'pt_a'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_b');
SELECT pg_temp.expect('Client B cannot read PT A''s user row (not their trainer)', 0,
  format('SELECT count(*) FROM public.users WHERE id = %L', :'pt_a'));
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Privilege escalation — column grants, not row policies, are what stop this.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
DO $$
BEGIN
  BEGIN
    EXECUTE 'UPDATE public.users SET role = ''admin'' WHERE id = auth.uid()';
    RAISE EXCEPTION 'FAIL escalation — a client promoted themselves to admin';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'pass  client cannot grant themselves the admin role';
  END;
END;
$$;
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- M2 — invite_client / claim_client_invites / set_client_state / submit_intake,
-- exercised end to end through the real RPCs on a fresh client so client_row /
-- intake_row (still needed by M0/M1 assertions below) are never touched.
-- ─────────────────────────────────────────────────────────────────────────────
\set client_c '99999999-9999-4999-8999-999999999999'
INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at)
VALUES (:'client_c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'rls-client-c@forge-test.local', '{"role":"client","display_name":"Client C"}', NOW());

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT public.invite_client('rls-client-c@forge-test.local', 'Client C', '{}') AS new_client_id \gset
RESET ROLE;

SELECT id AS new_intake_id FROM public.intake_forms WHERE client_id = :'new_client_id' \gset

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('intake_progress reports state without exposing content, pre-accept', 1,
  format('SELECT count(*) FROM public.intake_progress(%L) WHERE state = ''pending''', :'new_client_id'));
RESET ROLE;

-- claim_client_invites — verified-email match, then idempotent on a repeat call.
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_c');
SELECT public.claim_client_invites();
RESET ROLE;
SELECT pg_temp.expect('claim_client_invites links Client C to the new invite', 1,
  format('SELECT count(*) FROM public.clients WHERE id = %L AND client_user_id = %L AND state = ''accepted''',
         :'new_client_id', :'client_c'));

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_c');
SELECT public.claim_client_invites();
RESET ROLE;
SELECT pg_temp.expect('claim_client_invites is idempotent on a second call', 1,
  format('SELECT count(*) FROM public.clients WHERE id = %L AND client_user_id = %L AND state = ''accepted''',
         :'new_client_id', :'client_c'));

-- claim_client_invites — a non-matching or expired invite links nothing.
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT public.invite_client('rls-client-b@forge-test.local', 'Client B Late', '{}') AS expired_client_id \gset
RESET ROLE;
UPDATE public.clients SET invite_expires_at = NOW() - INTERVAL '1 day' WHERE id = :'expired_client_id';
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_b');
SELECT public.claim_client_invites();
RESET ROLE;
SELECT pg_temp.expect('claim_client_invites ignores an expired invite', 0,
  format('SELECT count(*) FROM public.clients WHERE id = %L AND client_user_id IS NOT NULL', :'expired_client_id'));

-- set_client_state — authorization.
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_b');
SELECT pg_temp.expect_raises('PT B cannot change PT A''s client state',
  format('SELECT public.set_client_state(%L::uuid, ''paused'')', :'new_client_id'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT public.set_client_state(:'new_client_id'::uuid, 'paused');
RESET ROLE;
SELECT pg_temp.expect('PT A can pause their own client', 1,
  format('SELECT count(*) FROM public.clients WHERE id = %L AND state = ''paused''', :'new_client_id'));

-- submit_intake — authorization, PAR-Q flag derivation, and one-shot.
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_b');
SELECT pg_temp.expect_raises('Client B cannot submit Client C''s intake',
  format('SELECT public.submit_intake(%L::uuid, ''{"parq":{}}''::jsonb)', :'new_intake_id'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_c');
SELECT public.submit_intake(:'new_intake_id'::uuid,
  '{"parq":{"parq_heart":true,"parq_chest_pain":false,"parq_dizziness":false,"parq_chronic_condition":false,"parq_medication":false,"parq_musculoskeletal":false,"parq_supervised":false}}'::jsonb);
RESET ROLE;
SELECT pg_temp.expect('submit_intake flags the row for review on a PAR-Q yes', 1,
  format('SELECT count(*) FROM public.intake_forms
           WHERE id = %L AND state = ''red_flag_review'' AND red_flags @> ''["parq_heart"]''::jsonb',
         :'new_intake_id'));

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_c');
SELECT pg_temp.expect_raises('submit_intake refuses a second submission',
  format('SELECT public.submit_intake(%L::uuid, ''{"parq":{}}''::jsonb)', :'new_intake_id'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('PT A can now read Client C''s submitted intake', 1,
  format('SELECT count(*) FROM public.intake_forms WHERE id = %L', :'new_intake_id'));
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- M1 fixtures — pt_profiles / pt_certifications / notification_preferences
-- for pt_a, published later in this block to exercise both denial and
-- positive read paths.
-- ─────────────────────────────────────────────────────────────────────────────
\set ptprofile_a '77777777-7777-4777-8777-777777777777'
\set ptcert_a    '88888888-8888-4888-8888-888888888888'

INSERT INTO public.pt_profiles (id, user_id, is_published)
VALUES (:'ptprofile_a', :'pt_a', FALSE);

INSERT INTO public.pt_certifications (id, pt_user_id, name, issuer, status)
VALUES (:'ptcert_a', :'pt_a', 'NASM CPT', 'NASM', 'verified');

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('PT A can upsert their own notification_preferences', 1,
  format('WITH ins AS (
            INSERT INTO public.notification_preferences (user_id, channel, category, enabled)
            VALUES (%L, ''push'', ''streak'', TRUE)
            RETURNING 1
          ) SELECT count(*) FROM ins', :'pt_a'));
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- notification_preferences — strictly self-owned.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_b');
SELECT pg_temp.expect('PT B cannot read PT A notification_preferences', 0,
  'SELECT count(*) FROM public.notification_preferences');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('PT A reads their own notification_preferences', 1,
  'SELECT count(*) FROM public.notification_preferences');
SELECT pg_temp.expect('PT A can update their own notification_preferences', 1,
  format('WITH u AS (
            UPDATE public.notification_preferences SET enabled = FALSE
             WHERE user_id = %L
            RETURNING 1
          ) SELECT count(*) FROM u', :'pt_a'));
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- pt_certifications — readable by the owner always; by anyone else only once
-- the parent pt_profiles.is_published flips to TRUE.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_b');
SELECT pg_temp.expect('PT B cannot read PT A certifications while unpublished', 0,
  'SELECT count(*) FROM public.pt_certifications');
RESET ROLE;

-- Publish PT A's profile as PT A (self-owned write policy).
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('PT A can publish their own pt_profiles row', 1,
  format('WITH u AS (
            UPDATE public.pt_profiles SET is_published = TRUE WHERE user_id = %L
            RETURNING 1
          ) SELECT count(*) FROM u', :'pt_a'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_b');
SELECT pg_temp.expect('PT B can read PT A certifications once published', 1,
  'SELECT count(*) FROM public.pt_certifications');
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- set_initial_role — one-time role picker. 'admin' is never reachable, and a
-- second call after onboarding_completed is a silent no-op, not a crash.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
DO $$
BEGIN
  BEGIN
    PERFORM public.set_initial_role('admin');
    RAISE EXCEPTION 'FAIL set_initial_role — admin role was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL set_initial_role%' THEN
      RAISE;
    END IF;
    RAISE NOTICE 'pass  set_initial_role rejects admin';
  END;
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
SELECT public.set_initial_role('pt');
SELECT pg_temp.expect('set_initial_role flips the role while onboarding is incomplete', 1,
  format('SELECT count(*) FROM public.users WHERE id = %L AND role = ''pt''', :'client_a'));
RESET ROLE;

-- Mark client_a's onboarding complete, then confirm a second call is a no-op.
UPDATE public.users SET onboarding_completed = TRUE WHERE id = :'client_a';

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
SELECT public.set_initial_role('client');
SELECT pg_temp.expect('set_initial_role no-ops once onboarding is complete', 1,
  format('SELECT count(*) FROM public.users WHERE id = %L AND role = ''pt''', :'client_a'));
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- log_account_event — actor is always auth.uid(); the action allow-list holds.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_b');
DO $$
BEGIN
  BEGIN
    PERFORM public.log_account_event('user_delete', NULL);
    RAISE EXCEPTION 'FAIL log_account_event — user_delete was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL log_account_event%' THEN
      RAISE;
    END IF;
    RAISE NOTICE 'pass  log_account_event rejects an action outside the allow-list';
  END;
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_b');
SELECT public.log_account_event('user_login', '{}'::jsonb);
RESET ROLE;

-- audit_logs is policy-free by design (service-role only), so authenticated
-- can't read it back — verify the insert with the harness's own (RLS-exempt
-- table-owner) connection instead.
SELECT pg_temp.expect('log_account_event inserts exactly one audit_logs row for the actor', 1,
  format('SELECT count(*) FROM public.audit_logs WHERE actor_id = %L', :'client_b'));

ROLLBACK;

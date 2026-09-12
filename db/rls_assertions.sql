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

-- ═════════════════════════════════════════════════════════════════════════════
-- M3 — programming: denormalised program_id, program/exercise visibility,
-- template immutability, and the AI credit ledger. Reuses pt_a / pt_b /
-- client_a / client_b / client_row from the M0-M2 fixtures above (note:
-- client_a's users.role is 'pt' by this point in the file — the M1 section
-- above flips it via set_initial_role and never reverts it. None of the M3
-- predicates below key on users.role, only on the clients table, so this is
-- harmless — except where explicitly noted as a bonus assertion on it).
-- ═════════════════════════════════════════════════════════════════════════════
\set program_a       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set program_tmpl    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
\set exercise_mine   'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
\set exercise_global 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
\set week_a  'e0000000-0000-4000-8000-000000000001'
\set day_a   'e0000000-0000-4000-8000-000000000002'
\set block_a 'e0000000-0000-4000-8000-000000000003'
\set pe_a    'e0000000-0000-4000-8000-000000000004'
\set week_t  'e0000000-0000-4000-8000-000000000011'
\set day_t   'e0000000-0000-4000-8000-000000000012'
\set block_t 'e0000000-0000-4000-8000-000000000013'
\set pe_t    'e0000000-0000-4000-8000-000000000014'
\set admin_a 'a0000000-0000-4000-8000-00000000a001'

INSERT INTO public.exercises (id, name, slug, muscle_group, equipment, movement_pattern, is_custom, created_by_user_id)
VALUES
  (:'exercise_global', 'Barbell Back Squat (RLS fixture)', 'rls-fixture-squat', 'quadriceps', 'barbell', 'squat', FALSE, NULL),
  (:'exercise_mine',   'PT B''s Custom Curl', 'rls-fixture-curl-pt-b', 'biceps', 'dumbbell', 'pull', TRUE, :'pt_b');

-- program_a: authored by pt_a, assigned to client_row, starts 'draft'.
INSERT INTO public.programs (id, author_user_id, client_id, state, name, duration_weeks)
VALUES (:'program_a', :'pt_a', :'client_row', 'draft', 'RLS Test Program', 1);
INSERT INTO public.program_weeks (id, program_id, week_number) VALUES (:'week_a', :'program_a', 1);
INSERT INTO public.program_days (id, week_id, program_id, day_number) VALUES (:'day_a', :'week_a', :'program_a', 1);
INSERT INTO public.program_blocks (id, day_id, program_id, sort_order, block_type) VALUES (:'block_a', :'day_a', :'program_a', 0, 'working');
INSERT INTO public.program_exercises (id, block_id, program_id, exercise_id, sort_order, target_sets, target_reps_min, target_reps_max)
VALUES (:'pe_a', :'block_a', :'program_a', :'exercise_global', 0, 3, 8, 10);

-- program_tmpl: a template authored by pt_a, same shape, so we can prove a
-- copy mutates independently of the source.
INSERT INTO public.programs (id, author_user_id, state, name, duration_weeks, is_template)
VALUES (:'program_tmpl', :'pt_a', 'draft', 'RLS Test Template', 1, TRUE);
INSERT INTO public.program_weeks (id, program_id, week_number) VALUES (:'week_t', :'program_tmpl', 1);
INSERT INTO public.program_days (id, week_id, program_id, day_number) VALUES (:'day_t', :'week_t', :'program_tmpl', 1);
INSERT INTO public.program_blocks (id, day_id, program_id, sort_order, block_type) VALUES (:'block_t', :'day_t', :'program_tmpl', 0, 'working');
INSERT INTO public.program_exercises (id, block_id, program_id, exercise_id, sort_order, target_sets, target_reps_min, target_reps_max)
VALUES (:'pe_t', :'block_t', :'program_tmpl', :'exercise_global', 0, 3, 8, 10);

INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at)
VALUES (:'admin_a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'rls-admin-a@forge-test.local', '{"role":"client","display_name":"Admin A"}', NOW());
UPDATE public.users SET role = 'admin' WHERE id = :'admin_a';

-- ─────────────────────────────────────────────────────────────────────────────
-- The composite-FK invariant (D1) — a program_blocks row whose declared
-- program_id disagrees with its day_id's actual program_id must be rejected
-- by the database itself, not merely discouraged. This is what fails loudly
-- if someone later drops fk_pb_day_program "to simplify".
-- ─────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.expect_raises('composite FK rejects a program_blocks row whose program_id disagrees with its day_id',
  format('INSERT INTO public.program_blocks (day_id, program_id, sort_order, block_type)
          VALUES (%L, %L, 99, ''working'')', :'day_a', :'program_tmpl'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Cross-tenant reads — PT B must not reach PT A's program tree; PT A must
-- not reach PT B's custom exercise (but the global library is shared).
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_b');
SELECT pg_temp.expect('PT B cannot see PT A''s program', 0,
  format('SELECT count(*) FROM public.programs WHERE id = %L', :'program_a'));
SELECT pg_temp.expect('PT B cannot see PT A''s program weeks', 0,
  format('SELECT count(*) FROM public.program_weeks WHERE program_id = %L', :'program_a'));
SELECT pg_temp.expect('PT B cannot see PT A''s program days', 0,
  format('SELECT count(*) FROM public.program_days WHERE program_id = %L', :'program_a'));
SELECT pg_temp.expect('PT B cannot see PT A''s program blocks', 0,
  format('SELECT count(*) FROM public.program_blocks WHERE program_id = %L', :'program_a'));
SELECT pg_temp.expect('PT B cannot see PT A''s program exercises', 0,
  format('SELECT count(*) FROM public.program_exercises WHERE program_id = %L', :'program_a'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('PT A cannot see PT B''s custom exercise', 0,
  format('SELECT count(*) FROM public.exercises WHERE id = %L', :'exercise_mine'));
SELECT pg_temp.expect('PT A can see the global exercise library', 1,
  format('SELECT count(*) FROM public.exercises WHERE id = %L', :'exercise_global'));
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Draft invisibility — EP-15's "AI never auto-publishes" at the row level.
-- client_id is already set on program_a; only the state flip makes it visible.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
SELECT pg_temp.expect('Client A cannot see their assigned program while it is draft', 0,
  format('SELECT count(*) FROM public.programs WHERE id = %L', :'program_a'));
RESET ROLE;

UPDATE public.programs SET state = 'active' WHERE id = :'program_a';

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
SELECT pg_temp.expect('Client A sees the program once it is active', 1,
  format('SELECT count(*) FROM public.programs WHERE id = %L', :'program_a'));
SELECT pg_temp.expect('Client A sees the program''s week/day/block/exercise tree', 1,
  format('SELECT count(*) FROM public.program_weeks WHERE program_id = %L', :'program_a'));
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Client cannot write. program_exercises_write's USING excludes a client
-- entirely (not merely a WITH CHECK failure), so this is the 0-affected-rows
-- idiom, same as clients_update's own client-tamper test above — not
-- expect_rls_block, which is for a WITH CHECK failure on a row USING admits.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
SELECT pg_temp.expect('Client A cannot edit a program_exercises row (USING-filtered no-op)', 0,
  format('WITH u AS (
            UPDATE public.program_exercises SET target_sets = 99 WHERE id = %L
            RETURNING 1
          ) SELECT count(*) FROM u', :'pe_a'));
SELECT pg_temp.expect('Client A cannot rename the program row itself (USING-filtered no-op)', 0,
  format('WITH u AS (
            UPDATE public.programs SET name = ''hijacked'' WHERE id = %L
            RETURNING 1
          ) SELECT count(*) FROM u', :'program_a'));
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- The global exercise library is not writable via a bare INSERT — WITH CHECK
-- fails on is_custom = FALSE, which Postgres raises as insufficient_privilege.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect_rls_block('cannot insert into the global library directly (is_custom = false)',
  format('INSERT INTO public.exercises (name, slug, muscle_group, equipment, movement_pattern, is_custom, created_by_user_id)
          VALUES (''Sneaky Global Exercise'', ''rls-sneaky-global'', ''chest'', ''barbell'', ''push'', FALSE, %L)', :'pt_a'));
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- AI credit wallet — auto-created at signup (pt_a/pt_b's metadata already
-- said role: pt), isolated per user, and immutable via direct PostgREST
-- write — every mutation is one of the RPCs below, never a raw UPDATE.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('PT A has an AI credit wallet with the starting balance of 10', 1,
  format('SELECT count(*) FROM public.ai_credit_wallets WHERE user_id = %L AND balance = 10', :'pt_a'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_b');
SELECT pg_temp.expect('PT B cannot see PT A''s wallet', 0,
  format('SELECT count(*) FROM public.ai_credit_wallets WHERE user_id = %L', :'pt_a'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('PT A cannot directly UPDATE their own wallet balance (no write policy exists)', 0,
  format('WITH u AS (
            UPDATE public.ai_credit_wallets SET balance = 9999 WHERE user_id = %L
            RETURNING 1
          ) SELECT count(*) FROM u', :'pt_a'));
RESET ROLE;

-- Bonus: client_a became a 'pt' via set_initial_role above (M1 section) —
-- confirm that code path also granted a wallet (handle_new_user_ai_wallet
-- only fires on INSERT, so this exercises the OTHER of the two grant paths).
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
SELECT pg_temp.expect('set_initial_role(''pt'') also grants an AI credit wallet', 1,
  format('SELECT count(*) FROM public.ai_credit_wallets WHERE user_id = %L AND balance = 10', :'client_a'));
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- The ledger end to end: consume → refund → double-refund raises → drain to
-- zero → over-debit raises without going negative → admin-only grant.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT generation_id AS gen1_id, new_balance AS gen1_balance
  FROM public.consume_ai_credit('program_draft', repeat('a', 64), 'scrubbed prompt', 'scrubbed output', 'claude-opus-5', 100, 200, 5000) \gset
RESET ROLE;

SELECT pg_temp.expect('consume_ai_credit drops PT A''s balance by exactly 1', 1,
  format('SELECT count(*) FROM public.ai_credit_wallets WHERE user_id = %L AND balance = 9', :'pt_a'));
SELECT pg_temp.expect('consume_ai_credit logs exactly one un-refunded ai_generations row', 1,
  format('SELECT count(*) FROM public.ai_generations WHERE id = %L AND was_refunded = FALSE', :'gen1_id'));

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT public.refund_ai_credit(:'gen1_id'::uuid, 'llm timeout');
RESET ROLE;

SELECT pg_temp.expect('refund_ai_credit restores PT A''s balance to 10', 1,
  format('SELECT count(*) FROM public.ai_credit_wallets WHERE user_id = %L AND balance = 10', :'pt_a'));
SELECT pg_temp.expect('refund_ai_credit flips was_refunded', 1,
  format('SELECT count(*) FROM public.ai_generations WHERE id = %L AND was_refunded = TRUE', :'gen1_id'));

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect_raises('refund_ai_credit refuses a second refund of the same generation',
  format('SELECT public.refund_ai_credit(%L::uuid, ''double refund attempt'')', :'gen1_id'));
RESET ROLE;

UPDATE public.ai_credit_wallets SET balance = 0, updated_at = NOW() WHERE user_id = :'pt_a';

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect_raises('consume_ai_credit raises on chk_acw_balance when the wallet is already at 0',
  format('SELECT * FROM public.consume_ai_credit(''program_draft'', %L, ''p'', ''o'', ''claude-opus-5'', 1, 1, 1)', repeat('b', 64)));
RESET ROLE;

SELECT pg_temp.expect('a failed consume_ai_credit leaves the balance at 0, never negative', 1,
  format('SELECT count(*) FROM public.ai_credit_wallets WHERE user_id = %L AND balance = 0', :'pt_a'));

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_b');
SELECT pg_temp.expect_raises('grant_ai_credits refuses a non-admin caller',
  format('SELECT public.grant_ai_credits(%L::uuid, 5, ''test'')', :'pt_b'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'admin_a');
SELECT public.grant_ai_credits(:'pt_a'::uuid, 5, 'support top-up');
RESET ROLE;

SELECT pg_temp.expect('grant_ai_credits (admin) tops up PT A''s balance to 5', 1,
  format('SELECT count(*) FROM public.ai_credit_wallets WHERE user_id = %L AND balance = 5', :'pt_a'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Template immutability (EP-04: "copies, never mutates") — instantiate,
-- mutate the copy, confirm the source is untouched. Also exercises the
-- archive-then-activate semantics: client_row's program_a (still 'active'
-- from the visibility test above) must be archived by this call.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT public.instantiate_template(:'program_tmpl'::uuid, :'client_row'::uuid, CURRENT_DATE) AS instantiated_id \gset
RESET ROLE;

SELECT pg_temp.expect('instantiate_template archives client_row''s previous active program', 1,
  format('SELECT count(*) FROM public.programs WHERE id = %L AND state = ''archived''', :'program_a'));

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
UPDATE public.program_exercises SET target_reps_min = 1
 WHERE program_id = :'instantiated_id' AND exercise_id = :'exercise_global';
RESET ROLE;

SELECT pg_temp.expect('the instantiated copy reflects the mutation', 1,
  format('SELECT count(*) FROM public.program_exercises WHERE program_id = %L AND target_reps_min = 1', :'instantiated_id'));
SELECT pg_temp.expect('the original template is unchanged after mutating its copy', 1,
  format('SELECT count(*) FROM public.program_exercises WHERE program_id = %L AND target_reps_min = 8', :'program_tmpl'));

-- ─────────────────────────────────────────────────────────────────────────────
-- create_program + assign_program — a second, independent exercise of
-- archive-then-activate, chained onto the program instantiate_template just
-- created (which is still 'active' on client_row at this point).
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT public.create_program('Fresh Program To Assign', 2::smallint) AS fresh_program_id \gset
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT public.assign_program(:'fresh_program_id'::uuid, :'client_row'::uuid, CURRENT_DATE);
RESET ROLE;

SELECT pg_temp.expect('assign_program activates the fresh program', 1,
  format('SELECT count(*) FROM public.programs WHERE id = %L AND state = ''active''', :'fresh_program_id'));
SELECT pg_temp.expect('assign_program archived the program it replaced (the template instantiation)', 1,
  format('SELECT count(*) FROM public.programs WHERE id = %L AND state = ''archived''', :'instantiated_id'));

-- ─────────────────────────────────────────────────────────────────────────────
-- save_program — a real round trip, not just a permission check: replace the
-- fresh program's tree and confirm the numeric(3,1) RPE cast survives.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT public.save_program(:'fresh_program_id'::uuid, format(
  '{"weeks":[{"week_number":1,"label":"W1","days":[{"day_number":1,"label":"Day 1","blocks":[{"sort_order":0,"block_type":"working","exercises":[{"sort_order":0,"exercise_id":"%s","target_sets":4,"target_reps_min":6,"target_reps_max":8,"target_rpe":7.5}]}]}]},{"week_number":2,"label":"W2","days":[]}]}',
  :'exercise_global')::jsonb);
RESET ROLE;

SELECT pg_temp.expect('save_program replaced the fresh program''s tree with exactly one exercise row', 1,
  format('SELECT count(*) FROM public.program_exercises WHERE program_id = %L', :'fresh_program_id'));
SELECT pg_temp.expect('save_program''s exercise row carries the RPE value through the numeric(3,1) cast', 1,
  format('SELECT count(*) FROM public.program_exercises WHERE program_id = %L AND target_rpe = 7.5', :'fresh_program_id'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Positive controls — the people who SHOULD have access still do.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('PT A sees the global exercise', 1,
  format('SELECT count(*) FROM public.exercises WHERE id = %L', :'exercise_global'));
SELECT pg_temp.expect('program_tree resolves non-null for PT A''s own program', 1,
  format('SELECT CASE WHEN public.program_tree(%L) IS NOT NULL THEN 1 ELSE 0 END::bigint', :'fresh_program_id'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
SELECT pg_temp.expect('Client A (via client_row) sees the fresh active assigned program', 1,
  format('SELECT count(*) FROM public.programs WHERE id = %L', :'fresh_program_id'));
RESET ROLE;

ROLLBACK;

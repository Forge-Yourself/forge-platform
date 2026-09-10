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

INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
VALUES
  (:'pt_a',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-pt-a@forge-test.local',     '{"role":"pt","display_name":"PT A"}'),
  (:'pt_b',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-pt-b@forge-test.local',     '{"role":"pt","display_name":"PT B"}'),
  (:'client_a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-client-a@forge-test.local', '{"role":"client","display_name":"Client A"}'),
  (:'client_b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-client-b@forge-test.local', '{"role":"client","display_name":"Client B"}');

INSERT INTO public.clients (id, pt_user_id, client_user_id, state)
VALUES (:'client_row', :'pt_a', :'client_a', 'active');

INSERT INTO public.intake_forms (id, client_id, state)
VALUES (:'intake_row', :'client_row', 'in_progress');

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

ROLLBACK;

# M4b · Offline and Live Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PT or client can start and log a workout with no signal, behind a server-controlled beta switch that defaults off. Queued writes replay through the four M4a RPCs when the signal returns. A PT and a client on the same session see each other's sets live.

**Architecture:** Migration `0016` lets `start_workout_session` take a client-generated id and device timestamps, lets `log_set` / `delete_set` append to completed sessions, adds broadcast triggers plus a `realtime.messages` policy, and adds the feature switch (`app_config` plus `users.offline_logging_beta` plus two admin RPCs). `packages/shared/src/offline/` holds everything with logic in it: types, error classifier, availability resolver, set ordering, and `SyncEngine` over a five-method `KvStore`. The mobile app adds two thin `KvStore` adapters (SQLite native, IndexedDB web), an `OfflineProvider`, read-through caching on the existing fetchers, a realtime channel hook, and three screens' worth of UI.

**Tech Stack:** Supabase Postgres (plpgsql, Realtime broadcast), zod 4, vitest 2, Expo SDK 57 / expo-router, `expo-sqlite`, `@react-native-community/netinfo`, IndexedDB, Next.js 16 App Router (server actions).

**Spec:** `docs/superpowers/specs/2026-09-19-m4b-offline-mirror-design.md`. Read it first. Section numbers below refer to it.

---

## Context

- M4a's four RPCs live in `supabase/migrations/0015_m4a_logging.sql`. `start_workout_session(UUID, UUID)` and `complete_workout_session(UUID, INTEGER, TEXT)` change signature here, so both are `DROP`ped and re-created. Leaving the old signature would create a PostgREST overload that errors as ambiguous. `log_set` and `delete_set` keep their signatures and are `CREATE OR REPLACE`d.
- `workout_sessions.id` defaults to `uuid_v7()` (the function is named `uuid_v7`, not `uuidv7`).
- `realtime.broadcast_changes(topic_name, event_name, operation, table_name, table_schema, new, old, level)` and `realtime.topic()` exist on the live project. `realtime.messages` has **no** policies today. `realtime.send` (called by `broadcast_changes`) swallows its own insert errors as a WARNING, so a broadcast can never fail a `log_set`.
- `users` UPDATE is column-granted in `0003_rls.sql:141` (`display_name … onboarding_completed`). A new column is therefore not self-writable unless granted. That is how `offline_logging_beta` stays admin-only.
- Harness (`db/rls_assertions.sql`): one `BEGIN;` at the top, `ROLLBACK;` as the last line. Helpers are `pg_temp.expect(label, n, query)`, `pg_temp.expect_raises(label, sql)`, `pg_temp.expect_rls_block(label, sql)` and `pg_temp.act_as(uuid)` inside `SET LOCAL ROLE authenticated; … RESET ROLE;`. Fixtures: `:'pt_a'`, `:'pt_b'`, `:'client_a'`, `:'client_row'` (pt_a ↔ client_a), `:'admin_a'`, `:'exercise_global'`. By the end of the M4a block both of client_row's sessions are `completed`, so a new start creates a fresh one.
- The M4a block asserts `log_set refuses a completed session`. D6 reverses that, so Task 1 rewrites that one assertion.
- Mobile: `lib/logging/sessionRpc.ts` wraps the four RPCs. `lib/logging/useSession.ts`, `StartSessionSheet.tsx`, `useInProgressSession.ts`, `lib/clients/useClientList.ts`, `lib/clients/useClientDetail.ts` and the `ClientHome` effect in `app/(app)/(tabs)/index.tsx` are the read paths that must work offline. `app/(app)/sessions/[id]/index.tsx` is the only writer.
- Mobile has no test runner. Anything with a branch in it goes in `packages/shared` under vitest; mobile files stay thin adapters.
- The shared `SetRow` / `SessionRow` types come from `Database` in `packages/shared/src/database.types.ts`.
- `lib/deviceStore.ts` has `getStoredValue` / `setStoredValue` (SecureStore native, localStorage web).
- Metro picks `file.web.ts` over `file.ts` on web. That is how `expo-sqlite` stays out of the web bundle.
- Conventions (unchanged from M4a): every `setState` inside a `.then()` in effects, a `cancelled` flag per effect, `useFocusEffect` for lists a pushed screen mutates (N12), and screens own their back control (N1).
- Test accounts: `pt.test@forge.dev`, `client.test@forge.dev`, `pt2.test@forge.dev`, `admin.test@forge.dev`; password `ForgeTest2026!`.
- Toolchain: PowerShell for pnpm with `$env:COREPACK_INTEGRITY_KEYS='0'`, Node 24 (`nvm use 24.15.0`), Supabase CLI at `& "$env:APPDATA\nvm\v24.15.0\supabase.cmd"`, psql per CLAUDE.md (`PGPASSWORD` + `-w`).

### Corrections this plan makes to the spec

- **§4.1 device timestamps.** Replaying an offline `start` hours later would stamp `started_at = NOW()` at replay time, and a replayed `complete` would record a one-minute session. So `start_workout_session` also takes `p_started_at TIMESTAMPTZ` and `complete_workout_session` takes `p_completed_at TIMESTAMPTZ`. Both are clamped server-side into `[NOW() − 24 h, NOW()]`, and `completed_at` is never before `started_at`. The device clock is trusted for 24 hours and no further.
- **§4.3 admin writes.** Admin pages run under the admin's own session, not the service role. Two `SECURITY DEFINER` RPCs guarded by `is_admin()`, `admin_set_offline_logging(p_mode)` and `admin_set_offline_beta(p_user_id, p_enabled)`, called from Next.js server actions. They are harness-testable, and no service-role key enters `/admin`.
- **§5.1 store shape.** `LocalStore` becomes `KvStore`: `get`, `all`, an atomic `write(batch)`, and `clear`, over six logical tables (`outbox`, `sessions`, `sets`, `aliases`, `cache`, `meta`). Every rule (coalescing, rewrite, merge, pruning) lives in `SyncEngine` in shared, and the two adapters are about 60 lines each. IndexedDB transactions cannot span `await`s, so an atomic batch is the only primitive both backends share honestly.
- **§5.3 coalescing vs. in-flight.** Coalescing never touches the entry currently being sent. Collapsing a `log_set` + `delete_set` pair while the `log_set` is on the wire would leave an orphan set on the server.
- **§5.3 always through the outbox.** With the switch effective, every write goes through the outbox, online or not, and the engine drains immediately. One path, not two. The PR moment arrives through an engine event when the set syncs.
- **§6 cold offline boot.** `AuthProvider` loads `public.users` over the network on `INITIAL_SESSION`. Offline, that returns nothing and the gate has no profile. When the device toggle is on, `AuthProvider` falls back to the last profile it cached for that user id. Without this, scope B's basement case never reaches the Clients tab.
- **§7 PR moment offline.** A set logged offline shows no PR banner at tap time. It shows when the set syncs if the session screen is still mounted; otherwise the completed summary lists it. Stated limitation.
- **§7 Add exercise offline.** The picker is the library, which is online-only, so an offline session logs the programmed day's exercises only. The rail's "+" shows the offline empty state.

---

## File structure

**Database**
- Create `supabase/migrations/0016_m4b_offline_mirror.sql`: RPC changes, broadcast triggers, realtime policy, `app_config`, `users.offline_logging_beta`, admin RPCs.
- Modify `db/rls_assertions.sql`: flip one M4a assertion, append the M4b block before `ROLLBACK;`.
- Regenerate `packages/shared/src/database.types.ts`.

**Shared (`packages/shared/src/offline/`)**
- `types.ts`: row aliases, RPC arg types, `OutboxOp`, `OutboxEntry`, `RpcError`, `RpcResult`, `Transport`, `KvStore`.
- `classify.ts` + `classify.test.ts`: `isNetworkError`, `classifyError`, `backoffMs`.
- `availability.ts` + `availability.test.ts`: `parseOfflineMode`, `resolveOfflineLogging`.
- `order.ts` + `order.test.ts`: `ulidTimeMs`, `orderSets`, `displayNumbers`.
- `memoryStore.ts`: `MemoryKvStore`.
- `engine.ts` + `engine.test.ts`: `SyncEngine`.
- `index.ts`; modify `packages/shared/src/index.ts`.
- Modify `packages/shared/src/i18n/en.json`, `ar.json`.

**Mobile (`apps/mobile/src/`)**
- Create `lib/offline/kvStore.ts` (SQLite), `lib/offline/kvStore.web.ts` (IndexedDB).
- Create `lib/offline/engine.ts`: the one `SyncEngine` per process, plus the deviceStore keys.
- Create `lib/offline/transport.ts`: `Transport` over `sessionRpc`.
- Create `lib/offline/offlineContext.ts`: context type, default, `useOffline`.
- Create `lib/offline/OfflineProvider.tsx`: availability, connectivity, drain scheduling, cache warming trigger.
- Create `lib/offline/cachedFetch.ts`: read-through cache helper and the `OFFLINE` sentinel.
- Create `lib/offline/warmCache.ts`, `lib/offline/fetchLastSets.ts`.
- Create `lib/offline/loggingRepo.ts`: the queued half of the four writes.
- Create `lib/offline/useSessionChannel.ts`: realtime mirror.
- Create `lib/offline/OfflineStatusChip.tsx`, `lib/offline/NeedsConnection.tsx`.
- Create `lib/logging/loadWeek.ts` (moved out of the start sheet), `lib/home/fetchClientHome.ts` (extracted from `ClientHome`).
- Create `ui/OfflineChip.tsx`, `ui/LiveBadge.tsx`; modify `ui/index.ts`.
- Create `app/(app)/sync-queue.tsx`.
- Modify `lib/logging/sessionRpc.ts`, `lib/logging/sessionModel.ts`, `lib/logging/loggingErrors.ts`, `lib/logging/useSession.ts`, `lib/logging/StartSessionSheet.tsx`, `lib/logging/useInProgressSession.ts`, `lib/clients/useClientList.ts`, `lib/clients/useClientDetail.ts`, `lib/auth/AuthProvider.tsx`.
- Modify `app/_layout.tsx` (provider), `app/(app)/sessions/[id]/index.tsx`, `app/(app)/(tabs)/index.tsx`, `app/(app)/(tabs)/clients.tsx`, `app/(app)/(tabs)/library.tsx`, `app/(app)/(tabs)/programs.tsx`, `app/(app)/my-sessions.tsx`, `app/(app)/clients/[id]/index.tsx`, `app/(app)/clients/[id]/sessions.tsx`, `app/(app)/settings/index.tsx`.
- Modify `package.json`, `app.json`.

**Web (`apps/web/app/admin/`)**
- Create `settings/page.tsx`, `settings/actions.ts`.
- Modify `users/[id]/page.tsx` (+ `users/[id]/actions.ts`), `sessions/[id]/page.tsx`, `page.tsx` (nav link).

**Docs**
- `CLAUDE.md`, `docs/DESIGN_SYSTEM_GAPS.md`, `docs/PITFALLS.md` (if a new class of bug shows up), this plan's As-built section.

---

## Task 1 · Harness: the failing M4b block

**Files:**
- Modify: `db/rls_assertions.sql`

- [x] **Step 1: Flip the M4a completed-session assertion**

Replace this block (in the M4a section, right after `workout_complete was audited once`):

```sql
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect_raises('log_set refuses a completed session',
  format('SELECT public.log_set(''01J8RZ0000000000000000DDDD'', %L::uuid, %L::uuid, 9, 1, 1, NULL, NULL, FALSE, NULL)', :'session_id', :'exercise_global'));
RESET ROLE;
```

with:

```sql
-- M4b D6 reversed this: a late set appends to a completed session.
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT public.log_set('01J8RZ0000000000000000DDDD', :'session_id'::uuid, :'exercise_global'::uuid, 9, 1, 1, NULL, NULL, FALSE, NULL);
SELECT pg_temp.expect('log_set appends a late set to a completed session', 1,
  format('SELECT count(*) FROM public.sets s JOIN public.workout_sessions ws ON ws.id = s.workout_session_id WHERE s.id = ''01J8RZ0000000000000000DDDD'' AND ws.id = %L AND ws.status = ''completed''', :'session_id'));
RESET ROLE;
```

- [x] **Step 2: Append the M4b block immediately above the final `ROLLBACK;`**

```sql
-- ═════════════════════════════════════════════════════════════════════════════
-- M4b: offline start by client-generated id, device timestamps clamped to
-- 24 h, late sets on completed sessions, the broadcast mirror and its topic
-- authorization, and the offline-logging switch. Every client_row session from
-- the M4a block is completed by now, so the first start below creates a fresh one.
-- ═════════════════════════════════════════════════════════════════════════════
\set m4b_s1       '0192f000-0000-7000-8000-00000000b001'
\set m4b_s2       '0192f000-0000-7000-8000-00000000b002'
\set m4b_s3       '0192f000-0000-7000-8000-00000000b003'
\set client_row_2 '0192f000-0000-7000-8000-00000000c002'
\set ulid_e1      '01J8RZ0000000000000000EEE1'
\set ulid_e2      '01J8RZ0000000000000000EEE2'

-- A second client of PT A, to prove a p_id cannot be borrowed across clients.
INSERT INTO public.clients (id, pt_user_id, state, invite_email, invite_name)
VALUES (:'client_row_2', :'pt_a', 'invited', 'm4b-second@forge-test.local', 'Second');

-- ─────────────────────────────────────────────────────────────────────────────
-- start_workout_session(p_id, p_started_at)
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
SELECT (public.start_workout_session(:'client_row'::uuid, NULL, :'m4b_s1'::uuid, NOW() - interval '2 hours')).id AS m4b_first \gset
SELECT pg_temp.expect('an offline start keeps the client-generated id', 1,
  format('SELECT CASE WHEN %L::uuid = %L::uuid THEN 1 ELSE 0 END::bigint', :'m4b_first', :'m4b_s1'));
SELECT pg_temp.expect('started_at honours a device time inside 24 h', 1,
  format('SELECT count(*) FROM public.workout_sessions WHERE id = %L AND started_at < NOW() - interval ''110 minutes''', :'m4b_s1'));
SELECT public.start_workout_session(:'client_row'::uuid, NULL, :'m4b_s1'::uuid, NULL);
SELECT pg_temp.expect('replaying the same p_id yields one session', 1,
  format('SELECT count(*) FROM public.workout_sessions WHERE id = %L', :'m4b_s1'));
SELECT pg_temp.expect('a different p_id while one is in progress returns the existing session', 1,
  format('SELECT CASE WHEN (public.start_workout_session(%L::uuid, NULL, %L::uuid, NULL)).id = %L::uuid THEN 1 ELSE 0 END::bigint',
         :'client_row', :'m4b_s2', :'m4b_s1'));
SELECT pg_temp.expect('the losing p_id created no row', 0,
  format('SELECT count(*) FROM public.workout_sessions WHERE id = %L', :'m4b_s2'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect_raises('a p_id owned by another client is refused',
  format('SELECT public.start_workout_session(%L::uuid, NULL, %L::uuid, NULL)', :'client_row_2', :'m4b_s1'));
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Late sets (D6) and complete(p_completed_at)
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
SELECT public.log_set(:'ulid_e1', :'m4b_s1'::uuid, :'exercise_global'::uuid, 1, 50, 5, NULL, NULL, FALSE, 'harness');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT public.complete_workout_session(:'m4b_s1'::uuid, NULL, NULL, NOW() - interval '30 minutes');
SELECT pg_temp.expect('duration uses the device completion time (2 h start, 30 min ago finish)', 1,
  format('SELECT count(*) FROM public.workout_sessions WHERE id = %L AND duration_min BETWEEN 85 AND 95', :'m4b_s1'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
SELECT pg_temp.expect('a late 50-rep set is a reps PR', 1,
  format('SELECT cardinality((public.log_set(%L, %L::uuid, %L::uuid, 2, 1, 50, NULL, NULL, FALSE, ''harness'')).new_prs)::bigint',
         :'ulid_e2', :'m4b_s1', :'exercise_global'));
SELECT pg_temp.expect('the session is still completed after a late set', 1,
  format('SELECT count(*) FROM public.workout_sessions WHERE id = %L AND status = ''completed''', :'m4b_s1'));
SELECT public.delete_set(:'ulid_e2');
SELECT pg_temp.expect('the client can delete their own late set on a completed session', 0,
  format('SELECT count(*) FROM public.sets WHERE id = %L', :'ulid_e2'));

SELECT public.start_workout_session(:'client_row'::uuid, NULL, :'m4b_s3'::uuid, NOW() - interval '3 days');
SELECT pg_temp.expect('a device start time older than 24 h is clamped', 1,
  format('SELECT count(*) FROM public.workout_sessions WHERE id = %L AND started_at >= NOW() - interval ''24 hours 1 minute''', :'m4b_s3'));
SELECT public.complete_workout_session(:'m4b_s3'::uuid, NULL, NULL, NOW() - interval '5 days');
SELECT pg_temp.expect('completed_at is never before started_at', 1,
  format('SELECT count(*) FROM public.workout_sessions WHERE id = %L AND completed_at >= started_at', :'m4b_s3'));
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Broadcast mirror. realtime.topic() reads the realtime.topic setting, which
-- is how Realtime itself authorizes a private channel join.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.expect('a set insert broadcast on the session topic', 1,
  format('SELECT CASE WHEN count(*) > 0 THEN 1 ELSE 0 END::bigint FROM realtime.messages WHERE topic = %L AND extension = ''broadcast''',
         'session:' || :'m4b_s1'));

SET LOCAL ROLE authenticated;
SELECT set_config('realtime.topic', 'session:' || :'m4b_s1', TRUE);
SELECT pg_temp.act_as(:'pt_b');
SELECT pg_temp.expect('PT B cannot read the session topic', 0,
  format('SELECT count(*) FROM realtime.messages WHERE topic = %L', 'session:' || :'m4b_s1'));
SELECT pg_temp.act_as(:'client_a');
SELECT pg_temp.expect('the client reads the session topic', 1,
  format('SELECT CASE WHEN count(*) > 0 THEN 1 ELSE 0 END::bigint FROM realtime.messages WHERE topic = %L', 'session:' || :'m4b_s1'));
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('the PT reads the session topic', 1,
  format('SELECT CASE WHEN count(*) > 0 THEN 1 ELSE 0 END::bigint FROM realtime.messages WHERE topic = %L', 'session:' || :'m4b_s1'));
SELECT pg_temp.act_as(:'admin_a');
SELECT pg_temp.expect('an admin reads the session topic', 1,
  format('SELECT CASE WHEN count(*) > 0 THEN 1 ELSE 0 END::bigint FROM realtime.messages WHERE topic = %L', 'session:' || :'m4b_s1'));
SELECT pg_temp.act_as(:'client_a');
SELECT pg_temp.expect_rls_block('nobody can broadcast on a session topic',
  format('INSERT INTO realtime.messages (topic, extension, payload, event, private) VALUES (%L, ''broadcast'', ''{}'', ''x'', TRUE)',
         'session:' || :'m4b_s1'));
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Offline-logging switch
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('authenticated reads the offline_logging mode, default off', 1,
  $q$SELECT count(*) FROM public.app_config WHERE key = 'offline_logging' AND value = '"off"'::jsonb$q$);
SELECT pg_temp.expect_rls_block('authenticated cannot write app_config',
  $q$UPDATE public.app_config SET value = '"all"'::jsonb WHERE key = 'offline_logging'$q$);
SELECT pg_temp.expect_rls_block('a user cannot grant themselves the offline beta',
  format('UPDATE public.users SET offline_logging_beta = TRUE WHERE id = %L', :'pt_a'));
SELECT pg_temp.expect_raises('a PT cannot change the offline mode',
  $q$SELECT public.admin_set_offline_logging('all')$q$);
SELECT pg_temp.expect_raises('a PT cannot grant the offline beta',
  format('SELECT public.admin_set_offline_beta(%L::uuid, TRUE)', :'pt_a'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'admin_a');
SELECT public.admin_set_offline_logging('beta');
SELECT public.admin_set_offline_beta(:'pt_a'::uuid, TRUE);
SELECT pg_temp.expect_raises('an unknown offline mode is refused',
  $q$SELECT public.admin_set_offline_logging('sometimes')$q$);
RESET ROLE;
SELECT pg_temp.expect('the admin set the mode to beta', 1,
  $q$SELECT count(*) FROM public.app_config WHERE key = 'offline_logging' AND value = '"beta"'::jsonb$q$);
SELECT pg_temp.expect('the admin granted PT A the offline beta', 1,
  format('SELECT count(*) FROM public.users WHERE id = %L AND offline_logging_beta', :'pt_a'));
```

- [x] **Step 3: Run the harness and confirm it fails at the first M4b-dependent line**

```bash
set -a && . ./.env && set +a
export PGURL="postgresql://postgres.qkmgmzhrwduvigccwgcz@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -w -v ON_ERROR_STOP=1 -f db/rls_assertions.sql 2>&1 | tail -5
```

Expected: every pre-M4b `pass` line prints, then a failure at `log_set appends a late set to a completed session` (the RPC still raises `session is not in progress`). Everything runs inside `ROLLBACK`, so nothing persists.

- [x] **Step 4: Commit**

```bash
git add db/rls_assertions.sql
git commit -m "test(db): M4b harness block (failing until 0016)"
```

---

## Task 2 · Migration 0016: RPC changes

**Files:**
- Create: `supabase/migrations/0016_m4b_offline_mirror.sql`

- [x] **Step 1: Write the header and the new `start_workout_session`**

```sql
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
```

- [x] **Step 2: Append `log_set` with the widened status check**

The body is `0015`'s with one changed condition. It is repeated in full because `CREATE OR REPLACE` replaces the whole body.

```sql
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
```

(The grants from `0015` survive `CREATE OR REPLACE`; no re-grant needed.)

- [x] **Step 3: Append `delete_set` and the new `complete_workout_session`**

```sql
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
```

Note on the clamp: when `started_at` is itself older than 24 h (a session left open for days), `GREATEST(v_started, NOW() − 24 h, …)` still floors at `NOW() − 24 h`, which is after `v_started`, so `completed_at ≥ started_at` holds.

- [x] **Step 4: Commit (migration is not applied until Task 4)**

```bash
git add supabase/migrations/0016_m4b_offline_mirror.sql
git commit -m "feat(db): 0016 RPCs — client session id, device times, late sets"
```

---

## Task 3 · Migration 0016: mirror and switch

**Files:**
- Modify: `supabase/migrations/0016_m4b_offline_mirror.sql` (append before nothing; the file has no `COMMIT;` yet)

- [x] **Step 1: Append the broadcast triggers and topic policy**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Live mirror. Triggers on the partitioned parent fire for every partition.
-- The table name is passed as a literal: TG_TABLE_NAME would be the partition
-- (sets_2026_09), which the app should never need to know about.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.broadcast_set_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.broadcast_changes(
    'session:' || COALESCE(NEW.workout_session_id, OLD.workout_session_id)::TEXT,
    TG_OP, TG_OP, 'sets', 'public', NEW, OLD
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sets_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.sets
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_set_change();

CREATE OR REPLACE FUNCTION public.broadcast_session_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.broadcast_changes(
    'session:' || NEW.id::TEXT, TG_OP, TG_OP, 'workout_sessions', 'public', NEW, OLD
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_workout_sessions_broadcast
  AFTER UPDATE ON public.workout_sessions
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_session_change();

REVOKE EXECUTE ON FUNCTION public.broadcast_set_change()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.broadcast_session_change() FROM PUBLIC, anon, authenticated;

-- Private channel authorization: Realtime runs this SELECT as the joining
-- user with realtime.topic() set to the channel name. No INSERT policy.
CREATE POLICY forge_session_topic_read ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND realtime.topic() ~ '^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (
      public.is_session_participant(substring(realtime.topic() FROM 9)::UUID)
      OR public.is_admin()
    )
  );
```

- [x] **Step 2: Append the switch and commit the transaction**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Offline-logging switch (spec §4.3).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.app_config (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID                              -- app-enforced FK -> users.id
);
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_config_select ON public.app_config FOR SELECT TO authenticated USING (TRUE);
REVOKE INSERT, UPDATE, DELETE ON public.app_config FROM anon, authenticated;

INSERT INTO public.app_config (key, value) VALUES ('offline_logging', '"off"'::jsonb);

-- Deliberately absent from 0003's GRANT UPDATE (…) ON users column list, so a
-- user can read it on their own row but never set it.
ALTER TABLE public.users ADD COLUMN offline_logging_beta BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.admin_set_offline_logging(p_mode TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_mode NOT IN ('off', 'beta', 'all') THEN
    RAISE EXCEPTION 'unknown offline mode' USING ERRCODE = '23514';
  END IF;
  UPDATE public.app_config
     SET value = to_jsonb(p_mode), updated_at = NOW(), updated_by = auth.uid()
   WHERE key = 'offline_logging';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_offline_beta(p_user_id UUID, p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.users SET offline_logging_beta = p_enabled, updated_at = NOW() WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_offline_logging(TEXT)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_offline_beta(UUID, BOOLEAN)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_offline_logging(TEXT)        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_set_offline_beta(UUID, BOOLEAN)  TO authenticated;

COMMIT;
```

- [x] **Step 3: Commit**

```bash
git add supabase/migrations/0016_m4b_offline_mirror.sql
git commit -m "feat(db): 0016 broadcast mirror, topic policy, offline switch"
```

---

## Task 4 · Apply, prove, regenerate types

- [x] **Step 1: Push the migration**

```powershell
$env:COREPACK_INTEGRITY_KEYS='0'
& "$env:APPDATA\nvm\v24.15.0\supabase.cmd" db push
& "$env:APPDATA\nvm\v24.15.0\supabase.cmd" migration list
```

Expected: `0016_m4b_offline_mirror` listed on both local and remote. If the push fails with `must be owner of table messages`, the `realtime.messages` policy needs the `supabase_admin` path. Stop and report it; do not work around it with a service-role broadcast.

- [x] **Step 2: Run the harness, expect every assertion to pass**

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -w -v ON_ERROR_STOP=1 -f db/rls_assertions.sql 2>&1 | grep -c "^psql.*pass\|NOTICE:  pass"
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -w -v ON_ERROR_STOP=1 -f db/rls_assertions.sql 2>&1 | tail -3
```

Expected: no `FAIL`, last line `ROLLBACK`. If only `a set insert broadcast on the session topic` fails, today's `realtime.messages` partition does not exist yet (Realtime creates them). Check with `SELECT tablename FROM pg_tables WHERE schemaname='realtime' AND tablename LIKE 'messages_%' ORDER BY 1 DESC LIMIT 3;` and record the result in the As-built section. Do not delete the assertion.

- [x] **Step 3: Regenerate types**

```powershell
pnpm types:gen
git diff --stat packages/shared/src/database.types.ts
```

Expected: `start_workout_session` Args gain `p_id?` and `p_started_at?`; `complete_workout_session` gains `p_completed_at?`; `app_config` table; `users.offline_logging_beta`; two `admin_set_*` functions.

- [x] **Step 4: Typecheck the monorepo; fix the one expected break**

```powershell
pnpm -r typecheck
```

Expected: pass. The new params are optional, so `sessionRpc.ts` still compiles.

- [x] **Step 5: Commit**

```bash
git add packages/shared/src/database.types.ts
git commit -m "chore(shared): regenerate types for 0016"
```

---
## Task 5 · Shared: offline types, error classifier, availability

**Files:**
- Create: `packages/shared/src/offline/types.ts`, `classify.ts`, `classify.test.ts`, `availability.ts`, `availability.test.ts`, `index.ts`
- Modify: `packages/shared/src/index.ts`

- [x] **Step 1: Write `types.ts`**

```ts
import type { Database } from '../database.types';

export type SessionRow = Database['public']['Tables']['workout_sessions']['Row'];
export type SetRow = Database['public']['Tables']['sets']['Row'];

/** The exact RPC arguments. The outbox stores these verbatim and replays them. */
export type StartArgs = {
  p_client_id: string;
  p_program_day_id: string | null;
  p_id: string;
  p_started_at: string;
};
export type LogSetArgs = {
  p_id: string;
  p_session_id: string;
  p_exercise_id: string;
  p_set_number: number;
  p_weight_kg: number | null;
  p_reps: number | null;
  p_rpe: number | null;
  p_notes: string | null;
  p_is_warmup: boolean;
  p_device_id: string | null;
};
export type DeleteSetArgs = { p_id: string };
export type CompleteArgs = {
  p_session_id: string;
  p_rating: number | null;
  p_notes: string | null;
  p_completed_at: string;
};

/** `sessionId` is the local session id the op belongs to; the engine rewrites it on a merge. */
export type OutboxOp =
  | { op: 'start'; sessionId: string; args: StartArgs }
  | { op: 'log_set'; sessionId: string; args: LogSetArgs }
  | { op: 'delete_set'; sessionId: string; args: DeleteSetArgs }
  | { op: 'complete'; sessionId: string; args: CompleteArgs };

export type RpcError = { code: string; message: string };
export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: RpcError };

export type OutboxEntry = OutboxOp & {
  seq: number;
  attempts: number;
  lastError: RpcError | null;
  state: 'pending' | 'failed';
  createdAt: string;
};

export interface Transport {
  start(args: StartArgs): Promise<RpcResult<SessionRow>>;
  logSet(args: LogSetArgs): Promise<RpcResult<{ set: SetRow; newPrs: string[] }>>;
  deleteSet(args: DeleteSetArgs): Promise<RpcResult<null>>;
  complete(args: CompleteArgs): Promise<RpcResult<SessionRow>>;
  /** One session refresh. True when a fresh access token is now in place. */
  refreshAuth(): Promise<boolean>;
}

export type KvTable = 'outbox' | 'sessions' | 'sets' | 'aliases' | 'cache' | 'meta';
/** `value: null` deletes the key. */
export type KvWrite = { table: KvTable; key: string; value: unknown };

/**
 * The whole storage seam. Adapters (SQLite native, IndexedDB web, memory in
 * tests) implement exactly this; every rule lives above it in SyncEngine.
 * `all` returns rows sorted by key ascending. `write` is atomic.
 */
export interface KvStore {
  get<T>(table: KvTable, key: string): Promise<T | null>;
  all<T>(table: KvTable): Promise<Array<{ key: string; value: T }>>;
  write(batch: readonly KvWrite[]): Promise<void>;
  clear(): Promise<void>;
}
```

- [x] **Step 2: Write the failing `classify.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { backoffMs, classifyError, isNetworkError } from './classify';

describe('isNetworkError', () => {
  it('is true for a fetch that never reached the server (web and native text)', () => {
    expect(isNetworkError({ code: '', message: 'TypeError: Failed to fetch' })).toBe(true);
    expect(isNetworkError({ code: '', message: 'Network request failed' })).toBe(true);
    expect(isNetworkError({ message: 'Load failed' })).toBe(true);
  });
  it('is false for a Postgres error and for nothing', () => {
    expect(isNetworkError({ code: '42501', message: 'network' })).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});

describe('classifyError', () => {
  it('treats an expired token as auth', () => {
    expect(classifyError({ code: 'PGRST301', message: 'JWT expired' })).toBe('auth');
    expect(classifyError({ code: 'PGRST303', message: 'JWT claims validation failed' })).toBe('auth');
  });
  it('treats anything that never reached Postgres as transient', () => {
    expect(classifyError({ code: '', message: 'Failed to fetch' })).toBe('transient');
    expect(classifyError({ code: '', message: 'AbortError' })).toBe('transient');
  });
  it('treats rule and rights failures as permanent', () => {
    for (const code of ['42501', '23514', 'P0001', '22P02', 'PGRST202']) {
      expect(classifyError({ code, message: 'x' })).toBe('permanent');
    }
  });
  it('treats connection and resource SQLSTATEs as transient', () => {
    for (const code of ['08006', '53300', '57014', '40001']) {
      expect(classifyError({ code, message: 'x' })).toBe('transient');
    }
  });
});

describe('backoffMs', () => {
  it('doubles from 2 s and caps at 60 s', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  });
});
```

- [x] **Step 3: Run it and see it fail**

```powershell
pnpm --filter @forge/shared test -- offline/classify
```

Expected: FAIL, `Cannot find module './classify'`.

- [x] **Step 4: Write `classify.ts`**

```ts
import type { RpcError } from './types';

export type ErrorClass = 'transient' | 'auth' | 'permanent';

const NETWORK = /network|failed to fetch|load failed/i;

/**
 * postgrest-js reports a request that never reached the server with an empty
 * code and the fetch TypeError text in message ("Failed to fetch" on web,
 * "Network request failed" on native, "Load failed" on Safari).
 */
export function isNetworkError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return (error.code ?? '') === '' && NETWORK.test(error.message ?? '');
}

/**
 * transient: retry the same entry later. auth: refresh the session, else
 * pause the queue until sign-in. permanent: the server said no; retrying the
 * same payload can never succeed, so the entry is parked as failed.
 */
export function classifyError(error: RpcError): ErrorClass {
  const code = error.code ?? '';
  if (code === 'PGRST301' || code === 'PGRST303') return 'auth';
  if (code === '') return 'transient';
  if (/^(22|23|42|P0)/.test(code) || code.startsWith('PGRST')) return 'permanent';
  return 'transient';
}

export function backoffMs(attempts: number): number {
  return Math.min(60_000, 2000 * 2 ** Math.max(0, attempts - 1));
}
```

- [x] **Step 5: Run it and see it pass**

```powershell
pnpm --filter @forge/shared test -- offline/classify
```

Expected: PASS, 7 tests.

- [x] **Step 6: Write the failing `availability.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { parseOfflineMode, resolveOfflineLogging } from './availability';

describe('parseOfflineMode', () => {
  it('accepts the three modes and defaults anything else to off', () => {
    expect(parseOfflineMode('beta')).toBe('beta');
    expect(parseOfflineMode('all')).toBe('all');
    expect(parseOfflineMode('off')).toBe('off');
    expect(parseOfflineMode('ALL')).toBe('off');
    expect(parseOfflineMode(null)).toBe('off');
    expect(parseOfflineMode(1)).toBe('off');
  });
});

describe('resolveOfflineLogging', () => {
  const cases: Array<[mode: 'off' | 'beta' | 'all', beta: boolean, choice: boolean, available: boolean, effective: boolean]> = [
    ['off', true, true, false, false],
    ['beta', false, true, false, false],
    ['beta', true, false, true, false],
    ['beta', true, true, true, true],
    ['all', false, false, true, false],
    ['all', false, true, true, true],
  ];
  it.each(cases)('mode %s, beta %s, choice %s → available %s, effective %s', (mode, userBeta, deviceChoice, available, effective) => {
    expect(resolveOfflineLogging({ mode, userBeta, deviceChoice })).toEqual({ available, effective });
  });
});
```

- [x] **Step 7: Run it and see it fail, then write `availability.ts`**

```ts
export type OfflineMode = 'off' | 'beta' | 'all';

/** app_config.offline_logging is JSONB; anything unexpected is off. */
export function parseOfflineMode(value: unknown): OfflineMode {
  return value === 'beta' || value === 'all' ? value : 'off';
}

/**
 * Spec §4.3. Available is the server's decision (mode, plus the per-user
 * beta flag in beta mode); effective adds the user's per-device choice.
 */
export function resolveOfflineLogging(input: {
  mode: OfflineMode;
  userBeta: boolean;
  deviceChoice: boolean;
}): { available: boolean; effective: boolean } {
  const available = input.mode === 'all' || (input.mode === 'beta' && input.userBeta);
  return { available, effective: available && input.deviceChoice };
}
```

```powershell
pnpm --filter @forge/shared test -- offline/availability
```

Expected: PASS, 7 tests.

- [x] **Step 8: Write `offline/index.ts` (it grows in Tasks 6 and 7) and export it**

```ts
export * from './types';
export * from './classify';
export * from './availability';
```

Append to `packages/shared/src/index.ts`:

```ts
export * from './offline/index';
```

- [x] **Step 9: Typecheck and commit**

```powershell
pnpm --filter @forge/shared typecheck
git add packages/shared/src/offline packages/shared/src/index.ts
git commit -m "feat(shared): offline types, error classifier, availability resolver"
```

---

## Task 6 · Shared: ULID time, set ordering, memory store

**Files:**
- Modify: `packages/shared/src/schemas/ulid.ts`, `ulid.test.ts`
- Create: `packages/shared/src/offline/order.ts`, `order.test.ts`, `memoryStore.ts`
- Modify: `packages/shared/src/offline/index.ts`

- [x] **Step 1: Add a failing decode test to `schemas/ulid.test.ts`**

Add `ulidTimeMs` to the existing `import { … } from './ulid'` line, then append:

```ts
describe('ulidTimeMs', () => {
  it('round-trips the timestamp makeUlid encoded', () => {
    const t = 1_758_000_000_123;
    expect(ulidTimeMs(makeUlid(t, new Uint8Array(10)))).toBe(t);
  });
  it('is NaN for something that is not a ULID', () => {
    expect(ulidTimeMs('nope')).toBeNaN();
  });
});
```

- [x] **Step 2: Run, see it fail, then add to `schemas/ulid.ts`**

```ts
/** The 48-bit millisecond timestamp in the first 10 chars. NaN if not a ULID. */
export function ulidTimeMs(id: string): number {
  if (!ULID_REGEX.test(id)) return Number.NaN;
  let t = 0;
  for (const ch of id.slice(0, 10)) t = t * 32 + ALPHABET.indexOf(ch);
  return t;
}
```

```powershell
pnpm --filter @forge/shared test -- schemas/ulid
```

Expected: PASS.

- [x] **Step 3: Write the failing `offline/order.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { makeUlid } from '../schemas/ulid';
import { displayNumbers, orderSets } from './order';

const id = (ms: number, r = 0) => makeUlid(ms, new Uint8Array(10).fill(r));
const set = (ms: number, exercise: string, warm = false, r = 0) => ({ id: id(ms, r), exercise_id: exercise, is_warmup: warm });

describe('orderSets', () => {
  it('orders by the client time encoded in the ULID, not arrival order', () => {
    const a = set(1000, 'x');
    const b = set(2000, 'x');
    const c = set(3000, 'x');
    expect(orderSets([c, a, b]).map((s) => s.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe('displayNumbers', () => {
  it('numbers working sets 1..n per exercise and warm-ups 0', () => {
    const w = set(500, 'x', true);
    const a = set(1000, 'x');
    const y = set(1500, 'y');
    const b = set(2000, 'x');
    expect(displayNumbers([b, y, w, a])).toEqual({ [w.id]: 0, [a.id]: 1, [b.id]: 2, [y.id]: 1 });
  });
  it('gives two devices logging "set 3" at once distinct numbers', () => {
    const pt = set(3000, 'x', false, 1);
    const client = set(3001, 'x', false, 2);
    const n = displayNumbers([client, pt]);
    expect([n[pt.id], n[client.id]]).toEqual([1, 2]);
  });
});
```

- [x] **Step 4: Run, see it fail, then write `offline/order.ts`**

```ts
type Orderable = { id: string; exercise_id: string; is_warmup: boolean };

/**
 * Spec D10. A ULID sorts lexically by the millisecond it was minted on the
 * device, so this is client-time order however late a set reached the server.
 */
export function orderSets<T extends { id: string }>(sets: readonly T[]): T[] {
  return [...sets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * What the screen prints as "Set N". set_number as stored is whatever the
 * device computed and may collide when two devices log at once; this never does.
 */
export function displayNumbers(sets: readonly Orderable[]): Record<string, number> {
  const out: Record<string, number> = {};
  const counts = new Map<string, number>();
  for (const s of orderSets(sets)) {
    if (s.is_warmup) {
      out[s.id] = 0;
      continue;
    }
    const n = (counts.get(s.exercise_id) ?? 0) + 1;
    counts.set(s.exercise_id, n);
    out[s.id] = n;
  }
  return out;
}
```

```powershell
pnpm --filter @forge/shared test -- offline/order
```

Expected: PASS, 3 tests.

- [x] **Step 5: Write `offline/memoryStore.ts`**

```ts
import type { KvStore, KvTable, KvWrite } from './types';

/** KvStore for tests. structuredClone so callers can never mutate stored rows by reference. */
export class MemoryKvStore implements KvStore {
  private readonly tables = new Map<KvTable, Map<string, unknown>>();

  private table(name: KvTable): Map<string, unknown> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  async get<T>(table: KvTable, key: string): Promise<T | null> {
    const v = this.table(table).get(key);
    return v === undefined ? null : (structuredClone(v) as T);
  }

  async all<T>(table: KvTable): Promise<Array<{ key: string; value: T }>> {
    return [...this.table(table).entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => ({ key, value: structuredClone(value) as T }));
  }

  async write(batch: readonly KvWrite[]): Promise<void> {
    for (const w of batch) {
      if (w.value === null) this.table(w.table).delete(w.key);
      else this.table(w.table).set(w.key, structuredClone(w.value));
    }
  }

  async clear(): Promise<void> {
    this.tables.clear();
  }
}
```

- [x] **Step 6: Export and commit**

Append to `offline/index.ts`:

```ts
export * from './order';
export * from './memoryStore';
```

```powershell
pnpm --filter @forge/shared typecheck
pnpm --filter @forge/shared test
git add packages/shared/src
git commit -m "feat(shared): ULID time decode, client-time set ordering, memory KvStore"
```

---

## Task 7 · Shared: SyncEngine

**Files:**
- Create: `packages/shared/src/offline/engine.ts`, `engine.test.ts`
- Modify: `packages/shared/src/offline/index.ts`

- [x] **Step 1: Write the failing `engine.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { SyncEngine, type EngineEvent } from './engine';
import { MemoryKvStore } from './memoryStore';
import type { CompleteArgs, DeleteSetArgs, LogSetArgs, RpcResult, SessionRow, SetRow, StartArgs, Transport } from './types';

const L = '00000000-0000-4000-8000-00000000000a';
const S = '00000000-0000-4000-8000-00000000000b';
const OTHER = '00000000-0000-4000-8000-00000000000c';
const CLIENT = '00000000-0000-4000-8000-0000000000c1';
const EX = '00000000-0000-4000-8000-0000000000e1';
const U1 = '01J8RZ0000000000000000AAA1';
const U2 = '01J8RZ0000000000000000AAA2';

function sessionRow(id: string, status = 'in_progress'): SessionRow {
  return {
    id, client_id: CLIENT, status, booking_id: null, completed_at: null, created_at: '2026-09-19T10:00:00Z',
    day_label: null, day_number: null, duration_min: null, gym_id: null, is_pt_led: true, logged_by_user_id: 'u',
    program_day_id: null, pt_notes: null, rating: null, scheduled_date: null, session_notes: null,
    started_at: '2026-09-19T10:00:00Z', updated_at: '2026-09-19T10:00:00Z', week_number: null,
  };
}

function setRow(id: string, sessionId: string, weight = 100): SetRow {
  return {
    id, workout_session_id: sessionId, exercise_id: EX, set_number: 1, weight_kg: weight, reps: 8, rpe: null,
    notes: null, distance_m: null, duration_sec: null, tempo_actual: null, is_warmup: false, is_drop_set: false,
    is_failure: false, is_synced: true, synced_at: null, conflict_resolved: false, device_id: null,
    logged_by_user_id: 'u', created_at: '2026-09-19T10:01:00Z', updated_at: '2026-09-19T10:01:00Z',
  };
}

const startArgs = (id = L): StartArgs => ({ p_client_id: CLIENT, p_program_day_id: null, p_id: id, p_started_at: '2026-09-19T10:00:00Z' });
const logArgs = (id: string, sessionId = L, weight = 100): LogSetArgs => ({
  p_id: id, p_session_id: sessionId, p_exercise_id: EX, p_set_number: 1, p_weight_kg: weight, p_reps: 8,
  p_rpe: null, p_notes: null, p_is_warmup: false, p_device_id: 'test',
});
const completeArgs = (sessionId = L): CompleteArgs => ({ p_session_id: sessionId, p_rating: 4, p_notes: null, p_completed_at: '2026-09-19T11:00:00Z' });

type Call = { op: string; args: unknown };
type Handler = (op: string, args: unknown) => RpcResult<unknown> | Promise<RpcResult<unknown>>;

const defaultHandler: Handler = (op, args) => {
  if (op === 'start') return { ok: true, data: sessionRow((args as StartArgs).p_id) };
  if (op === 'log_set') {
    const a = args as LogSetArgs;
    return { ok: true, data: { set: setRow(a.p_id, a.p_session_id, a.p_weight_kg ?? 0), newPrs: ['weight'] } };
  }
  if (op === 'complete') return { ok: true, data: sessionRow((args as CompleteArgs).p_session_id, 'completed') };
  return { ok: true, data: null };
};

class FakeTransport implements Transport {
  calls: Call[] = [];
  refreshOk = true;
  refreshCalls = 0;
  handler: Handler = defaultHandler;
  private async call<T>(op: string, args: unknown): Promise<RpcResult<T>> {
    this.calls.push({ op, args });
    return (await this.handler(op, args)) as RpcResult<T>;
  }
  start(a: StartArgs) {
    return this.call<SessionRow>('start', a);
  }
  logSet(a: LogSetArgs) {
    return this.call<{ set: SetRow; newPrs: string[] }>('log_set', a);
  }
  deleteSet(a: DeleteSetArgs) {
    return this.call<null>('delete_set', a);
  }
  complete(a: CompleteArgs) {
    return this.call<SessionRow>('complete', a);
  }
  async refreshAuth() {
    this.refreshCalls += 1;
    return this.refreshOk;
  }
}

let store: MemoryKvStore;
let transport: FakeTransport;
let engine: SyncEngine;
let events: EngineEvent[];

beforeEach(() => {
  store = new MemoryKvStore();
  transport = new FakeTransport();
  engine = new SyncEngine(store, transport, () => new Date('2026-09-19T10:00:00Z'));
  events = [];
  engine.subscribe((e) => events.push(e));
});

const ops = () => transport.calls.map((c) => c.op);
const outbox = () => engine.entries();

describe('enqueue and drain', () => {
  it('replays FIFO and empties the outbox', async () => {
    await engine.enqueue({ op: 'start', sessionId: L, args: startArgs() });
    await engine.enqueue({ op: 'log_set', sessionId: L, args: logArgs(U1) });
    await engine.enqueue({ op: 'complete', sessionId: L, args: completeArgs() });
    expect(await engine.drain()).toEqual({ kind: 'drained', sent: 3 });
    expect(ops()).toEqual(['start', 'log_set', 'complete']);
    expect(await outbox()).toEqual([]);
    expect(await engine.drain()).toEqual({ kind: 'idle' });
  });

  it('writes the optimistic rows in the same batch as the entry', async () => {
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) }, [
      { table: 'sets', key: U1, value: setRow(U1, S, 90) },
    ]);
    expect((await engine.localSets(S)).map((s) => s.weight_kg)).toEqual([90]);
  });

  it('emits set_synced with the PRs the server found', async () => {
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    await engine.drain();
    expect(events).toContainEqual(expect.objectContaining({ type: 'set_synced', newPrs: ['weight'] }));
  });

  it('survives a kill: a new engine on the same store drains and keeps numbering', async () => {
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U2, S) });
    const reborn = new SyncEngine(store, transport);
    await reborn.enqueue({ op: 'complete', sessionId: S, args: completeArgs(S) });
    expect((await reborn.entries()).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(await reborn.drain()).toEqual({ kind: 'drained', sent: 3 });
  });
});

describe('coalescing', () => {
  it('keeps only the last log_set for one ULID', async () => {
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S, 100) });
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S, 105) });
    const q = await outbox();
    expect(q).toHaveLength(1);
    expect(q[0].op === 'log_set' && q[0].args.p_weight_kg).toBe(105);
  });

  it('drops a never-sent log_set and its delete together', async () => {
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    await engine.enqueue({ op: 'delete_set', sessionId: S, args: { p_id: U1 } });
    expect(await outbox()).toEqual([]);
  });

  it('queues a delete for a set that already synced', async () => {
    await engine.enqueue({ op: 'delete_set', sessionId: S, args: { p_id: U1 } });
    expect((await outbox()).map((e) => e.op)).toEqual(['delete_set']);
  });

  it('never coalesces into the entry on the wire', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    transport.handler = async (op, args) => {
      if (op === 'log_set') await gate;
      return defaultHandler(op, args);
    };
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    const running = engine.drain();
    await new Promise((r) => setTimeout(r, 0));
    await engine.enqueue({ op: 'delete_set', sessionId: S, args: { p_id: U1 } });
    release();
    await running;
    expect(ops()).toEqual(['log_set', 'delete_set']);
  });
});

describe('session id rewrite', () => {
  it('rewrites queued ops, local rows and the alias when the server returns another session', async () => {
    transport.handler = (op, args) => (op === 'start' ? { ok: true, data: sessionRow(S) } : defaultHandler(op, args));
    await engine.enqueue({ op: 'start', sessionId: L, args: startArgs() }, [{ table: 'sessions', key: L, value: sessionRow(L) }]);
    await engine.enqueue({ op: 'log_set', sessionId: L, args: logArgs(U1) }, [{ table: 'sets', key: U1, value: setRow(U1, L) }]);
    await engine.drain();
    expect((transport.calls[1].args as LogSetArgs).p_session_id).toBe(S);
    expect(await engine.resolveSessionId(L)).toBe(S);
    expect(await store.get('sessions', L)).toBeNull();
    expect((await engine.localSession(L))?.id).toBe(S);
    expect((await engine.localSets(L)).map((s) => [s.id, s.workout_session_id])).toEqual([[U1, S]]);
    expect(events).toContainEqual({ type: 'session_rewritten', from: L, to: S });
  });
});

describe('failures', () => {
  it('backs off on a network error and keeps the entry at the head', async () => {
    transport.handler = () => ({ ok: false, error: { code: '', message: 'Failed to fetch' } });
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    expect(await engine.drain()).toEqual({ kind: 'transient', sent: 0, retryInMs: 2000 });
    expect(await engine.drain()).toEqual({ kind: 'transient', sent: 0, retryInMs: 4000 });
    const [head] = await outbox();
    expect([head.state, head.attempts]).toEqual(['pending', 2]);
  });

  it('refreshes once on an expired token and carries on', async () => {
    let first = true;
    transport.handler = (op, args) => {
      if (first) {
        first = false;
        return { ok: false, error: { code: 'PGRST301', message: 'JWT expired' } };
      }
      return defaultHandler(op, args);
    };
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    expect(await engine.drain()).toEqual({ kind: 'drained', sent: 1 });
    expect(transport.refreshCalls).toBe(1);
  });

  it('pauses on auth when the refresh fails', async () => {
    transport.refreshOk = false;
    transport.handler = () => ({ ok: false, error: { code: 'PGRST301', message: 'JWT expired' } });
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    expect(await engine.drain()).toEqual({ kind: 'auth', sent: 0 });
    expect((await outbox())[0].state).toBe('pending');
  });

  it('parks a denied write as failed and moves on', async () => {
    transport.handler = (op, args) =>
      (args as LogSetArgs).p_id === U1 ? { ok: false, error: { code: '42501', message: 'not authorized' } } : defaultHandler(op, args);
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) });
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U2, S) });
    expect(await engine.drain()).toEqual({ kind: 'drained', sent: 1 });
    expect(await engine.status()).toEqual({ pending: 0, failed: 1 });
  });

  it('fails every op of a session whose start was refused, and nothing else', async () => {
    transport.handler = (op, args) =>
      op === 'start' ? { ok: false, error: { code: '42501', message: 'not authorized for this client' } } : defaultHandler(op, args);
    await engine.enqueue({ op: 'start', sessionId: L, args: startArgs() });
    await engine.enqueue({ op: 'log_set', sessionId: L, args: logArgs(U1) });
    await engine.enqueue({ op: 'log_set', sessionId: OTHER, args: logArgs(U2, OTHER) });
    await engine.drain();
    expect(ops()).toEqual(['start', 'log_set']);
    expect((await outbox()).map((e) => [e.op, e.state, e.lastError?.code])).toEqual([
      ['start', 'failed', '42501'],
      ['log_set', 'failed', 'start_failed'],
    ]);
  });
});

describe('user actions', () => {
  it('retry puts a failed start back in the queue, cascade included', async () => {
    let refuse = true;
    transport.handler = (op, args) =>
      op === 'start' && refuse ? { ok: false, error: { code: 'P0001', message: 'x' } } : defaultHandler(op, args);
    await engine.enqueue({ op: 'start', sessionId: L, args: startArgs() });
    await engine.enqueue({ op: 'log_set', sessionId: L, args: logArgs(U1) });
    await engine.drain();
    refuse = false;
    const [start] = await outbox();
    await engine.retry(start.seq);
    expect(await engine.drain()).toEqual({ kind: 'drained', sent: 2 });
  });

  it('discarding a start removes its session, sets and ops', async () => {
    await engine.enqueue({ op: 'start', sessionId: L, args: startArgs() }, [{ table: 'sessions', key: L, value: sessionRow(L) }]);
    await engine.enqueue({ op: 'log_set', sessionId: L, args: logArgs(U1) }, [{ table: 'sets', key: U1, value: setRow(U1, L) }]);
    const [start] = await outbox();
    await engine.discard(start.seq);
    expect(await outbox()).toEqual([]);
    expect(await engine.localSession(L)).toBeNull();
    expect(await engine.localSets(L)).toEqual([]);
  });

  it('discardAll empties queue and local rows but keeps the read cache', async () => {
    await engine.putCache('roster:pt', [1, 2]);
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S) }, [{ table: 'sets', key: U1, value: setRow(U1, S) }]);
    await engine.discardAll();
    expect(await engine.status()).toEqual({ pending: 0, failed: 0 });
    expect(await engine.localSets(S)).toEqual([]);
    expect((await engine.getCache<number[]>('roster:pt'))?.value).toEqual([1, 2]);
  });
});

describe('merging server rows', () => {
  it('overlays pending local edits and deletes on a server read', async () => {
    const server = [setRow(U1, S, 100), setRow(U2, S, 80)];
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S, 105) }, [
      { table: 'sets', key: U1, value: setRow(U1, S, 105) },
    ]);
    await engine.enqueue({ op: 'delete_set', sessionId: S, args: { p_id: U2 } });
    const merged = await engine.overlaySets(S, server);
    expect(merged.map((s) => [s.id, s.weight_kg])).toEqual([[U1, 105]]);
  });

  it('ignores a broadcast echo while its own write is pending, applies it after', async () => {
    await engine.enqueue({ op: 'log_set', sessionId: S, args: logArgs(U1, S, 105) }, [
      { table: 'sets', key: U1, value: setRow(U1, S, 105) },
    ]);
    expect(await engine.applyServerSet(setRow(U1, S, 100))).toBe(false);
    expect((await engine.localSets(S))[0].weight_kg).toBe(105);
    await engine.drain();
    expect(await engine.applyServerSet(setRow(U1, S, 110))).toBe(true);
    expect((await engine.localSets(S))[0].weight_kg).toBe(110);
  });

  it('prune drops completed sessions with nothing queued', async () => {
    await store.write([
      { table: 'sessions', key: S, value: sessionRow(S, 'completed') },
      { table: 'sets', key: U1, value: setRow(U1, S) },
      { table: 'sessions', key: L, value: sessionRow(L) },
    ]);
    await engine.prune();
    expect(await engine.localSession(S)).toBeNull();
    expect(await engine.localSets(S)).toEqual([]);
    expect(await engine.localSession(L)).not.toBeNull();
  });
});
```

- [x] **Step 2: Run it and see it fail**

```powershell
pnpm --filter @forge/shared test -- offline/engine
```

Expected: FAIL, `Cannot find module './engine'`.

- [x] **Step 3: Write `engine.ts`**

```ts
import { backoffMs, classifyError } from './classify';
import { orderSets } from './order';
import type { KvStore, KvWrite, OutboxEntry, OutboxOp, RpcError, SessionRow, SetRow, Transport } from './types';

export type DrainOutcome =
  | { kind: 'idle' }
  | { kind: 'drained'; sent: number }
  | { kind: 'transient'; sent: number; retryInMs: number }
  | { kind: 'auth'; sent: number };

export type EngineEvent =
  | { type: 'changed' }
  | { type: 'set_synced'; set: SetRow; newPrs: string[] }
  | { type: 'session_synced'; session: SessionRow }
  | { type: 'session_rewritten'; from: string; to: string }
  | { type: 'failed'; entry: OutboxEntry };

export type QueueStatus = { pending: number; failed: number };

export const START_FAILED: RpcError = { code: 'start_failed', message: 'the session could not be created' };

const seqKey = (seq: number): string => String(seq).padStart(12, '0');

function setIdOf(e: OutboxEntry): string | null {
  return e.op === 'log_set' || e.op === 'delete_set' ? e.args.p_id : null;
}

function retarget(e: OutboxEntry, to: string): OutboxEntry {
  if (e.op === 'log_set') return { ...e, sessionId: to, args: { ...e.args, p_session_id: to } };
  if (e.op === 'complete') return { ...e, sessionId: to, args: { ...e.args, p_session_id: to } };
  return { ...e, sessionId: to };
}

/**
 * Spec §5. The outbox, its replay, and every rule about local rows. Pure over
 * a KvStore and a Transport, so all of it runs in vitest.
 *
 * Invariants:
 * - One mutation of the store at a time (`exclusive`). The network call itself
 *   runs outside the lock, so a tap never waits on a round trip.
 * - The entry on the wire (`inflight`) is never coalesced, retried, discarded
 *   or removed except by its own result.
 * - A pending local write always beats a server row for the same id: a stale
 *   broadcast or refetch never rolls back what the user just did.
 */
export class SyncEngine {
  private lock: Promise<unknown> = Promise.resolve();
  private inflight: number | null = null;
  private running: Promise<DrainOutcome> | null = null;
  private readonly listeners = new Set<(e: EngineEvent) => void>();

  constructor(
    private readonly store: KvStore,
    private readonly transport: Transport,
    private readonly now: () => Date = () => new Date(),
  ) {}

  subscribe(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(e: EngineEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  // ── Queue ────────────────────────────────────────────────────────────────

  async entries(): Promise<OutboxEntry[]> {
    return (await this.store.all<OutboxEntry>('outbox')).map((r) => r.value);
  }

  async status(): Promise<QueueStatus> {
    const all = await this.entries();
    return {
      pending: all.filter((e) => e.state === 'pending').length,
      failed: all.filter((e) => e.state === 'failed').length,
    };
  }

  /** Queues `op` and writes `rows` (the optimistic local rows) in one atomic batch. */
  enqueue(op: OutboxOp, rows: readonly KvWrite[] = []): Promise<void> {
    return this.exclusive(async () => {
      const open = (await this.entries()).filter((e) => e.seq !== this.inflight);
      if (op.op === 'log_set' || op.op === 'delete_set') {
        const prior = open.find((e) => e.op === 'log_set' && e.args.p_id === op.args.p_id);
        if (prior && op.op === 'log_set') {
          const replaced = { ...prior, args: op.args, state: 'pending', attempts: 0, lastError: null } as OutboxEntry;
          await this.store.write([...rows, { table: 'outbox', key: seqKey(prior.seq), value: replaced }]);
          this.emit({ type: 'changed' });
          return;
        }
        if (prior && op.op === 'delete_set') {
          await this.store.write([...rows, { table: 'outbox', key: seqKey(prior.seq), value: null }]);
          this.emit({ type: 'changed' });
          return;
        }
      }
      const seq = (await this.store.get<number>('meta', 'nextSeq')) ?? 1;
      const entry = { ...op, seq, attempts: 0, lastError: null, state: 'pending', createdAt: this.now().toISOString() } as OutboxEntry;
      await this.store.write([
        ...rows,
        { table: 'meta', key: 'nextSeq', value: seq + 1 },
        { table: 'outbox', key: seqKey(seq), value: entry },
      ]);
      this.emit({ type: 'changed' });
    });
  }

  /** One drain at a time; a second caller shares the running one. */
  drain(): Promise<DrainOutcome> {
    if (!this.running) {
      this.running = this.drainLoop().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async drainLoop(): Promise<DrainOutcome> {
    let sent = 0;
    let refreshed = false;
    for (;;) {
      const head = await this.exclusive(async () => {
        const next = (await this.entries()).find((e) => e.state === 'pending') ?? null;
        this.inflight = next?.seq ?? null;
        return next;
      });
      if (!head) return sent === 0 ? { kind: 'idle' } : { kind: 'drained', sent };

      const error = await this.attempt(head);
      if (!error) {
        sent += 1;
        continue;
      }
      const kind = classifyError(error);
      if (kind === 'auth' && !refreshed) {
        refreshed = true;
        if (await this.transport.refreshAuth()) continue;
      }
      if (kind === 'auth') {
        await this.exclusive(() => this.bump(head, error));
        return { kind: 'auth', sent };
      }
      if (kind === 'transient') {
        const attempts = await this.exclusive(() => this.bump(head, error));
        return { kind: 'transient', sent, retryInMs: backoffMs(attempts) };
      }
      await this.exclusive(() => this.fail(head, error));
    }
  }

  /** Sends one entry; on success applies the result under the lock. Returns the error, or null. */
  private async attempt(e: OutboxEntry): Promise<RpcError | null> {
    switch (e.op) {
      case 'start': {
        const r = await this.transport.start(e.args);
        if (!r.ok) return r.error;
        await this.exclusive(() => this.applyStart(e, r.data));
        return null;
      }
      case 'log_set': {
        const r = await this.transport.logSet(e.args);
        if (!r.ok) return r.error;
        await this.exclusive(async () => {
          const writes: KvWrite[] = [{ table: 'outbox', key: seqKey(e.seq), value: null }];
          if (!(await this.touchedByOthers(r.data.set.id, e.seq))) {
            writes.push({ table: 'sets', key: r.data.set.id, value: r.data.set });
          }
          await this.store.write(writes);
          this.inflight = null;
        });
        this.emit({ type: 'set_synced', set: r.data.set, newPrs: r.data.newPrs });
        this.emit({ type: 'changed' });
        return null;
      }
      case 'delete_set': {
        const r = await this.transport.deleteSet(e.args);
        if (!r.ok) return r.error;
        await this.exclusive(async () => {
          await this.store.write([{ table: 'outbox', key: seqKey(e.seq), value: null }]);
          this.inflight = null;
        });
        this.emit({ type: 'changed' });
        return null;
      }
      case 'complete': {
        const r = await this.transport.complete(e.args);
        if (!r.ok) return r.error;
        await this.exclusive(async () => {
          await this.store.write([
            { table: 'outbox', key: seqKey(e.seq), value: null },
            { table: 'sessions', key: r.data.id, value: r.data },
          ]);
          this.inflight = null;
        });
        this.emit({ type: 'session_synced', session: r.data });
        this.emit({ type: 'changed' });
        return null;
      }
    }
  }

  private async applyStart(e: OutboxEntry, row: SessionRow): Promise<void> {
    const from = e.sessionId;
    const to = row.id;
    const all = await this.entries();
    const hasComplete = all.some((o) => o.seq !== e.seq && o.sessionId === from && o.op === 'complete');
    const writes: KvWrite[] = [{ table: 'outbox', key: seqKey(e.seq), value: null }];

    if (from === to) {
      if (!hasComplete) writes.push({ table: 'sessions', key: to, value: row });
      await this.store.write(writes);
      this.inflight = null;
      this.emit({ type: 'session_synced', session: row });
      this.emit({ type: 'changed' });
      return;
    }

    // Another device (or the PT, online) already had a session in progress for
    // this client. Everything queued or stored under `from` moves to `to`.
    for (const o of all) {
      if (o.seq !== e.seq && o.sessionId === from) {
        writes.push({ table: 'outbox', key: seqKey(o.seq), value: retarget(o, to) });
      }
    }
    for (const { key, value } of await this.store.all<SetRow>('sets')) {
      if (value.workout_session_id === from) {
        writes.push({ table: 'sets', key, value: { ...value, workout_session_id: to } });
      }
    }
    const local = await this.store.get<SessionRow>('sessions', from);
    writes.push({ table: 'sessions', key: from, value: null });
    writes.push({
      table: 'sessions',
      key: to,
      value: hasComplete && local ? { ...row, status: local.status, completed_at: local.completed_at } : row,
    });
    writes.push({ table: 'aliases', key: from, value: to });
    await this.store.write(writes);
    this.inflight = null;
    this.emit({ type: 'session_rewritten', from, to });
    this.emit({ type: 'changed' });
  }

  private async bump(e: OutboxEntry, error: RpcError): Promise<number> {
    const current = (await this.store.get<OutboxEntry>('outbox', seqKey(e.seq))) ?? e;
    const attempts = current.attempts + 1;
    await this.store.write([{ table: 'outbox', key: seqKey(e.seq), value: { ...current, attempts, lastError: error } }]);
    this.inflight = null;
    this.emit({ type: 'changed' });
    return attempts;
  }

  private async fail(e: OutboxEntry, error: RpcError): Promise<void> {
    const failed: OutboxEntry[] = [{ ...e, state: 'failed', lastError: error }];
    if (e.op === 'start') {
      for (const o of await this.entries()) {
        if (o.seq !== e.seq && o.sessionId === e.sessionId) failed.push({ ...o, state: 'failed', lastError: START_FAILED });
      }
    }
    await this.store.write(failed.map((f) => ({ table: 'outbox' as const, key: seqKey(f.seq), value: f })));
    this.inflight = null;
    for (const f of failed) this.emit({ type: 'failed', entry: f });
    this.emit({ type: 'changed' });
  }

  private async touchedByOthers(setId: string, exceptSeq: number | null): Promise<boolean> {
    return (await this.entries()).some((o) => o.seq !== exceptSeq && setIdOf(o) === setId);
  }

  // ── User actions (sync queue screen, settings) ───────────────────────────

  retry(seq: number): Promise<void> {
    return this.exclusive(async () => {
      const all = await this.entries();
      const target = all.find((e) => e.seq === seq);
      if (!target || target.seq === this.inflight) return;
      const reset = (e: OutboxEntry): KvWrite => ({
        table: 'outbox',
        key: seqKey(e.seq),
        value: { ...e, state: 'pending', attempts: 0, lastError: null },
      });
      const writes = [reset(target)];
      if (target.op === 'start') {
        for (const o of all) {
          if (o.seq !== seq && o.sessionId === target.sessionId && o.lastError?.code === START_FAILED.code) writes.push(reset(o));
        }
      }
      await this.store.write(writes);
      this.emit({ type: 'changed' });
    });
  }

  async retryAll(): Promise<void> {
    for (const e of await this.entries()) {
      if (e.state === 'failed') await this.retry(e.seq);
    }
  }

  discard(seq: number): Promise<void> {
    return this.exclusive(async () => {
      const all = await this.entries();
      const target = all.find((e) => e.seq === seq);
      if (!target || target.seq === this.inflight) return;
      const writes: KvWrite[] = [{ table: 'outbox', key: seqKey(seq), value: null }];
      if (target.op === 'log_set') writes.push({ table: 'sets', key: target.args.p_id, value: null });
      if (target.op === 'start') {
        for (const o of all) {
          if (o.seq !== seq && o.sessionId === target.sessionId) writes.push({ table: 'outbox', key: seqKey(o.seq), value: null });
        }
        for (const { key, value } of await this.store.all<SetRow>('sets')) {
          if (value.workout_session_id === target.sessionId) writes.push({ table: 'sets', key, value: null });
        }
        writes.push({ table: 'sessions', key: target.sessionId, value: null });
      }
      await this.store.write(writes);
      this.emit({ type: 'changed' });
    });
  }

  /** Toggle-off with a queue (spec §4.3). Keeps the read cache. */
  discardAll(): Promise<void> {
    return this.exclusive(async () => {
      const writes: KvWrite[] = [];
      for (const table of ['outbox', 'sessions', 'sets', 'aliases'] as const) {
        for (const { key } of await this.store.all(table)) writes.push({ table, key, value: null });
      }
      await this.store.write(writes);
      this.emit({ type: 'changed' });
    });
  }

  // ── Local reads and server merges ────────────────────────────────────────

  async resolveSessionId(id: string): Promise<string> {
    return (await this.store.get<string>('aliases', id)) ?? id;
  }

  async localSession(id: string): Promise<SessionRow | null> {
    return this.store.get<SessionRow>('sessions', await this.resolveSessionId(id));
  }

  async localSessionsInProgress(): Promise<SessionRow[]> {
    return (await this.store.all<SessionRow>('sessions')).map((r) => r.value).filter((s) => s.status === 'in_progress');
  }

  async localSets(sessionId: string): Promise<SetRow[]> {
    const id = await this.resolveSessionId(sessionId);
    return orderSets((await this.store.all<SetRow>('sets')).map((r) => r.value).filter((s) => s.workout_session_id === id));
  }

  /** Server rows, with every pending local upsert laid over them and pending deletes removed. */
  async overlaySets(sessionId: string, server: readonly SetRow[]): Promise<SetRow[]> {
    const entries = await this.entries();
    const upserts = new Set(entries.filter((e) => e.op === 'log_set').map(setIdOf));
    const deletes = new Set(entries.filter((e) => e.op === 'delete_set').map(setIdOf));
    const merged = new Map(server.map((s) => [s.id, s]));
    for (const local of await this.localSets(sessionId)) {
      if (upserts.has(local.id)) merged.set(local.id, local);
    }
    for (const id of deletes) if (id) merged.delete(id);
    return orderSets([...merged.values()]);
  }

  /** A server set (refetch or broadcast). False when a pending local write for it wins. */
  applyServerSet(row: SetRow): Promise<boolean> {
    return this.exclusive(async () => {
      if (await this.touchedByOthers(row.id, null)) return false;
      await this.store.write([{ table: 'sets', key: row.id, value: row }]);
      return true;
    });
  }

  applyServerSetDelete(id: string): Promise<boolean> {
    return this.exclusive(async () => {
      if (await this.touchedByOthers(id, null)) return false;
      await this.store.write([{ table: 'sets', key: id, value: null }]);
      return true;
    });
  }

  applyServerSession(row: SessionRow): Promise<boolean> {
    return this.exclusive(async () => {
      const pendingComplete = (await this.entries()).some((e) => e.sessionId === row.id && e.op === 'complete');
      if (pendingComplete) return false;
      await this.store.write([{ table: 'sessions', key: row.id, value: row }]);
      return true;
    });
  }

  /** Completed sessions with nothing queued live on the server; drop the local copy. */
  prune(): Promise<void> {
    return this.exclusive(async () => {
      const queued = new Set((await this.entries()).map((e) => e.sessionId));
      const done = (await this.store.all<SessionRow>('sessions'))
        .map((r) => r.value)
        .filter((s) => s.status === 'completed' && !queued.has(s.id))
        .map((s) => s.id);
      if (done.length === 0) return;
      const doneSet = new Set(done);
      const writes: KvWrite[] = done.map((id) => ({ table: 'sessions', key: id, value: null }));
      for (const { key, value } of await this.store.all<SetRow>('sets')) {
        if (doneSet.has(value.workout_session_id)) writes.push({ table: 'sets', key, value: null });
      }
      await this.store.write(writes);
    });
  }

  // ── Read cache (spec §6) ─────────────────────────────────────────────────

  async getCache<T>(key: string): Promise<{ value: T; at: string } | null> {
    return this.store.get<{ value: T; at: string }>('cache', key);
  }

  async putCache(key: string, value: unknown): Promise<void> {
    await this.store.write([{ table: 'cache', key, value: { value, at: this.now().toISOString() } }]);
  }
}
```

- [x] **Step 4: Run and see it pass**

```powershell
pnpm --filter @forge/shared test -- offline/engine
```

Expected: PASS, 20 tests. If `never coalesces into the entry on the wire` reports `['log_set']` only, `enqueue` is filtering on `state` rather than `seq !== this.inflight`. Fix the filter, not the test.

- [x] **Step 5: Export, run the whole shared suite, commit**

Append to `offline/index.ts`:

```ts
export * from './engine';
```

```powershell
pnpm --filter @forge/shared typecheck
pnpm --filter @forge/shared test
git add packages/shared/src/offline
git commit -m "feat(shared): SyncEngine — outbox, replay, id rewrite, merge rules"
```

---

## Task 8 · Shared: i18n copy

**Files:**
- Modify: `packages/shared/src/i18n/en.json`, `packages/shared/src/i18n/ar.json`

- [x] **Step 1: Add `logging.offline` as the last key of the `logging` object in `en.json`**

```json
"offline": {
  "chipOffline": "Offline · synced {{time}}",
  "chipOfflineNever": "Offline",
  "chipPending_one": "Offline · 1 pending",
  "chipPending_other": "Offline · {{count}} pending",
  "chipSyncing_one": "Syncing 1…",
  "chipSyncing_other": "Syncing {{count}}…",
  "authPaused_one": "Sign in to sync 1 item.",
  "authPaused_other": "Sign in to sync {{count}} items.",
  "live": "Live",
  "notLive": "Offline",
  "notSynced": "Not synced yet",
  "needsConnection": "You're offline. This needs a connection.",
  "needsConnectionBody": "Logging still works. Everything else comes back with the signal.",
  "queueTitle": "Sync queue",
  "queueEmpty": "Everything is synced.",
  "queueEmptyBody": "Sets you log offline wait here until you're back online.",
  "statePending": "Waiting",
  "stateFailed": "Didn't sync",
  "opStart": "Start session · {{name}}",
  "opStartNoName": "Start session",
  "opSet": "Set · {{summary}}",
  "opDelete": "Delete a set",
  "opComplete": "Finish session",
  "errorStartFailed": "The session couldn't be created, so this can't sync.",
  "retry": "Retry",
  "discard": "Discard",
  "retryAll": "Retry all"
}
```

- [x] **Step 2: Add `settings.offline` as the last key of the `settings` object in `en.json`**

```json
"offline": {
  "heading": "Offline",
  "label": "Offline logging (beta)",
  "body": "Log sets with no signal. They sync when you're back online.",
  "pending_one": "1 item waiting to sync",
  "pending_other": "{{count}} items waiting to sync",
  "queue": "Sync queue",
  "cantTurnOff": "Items are still waiting to sync",
  "cantTurnOffBody": "Go back online so they sync, or discard them. Discarded sets are gone for good.",
  "discard_one": "Discard 1 item",
  "discard_other": "Discard {{count}} items",
  "keep": "Keep them",
  "signOutPending_one": "1 item hasn't synced",
  "signOutPending_other": "{{count}} items haven't synced",
  "signOutPendingBody": "Signing out now deletes them from this phone.",
  "signOutAnyway": "Sign out anyway"
}
```

- [x] **Step 3: Add the same two objects to `ar.json`, same positions and key order**

`logging.offline`:

```json
"offline": {
  "chipOffline": "غير متصل · آخر مزامنة {{time}}",
  "chipOfflineNever": "غير متصل",
  "chipPending_zero": "غير متصل · لا شيء بانتظار المزامنة",
  "chipPending_one": "غير متصل · عنصر واحد بانتظار المزامنة",
  "chipPending_two": "غير متصل · عنصران بانتظار المزامنة",
  "chipPending_few": "غير متصل · {{count}} عناصر بانتظار المزامنة",
  "chipPending_many": "غير متصل · {{count}} عنصرًا بانتظار المزامنة",
  "chipPending_other": "غير متصل · {{count}} عنصر بانتظار المزامنة",
  "chipSyncing_zero": "جارٍ المزامنة…",
  "chipSyncing_one": "جارٍ مزامنة عنصر واحد…",
  "chipSyncing_two": "جارٍ مزامنة عنصرين…",
  "chipSyncing_few": "جارٍ مزامنة {{count}} عناصر…",
  "chipSyncing_many": "جارٍ مزامنة {{count}} عنصرًا…",
  "chipSyncing_other": "جارٍ مزامنة {{count}} عنصر…",
  "authPaused_zero": "سجّل الدخول للمزامنة.",
  "authPaused_one": "سجّل الدخول لمزامنة عنصر واحد.",
  "authPaused_two": "سجّل الدخول لمزامنة عنصرين.",
  "authPaused_few": "سجّل الدخول لمزامنة {{count}} عناصر.",
  "authPaused_many": "سجّل الدخول لمزامنة {{count}} عنصرًا.",
  "authPaused_other": "سجّل الدخول لمزامنة {{count}} عنصر.",
  "live": "مباشر",
  "notLive": "غير متصل",
  "notSynced": "لم تتم المزامنة بعد",
  "needsConnection": "أنت غير متصل. هذه الشاشة تحتاج إلى اتصال.",
  "needsConnectionBody": "التسجيل ما زال يعمل. كل شيء آخر يعود مع الإشارة.",
  "queueTitle": "قائمة المزامنة",
  "queueEmpty": "تمت مزامنة كل شيء.",
  "queueEmptyBody": "المجموعات التي تسجّلها دون اتصال تنتظر هنا حتى تعود متصلًا.",
  "statePending": "بالانتظار",
  "stateFailed": "لم تتم المزامنة",
  "opStart": "بدء الجلسة · {{name}}",
  "opStartNoName": "بدء الجلسة",
  "opSet": "مجموعة · {{summary}}",
  "opDelete": "حذف مجموعة",
  "opComplete": "إنهاء الجلسة",
  "errorStartFailed": "تعذّر إنشاء الجلسة، لذا لا يمكن مزامنة هذا.",
  "retry": "إعادة المحاولة",
  "discard": "تجاهل",
  "retryAll": "إعادة المحاولة للكل"
}
```

`settings.offline`:

```json
"offline": {
  "heading": "دون اتصال",
  "label": "التسجيل دون اتصال (تجريبي)",
  "body": "سجّل المجموعات دون إشارة. تتم مزامنتها عند عودتك متصلًا.",
  "pending_zero": "لا شيء بانتظار المزامنة",
  "pending_one": "عنصر واحد بانتظار المزامنة",
  "pending_two": "عنصران بانتظار المزامنة",
  "pending_few": "{{count}} عناصر بانتظار المزامنة",
  "pending_many": "{{count}} عنصرًا بانتظار المزامنة",
  "pending_other": "{{count}} عنصر بانتظار المزامنة",
  "queue": "قائمة المزامنة",
  "cantTurnOff": "هناك عناصر ما زالت بانتظار المزامنة",
  "cantTurnOffBody": "عُد متصلًا لتتم مزامنتها، أو تجاهلها. المجموعات المتجاهلة تُحذف نهائيًا.",
  "discard_zero": "لا شيء للتجاهل",
  "discard_one": "تجاهل عنصر واحد",
  "discard_two": "تجاهل عنصرين",
  "discard_few": "تجاهل {{count}} عناصر",
  "discard_many": "تجاهل {{count}} عنصرًا",
  "discard_other": "تجاهل {{count}} عنصر",
  "keep": "احتفظ بها",
  "signOutPending_zero": "لا شيء بانتظار المزامنة",
  "signOutPending_one": "عنصر واحد لم تتم مزامنته",
  "signOutPending_two": "عنصران لم تتم مزامنتهما",
  "signOutPending_few": "{{count}} عناصر لم تتم مزامنتها",
  "signOutPending_many": "{{count}} عنصرًا لم تتم مزامنتها",
  "signOutPending_other": "{{count}} عنصر لم تتم مزامنتها",
  "signOutPendingBody": "تسجيل الخروج الآن يحذفها من هذا الهاتف.",
  "signOutAnyway": "سجّل الخروج على أي حال"
}
```

`opStart` has its no-name variant `opStartNoName` (PITFALLS I3). The chip's `{{time}}` has `chipOfflineNever` for the never-warmed case.

- [x] **Step 4: Run the i18n parity test**

```powershell
pnpm --filter @forge/shared test -- i18n
```

Expected: PASS. A failure naming a plural category means an `ar` form is missing; add it, don't remove the `en` one.

- [x] **Step 5: Commit**

```bash
git add packages/shared/src/i18n
git commit -m "feat(i18n): offline chip, sync queue, live badge, settings copy"
```

---

## Task 9 · Mobile: dependencies, stores, transport, RPC wrappers

**Files:**
- Modify: `apps/mobile/package.json`, `apps/mobile/app.json`
- Create: `apps/mobile/src/lib/offline/kvStore.ts`, `kvStore.web.ts`, `engine.ts`, `transport.ts`
- Modify: `apps/mobile/src/lib/logging/sessionRpc.ts`

- [x] **Step 1: Install the two native dependencies through Expo**

```powershell
cd apps/mobile
npx expo install expo-sqlite @react-native-community/netinfo
cd ../..
```

Expected: both added to `apps/mobile/package.json` at SDK-57-compatible versions. If `expo install` adds `expo-sqlite` to `app.json` `plugins`, keep it.

- [x] **Step 2: Write `lib/offline/kvStore.ts` (native)**

```ts
import type { KvStore, KvTable, KvWrite } from '@forge/shared';
import * as SQLite from 'expo-sqlite';

/**
 * Native KvStore: one table, JSON values. kvStore.web.ts replaces this file on
 * web (Metro platform extensions), so expo-sqlite never enters the web bundle.
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= SQLite.openDatabaseAsync('forge-offline.db').then(async (d) => {
    await d.execAsync(
      'PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS kv (tbl TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (tbl, k));',
    );
    return d;
  });
  return dbPromise;
}

export const kvStore: KvStore = {
  async get<T>(table: KvTable, key: string): Promise<T | null> {
    const row = await (await db()).getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE tbl = ? AND k = ?', table, key);
    return row ? (JSON.parse(row.v) as T) : null;
  },
  async all<T>(table: KvTable): Promise<Array<{ key: string; value: T }>> {
    const rows = await (await db()).getAllAsync<{ k: string; v: string }>('SELECT k, v FROM kv WHERE tbl = ? ORDER BY k', table);
    return rows.map((r) => ({ key: r.k, value: JSON.parse(r.v) as T }));
  },
  async write(batch: readonly KvWrite[]): Promise<void> {
    const d = await db();
    await d.withExclusiveTransactionAsync(async (tx) => {
      for (const w of batch) {
        if (w.value === null) await tx.runAsync('DELETE FROM kv WHERE tbl = ? AND k = ?', w.table, w.key);
        else await tx.runAsync('INSERT OR REPLACE INTO kv (tbl, k, v) VALUES (?, ?, ?)', w.table, w.key, JSON.stringify(w.value));
      }
    });
  },
  async clear(): Promise<void> {
    await (await db()).runAsync('DELETE FROM kv');
  },
};
```

- [x] **Step 3: Write `lib/offline/kvStore.web.ts` (IndexedDB)**

```ts
/// <reference lib="dom" />
import type { KvStore, KvTable, KvWrite } from '@forge/shared';

/**
 * Web KvStore over IndexedDB. Keys are [table, key] arrays, so a table's rows
 * are one contiguous, key-ordered range. One readwrite transaction per batch
 * is what makes write() atomic.
 */
const DB_NAME = 'forge-offline';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const kvStore: KvStore = {
  async get<T>(table: KvTable, key: string): Promise<T | null> {
    const store = (await db()).transaction(STORE, 'readonly').objectStore(STORE);
    const value = await request(store.get([table, key]));
    return value === undefined ? null : (value as T);
  },
  async all<T>(table: KvTable): Promise<Array<{ key: string; value: T }>> {
    const store = (await db()).transaction(STORE, 'readonly').objectStore(STORE);
    const range = IDBKeyRange.bound([table, ''], [table, '￿']);
    const [keys, values] = await Promise.all([request(store.getAllKeys(range)), request(store.getAll(range))]);
    return keys.map((k, i) => ({ key: (k as [string, string])[1], value: values[i] as T }));
  },
  async write(batch: readonly KvWrite[]): Promise<void> {
    const tx = (await db()).transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const w of batch) {
      if (w.value === null) store.delete([w.table, w.key]);
      else store.put(w.value, [w.table, w.key]);
    }
    await done(tx);
  },
  async clear(): Promise<void> {
    const tx = (await db()).transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await done(tx);
  },
};
```

- [x] **Step 4: Update `lib/logging/sessionRpc.ts` for the new parameters**

Replace `startWorkoutSession` and `completeWorkoutSession` with:

```ts
export async function startWorkoutSession(
  clientId: string,
  programDayId: string | null,
  opts: { id?: string; startedAt?: string } = {},
): Promise<{ session: WorkoutSessionRow | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('start_workout_session', {
    p_client_id: clientId,
    ...(programDayId ? { p_program_day_id: programDayId } : {}),
    ...(opts.id ? { p_id: opts.id } : {}),
    ...(opts.startedAt ? { p_started_at: opts.startedAt } : {}),
  });
  if (error) return { session: null, error };
  return { session: data ?? null, error: null };
}
```

```ts
export async function completeWorkoutSession(
  sessionId: string,
  input: CompleteSessionInput,
  completedAt?: string,
): Promise<{ session: WorkoutSessionRow | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('complete_workout_session', {
    p_session_id: sessionId,
    ...(input.rating !== null ? { p_rating: input.rating } : {}),
    ...(input.notes !== null ? { p_notes: input.notes } : {}),
    ...(completedAt ? { p_completed_at: completedAt } : {}),
  });
  if (error) return { session: null, error };
  return { session: data ?? null, error: null };
}
```

Existing callers pass neither new argument and keep M4a behaviour.

- [x] **Step 5: Write `lib/offline/transport.ts`**

```ts
import type { PrType, RpcError, Transport } from '@forge/shared';
import { supabase } from '../supabase';
import { completeWorkoutSession, deleteSet, logSet, startWorkoutSession } from '../logging/sessionRpc';

function toRpcError(error: Error): RpcError {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  return { code, message: error.message ?? '' };
}

const NO_ROW: RpcError = { code: 'P0001', message: 'the RPC returned no row' };

/** The four M4a RPCs as the engine sees them. Replays go through the same wrappers the online path uses. */
export const supabaseTransport: Transport = {
  async start(a) {
    const { session, error } = await startWorkoutSession(a.p_client_id, a.p_program_day_id, {
      id: a.p_id,
      startedAt: a.p_started_at,
    });
    if (error) return { ok: false, error: toRpcError(error) };
    return session ? { ok: true, data: session } : { ok: false, error: NO_ROW };
  },
  async logSet(a) {
    const { result, error } = await logSet(
      a.p_session_id,
      a.p_exercise_id,
      a.p_set_number,
      { id: a.p_id, weight_kg: a.p_weight_kg, reps: a.p_reps, rpe: a.p_rpe, notes: a.p_notes, is_warmup: a.p_is_warmup },
      a.p_device_id,
    );
    if (error) return { ok: false, error: toRpcError(error) };
    return result ? { ok: true, data: { set: result.set, newPrs: result.newPrs as PrType[] } } : { ok: false, error: NO_ROW };
  },
  async deleteSet(a) {
    const { error } = await deleteSet(a.p_id);
    return error ? { ok: false, error: toRpcError(error) } : { ok: true, data: null };
  },
  async complete(a) {
    const { session, error } = await completeWorkoutSession(
      a.p_session_id,
      { rating: a.p_rating, notes: a.p_notes },
      a.p_completed_at,
    );
    if (error) return { ok: false, error: toRpcError(error) };
    return session ? { ok: true, data: session } : { ok: false, error: NO_ROW };
  },
  async refreshAuth() {
    const { data, error } = await supabase.auth.refreshSession();
    return !error && data.session !== null;
  },
};
```

If `LogSetInput` / `CompleteSessionInput` carry more fields than the literals above, typecheck names them; add them from the args (every field of the RPC is in `LogSetArgs`).

- [x] **Step 6: Write `lib/offline/engine.ts`, the one engine per app process**

```ts
import { SyncEngine } from '@forge/shared';
import { kvStore } from './kvStore';
import { supabaseTransport } from './transport';

/** Device-level, so one per process, not per render or per provider mount. */
export const engine = new SyncEngine(kvStore, supabaseTransport);

/** deviceStore keys. The choice is per device (spec §4.3); the mode is the last one the server told us. */
export const OFFLINE_CHOICE_KEY = 'forge.offlineLogging';
export const OFFLINE_MODE_KEY = 'forge.offlineMode';
```

- [x] **Step 7: Typecheck and commit**

```powershell
pnpm --filter mobile typecheck
pnpm --filter mobile lint
git add apps/mobile
git commit -m "feat(mobile): KvStore adapters, engine singleton, RPC transport"
```

---

## Task 10 · Mobile: OfflineProvider and the cold-boot profile

**Files:**
- Create: `apps/mobile/src/lib/offline/offlineContext.ts`, `apps/mobile/src/lib/offline/OfflineProvider.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/lib/auth/AuthProvider.tsx`

- [x] **Step 1: Write `offlineContext.ts`**

The context and `useOffline` live apart from the provider. The provider imports `warmCache`, which imports the fetch hooks, which call `useOffline`; one file would be a require cycle.

```ts
import type { QueueStatus } from '@forge/shared';
import { createContext, use } from 'react';

export type OfflineContextValue = {
  /** The server allows offline logging for this user (spec §4.3). */
  available: boolean;
  /** Available and switched on on this device. Every offline branch keys off this. */
  effective: boolean;
  online: boolean;
  status: QueueStatus;
  authPaused: boolean;
  warmedAt: string | null;
  setDeviceChoice: (next: boolean) => Promise<'ok' | 'queue_not_empty'>;
  discardAllAndDisable: () => Promise<void>;
  drainNow: () => void;
};

export const OfflineContext = createContext<OfflineContextValue>({
  available: false,
  effective: false,
  online: true,
  status: { pending: 0, failed: 0 },
  authPaused: false,
  warmedAt: null,
  setDeviceChoice: async () => 'ok',
  discardAllAndDisable: async () => {},
  drainNow: () => {},
});

export function useOffline(): OfflineContextValue {
  return use(OfflineContext);
}
```

- [x] **Step 2: Write `OfflineProvider.tsx`**

```tsx
import NetInfo from '@react-native-community/netinfo';
import { parseOfflineMode, resolveOfflineLogging, type OfflineMode, type QueueStatus } from '@forge/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { getStoredValue, setStoredValue } from '../deviceStore';
import { supabase } from '../supabase';
import { engine, OFFLINE_CHOICE_KEY, OFFLINE_MODE_KEY } from './engine';
import { OfflineContext, type OfflineContextValue } from './offlineContext';
import { warmCache } from './warmCache';

const WARM_EVERY_MS = 60_000;

export function OfflineProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const signedIn = auth.status === 'signedIn' && auth.user !== null;
  const [mode, setMode] = useState<OfflineMode>('off');
  const [deviceChoice, setChoice] = useState(false);
  const [online, setOnline] = useState(true);
  const [status, setStatus] = useState<QueueStatus>({ pending: 0, failed: 0 });
  const [authPaused, setAuthPaused] = useState(false);
  const [warmedAt, setWarmedAt] = useState<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const lastWarm = useRef(0);

  const { available, effective } = resolveOfflineLogging({
    mode,
    userBeta: auth.user?.offline_logging_beta ?? false,
    deviceChoice,
  });

  // Last-known mode and the device choice, before any network (cold offline boot).
  useEffect(() => {
    let cancelled = false;
    void Promise.all([getStoredValue(OFFLINE_MODE_KEY), getStoredValue(OFFLINE_CHOICE_KEY), engine.getCache<string>('warmedAt')]).then(
      ([m, c, w]) => {
        if (cancelled) return;
        setMode(parseOfflineMode(m));
        setChoice(c === '1');
        setWarmedAt(w?.value ?? null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // The server's mode, whenever we are signed in and online.
  useEffect(() => {
    if (!signedIn || !online) return;
    let cancelled = false;
    void supabase
      .from('app_config')
      .select('value')
      .eq('key', 'offline_logging')
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const next = parseOfflineMode(data.value);
        setMode(next);
        void setStoredValue(OFFLINE_MODE_KEY, next);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, online]);

  useEffect(() => {
    return NetInfo.addEventListener((s) => {
      setOnline(s.isConnected !== false && s.isInternetReachable !== false);
    });
  }, []);

  useEffect(() => {
    const refresh = () => void engine.status().then(setStatus);
    refresh();
    return engine.subscribe((e) => {
      if (e.type === 'changed') refresh();
    });
  }, []);

  const drainNow = useCallback(() => {
    if (!online || !signedIn) return;
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    void engine.drain().then((outcome) => {
      setAuthPaused(outcome.kind === 'auth');
      if (outcome.kind === 'transient') {
        retryTimer.current = setTimeout(() => setRetryTick((n) => n + 1), outcome.retryInMs);
      }
      if (outcome.kind === 'drained') void engine.prune();
    });
  }, [online, signedIn]);

  // Drain whenever the signal or the session comes back, and on each backoff
  // tick. Not gated on `effective`: a queue left behind by a switched-off mode
  // still drains.
  useEffect(() => {
    drainNow();
  }, [drainNow, retryTick]);

  const warm = useCallback(() => {
    if (!effective || !online || !signedIn || !auth.user) return;
    const now = Date.now();
    if (now - lastWarm.current < WARM_EVERY_MS) return;
    lastWarm.current = now;
    void warmCache(auth.user).then((at) => {
      if (at) setWarmedAt(at);
    });
  }, [effective, online, signedIn, auth.user]);

  useEffect(() => {
    warm();
  }, [warm]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      drainNow();
      warm();
    });
    return () => sub.remove();
  }, [drainNow, warm]);

  const setDeviceChoice = useCallback(
    async (next: boolean): Promise<'ok' | 'queue_not_empty'> => {
      if (!next) {
        const s = await engine.status();
        if (s.pending + s.failed > 0) return 'queue_not_empty';
      }
      await setStoredValue(OFFLINE_CHOICE_KEY, next ? '1' : '0');
      setChoice(next);
      if (next) lastWarm.current = 0;
      return 'ok';
    },
    [],
  );

  const discardAllAndDisable = useCallback(async () => {
    await engine.discardAll();
    await setStoredValue(OFFLINE_CHOICE_KEY, '0');
    setChoice(false);
  }, []);

  const value = useMemo<OfflineContextValue>(
    () => ({ available, effective, online, status, authPaused, warmedAt, setDeviceChoice, discardAllAndDisable, drainNow }),
    [available, effective, online, status, authPaused, warmedAt, setDeviceChoice, discardAllAndDisable, drainNow],
  );

  return <OfflineContext value={value}>{children}</OfflineContext>;
}
```

`warmCache` is written in Task 11. Until then, create `lib/offline/warmCache.ts` with the stub below so this task typechecks. Task 11 replaces it wholesale.

```ts
import type { Database } from '@forge/shared';

export async function warmCache(_user: Database['public']['Tables']['users']['Row']): Promise<string | null> {
  return null;
}
```

- [x] **Step 3: Mount the provider inside `AuthProvider` in `app/_layout.tsx`**

```tsx
import { OfflineProvider } from '../lib/offline/OfflineProvider';
```

```tsx
        <AuthProvider>
          <OfflineProvider>
            <ThemedGate />
          </OfflineProvider>
        </AuthProvider>
```

- [x] **Step 4: Cold offline boot in `AuthProvider.tsx`**

Replace `loadProfile` with:

```ts
async function loadProfile(
  userId: string,
): Promise<{ user: UserRow | null; ptProfile: PtProfileRow | null; mfaFactors: MfaFactors }> {
  const [{ data: user, error: userError }, { data: mfaData }] = await Promise.all([
    supabase.from('users').select('*').eq('id', userId).maybeSingle(),
    supabase.auth.mfa.listFactors(),
  ]);

  // M4b cold offline boot: with offline logging switched on for this device,
  // a profile read that never reached the server falls back to the last one
  // we saw for this same user id, so the gate can let a basement session in.
  const offlineChoice = (await getStoredValue(OFFLINE_CHOICE_KEY)) === '1';
  if (!user && offlineChoice && isNetworkError(userError)) {
    const cached = await engine.getCache<{ user: UserRow; ptProfile: PtProfileRow | null }>('profile:' + userId);
    if (cached) return { user: cached.value.user, ptProfile: cached.value.ptProfile, mfaFactors: mfaData ?? null };
  }

  let ptProfile: PtProfileRow | null = null;
  if (user?.role === 'pt') {
    const { data } = await supabase.from('pt_profiles').select('*').eq('user_id', userId).maybeSingle();
    ptProfile = data ?? null;
  }

  if (user && offlineChoice) void engine.putCache('profile:' + userId, { user, ptProfile });

  return { user: user ?? null, ptProfile, mfaFactors: mfaData ?? null };
}
```

Add the imports:

```ts
import { isNetworkError } from '@forge/shared';
import { getStoredValue } from '../deviceStore';
import { engine, OFFLINE_CHOICE_KEY } from '../offline/engine';
```

The profile goes into the KvStore, not `deviceStore`. SecureStore warns above 2 KB, and a PT profile with a bio exceeds that.

- [x] **Step 5: Typecheck, lint, commit**

```powershell
pnpm --filter mobile typecheck
pnpm --filter mobile lint
git add apps/mobile
git commit -m "feat(mobile): OfflineProvider — switch, connectivity, drain; cached profile on cold offline boot"
```

---

## Task 11 · Mobile: read-through cache and warming

**Files:**
- Create: `apps/mobile/src/lib/offline/cachedFetch.ts`, `apps/mobile/src/lib/offline/fetchLastSets.ts`, `apps/mobile/src/lib/logging/loadWeek.ts`, `apps/mobile/src/lib/home/fetchClientHome.ts`
- Replace: `apps/mobile/src/lib/offline/warmCache.ts`
- Modify: `apps/mobile/src/lib/clients/useClientList.ts`, `apps/mobile/src/lib/clients/useClientDetail.ts`, `apps/mobile/src/lib/logging/StartSessionSheet.tsx`, `apps/mobile/src/lib/logging/useInProgressSession.ts`, `apps/mobile/src/app/(app)/(tabs)/index.tsx`

- [x] **Step 1: Write `cachedFetch.ts`**

```ts
import { engine } from './engine';

/** Error sentinel a fetcher returns when the request never reached the server. */
export const OFFLINE = 'offline';

/**
 * Read-through cache for the screens that must work offline (spec §5.4).
 * Switch off: exactly the fetcher. Switch on: a good result is stored under
 * `key`; a network failure (or no signal at all) returns the stored one.
 * Only results with `error === null` are ever stored.
 */
export async function cachedFetch<T extends { error: string | null }>(
  opts: { enabled: boolean; online: boolean },
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  if (!opts.enabled) return fetcher();
  if (!opts.online) {
    const hit = await engine.getCache<T>(key);
    if (hit) return hit.value;
  }
  const result = await fetcher();
  if (result.error === OFFLINE) {
    const hit = await engine.getCache<T>(key);
    return hit?.value ?? result;
  }
  if (result.error === null) await engine.putCache(key, result);
  return result;
}
```

- [x] **Step 2: Map network errors to `OFFLINE` in the existing fetchers and export them**

`lib/clients/useClientList.ts`: export `fetchRoster` and change its error line to:

```ts
  if (error) {
    return { rows: [], error: isNetworkError(error) ? OFFLINE : error.message };
  }
```

and wrap the two call sites (the mount effect and `refetch`) as follows. Add `const offline = useOffline();` at the top of `useClientList`, and add `offline.effective, offline.online` to both dependency arrays.

```ts
cachedFetch({ enabled: offline.effective, online: offline.online }, 'roster:' + ptUserId, () => fetchRoster(ptUserId))
```

`lib/clients/useClientDetail.ts`: export `fetchClientDetail`. Its first error return becomes:

```ts
      error: clientResult.error && isNetworkError(clientResult.error) ? OFFLINE : (clientResult.error?.message ?? 'Client not found'),
```

Both call sites become `cachedFetch({ enabled: offline.effective, online: offline.online }, 'client:' + clientId, () => fetchClientDetail(clientId, unitSystem))`, with `useOffline()` and the two dependencies added as above.

Imports for both files:

```ts
import { isNetworkError } from '@forge/shared';
import { cachedFetch, OFFLINE } from '../offline/cachedFetch';
import { useOffline } from '../offline/offlineContext';
```

- [x] **Step 3: Move `loadWeek` out of the sheet into `lib/logging/loadWeek.ts`**

```ts
import { isNetworkError, programTreeSchema, weekCompletion, type ProgramTree } from '@forge/shared';
import { OFFLINE } from '../offline/cachedFetch';
import { supabase } from '../supabase';

export type DayOption = { id: string; dayNumber: number; label: string | null; done: boolean };
export type WeekLoad = { program: ProgramTree | null; week: number; days: DayOption[]; error: string | null };

export const EMPTY_WEEK: WeekLoad = { program: null, week: 1, days: [], error: null };

/** The active program's current week for one client, with done-day marks (M4a spec §5.2). */
export async function loadWeek(clientId: string): Promise<WeekLoad> {
  const { data: active, error } = await supabase
    .from('programs')
    .select('id, duration_weeks, start_date')
    .eq('client_id', clientId)
    .eq('state', 'active')
    .maybeSingle();
  if (error) return { ...EMPTY_WEEK, error: isNetworkError(error) ? OFFLINE : error.message };
  if (!active) return EMPTY_WEEK;
  const { data: raw } = await supabase.rpc('program_tree', { p_program_id: active.id });
  const parsed = programTreeSchema.safeParse(raw);
  if (!parsed.success) return EMPTY_WEEK;
  const current = weekCompletion({ duration_weeks: active.duration_weeks, start_date: active.start_date }).currentWeek ?? 1;
  const weekNode = parsed.data.weeks.find((w) => w.week_number === current) ?? parsed.data.weeks[0];
  const dayIds = (weekNode?.days ?? []).map((d) => d.id);
  let doneIds = new Set<string>();
  if (dayIds.length > 0) {
    const { data: done } = await supabase
      .from('workout_sessions')
      .select('program_day_id')
      .eq('client_id', clientId)
      .eq('status', 'completed')
      .in('program_day_id', dayIds);
    doneIds = new Set((done ?? []).map((r) => r.program_day_id).filter((id): id is string => id !== null));
  }
  return {
    program: parsed.data,
    week: weekNode?.week_number ?? current,
    days: (weekNode?.days ?? []).map((d) => ({ id: d.id, dayNumber: d.day_number, label: d.label, done: doneIds.has(d.id) })),
    error: null,
  };
}
```

In `StartSessionSheet.tsx`, delete the local `DayOption`, `Loaded`, `EMPTY` and `loadWeek`, import `loadWeek`, `EMPTY_WEEK`, `WeekLoad` from `./loadWeek`, replace `Loaded` with `WeekLoad` and `EMPTY` with `EMPTY_WEEK`, and wrap the effect's call:

```ts
void cachedFetch({ enabled: offline.effective, online: offline.online }, 'week:' + clientId, () => loadWeek(clientId)).then((r) => {
```

with `const offline = useOffline();` at the top of the component and `offline.effective, offline.online` in the effect's dependencies. New imports in the sheet:

```ts
import { cachedFetch } from '../offline/cachedFetch';
import { useOffline } from '../offline/offlineContext';
import { EMPTY_WEEK, loadWeek, type WeekLoad } from './loadWeek';
```

- [x] **Step 4: Write `lib/offline/fetchLastSets.ts`**

```ts
import { isNetworkError, type SetRow } from '@forge/shared';
import { supabase } from '../supabase';
import { OFFLINE } from './cachedFetch';

export type LastSets = { last: Record<string, SetRow>; error: string | null };

/**
 * The most recent completed working set per exercise for one client, over
 * their last 20 completed sessions. The session screen's "Last:" line reads
 * this from the cache when it cannot ask the server.
 */
export async function fetchLastSets(clientId: string): Promise<LastSets> {
  const { data: recent, error } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(20);
  if (error) return { last: {}, error: isNetworkError(error) ? OFFLINE : error.message };
  const ids = (recent ?? []).map((r) => r.id);
  if (ids.length === 0) return { last: {}, error: null };
  const { data: sets, error: setsError } = await supabase
    .from('sets')
    .select('*')
    .in('workout_session_id', ids)
    .eq('is_warmup', false)
    .order('created_at', { ascending: false });
  if (setsError) return { last: {}, error: isNetworkError(setsError) ? OFFLINE : setsError.message };
  const last: Record<string, SetRow> = {};
  for (const s of sets ?? []) if (!last[s.exercise_id]) last[s.exercise_id] = s;
  return { last, error: null };
}
```

- [x] **Step 5: Extract `lib/home/fetchClientHome.ts` from `ClientHome`'s effect**

```ts
import { isNetworkError, type Database } from '@forge/shared';
import { OFFLINE } from '../offline/cachedFetch';
import { supabase } from '../supabase';

type ClientRow = Database['public']['Tables']['clients']['Row'];
type IntakeRow = Database['public']['Tables']['intake_forms']['Row'];

export type ClientHomeData = {
  client: ClientRow | null;
  ptInfo: { display_name: string; avatar_url: string | null } | null;
  intake: IntakeRow | null;
  error: string | null;
};

export async function fetchClientHome(userId: string): Promise<ClientHomeData> {
  const { data: client, error } = await supabase.from('clients').select('*').eq('client_user_id', userId).maybeSingle();
  if (error) return { client: null, ptInfo: null, intake: null, error: isNetworkError(error) ? OFFLINE : error.message };
  if (!client) return { client: null, ptInfo: null, intake: null, error: null };
  const [{ data: ptInfo }, { data: intake }] = await Promise.all([
    supabase.from('users').select('display_name, avatar_url').eq('id', client.pt_user_id).maybeSingle(),
    supabase.from('intake_forms').select('*').eq('client_id', client.id).maybeSingle(),
  ]);
  return { client, ptInfo: ptInfo ?? null, intake: intake ?? null, error: null };
}
```

In `app/(app)/(tabs)/index.tsx` `ClientHome`, replace the `.then(async () => { … })` body with:

```ts
      .then(() =>
        cachedFetch({ enabled: offline.effective, online: offline.online }, 'clientHome:' + (auth.user?.id ?? ''), () =>
          fetchClientHome(auth.user?.id ?? ''),
        ),
      )
      .then((r) => {
        if (!cancelled) setState({ loading: false, client: r.client, ptInfo: r.ptInfo, intake: r.intake });
      });
```

Add `const offline = useOffline();` to `ClientHome`, and add `offline.effective` and `offline.online` to the effect's dependency array. New imports in that file:

```ts
import { fetchClientHome } from '../../../lib/home/fetchClientHome';
import { cachedFetch } from '../../../lib/offline/cachedFetch';
import { useOffline } from '../../../lib/offline/offlineContext';
``` `claimClientInvites()` stays first and keeps its `.catch`: offline, it fails fast and the cache answers.

- [x] **Step 6: Local in-progress sessions in `useInProgressSession.ts`**

Export `fetchInProgress`, map its first error with `isNetworkError(error) ? OFFLINE : error.message`, and change the focus effect's body to:

```ts
      void cachedFetch({ enabled: offline.effective, online: offline.online }, 'inprogress', fetchInProgress)
        .then(async (result) => {
          if (!offline.effective) return result;
          // A session started offline exists only locally until its start replays.
          // Only sessions with queued work count: a local copy of a server
          // session may be stale (finished on another device since).
          const queued = new Set((await engine.entries()).map((e) => e.sessionId));
          const local = (await engine.localSessionsInProgress())
            .filter((s) => queued.has(s.id))
            .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))[0];
          if (!local || (result.session && result.session.id === local.id)) return result;
          return { session: { ...local, clientName: null }, error: null };
        })
        .then((result) => {
          if (!cancelled) setState({ session: result.session, loading: false, error: result.error });
        });
```

with `const offline = useOffline();` and the deps `[offline.effective, offline.online]` on the `useCallback`. New imports:

```ts
import { isNetworkError } from '@forge/shared';
import { cachedFetch, OFFLINE } from '../offline/cachedFetch';
import { engine } from '../offline/engine';
import { useOffline } from '../offline/offlineContext';
``` The Resume banner already renders without a name when `clientName` is null (PITFALLS I3).

- [x] **Step 7: Replace `lib/offline/warmCache.ts`**

```ts
import type { Database } from '@forge/shared';
import { fetchClientDetail } from '../clients/useClientDetail';
import { fetchRoster } from '../clients/useClientList';
import { fetchClientHome } from '../home/fetchClientHome';
import { fetchInProgress } from '../logging/useInProgressSession';
import { loadWeek } from '../logging/loadWeek';
import { cachedFetch } from './cachedFetch';
import { engine } from './engine';
import { fetchLastSets } from './fetchLastSets';

type UserRow = Database['public']['Tables']['users']['Row'];

const ON = { enabled: true, online: true };

async function warmClient(clientId: string, name: string | null, unit: 'metric' | 'imperial'): Promise<void> {
  await Promise.all([
    cachedFetch(ON, 'client:' + clientId, () => fetchClientDetail(clientId, unit)),
    cachedFetch(ON, 'week:' + clientId, () => loadWeek(clientId)),
    cachedFetch(ON, 'last:' + clientId, () => fetchLastSets(clientId)),
    engine.putCache('clientName:' + clientId, { name }),
  ]);
}

/**
 * Spec §6: everything an offline start needs, fetched ahead of time. Runs the
 * same fetchers the screens run, so the cache holds exactly what they read.
 * Returns the warm time, or null when the roster itself could not be read.
 */
export async function warmCache(user: UserRow): Promise<string | null> {
  const unit = (user.unit_system as 'metric' | 'imperial' | null) ?? 'metric';
  await cachedFetch(ON, 'inprogress', fetchInProgress);

  if (user.role === 'pt') {
    const roster = await cachedFetch(ON, 'roster:' + user.id, () => fetchRoster(user.id));
    if (roster.error !== null) return null;
    for (const c of roster.rows.filter((r) => r.state === 'active')) {
      await warmClient(c.id, c.displayName, unit);
    }
  } else {
    const home = await cachedFetch(ON, 'clientHome:' + user.id, () => fetchClientHome(user.id));
    if (home.error !== null) return null;
    if (home.client) await warmClient(home.client.id, user.display_name, unit);
  }

  const at = new Date().toISOString();
  await engine.putCache('warmedAt', at);
  return at;
}
```

Clients are warmed one at a time on purpose. Thirty parallel program-tree RPCs from a phone on a weak signal would time out together.

- [x] **Step 8: Typecheck, lint, commit**

```powershell
pnpm --filter mobile typecheck
pnpm --filter mobile lint
git add apps/mobile
git commit -m "feat(mobile): read-through cache on roster, client, week, home, in-progress; warm on sign-in"
```

---

## Task 12 · Mobile: offline writes on the start sheet and session screen

**Files:**
- Create: `apps/mobile/src/lib/offline/loggingRepo.ts`
- Modify: `apps/mobile/src/lib/logging/useSession.ts`, `apps/mobile/src/lib/logging/sessionModel.ts`, `apps/mobile/src/lib/logging/StartSessionSheet.tsx`, `apps/mobile/src/app/(app)/sessions/[id]/index.tsx`

- [x] **Step 1: Write `loggingRepo.ts`, the queued half of the four writes**

```ts
import type { CompleteSessionInput, LogSetInput, SessionRow, SetRow } from '@forge/shared';
import * as Crypto from 'expo-crypto';
import { engine } from './engine';

/**
 * The offline path of the four M4a writes (spec §5.1). Each call writes the
 * optimistic local row and the outbox entry in one atomic batch. The online
 * path is still lib/logging/sessionRpc.ts, called directly by the screens when
 * the switch is off.
 */

export async function queueStart(input: {
  clientId: string;
  programDayId: string | null;
  dayLabel: string | null;
  dayNumber: number | null;
  weekNumber: number | null;
  viewerId: string;
  isPtLed: boolean;
}): Promise<string> {
  // M4a D4 locally: reuse this client's in-progress session if it still has
  // queued work on this device. A local copy with nothing queued may be stale
  // (finished elsewhere); start fresh and let the server's D4 merge decide.
  const queued = new Set((await engine.entries()).map((e) => e.sessionId));
  const existing = (await engine.localSessionsInProgress()).find(
    (s) => s.client_id === input.clientId && queued.has(s.id),
  );
  if (existing) return existing.id;

  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  const row: SessionRow = {
    id,
    client_id: input.clientId,
    status: 'in_progress',
    started_at: now,
    created_at: now,
    updated_at: now,
    scheduled_date: now.slice(0, 10),
    is_pt_led: input.isPtLed,
    logged_by_user_id: input.viewerId,
    program_day_id: input.programDayId,
    day_label: input.programDayId ? input.dayLabel : null,
    day_number: input.programDayId ? input.dayNumber : null,
    week_number: input.programDayId ? input.weekNumber : null,
    booking_id: null,
    completed_at: null,
    duration_min: null,
    gym_id: null,
    pt_notes: null,
    rating: null,
    session_notes: null,
  };
  await engine.enqueue(
    { op: 'start', sessionId: id, args: { p_client_id: input.clientId, p_program_day_id: input.programDayId, p_id: id, p_started_at: now } },
    [{ table: 'sessions', key: id, value: row }],
  );
  return id;
}

export async function queueLogSet(
  sessionId: string,
  exerciseId: string,
  setNumber: number,
  input: LogSetInput,
  optimistic: SetRow,
  deviceId: string | null,
): Promise<void> {
  await engine.enqueue(
    {
      op: 'log_set',
      sessionId,
      args: {
        p_id: input.id,
        p_session_id: sessionId,
        p_exercise_id: exerciseId,
        p_set_number: setNumber,
        p_weight_kg: input.weight_kg,
        p_reps: input.reps,
        p_rpe: input.rpe,
        p_notes: input.notes,
        p_is_warmup: input.is_warmup,
        p_device_id: deviceId,
      },
    },
    [{ table: 'sets', key: optimistic.id, value: optimistic }],
  );
}

export async function queueDeleteSet(set: SetRow): Promise<void> {
  await engine.enqueue({ op: 'delete_set', sessionId: set.workout_session_id, args: { p_id: set.id } }, [
    { table: 'sets', key: set.id, value: null },
  ]);
}

export async function queueComplete(session: SessionRow, input: CompleteSessionInput): Promise<void> {
  const now = new Date();
  const started = new Date(session.started_at ?? session.created_at).getTime();
  const local: SessionRow = {
    ...session,
    status: 'completed',
    completed_at: now.toISOString(),
    duration_min: Math.max(1, Math.round((now.getTime() - started) / 60_000)),
    rating: input.rating,
  };
  await engine.enqueue(
    {
      op: 'complete',
      sessionId: session.id,
      args: { p_session_id: session.id, p_rating: input.rating, p_notes: input.notes, p_completed_at: now.toISOString() },
    },
    [{ table: 'sessions', key: session.id, value: local }],
  );
}
```

- [x] **Step 2: Make `useSession.ts` offline-aware**

Add the imports:

```ts
import { isNetworkError } from '@forge/shared';
import { OFFLINE } from '../offline/cachedFetch';
import { engine } from '../offline/engine';
import type { LastSets } from '../offline/fetchLastSets';
import { useOffline } from '../offline/offlineContext';
import type { WeekLoad } from './loadWeek';
```

In `fetchSession`, map its first error: `if (error) return { ...EMPTY, error: isNetworkError(error) ? OFFLINE : error.message };`.

Add below `fetchSession`:

```ts
/** A session built only from the device: local rows plus the warmed cache (spec §5.4). */
async function localLoaded(sessionId: string): Promise<Loaded | null> {
  const session = await engine.localSession(sessionId);
  if (!session) return null;
  const sets = await engine.localSets(session.id);
  const week = await engine.getCache<WeekLoad>('week:' + session.client_id);
  let day: ProgramDay | null = null;
  for (const w of week?.value.program?.weeks ?? []) {
    const found = w.days.find((d) => d.id === session.program_day_id);
    if (found) {
      day = found;
      break;
    }
  }
  const names: Record<string, ExerciseName> = {};
  for (const block of day?.blocks ?? []) {
    for (const e of block.exercises) names[e.exercise_id] = { name: e.exercise_name, name_ar: e.exercise_name_ar ?? null };
  }
  const last = await engine.getCache<LastSets>('last:' + session.client_id);
  const clientName = (await engine.getCache<{ name: string | null }>('clientName:' + session.client_id))?.value.name ?? null;
  return { loading: false, error: null, session, sets, day, clientName, names, lastByExercise: last?.value.last ?? {} };
}

async function loadSession(sessionId: string, offline: { effective: boolean; online: boolean }): Promise<Loaded> {
  if (!offline.effective) return fetchSession(sessionId);
  const id = await engine.resolveSessionId(sessionId);
  const server = offline.online ? await fetchSession(id) : null;
  if (server && server.error === null && server.session) {
    // A Finish still in the outbox: the device's completed row wins over the
    // server's in_progress, or the screen would flip back to logging.
    const local = await engine.localSession(id);
    const session = local?.status === 'completed' && server.session.status === 'in_progress' ? local : server.session;
    // Keep an in-progress session on the device so a kill plus an offline reopen still has it.
    if (session.status === 'in_progress') {
      await engine.applyServerSession(session);
      for (const s of server.sets) await engine.applyServerSet(s);
    }
    return { ...server, session, sets: await engine.overlaySets(id, server.sets) };
  }
  // Offline, or a session whose start has not replayed yet (the server says not_found).
  return (await localLoaded(id)) ?? server ?? { ...EMPTY, error: 'not_found' };
}
```

In `useSession`, add `const offline = useOffline();`. Replace both `fetchSession(sessionId)` calls (mount effect and `refetch`) with `loadSession(sessionId, { effective: offline.effective, online: offline.online })`, and add `offline.effective, offline.online` to both dependency arrays.

- [x] **Step 3: Order sets by ULID in `sessionModel.ts` (spec D10)**

Replace `setsFor`:

```ts
export function setsFor(sets: readonly SetRow[], exerciseId: string): SetRow[] {
  return orderSets(sets.filter((s) => s.exercise_id === exerciseId));
}
```

with `import { orderSets, type ProgramTree } from '@forge/shared';` replacing the type-only import. `nextSetNumber` is unchanged: it is what the device sends, and `displayNumbers` decides what is printed.

- [x] **Step 4: Offline start in `StartSessionSheet.tsx`**

Add the imports `import { useAuth } from '../auth/AuthProvider';` and `import { queueStart } from '../offline/loggingRepo';`, add `const auth = useAuth();` next to `useOffline()`, and put this at the top of `start()`, after `setError(null)`:

```ts
    if (offline.effective) {
      const day = selected === 'freestyle' ? null : (loaded.days.find((d) => d.id === selected) ?? null);
      const id = await queueStart({
        clientId,
        programDayId: day?.id ?? null,
        dayLabel: day?.label ?? null,
        dayNumber: day?.dayNumber ?? null,
        weekNumber: day ? loaded.week : null,
        viewerId: auth.user?.id ?? '',
        isPtLed: viewerIsPt,
      });
      offline.drainNow();
      setStarting(false);
      onDismiss();
      router.replace({ pathname: '/(app)/sessions/[id]', params: { id } });
      return;
    }
```

- [x] **Step 5: The session screen writes through the outbox when the switch is effective**

In `app/(app)/sessions/[id]/index.tsx`:

(a) Imports:

```ts
import { displayNumbers } from '@forge/shared';
import { engine } from '../../../../lib/offline/engine';
import { queueComplete, queueDeleteSet, queueLogSet } from '../../../../lib/offline/loggingRepo';
import { useOffline } from '../../../../lib/offline/offlineContext';
```

(`displayNumbers` joins the existing `@forge/shared` import list rather than a second line.)

(b) `type PendingSet = { id: string; error: string | null; queued?: boolean };`, and `const offline = useOffline();` below `const data = useSession(params.id);`.

(c) Extract the rest-timer start from the end of `submitSet` into a function inside the component:

```ts
  function startRest(setNumber: number, isWarmup: boolean) {
    if (isWarmup || !current) return;
    setRest(() => ({
      startedAt: Date.now(),
      seconds: current.restSec ?? DEFAULT_REST_SEC,
      setNumber: setNumber + 1,
      total: current.targetSets,
    }));
  }
```

and call `startRest(setNumber, input.data.is_warmup)` where the old inline `setRest` block was, keeping it inside `if (!existing)`.

(d) In `submitSet`, directly after `haptic('light');`:

```ts
    if (offline.effective) {
      await queueLogSet(session.id, exerciseId, setNumber, input.data, optimistic, Platform.OS);
      setPending((p) => ({ ...p, [id]: { id, error: null, queued: true } }));
      offline.drainNow();
      if (!existing) startRest(setNumber, input.data.is_warmup);
      return;
    }
```

(e) `removeSet`, first lines:

```ts
    if (offline.effective) {
      data.removeSet(set.id);
      await queueDeleteSet(set);
      offline.drainNow();
      return;
    }
```

(f) `finish`, after the schema check and before `setFinishing(true)`:

```ts
    if (offline.effective) {
      await queueComplete(session, input.data);
      offline.drainNow();
      setFinishOpen(false);
      await data.refetch();
      return;
    }
```

(g) Engine events: synced sets, their PR moment, a merged session id, failures. The handler reads fresh render values through a ref, so the subscription is made once per switch state rather than on every render (`prLine` and `haptic` are redefined each render).

```ts
  const onEngineEvent = useRef<(e: EngineEvent) => void>(() => {});
  useEffect(() => {
    onEngineEvent.current = (e: EngineEvent) => {
      if (e.type === 'set_synced' && e.set.workout_session_id === session?.id) {
        data.applySet(e.set);
        setPending((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== e.set.id)));
        if (e.newPrs.length > 0 && !e.set.is_warmup) {
          setPrLines(e.newPrs.map((h) => prLine(h as PrType, e.set)));
          haptic('success');
        }
      }
      if (e.type === 'session_rewritten' && (e.from === params.id || e.from === session?.id)) {
        router.replace({ pathname: '/(app)/sessions/[id]', params: { id: e.to } });
      }
      if (e.type === 'failed' && e.entry.op === 'log_set' && e.entry.sessionId === session?.id) {
        const setId = e.entry.args.p_id;
        setPending((p) => ({ ...p, [setId]: { id: setId, error: mapLoggingError(e.entry.lastError, t) } }));
      }
    };
  });
  useEffect(() => {
    if (!offline.effective) return;
    return engine.subscribe((e) => onEngineEvent.current(e));
  }, [offline.effective]);
```

Add `useRef` to the `react` import and `type EngineEvent` to the `@forge/shared` import.

`mapLoggingError` takes `PostgrestError | Error`, and an `RpcError` has no `name`, so it is not assignable. Widen the parameter in `lib/logging/loggingErrors.ts` to `error: { code?: string | null; message?: string | null } | null | undefined`. The body only reads `code` and `message`, and every existing caller still type-checks.

(h) Display numbers. Below the `exercises` memo:

```ts
  const displayNo = useMemo(() => displayNumbers(data.sets), [data.sets]);
```

and at both `t('logging.session.setN', { n: s.set_number })` sites (the summary list and the in-progress list), use `{ n: displayNo[s.id] ?? s.set_number }`.

(i) Queued rows. In the in-progress set list, directly after the `{p?.error ? ( … ) : null}` block:

```tsx
                        {p?.queued && !p.error ? (
                          <Text variant="caption" tone="muted">
                            {t('logging.offline.notSynced')}
                          </Text>
                        ) : null}
```

(j) Add exercise offline. Where the rail's "+" pushes the picker route, guard it:

```ts
if (offline.effective && !offline.online) return;
```

and render the "+" chip disabled under the same condition. The picker is the online-only library.

- [x] **Step 6: Typecheck, lint, commit**

```powershell
pnpm --filter mobile typecheck
pnpm --filter mobile lint
git add apps/mobile
git commit -m "feat(mobile): offline start, log, delete, finish through the outbox"
```

---

## Task 13 · Mobile: the live mirror

**Files:**
- Create: `apps/mobile/src/lib/offline/useSessionChannel.ts`, `apps/mobile/src/ui/LiveBadge.tsx`
- Modify: `apps/mobile/src/ui/index.ts`, `apps/mobile/src/app/(app)/sessions/[id]/index.tsx`

- [x] **Step 1: Write `useSessionChannel.ts`**

```ts
import type { SessionRow, SetRow } from '@forge/shared';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';
import { engine } from './engine';

type Handlers = {
  onSet: (row: SetRow) => void;
  onDelete: (id: string) => void;
  onSession: (row: SessionRow) => void;
};

type BroadcastPayload = {
  table?: string;
  operation?: string;
  record?: unknown;
  old_record?: unknown;
};

/**
 * Spec §4.2 / §7, the live mirror. Joins the private topic session:<id>;
 * Realtime authorizes the join against 0016's realtime.messages policy, so a
 * stranger's join fails server-side. Payloads are what
 * realtime.broadcast_changes sends: { table, operation, record, old_record }.
 *
 * With offline logging effective, every row goes through the engine first:
 * a pending local write for the same id wins, and an echo of our own write
 * is dropped. Returns whether the channel is joined (the Live badge).
 */
export function useSessionChannel(sessionId: string | null, handlers: Handlers, throughEngine: boolean): boolean {
  const [joined, setJoined] = useState(false);
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    const handle = (msg: { payload?: BroadcastPayload }) => {
      const p = msg.payload ?? {};
      if (p.table === 'sets' && p.operation === 'DELETE') {
        const id = (p.old_record as { id?: string } | undefined)?.id;
        if (!id) return;
        void (throughEngine ? engine.applyServerSetDelete(id) : Promise.resolve(true)).then((ok) => {
          if (ok && !cancelled) latest.current.onDelete(id);
        });
        return;
      }
      if (p.table === 'sets' && p.record) {
        const row = p.record as SetRow;
        void (throughEngine ? engine.applyServerSet(row) : Promise.resolve(true)).then((ok) => {
          if (ok && !cancelled) latest.current.onSet(row);
        });
        return;
      }
      if (p.table === 'workout_sessions' && p.record) {
        const row = p.record as SessionRow;
        void (throughEngine ? engine.applyServerSession(row) : Promise.resolve(true)).then((ok) => {
          if (ok && !cancelled) latest.current.onSession(row);
        });
      }
    };

    const channel = supabase
      .channel('session:' + sessionId, { config: { private: true } })
      .on('broadcast', { event: 'INSERT' }, handle)
      .on('broadcast', { event: 'UPDATE' }, handle)
      .on('broadcast', { event: 'DELETE' }, handle);

    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel.subscribe((status) => {
        if (!cancelled) setJoined(status === 'SUBSCRIBED');
      });
    });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [sessionId, throughEngine]);

  return joined;
}
```

- [x] **Step 2: Write `ui/LiveBadge.tsx`**

```tsx
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type LiveBadgeProps = { live: boolean; label: string };

/** Session header mark: a success dot while the mirror channel is joined, muted otherwise. Copy comes from the screen. */
export function LiveBadge({ live, label }: LiveBadgeProps) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 }}
    >
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: live ? t.colors.successAccent : t.colors.textMuted,
        }}
      />
      <Text variant="caption" tone={live ? 'secondary' : 'muted'}>
        {label}
      </Text>
    </View>
  );
}
```

Export it from `ui/index.ts` next to `PrBanner`: `export { LiveBadge, type LiveBadgeProps } from './LiveBadge';`. If `t.colors.textMuted` does not exist, use the token `Text tone="muted"` resolves to (read `ui/Text.tsx`).

- [x] **Step 3: Wire it into the session screen**

Import `useSessionChannel` from `../../../../lib/offline/useSessionChannel` and `LiveBadge` from the ui barrel. Below `const offline = useOffline();`:

```ts
  const live = useSessionChannel(
    session?.id ?? null,
    {
      onSet: data.applySet,
      onDelete: data.removeSet,
      onSession: () => void data.refetch(),
    },
    offline.effective,
  );
```

In the in-progress `NavHeader`, replace the `title` prop with:

```tsx
        title={
          <Row style={{ gap: theme.space[2], alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="bodyBold" numberOfLines={1} style={{ flexShrink: 1 }}>
              {title}
            </Text>
            <LiveBadge live={live} label={live ? t('logging.offline.live') : t('logging.offline.notLive')} />
          </Row>
        }
```

The completed summary keeps its plain title, but the channel stays joined there too, so a late set (D6) appears on a summary the PT is looking at.

- [x] **Step 4: Typecheck, lint, commit**

```powershell
pnpm --filter mobile typecheck
pnpm --filter mobile lint
git add apps/mobile
git commit -m "feat(mobile): live mirror over a private Realtime topic, Live badge"
```

---

## Task 14 · Mobile: offline chip, sync queue, settings, sign-out guard

**Files:**
- Create: `apps/mobile/src/ui/OfflineChip.tsx`, `apps/mobile/src/lib/offline/OfflineStatusChip.tsx`, `apps/mobile/src/app/(app)/sync-queue.tsx`
- Modify: `apps/mobile/src/ui/index.ts`, `apps/mobile/src/app/(app)/(tabs)/index.tsx`, `apps/mobile/src/app/(app)/(tabs)/clients.tsx`, `apps/mobile/src/app/(app)/clients/[id]/index.tsx`, `apps/mobile/src/app/(app)/sessions/[id]/index.tsx`, `apps/mobile/src/app/(app)/settings/index.tsx`

**Correction to spec §7:** the chip is not global. It renders at the top of the scroll content of the four screens that work offline (Today, Clients, client detail, the session screen). A global overlay would sit on top of each screen's own header or its `FooterBar`, and every stack sets `headerShown: false`, so there is no shared header to put it in.

- [x] **Step 1: Write `ui/OfflineChip.tsx`**

```tsx
import { Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type OfflineChipProps = { label: string; tone: 'offline' | 'syncing' | 'failed'; onPress: () => void };

/** The offline/sync status pill. A tappable Tag, full-width-safe; copy comes from the caller. */
export function OfflineChip({ label, tone, onPress }: OfflineChipProps) {
  const t = useTheme();
  const colors =
    tone === 'failed'
      ? { bg: t.colors.dangerSurface, fg: t.colors.onDangerSurface }
      : tone === 'syncing'
        ? { bg: t.colors.accentSurfaceSoft, fg: t.colors.onAccentSurfaceSoft }
        : { bg: t.colors.warnSurface, fg: t.colors.onWarnSurface };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: t.radius.pill,
        backgroundColor: colors.bg,
      }}
    >
      <Text variant="caption" style={{ color: colors.fg, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}
```

Export from `ui/index.ts`: `export { OfflineChip, type OfflineChipProps } from './OfflineChip';`.

- [x] **Step 2: Write `lib/offline/OfflineStatusChip.tsx`, the copy and visibility rule**

```tsx
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { OfflineChip } from '../../ui';
import { useOffline } from './offlineContext';

/**
 * Spec §7. Hidden when the switch is off, or when online with nothing queued.
 * Priority: signed-out pause, then failures, then offline, then syncing.
 */
export function OfflineStatusChip() {
  const { t } = useTranslation();
  const o = useOffline();
  const queued = o.status.pending + o.status.failed;
  if (!o.effective && queued === 0) return null;
  if (o.online && queued === 0) return null;

  const open = () => router.push('/(app)/sync-queue');
  if (o.authPaused) return <OfflineChip tone="failed" label={t('logging.offline.authPaused', { count: queued })} onPress={open} />;
  if (o.status.failed > 0) {
    return <OfflineChip tone="failed" label={t('logging.offline.chipPending', { count: queued })} onPress={open} />;
  }
  if (!o.online) {
    const label =
      queued > 0
        ? t('logging.offline.chipPending', { count: queued })
        : o.warmedAt
          ? t('logging.offline.chipOffline', {
              time: new Date(o.warmedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            })
          : t('logging.offline.chipOfflineNever');
    return <OfflineChip tone="offline" label={label} onPress={open} />;
  }
  return <OfflineChip tone="syncing" label={t('logging.offline.chipSyncing', { count: queued })} onPress={open} />;
}
```

- [x] **Step 3: Place `<OfflineStatusChip />` on the four screens**

It goes as the first child of each screen's main `ScrollView` content container (it renders `null` when hidden, so no spacing is left behind):
- `app/(app)/(tabs)/index.tsx`: both `PtHome`'s and `ClientHome`'s main `ScrollView`, directly above `<HomeHeader … />`.
- `app/(app)/(tabs)/clients.tsx`: first child of the list `ScrollView`.
- `app/(app)/clients/[id]/index.tsx`: first child of the `ScrollView` under `NavHeader`.
- `app/(app)/sessions/[id]/index.tsx`: first child of the in-progress `ScrollView`.

Import path from `app/(app)/(tabs)/*`: `'../../../lib/offline/OfflineStatusChip'`. From `app/(app)/clients/[id]/index.tsx` and `app/(app)/sessions/[id]/index.tsx`: `'../../../../lib/offline/OfflineStatusChip'`.

- [x] **Step 3b: Online-only screens say so (spec §7)**

Create `lib/offline/NeedsConnection.tsx`:

```tsx
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, Screen } from '../../ui';
import { useOffline } from './offlineContext';

/**
 * Wraps a screen that has no offline path. With the switch effective and no
 * signal it shows why, instead of that screen's generic load error. A pushed
 * screen gets a Back action (PITFALLS N1, N15); a tab does not need one.
 */
export function NeedsConnection({ children, pushed = false }: { children: ReactNode; pushed?: boolean }) {
  const { t } = useTranslation();
  const o = useOffline();
  if (!o.effective || o.online) return children;
  return (
    <Screen>
      <EmptyState
        icon="alert"
        title={t('logging.offline.needsConnection')}
        body={t('logging.offline.needsConnectionBody')}
        {...(pushed ? { actionLabel: t('common.back'), actionVariant: 'ghost' as const, onAction: () => router.dismissTo('/') } : {})}
      />
    </Screen>
  );
}
```

Wrap these four screens. Rename each file's default-exported component to `…Inner` (not exported), then add:

- `app/(app)/(tabs)/library.tsx`: `export default function LibraryTab() { return <NeedsConnection><LibraryTabInner /></NeedsConnection>; }`
- `app/(app)/(tabs)/programs.tsx`: same shape, no `pushed`.
- `app/(app)/my-sessions.tsx`: same shape, `pushed`.
- `app/(app)/clients/[id]/sessions.tsx`: same shape, `pushed`.

Use each file's existing default-export name for the wrapper, so nothing that imports it changes.

- [x] **Step 4: Write `app/(app)/sync-queue.tsx`**

```tsx
import { formatWeight, type OutboxEntry, type UnitSystem } from '@forge/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../lib/auth/AuthProvider';
import { mapLoggingError } from '../../lib/logging/loggingErrors';
import { engine } from '../../lib/offline/engine';
import { useOffline } from '../../lib/offline/offlineContext';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, EmptyState, FooterBar, IconButton, NavHeader, Row, Screen, SectionCard, Tag, Text } from '../../ui';

/**
 * Spec §7. Every outbox entry, oldest first, with Retry / Discard on the ones
 * that failed. Reads the engine directly and re-reads on each engine change,
 * so a drain in the background updates the list in place.
 */
export default function SyncQueueScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const unit = (auth.user?.unit_system as UnitSystem | undefined) ?? 'metric';
  const [entries, setEntries] = useState<OutboxEntry[]>([]);

  useEffect(() => {
    const load = () => void engine.entries().then(setEntries);
    load();
    return engine.subscribe((e) => {
      if (e.type === 'changed') load();
    });
  }, []);

  const describe = useCallback(
    (e: OutboxEntry): string => {
      if (e.op === 'start') return t('logging.offline.opStartNoName');
      if (e.op === 'complete') return t('logging.offline.opComplete');
      if (e.op === 'delete_set') return t('logging.offline.opDelete');
      const a = e.args;
      const summary =
        a.p_weight_kg === null
          ? t('logging.session.repsOnly', { reps: a.p_reps ?? 0 })
          : t('logging.session.setSummary', { weight: formatWeight(a.p_weight_kg, unit), reps: a.p_reps ?? 0 });
      return t('logging.offline.opSet', { summary });
    },
    [t, unit],
  );

  const back = (
    <IconButton
      icon="back"
      accessibilityLabel={t('common.back')}
      onPress={() => (router.canDismiss() ? router.dismiss() : router.dismissTo('/'))}
    />
  );

  return (
    <Screen padded={false}>
      <NavHeader leading={back} title={t('logging.offline.queueTitle')} divider />
      {entries.length === 0 ? (
        <EmptyState icon="check" title={t('logging.offline.queueEmpty')} body={t('logging.offline.queueEmptyBody')} />
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[3] }}>
            <SectionCard>
              {entries.map((e) => (
                <View key={e.seq} style={{ padding: theme.space[3], gap: theme.space[2] }}>
                  <Row style={{ justifyContent: 'space-between', gap: theme.space[2] }}>
                    <Text style={{ flex: 1 }}>{describe(e)}</Text>
                    <Tag
                      tone={e.state === 'failed' ? 'danger' : 'neutral'}
                      label={e.state === 'failed' ? t('logging.offline.stateFailed') : t('logging.offline.statePending')}
                    />
                  </Row>
                  {e.state === 'failed' ? (
                    <>
                      <Text variant="caption" style={{ color: theme.colors.dangerAccent }}>
                        {e.lastError?.code === 'start_failed'
                          ? t('logging.offline.errorStartFailed')
                          : mapLoggingError(e.lastError, t)}
                      </Text>
                      <Row style={{ gap: theme.space[3] }}>
                        <Button label={t('logging.offline.retry')} variant="link" onPress={() => void engine.retry(e.seq).then(offline.drainNow)} />
                        <Button label={t('logging.offline.discard')} variant="link" tone="danger" onPress={() => void engine.discard(e.seq)} />
                      </Row>
                    </>
                  ) : null}
                </View>
              ))}
            </SectionCard>
          </ScrollView>
          {offline.status.failed > 0 ? (
            <FooterBar>
              <Button
                label={t('logging.offline.retryAll')}
                size="lg"
                onPress={() => void engine.retryAll().then(offline.drainNow)}
              />
            </FooterBar>
          ) : null}
        </>
      )}
    </Screen>
  );
}
```

Match the back-control idiom to the one in `app/(app)/clients/[id]/sessions.tsx` (read it first; PITFALLS N1 and N15). If `Button` has no `tone="danger"`, use the prop that `settings/index.tsx`'s MFA-unenroll confirm uses for its destructive action. If `'check'` is not an `EmptyState` icon name, use the one the history empty state uses.

- [x] **Step 5: Settings, the Offline section and the sign-out guard**

In `app/(app)/settings/index.tsx`, add `const offline = useOffline();`, `const [offlineConfirm, setOfflineConfirm] = useState(false);`, `const [signOutConfirm, setSignOutConfirm] = useState(false);`, and `const queued = offline.status.pending + offline.status.failed;`.

Insert this section directly above the `settings.account.heading` section:

```tsx
        {offline.available || queued > 0 ? (
          <View style={{ gap: theme.space[2] }}>
            <SectionLabel>{t('settings.offline.heading')}</SectionLabel>
            <SectionCard>
              <ListRow
                title={t('settings.offline.label')}
                subtitle={queued > 0 ? t('settings.offline.pending', { count: queued }) : t('settings.offline.body')}
                trailing={
                  <Toggle
                    label={t('settings.offline.label')}
                    value={offline.effective}
                    disabled={!offline.available && !offline.effective}
                    onValueChange={(next) =>
                      void offline.setDeviceChoice(next).then((r) => {
                        if (r === 'queue_not_empty') setOfflineConfirm(true);
                      })
                    }
                  />
                }
              />
              <ListRow title={t('settings.offline.queue')} onPress={() => router.push('/(app)/sync-queue')} />
            </SectionCard>
            {offlineConfirm ? (
              <Card style={{ borderColor: theme.colors.dangerAccent, gap: theme.space[3] }}>
                <Text variant="bodyBold">{t('settings.offline.cantTurnOff')}</Text>
                <Text tone="secondary">{t('settings.offline.cantTurnOffBody')}</Text>
                <Button
                  label={t('settings.offline.discard', { count: queued })}
                  variant="danger"
                  onPress={() => void offline.discardAllAndDisable().then(() => setOfflineConfirm(false))}
                />
                <Button label={t('settings.offline.keep')} variant="ghost" onPress={() => setOfflineConfirm(false)} />
              </Card>
            ) : null}
          </View>
        ) : null}
```

Match the confirm card's button variants to the existing MFA-unenroll card in the same file (`unenrollOpen`), not to the names above, if they differ.

Replace `handleSignOut` with:

```ts
  async function handleSignOut(force = false) {
    if (queued > 0 && !force) {
      setSignOutConfirm(true);
      return;
    }
    setError(null);
    await run(async () => {
      // Must happen BEFORE signOut() — log_account_event needs an authenticated
      // session, which is gone the instant signOut() resolves.
      await logAccountEvent('user_logout');
      // The outbox belongs to this user's session; the next account on this
      // device must never replay it (spec §4.3). The read cache goes too: its
      // keys are not all user-scoped, and it holds RLS-filtered rows.
      await kvStore.clear();
      await supabase.auth.signOut();
    });
  }
```

and directly above the sign-out button render:

```tsx
        {signOutConfirm ? (
          <Card style={{ borderColor: theme.colors.dangerAccent, gap: theme.space[3] }}>
            <Text variant="bodyBold">{t('settings.offline.signOutPending', { count: queued })}</Text>
            <Text tone="secondary">{t('settings.offline.signOutPendingBody')}</Text>
            <Button label={t('settings.offline.signOutAnyway')} variant="danger" onPress={() => void handleSignOut(true)} />
            <Button label={t('settings.offline.keep')} variant="ghost" onPress={() => setSignOutConfirm(false)} />
          </Card>
        ) : null}
```

Imports: `useOffline` from `'../../../lib/offline/offlineContext'`, `kvStore` from `'../../../lib/offline/kvStore'`. After `kvStore.clear()` the engine's view is empty too: it holds no rows in memory.

- [x] **Step 6: Typecheck, lint, commit**

```powershell
pnpm --filter mobile typecheck
pnpm --filter mobile lint
git add apps/mobile
git commit -m "feat(mobile): offline chip, sync queue screen, settings switch, sign-out guard"
```

---

## Task 15 · Web: admin switch, per-user beta, inspector tags

**Files:**
- Create: `apps/web/app/admin/settings/page.tsx`, `apps/web/app/admin/settings/actions.ts`, `apps/web/app/admin/users/[id]/actions.ts`
- Modify: `apps/web/app/admin/page.tsx`, `apps/web/app/admin/users/[id]/page.tsx`, `apps/web/app/admin/sessions/[id]/page.tsx`

- [x] **Step 1: Write `settings/actions.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createClient } from '@/lib/supabase/server';

/** Runs under the admin's own session; the RPC's is_admin() check is the real gate. */
export async function setOfflineMode(formData: FormData): Promise<void> {
  const mode = String(formData.get('mode') ?? '');
  const supabase = await createClient();
  await requireAdmin(supabase);
  const { error } = await supabase.rpc('admin_set_offline_logging', { p_mode: mode });
  if (error) throw new Error(error.message);
  revalidatePath('/admin/settings');
}
```

- [x] **Step 2: Write `settings/page.tsx`**

```tsx
import { parseOfflineMode } from '@forge/shared';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createClient } from '@/lib/supabase/server';
import * as ui from '@/lib/ui/styles';
import { setOfflineMode } from './actions';

export const dynamic = 'force-dynamic';

const MODES = [
  { value: 'off', label: 'Off', help: 'Nobody sees offline logging. Queues already on devices still drain.' },
  { value: 'beta', label: 'Beta', help: 'Only users with the offline beta flag (set on their user page).' },
  { value: 'all', label: 'Everyone', help: 'Every user can switch it on in Settings.' },
] as const;

export default async function AdminSettingsPage() {
  const supabase = await createClient();
  await requireAdmin(supabase);
  const { data } = await supabase.from('app_config').select('value, updated_at').eq('key', 'offline_logging').maybeSingle();
  const current = parseOfflineMode(data?.value);

  return (
    <main style={ui.page}>
      <Link href="/admin">← Admin</Link>
      <h1 style={ui.h1}>Settings</h1>
      <section style={ui.card}>
        <h2 style={{ ...ui.h2, marginBottom: 'var(--s-3)' }}>Offline logging</h2>
        <p>
          Current: <strong>{current}</strong>
          {data?.updated_at ? ` · changed ${new Date(data.updated_at).toLocaleString()}` : ''}
        </p>
        {MODES.map((m) => (
          <form key={m.value} action={setOfflineMode} style={{ marginTop: 'var(--s-3)' }}>
            <input type="hidden" name="mode" value={m.value} />
            <button type="submit" disabled={m.value === current}>
              {m.label}
            </button>{' '}
            <span>{m.help}</span>
          </form>
        ))}
      </section>
    </main>
  );
}
```

Read `apps/web/lib/ui/styles.ts` first and use the style names it actually exports (`page`, `h1`, `h2`, `card` are what `users/[id]/page.tsx` uses; confirm `page` and `h1`). Add a `Settings` link to `app/admin/page.tsx` next to the existing Programs / AI generations links.

- [x] **Step 3: Per-user beta on `users/[id]`**

`users/[id]/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createClient } from '@/lib/supabase/server';

export async function setOfflineBeta(formData: FormData): Promise<void> {
  const userId = String(formData.get('userId') ?? '');
  const enabled = formData.get('enabled') === 'true';
  const supabase = await createClient();
  await requireAdmin(supabase);
  const { error } = await supabase.rpc('admin_set_offline_beta', { p_user_id: userId, p_enabled: enabled });
  if (error) throw new Error(error.message);
  revalidatePath('/admin/users/' + userId);
}
```

In `users/[id]/page.tsx`, add `offline_logging_beta` to the `users` select list and this card after the Quarantine card:

```tsx
      <section style={ui.card}>
        <h2 style={{ ...ui.h2, marginBottom: 'var(--s-3)' }}>Offline logging beta</h2>
        <form action={setOfflineBeta}>
          <input type="hidden" name="userId" value={target.id} />
          <input type="hidden" name="enabled" value={target.offline_logging_beta ? 'false' : 'true'} />
          <span>{target.offline_logging_beta ? 'On' : 'Off'} </span>
          <button type="submit">{target.offline_logging_beta ? 'Turn off' : 'Turn on'}</button>
        </form>
      </section>
```

Update the page's doc comment ("No mutations here") to say this card is the one mutation and it goes through an `is_admin()`-guarded RPC.

- [x] **Step 4: Inspector: device and late tags on `sessions/[id]/page.tsx`**

Import `ulidTimeMs` from `@forge/shared`. In the set table add a `Device` column rendering `s.device_id ?? '—'`, and after the weight × reps cell render ` late` (styled like the page's existing muted text) when:

```ts
session.completed_at !== null && ulidTimeMs(s.id) > new Date(session.completed_at).getTime()
```

- [x] **Step 5: Typecheck, lint, build, commit**

```powershell
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web build
git add apps/web
git commit -m "feat(web): admin offline-logging switch, per-user beta, late-set tag"
```

---

## Task 16 · Screen walk and live-DB proof

Run the `forge-screen-walk` skill (PITFALLS V1). Web target, headless Chrome. Offline is driven through CDP: `Network.emulateNetworkConditions({ offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })` fires the browser `offline` event, which is what NetInfo listens to on web.

- [x] **Step 1: Arm the switch for the two test accounts**

As `admin.test@forge.dev` on `/admin/settings`: mode Beta. On `/admin/users/<id>`: offline beta On for `pt.test@forge.dev` and `client.test@forge.dev`. Confirm with psql:

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -w -c "select value from app_config where key='offline_logging';" -c "select email, offline_logging_beta from users where email like '%test@forge.dev';"
```

- [x] **Step 2: Walk 1: PT offline start and log, reload, drain**

Sign in as `pt.test` → Settings → switch Offline logging on → Today (wait for warm: the chip is hidden online) → go offline → Clients → the linked client → Start session → Day 1 → log three sets → screenshot (three rows marked "Not synced yet", chip "Offline · 4 pending": start plus three sets) → **reload the page** → reopen the session from the Resume banner → the three sets are still there → go online → the chip shows "Syncing…" then disappears → screenshot. Then:

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -w -c "select ws.id, ws.status, ws.started_at, count(s.id) from workout_sessions ws left join sets s on s.workout_session_id = ws.id where ws.client_id = (select id from clients where client_user_id = (select id from users where email='client.test@forge.dev')) group by 1,2,3 order by 3 desc limit 1;"
```

Expected: one `in_progress` session, 3 sets, `started_at` at the offline tap time (not the reconnect time).

- [x] **Step 3: Walk 2: the mirror**

Two browser contexts: `pt.test` on that session, `client.test` on the same session (client Today → Resume). The client logs a set; within ~2 s it appears on the PT's screen without a refresh, and the PT's header shows "Live". Screenshot both.

- [x] **Step 4: Walk 3: merge**

The PT finishes that session. The client goes offline → Today → Start workout → Freestyle → logs one set. The PT (online) starts a new session for the same client and logs one set. The client goes online. Expected: the client's screen `router.replace`s to the PT's session id and shows both sets; psql shows one `in_progress` session for that client with 2 sets and no row for the client's local UUID.

- [x] **Step 5: Walk 4: late set**

The PT finishes. The client (offline since before the finish) logs a set, then reconnects. Expected: the set shows on the PT's summary (mirror) and the admin inspector tags it `late`; psql shows the session still `completed`.

- [x] **Step 6: Walk 5: the switch**

With one set queued offline, Settings → toggle off → the confirm card appears. Keep them → online → drains → toggle off succeeds. Admin mode → Off → reload the app → the Offline section is gone, and logging a set online behaves exactly as M4a (inline retry copy on a forced failure).

- [x] **Step 7: Save screenshots and results**

Screenshots go where M4a's went (see `docs/superpowers/plans/2026-09-18-m4a-log-core.md` Task 15). Any walk that fails is fixed and re-walked before Task 17; a failure that reveals a new class of bug gets a `docs/PITFALLS.md` entry.

- [x] **Step 8: Put the live project back**

Admin mode → Off (ships dark, spec §1). Leave the two beta flags on for the next session's testing.

---

## Task 17 · Close-out

- [x] **Step 1: `docs/DESIGN_SYSTEM_GAPS.md`**: add `OfflineChip` and `LiveBadge` as built, with the screens that use them.
- [x] **Step 2: `CLAUDE.md`**: M4b row → ✅ done; M4c → next; Status paragraph gains the offline/mirror sentence and migration count 16 with `0016`'s one-line summary; Phase line updated.
- [x] **Step 3: This plan's As-built section**: every deviation found while building, in the format M4a's plan used.
- [x] **Step 4: Memory**: update `forge-m4-split-and-status.md` (M4b done, M4c next) and add a memory for the offline test recipe (CDP offline emulation, the arm-the-switch step) if the walk needed anything non-obvious.
- [x] **Step 5: Full verification (below), then commit**

```bash
git add -A docs CLAUDE.md
git commit -m "docs: M4b close-out — as-built record and CLAUDE.md"
```

---

## Verification

All four layers, as M4a (memory `forge-m4a-verification-recipe`):

1. `db/rls_assertions.sql`: every assertion passes, ends in `ROLLBACK`.
2. `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` (shared suite includes classify, availability, order, engine, ulid, i18n).
3. `forge-screen-walk`: walks 1–5 above, screenshots kept.
4. psql read-only checks from walks 1, 3 and 4.

The native `SqliteStore` path is not exercised by any of these. It stays recorded as open until a dev-client build exists.

## Risks

- **`realtime.messages` policy ownership.** If `supabase db push` cannot create a policy on `realtime.messages`, the mirror has no authorization and must not ship. Stop at Task 4 and report.
- **Realtime private channels.** They need Realtime Authorization, which is on for projects of this age. If the join returns `CHANNEL_ERROR` for a participant, check the project's Realtime settings before touching the policy.
- **Cold offline boot beyond the profile.** `mfa.listFactors()` needs the network; offline it returns nothing and `mfaFactors` is null. The gate reads AAL from the JWT, not from factors, so this should hold. Walk 1's reload step is what proves it.
- **Expired access token offline.** The JWT lives one hour. A cold boot two hours into a basement session starts with an expired token. Local reads do not need it; the first replay does, and `refreshAuth` handles it when the signal returns.
- **IndexedDB in private browsing.** Some browsers refuse IndexedDB there. `kvStore.web.ts` then rejects and offline logging fails loudly. That is acceptable for a dev target; native uses SQLite.

## Deliberately out of scope

Everything in spec §11, plus: offline PR banner at tap time, adding an off-program exercise offline, a global chip, and conflict UI beyond the queue view.

## As built — deviations from this plan

Executed 2026-09-19 inline (executing-plans), one commit per task on
`feature/m4b-offline-mirror`, then a screen-walk fix commit (`2eb02d8`). `0016`
is applied to the live project; the offline mode was left `off` and the two
test accounts' beta flags on.

### Changed while implementing

- **Task 4, realtime partitions.** The first harness run failed only at `a set insert broadcast on the session topic`: `realtime.messages` had no partitions at all, because the Realtime service creates its daily `messages_YYYY_MM_DD` partitions only after a tenant has had a channel join, and nobody had ever subscribed on this project. `realtime.send` swallowed the insert error as `WARNING: no partition of relation "messages" found for row`. The `postgres` role cannot create partitions in `realtime` (`permission denied for schema realtime`), so the harness cannot self-heal. One anon-key `supabase.channel(...).subscribe()` created 2026-09-18 through 09-22 and the harness then passed in full (156). In production the app's own joins keep them rolling; with nobody subscribed a dropped broadcast has no listener anyway. If the harness ever fails on that one assertion after a quiet spell, join a channel once and rerun.
- **Task 7, `enqueue` after a failed start.** The plan's engine queued a new op for a session whose `start` had already failed as `pending`. It would replay against a session that never existed, fail permanently with "session not found", and `retry(start)` would not free it. `enqueue` now parks such an op as `failed` / `start_failed`. Test: `an op queued after its start failed waits with it, and retries with it`.
- **Task 7, test typing.** `noUncheckedIndexedAccess` rejected the plan's `q[0].args` style indexing. Narrowed with a destructure or `!`; assertions unchanged.
- **Tasks 11–14 were written before `ab6e150`** restyled the session screen and `useSession` to the prototype's M4 artboards. Adapted, not transcribed: `Loaded` gained `bestByExercise` / `sessionPrs` (an offline-built session leaves both empty; records are not warmed, so the Best tile is blank offline), the rest timer is `rest.start(...)` rather than an extracted `startRest`, and the PR moment on sync goes through `buildPrView` + `data.applyPrs` like the online path.
- **Tasks 13–14 follow the prototype, not the plan, where the prototype is explicit** (it gained `session`, `sync` and `conflict` artboards after this plan was written): the status pill sits at the right of the session header (OFFLINE, or LIVE while mirrored) instead of beside the title; the offline chip is the shell's full-width strip, not a pill; the sync queue is the `sync` artboard (status banner with Retry now, guarantee copy, one row per session) rather than a per-op list; PT Today's Needs you lists an unsynced session. Settings follows the plan; the prototype is silent there. `conflict` is recorded as outstanding in `DESIGN_SYSTEM_GAPS.md`.
- **Task 15** matches the existing admin idiom (kicker, back link, `ui.button`) rather than the plan's bare `<button>`s; the Device column and the `late` tag sit in the Reps cell.
- **Task 16, test data.** Client Test has no program any more, so an offline start can only be Freestyle, and the library is online-only. The walk starts Freestyle offline, checks the honest empty state, adds an exercise online, then logs offline. The admin UI was not driven for Step 1 / 8: the mode and beta flags were set by psql (same end state).

### Found by the screen walk (`2eb02d8`)

- **Web never went offline.** NetInfo's web module listens to `navigator.connection` `change` in Chrome and never to window `online` / `offline` (PITFALLS W6). The provider now listens to both and seeds from `navigator.onLine`; the seed also stops a cold offline boot's first reads queueing ~20 s behind supabase-js's auth retries.
- **A Finish reverted to logging** on the PT's own screen while the server and the client showed it complete: overlapping loads, and prune dropping the local completed copy under a read taken before the Finish (PITFALLS O1). Local is read first, only the newest load lands, and `applyServerSession` is monotonic (engine test `never lets a stale in_progress read regress a completed session`).
- **The mirror stayed joined offline** in the simulation (PITFALLS O2); `useSessionChannel` now joins only while online, and the session reloads on reconnect.
- **Offline gaps:** Today's program list and intake flags were not cached (skeletons offline); an empty offline session offered a dead Add exercise (N14); a session not on the device said "not found"; exercise names added online were lost on an offline reload; a stale cached Resume banner pointed at a finished session; the local Next up card had no client name. All fixed.

### Verification

- Harness: 156 pass, ends `ROLLBACK`.
- `pnpm -r typecheck`, mobile + web lint, web build, shared suite 302 tests.
- `walk-m4b.mjs` (local skill, `.claude/` is gitignored): 14/14 steps across walks 1–5, psql-checked: W1 `in_progress 3` after drain; W4 `completed 5` with the late set; W3 one server row, the client's local id never created. Only non-network console error: the PT sign-in's 401 `JWT issued at future`, machine clock skew, not M4b.

### Still open

- The native `kvStore.ts` (expo-sqlite) path is not exercised by any test; it waits for a dev-client build (M4d needs one anyway).
- The conflict artboard (above).
- Late sets never re-evaluate a PR against sets logged after them (inherited from M4a's edit rule).

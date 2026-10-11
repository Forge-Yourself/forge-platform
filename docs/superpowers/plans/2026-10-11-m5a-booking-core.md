# M5a · Booking Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PT publishes weekly hours, exceptions and booking rules; a PT or a client books sessions (clients one at a time inside open slots, PTs one-off or weekly series that hold local time across DST); both see their schedule; a PT cancels late (counted or waived) or marks a no-show; starting a logging session fulfils the booking and completing it marks the booking completed.

**Architecture:** Migration `0020` adds two tables (`booking_rules`, `availability_exceptions`), five columns and an exclusion constraint on `bookings`, SELECT-only RLS on all four scheduling tables, and SECURITY DEFINER RPCs that own every write and every time calculation (slots, series, DST). `packages/shared/src/schedule/` holds the pure helpers with a branch in them (error map, deadlines, day-row geometry, month grid, hours validation) under vitest. The mobile app adds API wrappers, five hooks, seven UI atoms, a PT Schedule tab (phone day/week/month, iPad week grid), Availability, Create/Edit booking, Booking detail, and the client's Book and My bookings screens. The web admin gains a read-only bookings table.

**Tech Stack:** Supabase Postgres (plpgsql, `btree_gist` exclusion constraint, tz database), zod 4, vitest 2, Expo SDK 57 / expo-router, `react-native-svg`, Next.js 16 App Router.

**Spec:** `docs/superpowers/specs/2026-10-11-m5a-booking-core-design.md`. Read it first. Decision numbers (D1–D15) refer to it. Design: `docs/Forge M5 Scheduling.html` (screens 01–04, 08–10). Tracker: `docs/M5_Scheduling.md`.

## Global Constraints

- Every write to `bookings`, `schedules`, `booking_rules`, `availability_exceptions` goes through an RPC. `authenticated` and `anon` hold no INSERT/UPDATE/DELETE on them.
- Session lengths are only ever 30, 45, 60 or 90 minutes, and only the ones in the PT's rules are bookable — on both sides.
- Rule bounds: buffer 0–60 min (step 5), booking window 1–12 weeks, cancel cutoff 0–48 h. Defaults: lengths `{45,60,90}`, buffer 15, window 4, cutoff 12.
- A series is weekly or every 2 weeks, 2–26 occurrences, or until a date at most 181 days after the first.
- Times are stored as UTC instants plus `originating_timezone`; local wall time is computed in Postgres only. The app formats with the device's own clock and never converts between zones.
- No-show unlocks 15 minutes after the start. A client may change a booking only while `starts_at − cutoff > now` (strictly).
- Typed RPC errors are raised as the bare message token (`slot_taken`, …). `not authorized` keeps 0015's wording and ERRCODE `42501`.
- Every screen draws its own `NavHeader` with Back via `router.dismissTo` (PITFALLS N1, N15); lists refetch in `useFocusEffect` (N12); only the newest load sets state (O1); `replace` after a state-changing submit (N3).
- Every `{{name}}` string has a no-name variant (I3). `en.json` and `ar.json` stay key-for-key identical; no plurals.
- Copy and states come from the design's `COPY` table where it has them; deviations are listed under Corrections.

## Review Focus

The inputs and failure modes the spec implies but no screen test would naturally hit. Each has its test in the owning task.

1. **A double-tapped Book, or a retry after a dropped response** — must yield one booking, not two. Test: Task 1 replays `create_booking` with the same id.
2. **A client cancelling exactly at the cutoff** — refused on the server and disabled on the phone, at the same instant. Tests: Task 1 (booking at `NOW() + 12 h`), Task 4 (`canClientChange` at `now === deadline`).
3. **A series where one occurrence collides** — the whole series is refused and nothing is inserted. Test: Task 1.
4. **Hours saved with overlapping or reversed ranges** — refused with a code the screen can name. Tests: Task 1 (SQL) and Task 4 (`validateHours`), same cases both sides.
5. **A paused client trying to book** — refused, not silently accepted. Test: Task 1.

---

## Context

- `schedules`, `bookings`, `check_ins` come from `0001_baseline.sql:977-1121`. RLS is enabled, **no policies exist**, and all three are **empty on the live project** (checked 2026-10-11: 0 / 0 / 0 rows, 0 policies). Column changes need no backfill.
- `bookings.status` CHECK allows `scheduled, reminder_sent, waitlisted, promoted, checked_in, in_progress, checked_out, completed, no_show, cancelled`. M5a writes `scheduled, completed, no_show, cancelled`.
- `workout_sessions.booking_id` exists with FK `fk_ws_booking` (`ON DELETE SET NULL`). The live `start_workout_session` and `complete_workout_session` bodies are in `0016_m4b_offline_mirror.sql:27-112` and `:268-323`; `0019` changed neither.
- `chk_audit_logs_action` (live) allows `booking_create, booking_cancel, booking_no_show, booking_complete`. `audit_logs` is partitioned, so altering that CHECK rewrites every partition's copy — this plan does not alter it (see Corrections).
- Beirut DST (verified on the live tz database): `2027-10-28 10:30` local = `07:30Z`; `2027-11-04 10:30` local = `08:30Z`. Clocks go back on Sunday 2027-10-31. In 2026 it is Sunday 2026-10-25.
- Helpers from `0003_rls.sql`: `is_pt_of_client(uuid)`, `is_client_record_owner(uuid)`, `is_admin()`. Neither client helper reads `users.role`.
- Harness `db/rls_assertions.sql` (1631 lines): one `BEGIN;`, `ROLLBACK;` last. Helpers `pg_temp.expect(label, n, query)`, `pg_temp.expect_raises(label, sql)`, `pg_temp.expect_rls_block(label, sql)`, `pg_temp.act_as(uuid)` inside `SET LOCAL ROLE authenticated; … RESET ROLE;`. `NOW()` is fixed for the whole transaction. psql does not interpolate `:'var'` inside `$$…$$`; build SQL with `format()`. Fixtures in scope at the end: `:'pt_a'`, `:'pt_b'`, `:'client_a'` (**its role was flipped to `pt` by the M1 block**), `:'client_b'` (role `client`), `:'client_row'` (pt_a ↔ client_a), `:'admin_a'`, `:'self_row'` (pt_a's self row, from the 0019 block). `clients` has no unique constraint on `(pt_user_id, client_user_id)` except the self-row partial index.
- Mobile: no test runner — anything with a branch goes in `packages/shared` under vitest. `supabase` from `lib/supabase.ts`; ids from `expo-crypto`'s `Crypto.randomUUID()`; `cachedFetch({ enabled: offline.effective, online: offline.online }, key, fetcher)` from `lib/offline/cachedFetch.ts` caches only when the offline beta is on, and its fetcher result must carry `error: string | null` with `'offline'` as the no-network sentinel; `fetchRoster(ptUserId)` in `lib/clients/useClientList.ts` returns rows with `displayName` and `isSelf`; `StartSessionSheet` in `lib/logging/StartSessionSheet.tsx` takes `{ visible, clientId, viewerIsPt, onNoProgram?, onDismiss }` and starts (or resumes) the session itself.
- The (tabs) layout hides the tab bar for clients entirely (`tabBar={isClient ? () => null : undefined}`); Programs already uses the `calendar` icon. `(app)/_layout.tsx` is a bare `Stack` with `headerShown: false`, so new route folders need no layout file.
- `CONSOLE_MIN_WIDTH = 900` is a module-local const in `app/(app)/sessions/[id]/index.tsx:14`.
- UI atoms (`apps/mobile/src/ui/index.ts`): `Banner({variant, message})`, `Button({label, variant: primary|ghost|link, tone: default|danger|accent, icon, loading, disabled, size})`, `Card`, `ChipRow`, `DateField({label, value 'YYYY-MM-DD'|'', onChange, minDate, maxDate})`, `EmptyState({icon, title, body, tone, actionLabel, onAction})`, `Icon`, `ListRow`, `MeasureStepper({value, unit, onDecrement, onIncrement, decrementLabel, incrementLabel, disabled})`, `NavHeader({title, leading, trailing, divider})`, `Screen({padded})`, `SectionLabel`, `SegmentedPill({items: {label,value}[], selected, onChange})`, `Skeleton({height, radius})`, `Tag`, `Text({variant, tone, numeric})`, `Toggle({label, value, onValueChange})`. Theme: `useTheme()` → `colors.*` (`accent`, `accentSurfaceSoft`, `onAccentSurfaceSoft`, `successAccent/Surface/onSuccessSurface`, `warnAccent/Surface/onWarnSurface`, `dangerAccent`, `surface`, `surfaceRaised`, `surfaceSunken`, `border`, `borderStrong`, `textPrimary/Secondary/Muted`), `space[1..]`, `radius.{sm,md,lg,xl,pill}`, `touchTarget`. Existing modals use RN `Modal` directly; there is no generic sheet.
- Test accounts: `pt.test@forge.dev`, `client.test@forge.dev`, `pt2.test@forge.dev`, `admin.test@forge.dev`; password in `FORGE_E2E_PASSWORD`. `client.test` is a client of `pt.test`.
- Toolchain: PowerShell for pnpm with `$env:COREPACK_INTEGRITY_KEYS='0'`, Node 24 (`nvm use 24.15.0`), Supabase CLI `& "$env:APPDATA\nvm\v24.15.0\supabase.cmd"`, psql per CLAUDE.md (`PGPASSWORD` + `-w`). `.expo/types/router.d.ts` regenerates with the dev server; a `tsc` error on a route string that exists means it is stale (V3).

### Corrections this plan makes to the spec

- **D11 — no signature change, no outbox change.** `start_workout_session` keeps its four parameters and links the booking itself: the client's `scheduled` booking whose `[starts_at − 30 min, ends_at]` contains the session's start, not already linked, nearest first. That covers Start from Booking detail, from client detail, from Today and from an offline replay (which passes `p_started_at`) with zero app-side change, and removes the PITFALLS O3 risk the spec flagged. `complete_workout_session` marks the linked booking `completed`.
- **D13 — the client gets no tab bar.** The client has never had one (the tabs layout renders `null` for them). Their schedule is two stack screens, `/(app)/bookings` (My bookings) and `/(app)/bookings/book`, reached from a "Next session" card on the client's Today. The PT gets a fifth tab, **Schedule**, with the `clock` icon.
- **§4.1 exception kinds are `off` | `extra`.** The design's legend is "Day off / Extra": an extra range is *added* to that day's weekly hours, not a replacement.
- **§4.2 clients read their PT's rules through `booking_policy(p_pt)`,** which applies the defaults server-side, and the PT reads their own day windows (for open-gap rows) through `pt_day_windows(p_from, p_to)`. Neither the defaults nor the window rule is written in TypeScript.
- **§4.3 a PT booking is not restricted to published hours** — only overlap is enforced (a PT may train themselves at 07:00 or add a session on a day off). The length must still be one of their offered lengths. A client booking must equal a slot `open_slots` returns.
- **§4.3 reschedule is audited as `booking_create` with `details.rescheduled_from`.** Adding a verb would rewrite the CHECK on every `audit_logs` partition.
- **Design copy for Availability offline** says edits save on reconnect. M5a queues no booking writes (D15), so Save is disabled offline and the banner says "OFFLINE · SAVING NEEDS A CONNECTION".
- **Deferred design affordances:** "Message {{name}}" (no messaging until M9), "Add to my calendar" and the header "Google" button (M5c), "Show check-in code" and the Rules → Reminders row (M5b), rating and receipt actions on past rows (M5b). The Booking detail program card shows the client's active program name, not a specific day.
- **Exceptions tab** keeps the design's month grid (dots for day-off and extra) above the list; tapping a day opens the add-exception sheet for that date.

---

## File structure

**Database**
- Create `supabase/migrations/0020_m5a_booking.sql`.
- Modify `db/rls_assertions.sql`: append the M5a block before `ROLLBACK;`.
- Regenerate `packages/shared/src/database.types.ts`.

**Shared (`packages/shared/src/schedule/`)**
- `errors.ts` + `errors.test.ts`: `BOOKING_ERROR_CODES`, `BookingErrorCode`, `bookingErrorCode`, `bookingErrorKey`.
- `time.ts` + `time.test.ts`: `cancelDeadline`, `canClientChange`, `noShowUnlocksAt`, `canMarkNoShow`, `hhmm`, `parseHhmm`, `minuteOfDay`, `localDayKey`, `addDays`, `durationLabel`.
- `layout.ts` + `layout.test.ts`: `BookingState`, `bookingState`, `dayRows`, `monthCells`, `slotCountsByDay`, `seriesProgress`.
- `rules.ts` + `rules.test.ts`: `ALL_LENGTHS`, `RULE_BOUNDS`, `DEFAULT_RULES`, `stepRule`, `toggleLength`, `validateHours`, `weeklyMinutes`, `copyMondayToWeekdays`, types `BookingRules`, `HoursRange`, `ExceptionInput`.
- `index.ts`; modify `packages/shared/src/index.ts`.
- Modify `packages/shared/src/i18n/en.json`, `ar.json`.

**Mobile**
- Create `apps/mobile/src/lib/consoleWidth.ts`; modify `app/(app)/sessions/[id]/index.tsx` to import it.
- Create `apps/mobile/src/lib/schedule/`: `scheduleApi.ts`, `format.ts`, `stateStyle.ts`, `useSchedule.ts`, `useAvailability.ts`, `useOpenSlots.ts`, `useMyBookings.ts`, `useBookingDetail.ts`, `BookingDetailBody.tsx`, `IpadWeek.tsx`, `BookingForm.tsx`.
- Create `apps/mobile/src/ui/`: `BottomSheet.tsx`, `CalendarBlock.tsx`, `OpenGapRow.tsx`, `MonthGrid.tsx`, `TimeRangePill.tsx`, `DayStrip.tsx`, `SlotGrid.tsx`; modify `ui/index.ts`.
- Create routes: `app/(app)/(tabs)/schedule.tsx`, `app/(app)/schedule/availability.tsx`, `app/(app)/schedule/new.tsx`, `app/(app)/schedule/[id]/index.tsx`, `app/(app)/schedule/[id]/edit.tsx`, `app/(app)/bookings/index.tsx`, `app/(app)/bookings/book.tsx`.
- Modify `app/(app)/(tabs)/_layout.tsx` (Schedule tab) and `app/(app)/(tabs)/index.tsx` (client "Next session" card).

**Web**
- Modify `apps/web/app/admin/users/[id]/page.tsx`: Bookings section.

**Docs**
- Modify `docs/DESIGN_SYSTEM_GAPS.md`, `docs/M5_Scheduling.md`, `CLAUDE.md`, this plan's As-built section.

---

## Task 1 · Harness: the failing M5a block

**Files:**
- Modify: `db/rls_assertions.sql` (insert before the final `ROLLBACK;`)

**Interfaces:**
- Consumes: fixtures listed in Context.
- Produces: the contract Task 2's migration must satisfy — RPC names, argument order, error tokens, return column names (`slot_date`, `slot_start`; `win_date`, `win_start`, `win_end`; `n`, `occ_start`, `after_offset_change`, `conflict`; `out_booking_id`, `out_starts_at`).

- [ ] **Step 1: Append the block**

Insert this immediately above the last line (`ROLLBACK;`):

```sql
-- =============================================================================
-- 0020 — M5a booking core.
--
-- Times below are built from CURRENT_DATE + 8 (well inside the 4-week client
-- window, never "today", so NOW() can't eat the morning) in Asia/Beirut, the
-- users.timezone default. Hours are published for all seven days so no case
-- depends on which weekday the harness happens to run.
-- =============================================================================

CREATE FUNCTION pg_temp.expect_error(label TEXT, sql TEXT, msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE sql;
    RAISE EXCEPTION 'FAIL % — statement did not raise', label;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL %' THEN
      RAISE;
    END IF;
    IF SQLERRM <> msg THEN
      RAISE EXCEPTION 'FAIL % — expected "%", got "%"', label, msg, SQLERRM;
    END IF;
    RAISE NOTICE 'pass  %', label;
  END;
END;
$$;

\set cb_row  '5a000000-0000-4000-8000-0000000000c1'
\set bk1     '5a000000-0000-4000-8000-0000000000b1'
\set bk2     '5a000000-0000-4000-8000-0000000000b2'
\set bk3     '5a000000-0000-4000-8000-0000000000b3'
\set bks     '5a000000-0000-4000-8000-0000000000b4'
\set bks2    '5a000000-0000-4000-8000-0000000000b5'
\set bkd     '5a000000-0000-4000-8000-0000000000b6'
\set bklate  '5a000000-0000-4000-8000-0000000000b7'
\set bklate2 '5a000000-0000-4000-8000-0000000000b8'
\set bkedge  '5a000000-0000-4000-8000-0000000000b9'
\set bkpast  '5a000000-0000-4000-8000-0000000000ba'
\set bknow   '5a000000-0000-4000-8000-0000000000bb'

-- client_b becomes a real client of pt_a (client_a's role was flipped to 'pt'
-- by the M1 block, so it can't stand in for a client-role account here).
INSERT INTO public.clients (id, pt_user_id, client_user_id, state)
VALUES (:'cb_row', :'pt_a', :'client_b', 'active');
-- Earlier blocks pause and reactivate client_row; don't depend on where they left it.
UPDATE public.clients SET state = 'active' WHERE id = :'client_row';

SELECT (CURRENT_DATE + 8) AS d \gset
SELECT ((:'d'::date + time '06:00') AT TIME ZONE 'Asia/Beirut') AS t0600,
       ((:'d'::date + time '07:00') AT TIME ZONE 'Asia/Beirut') AS t0700,
       ((:'d'::date + time '07:15') AT TIME ZONE 'Asia/Beirut') AS t0715,
       ((:'d'::date + time '07:30') AT TIME ZONE 'Asia/Beirut') AS t0730,
       ((:'d'::date + time '08:30') AT TIME ZONE 'Asia/Beirut') AS t0830,
       ((:'d'::date + time '09:45') AT TIME ZONE 'Asia/Beirut') AS t0945,
       ((:'d'::date + time '13:00') AT TIME ZONE 'Asia/Beirut') AS t1300 \gset

-- ── Availability ────────────────────────────────────────────────────────────
SELECT jsonb_agg(r) AS hours_json FROM (
  SELECT jsonb_build_object('dow', d, 'start', s, 'end', e) AS r
    FROM generate_series(0, 6) d, (VALUES ('06:00', '12:00'), ('15:00', '20:00')) v(s, e)
) x \gset
\set rules_json '{"lengths":[45,60,90],"buffer":15,"window":4,"cutoff":12}'

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_b');
SELECT pg_temp.expect_raises('a client cannot publish availability',
  format('SELECT * FROM public.save_availability(%L::jsonb, ''[]''::jsonb, %L::jsonb)', :'hours_json', :'rules_json'));
SELECT pg_temp.expect_rls_block('a client cannot write schedules directly',
  format('INSERT INTO public.schedules (user_id, day_of_week, start_time, end_time) VALUES (%L, 1, ''06:00'', ''07:00'')', :'client_b'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect_error('overlapping ranges on one day are refused',
  $q$SELECT * FROM public.save_availability('[{"dow":1,"start":"06:00","end":"12:00"},{"dow":1,"start":"11:00","end":"14:00"}]'::jsonb, '[]'::jsonb, '{"lengths":[60],"buffer":15,"window":4,"cutoff":12}'::jsonb)$q$,
  'overlapping_hours');
SELECT pg_temp.expect_error('a range that ends before it starts is refused',
  $q$SELECT * FROM public.save_availability('[{"dow":1,"start":"12:00","end":"06:00"}]'::jsonb, '[]'::jsonb, '{"lengths":[60],"buffer":15,"window":4,"cutoff":12}'::jsonb)$q$,
  'bad_range');
SELECT pg_temp.expect_raises('a 30-day booking window is refused by the CHECK',
  format('SELECT * FROM public.save_availability(%L::jsonb, ''[]''::jsonb, ''{"lengths":[60],"buffer":15,"window":30,"cutoff":12}''::jsonb)', :'hours_json'));
SELECT count(*) FROM public.save_availability(:'hours_json'::jsonb, '[]'::jsonb, :'rules_json'::jsonb);
SELECT pg_temp.expect('the PT published 14 weekly ranges', 14,
  format('SELECT count(*) FROM public.schedules WHERE user_id = %L', :'pt_a'));
SELECT pg_temp.expect('the PT reads two windows on day D', 2,
  format('SELECT count(*) FROM public.pt_day_windows(%L::date, %L::date)', :'d', :'d'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_b');
SELECT pg_temp.expect('a client cannot read raw hours', 0,
  format('SELECT count(*) FROM public.schedules WHERE user_id = %L', :'pt_a'));
SELECT pg_temp.expect('a client reads their PT''s policy through the RPC', 12,
  format('SELECT cutoff_hours::bigint FROM public.booking_policy(%L::uuid)', :'pt_a'));
SELECT pg_temp.expect_raises('a client cannot read the PT''s day windows',
  format('SELECT count(*) FROM public.pt_day_windows(%L::date, %L::date)', :'d', :'d'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_b');
SELECT pg_temp.expect('another PT reads no hours', 0,
  format('SELECT count(*) FROM public.schedules WHERE user_id = %L', :'pt_a'));
SELECT pg_temp.expect_raises('another PT cannot read pt_a''s policy',
  format('SELECT * FROM public.booking_policy(%L::uuid)', :'pt_a'));
SELECT pg_temp.expect_raises('another PT cannot list pt_a''s open slots',
  format('SELECT count(*) FROM public.open_slots(%L::uuid, %L::date, %L::date, 60::smallint)', :'pt_a', :'d', :'d'));
RESET ROLE;

-- ── Open slots: packing and buffer (spec D3) ────────────────────────────────
-- 06:00-12:00 at 60 + 15: 06:00 07:15 08:30 09:45 11:00. 15:00-20:00: 15:00 16:15 17:30 18:45.
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_b');
SELECT pg_temp.expect('nine packed 60-minute slots on day D', 9,
  format('SELECT count(*) FROM public.open_slots(%L::uuid, %L::date, %L::date, 60::smallint)', :'pt_a', :'d', :'d'));
SELECT pg_temp.expect('07:15 is a slot (06:00 + 60 + 15 buffer)', 1,
  format('SELECT count(*) FROM public.open_slots(%L::uuid, %L::date, %L::date, 60::smallint) WHERE slot_start = %L',
         :'pt_a', :'d', :'d', :'t0715'));
SELECT pg_temp.expect('07:00 is not a slot', 0,
  format('SELECT count(*) FROM public.open_slots(%L::uuid, %L::date, %L::date, 60::smallint) WHERE slot_start = %L',
         :'pt_a', :'d', :'d', :'t0700'));
SELECT pg_temp.expect_error('a length the PT does not offer is refused',
  format('SELECT count(*) FROM public.open_slots(%L::uuid, %L::date, %L::date, 30::smallint)', :'pt_a', :'d', :'d'),
  'length_not_offered');
RESET ROLE;

-- ── Client booking ──────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_b');
SELECT count(*) FROM public.create_booking(:'bk1'::uuid, :'cb_row'::uuid, :'t0715'::timestamptz, 60::smallint);
SELECT count(*) FROM public.create_booking(:'bk1'::uuid, :'cb_row'::uuid, :'t0715'::timestamptz, 60::smallint);
SELECT pg_temp.expect('a replayed create is one booking, not two (Review Focus 1)', 1,
  format('SELECT count(*) FROM public.bookings WHERE client_id = %L', :'cb_row'));
SELECT pg_temp.expect('the client''s booking is scheduled, 60 min, created by them', 1,
  format('SELECT count(*) FROM public.bookings WHERE id = %L AND status = ''scheduled'' AND length_min = 60
            AND created_by_user_id = %L AND ends_at = starts_at + interval ''60 minutes''', :'bk1', :'client_b'));
SELECT pg_temp.expect('a booked slot leaves the list', 0,
  format('SELECT count(*) FROM public.open_slots(%L::uuid, %L::date, %L::date, 60::smallint) WHERE slot_start = %L',
         :'pt_a', :'d', :'d', :'t0715'));
SELECT pg_temp.expect('06:00 still fits before it (ends 07:00, buffer to 07:15)', 1,
  format('SELECT count(*) FROM public.open_slots(%L::uuid, %L::date, %L::date, 60::smallint) WHERE slot_start = %L',
         :'pt_a', :'d', :'d', :'t0600'));
SELECT pg_temp.expect('the next slot starts after its buffer, at 08:30', 1,
  format('SELECT count(*) FROM public.open_slots(%L::uuid, %L::date, %L::date, 60::smallint) WHERE slot_start = %L',
         :'pt_a', :'d', :'d', :'t0830'));
SELECT pg_temp.expect_error('a client cannot take a time inside another booking''s buffer',
  format('SELECT count(*) FROM public.create_booking(gen_random_uuid(), %L::uuid, %L::timestamptz, 60::smallint)', :'cb_row', :'t0730'),
  'slot_taken');
SELECT pg_temp.expect_error('a client cannot book outside published hours',
  format('SELECT count(*) FROM public.create_booking(gen_random_uuid(), %L::uuid, %L::timestamptz, 60::smallint)', :'cb_row', :'t1300'),
  'outside_hours');
SELECT pg_temp.expect_error('a client cannot book beyond the window',
  format('SELECT count(*) FROM public.create_booking(gen_random_uuid(), %L::uuid, %L::timestamptz, 60::smallint)',
         :'cb_row', (:'t0715'::timestamptz + interval '40 days')),
  'outside_window');
SELECT pg_temp.expect_error('nobody books in the past',
  format('SELECT count(*) FROM public.create_booking(gen_random_uuid(), %L::uuid, NOW() - interval ''1 hour'', 60::smallint)', :'cb_row'),
  'in_past');
SELECT pg_temp.expect_error('a client cannot create a series',
  format('SELECT count(*) FROM public.create_booking(gen_random_uuid(), %L::uuid, %L::timestamptz, 60::smallint, 1::smallint, 4::smallint)', :'cb_row', :'t0600'),
  'not authorized');
SELECT pg_temp.expect_rls_block('a client cannot INSERT a booking directly',
  format('INSERT INTO public.bookings (pt_user_id, client_id, starts_at, ends_at) VALUES (%L, %L, %L, %L)',
         :'pt_a', :'cb_row', :'t0600', :'t0700'));
RESET ROLE;

-- Visibility.
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_a');
SELECT pg_temp.expect('another client of the same PT cannot see the booking', 0,
  format('SELECT count(*) FROM public.bookings WHERE id = %L', :'bk1'));
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_b');
SELECT pg_temp.expect('another PT cannot see the booking', 0,
  format('SELECT count(*) FROM public.bookings WHERE id = %L', :'bk1'));
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'admin_a');
SELECT pg_temp.expect('an admin sees the booking', 1,
  format('SELECT count(*) FROM public.bookings WHERE id = %L', :'bk1'));
RESET ROLE;

-- ── PT booking, overlap, self ───────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('the PT sees the client''s booking', 1,
  format('SELECT count(*) FROM public.bookings WHERE id = %L', :'bk1'));
SELECT pg_temp.expect_error('the exclusion constraint refuses an overlapping PT booking (spec D7)',
  format('SELECT count(*) FROM public.create_booking(%L::uuid, %L::uuid, %L::timestamptz, 60::smallint)', :'bk2', :'client_row', :'t0730'),
  'slot_taken');
SELECT count(*) FROM public.create_booking(:'bk3'::uuid, :'self_row'::uuid, :'t1300'::timestamptz, 60::smallint);
SELECT pg_temp.expect('a PT may book their own training outside published hours', 1,
  format('SELECT count(*) FROM public.bookings WHERE id = %L AND client_id = %L', :'bk3', :'self_row'));
RESET ROLE;

-- ── Series and DST (spec D5, D6) ────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('a weekly x4 preview lists four occurrences, none in conflict', 4,
  format('SELECT count(*) FROM public.preview_series(%L::timestamptz, 60::smallint, 1::smallint, 4::smallint, NULL) WHERE NOT conflict', :'t0945'));
SELECT count(*) FROM public.create_booking(:'bks'::uuid, :'client_row'::uuid, :'t0945'::timestamptz, 60::smallint, 1::smallint, 4::smallint);
SELECT pg_temp.expect('the series is four rows, children pointing at the first', 3,
  format('SELECT count(*) FROM public.bookings WHERE parent_booking_id = %L', :'bks'));
SELECT pg_temp.expect('every row of the series carries its rule', 4,
  format('SELECT count(*) FROM public.bookings WHERE (id = %L OR parent_booking_id = %L) AND recurrence_rule = ''FREQ=WEEKLY;INTERVAL=1;COUNT=4''', :'bks', :'bks'));
SELECT pg_temp.expect('the preview flags the collision with the series', 2,
  format('SELECT count(*) FROM public.preview_series(%L::timestamptz, 60::smallint, 1::smallint, 2::smallint, NULL) WHERE conflict', :'t0945'));
SELECT pg_temp.expect_error('a colliding series is refused whole (Review Focus 3)',
  format('SELECT count(*) FROM public.create_booking(%L::uuid, %L::uuid, %L::timestamptz, 60::smallint, 1::smallint, 2::smallint)', :'bks2', :'self_row', :'t0945'),
  'slot_taken');
SELECT pg_temp.expect('nothing of the refused series was inserted', 0,
  format('SELECT count(*) FROM public.bookings WHERE id = %L OR parent_booking_id = %L', :'bks2', :'bks2'));
SELECT pg_temp.expect_error('27 occurrences is too long',
  format('SELECT count(*) FROM public.preview_series(%L::timestamptz, 60::smallint, 1::smallint, 27::smallint, NULL)', :'t0945'),
  'series_too_long');
SELECT pg_temp.expect_error('a series needs a count or an end date, not both',
  format('SELECT count(*) FROM public.preview_series(%L::timestamptz, 60::smallint, 1::smallint, 4::smallint, %L::date)', :'t0945', :'d'),
  'bad_repeat');

-- Beirut clocks go back on Sun 2027-10-31. A Thursday 10:30 series stays 10:30.
SELECT pg_temp.expect('both occurrences across the change are 10:30 local', 2,
  $q$SELECT count(*) FROM public.preview_series(('2027-10-28 10:30'::timestamp AT TIME ZONE 'Asia/Beirut'), 60::smallint, 1::smallint, 2::smallint, NULL)
      WHERE to_char(occ_start AT TIME ZONE 'Asia/Beirut', 'HH24:MI') = '10:30'$q$);
SELECT pg_temp.expect('only the occurrence after the change is flagged, and its UTC moved an hour', 1,
  $q$SELECT count(*) FROM public.preview_series(('2027-10-28 10:30'::timestamp AT TIME ZONE 'Asia/Beirut'), 60::smallint, 1::smallint, 2::smallint, NULL)
      WHERE after_offset_change AND n = 2 AND occ_start = '2027-11-04 08:30+00'::timestamptz$q$);
SELECT count(*) FROM public.create_booking(:'bkd'::uuid, :'client_row'::uuid, ('2027-10-28 10:30'::timestamp AT TIME ZONE 'Asia/Beirut'), 60::smallint, 1::smallint, 2::smallint);
SELECT pg_temp.expect('a stored series across DST keeps 10:30 local on both rows', 2,
  format('SELECT count(*) FROM public.bookings WHERE (id = %L OR parent_booking_id = %L)
            AND to_char(starts_at AT TIME ZONE originating_timezone, ''HH24:MI'') = ''10:30''', :'bkd', :'bkd'));
RESET ROLE;

-- ── Availability changes flag bookings (spec §7) ────────────────────────────
-- Day D off: bk1 (07:15), the series' first row (09:45) and bk3 (13:00) are all on D.
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect('a day off returns the three bookings left on it', 3,
  format('SELECT count(*) FROM public.save_availability(%L::jsonb, %L::jsonb, %L::jsonb)',
         :'hours_json', jsonb_build_array(jsonb_build_object('date', :'d', 'kind', 'off')), :'rules_json'));
SELECT pg_temp.expect('the bookings stay put', 3,
  format('SELECT count(*) FROM public.bookings WHERE status = ''scheduled'' AND id IN (%L, %L, %L)', :'bk1', :'bks', :'bk3'));
SELECT pg_temp.expect('a day off has no open slots', 0,
  format('SELECT count(*) FROM public.open_slots(%L::uuid, %L::date, %L::date, 60::smallint)', :'pt_a', :'d', :'d'));
SELECT count(*) FROM public.save_availability(:'hours_json'::jsonb,
  jsonb_build_array(jsonb_build_object('date', :'d', 'kind', 'extra', 'ranges', '[{"start":"21:00","end":"22:00"}]'::jsonb)), :'rules_json'::jsonb);
SELECT pg_temp.expect('an extra range adds a window to the weekly two', 3,
  format('SELECT count(*) FROM public.pt_day_windows(%L::date, %L::date)', :'d', :'d'));
SELECT count(*) FROM public.save_availability(:'hours_json'::jsonb, '[]'::jsonb, :'rules_json'::jsonb);
RESET ROLE;

-- ── Reschedule (spec D10) ───────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_b');
SELECT count(*) FROM public.reschedule_booking(:'bk1'::uuid, :'t0600'::timestamptz, 'one');
SELECT pg_temp.expect('the client moved their booking into a slot it was itself blocking', 1,
  format('SELECT count(*) FROM public.bookings WHERE id = %L AND starts_at = %L', :'bk1', :'t0600'));
SELECT pg_temp.expect_error('a client cannot move a whole series',
  format('SELECT count(*) FROM public.reschedule_booking(%L::uuid, %L::timestamptz, ''following'')', :'bk1', :'t0715'),
  'not authorized');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT id AS bks_second FROM public.bookings WHERE parent_booking_id = :'bks' ORDER BY starts_at LIMIT 1 \gset
SELECT count(*) FROM public.reschedule_booking(:'bks_second'::uuid,
  ((SELECT starts_at FROM public.bookings WHERE id = :'bks_second') + interval '1 hour'), 'following');
SELECT pg_temp.expect('"this and following" moved the last three to 10:45 local', 3,
  format('SELECT count(*) FROM public.bookings WHERE parent_booking_id = %L
            AND to_char(starts_at AT TIME ZONE originating_timezone, ''HH24:MI'') = ''10:45''', :'bks'));
SELECT pg_temp.expect('and left the first at 09:45', 1,
  format('SELECT count(*) FROM public.bookings WHERE id = %L AND starts_at = %L', :'bks', :'t0945'));
RESET ROLE;

-- ── Cancellation and the cutoff (spec D8) ───────────────────────────────────
-- Inserted as the table owner: create_booking refuses nothing here, but these
-- need times relative to NOW() that the hours fixture doesn't cover.
INSERT INTO public.bookings (id, pt_user_id, client_id, status, starts_at, ends_at, length_min, created_by_user_id) VALUES
  (:'bklate',  :'pt_a', :'cb_row', 'scheduled', NOW() + interval '2 hours',  NOW() + interval '3 hours',  60, :'pt_a'),
  (:'bklate2', :'pt_a', :'cb_row', 'scheduled', NOW() + interval '4 hours',  NOW() + interval '5 hours',  60, :'pt_a'),
  (:'bkedge',  :'pt_a', :'cb_row', 'scheduled', NOW() + interval '12 hours', NOW() + interval '13 hours', 60, :'pt_a'),
  (:'bkpast',  :'pt_a', :'cb_row', 'scheduled', NOW() - interval '3 hours',  NOW() - interval '2 hours',  60, :'pt_a'),
  (:'bknow',   :'pt_a', :'cb_row', 'scheduled', NOW() - interval '5 minutes', NOW() + interval '55 minutes', 60, :'pt_a');

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_b');
SELECT pg_temp.expect_error('a client cannot cancel inside the cutoff',
  format('SELECT count(*) FROM public.cancel_booking(%L::uuid)', :'bklate'), 'inside_cutoff');
SELECT pg_temp.expect_error('exactly at the cutoff is already too late (Review Focus 2)',
  format('SELECT count(*) FROM public.cancel_booking(%L::uuid)', :'bkedge'), 'inside_cutoff');
SELECT pg_temp.expect_error('nor reschedule inside it',
  format('SELECT count(*) FROM public.reschedule_booking(%L::uuid, %L::timestamptz, ''one'')', :'bklate', :'t0715'), 'inside_cutoff');
SELECT count(*) FROM public.cancel_booking(:'bk1'::uuid);
SELECT count(*) FROM public.cancel_booking(:'bk1'::uuid);
SELECT pg_temp.expect('an early client cancel is free and idempotent', 1,
  format('SELECT count(*) FROM public.bookings WHERE id = %L AND status = ''cancelled'' AND cancelled_by = ''client''
            AND NOT cancel_late AND NOT cancel_counted', :'bk1'));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT count(*) FROM public.cancel_booking(:'bklate'::uuid, 'one', FALSE, 'Client is ill');
SELECT pg_temp.expect('a waived late cancel is late, not counted', 1,
  format('SELECT count(*) FROM public.bookings WHERE id = %L AND cancel_late AND NOT cancel_counted
            AND cancelled_by = ''pt'' AND cancel_reason = ''Client is ill''', :'bklate'));
SELECT count(*) FROM public.cancel_booking(:'bklate2'::uuid);
SELECT pg_temp.expect('a late cancel counts by default', 1,
  format('SELECT count(*) FROM public.bookings WHERE id = %L AND cancel_late AND cancel_counted', :'bklate2'));
SELECT count(*) FROM public.cancel_booking(:'bks'::uuid, 'following');
SELECT pg_temp.expect('cancelling a series from its first row cancels all four', 4,
  format('SELECT count(*) FROM public.bookings WHERE (id = %L OR parent_booking_id = %L) AND status = ''cancelled''', :'bks', :'bks'));
SELECT pg_temp.expect('only the row the PT cancelled could be late', 0,
  format('SELECT count(*) FROM public.bookings WHERE parent_booking_id = %L AND cancel_late', :'bks'));
RESET ROLE;

-- ── No-show (spec D9) ───────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_b');
SELECT pg_temp.expect_raises('a client cannot mark a no-show',
  format('SELECT public.mark_no_show(%L::uuid)', :'bkpast'));
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT pg_temp.expect_error('no-show is locked for 15 minutes after the start',
  format('SELECT public.mark_no_show(%L::uuid)', :'bknow'), 'too_early_for_no_show');
SELECT public.mark_no_show(:'bkpast'::uuid);
SELECT pg_temp.expect('the PT marks a no-show', 1,
  format('SELECT count(*) FROM public.bookings WHERE id = %L AND status = ''no_show'' AND no_show_marked_at IS NOT NULL', :'bkpast'));
RESET ROLE;

-- ── A session fulfils its booking (correction to D11) ───────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'pt_a');
SELECT (public.start_workout_session(:'cb_row'::uuid, NULL)).id AS bk_sess \gset
SELECT pg_temp.expect('starting a session links the booking now in progress', 1,
  format('SELECT count(*) FROM public.workout_sessions WHERE id = %L AND booking_id = %L', :'bk_sess', :'bknow'));
SELECT pg_temp.expect_error('a booking with a session cannot be marked no-show',
  format('SELECT public.mark_no_show(%L::uuid)', :'bknow'), 'session_started');
SELECT public.complete_workout_session(:'bk_sess'::uuid, NULL, NULL);
SELECT pg_temp.expect('completing the session completes the booking', 1,
  format('SELECT count(*) FROM public.bookings WHERE id = %L AND status = ''completed''', :'bknow'));
SELECT pg_temp.expect('booking_complete is audited', 1,
  format('SELECT count(*) FROM public.audit_logs WHERE action = ''booking_complete'' AND entity_id = %L', :'bknow'));
RESET ROLE;

-- ── A paused client cannot book (Review Focus 5) ────────────────────────────
UPDATE public.clients SET state = 'paused' WHERE id = :'cb_row';
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(:'client_b');
SELECT pg_temp.expect_raises('a paused client cannot list slots',
  format('SELECT count(*) FROM public.open_slots(%L::uuid, %L::date, %L::date, 60::smallint)', :'pt_a', :'d', :'d'));
SELECT pg_temp.expect_error('a paused client cannot book',
  format('SELECT count(*) FROM public.create_booking(gen_random_uuid(), %L::uuid, %L::timestamptz, 60::smallint)', :'cb_row', :'t0600'),
  'client_not_bookable');
SELECT pg_temp.expect('a paused client still reads their own bookings', 1,
  format('SELECT count(*) FROM public.bookings WHERE id = %L', :'bk1'));
RESET ROLE;
UPDATE public.clients SET state = 'active' WHERE id = :'cb_row';
```

- [ ] **Step 2: Run it and watch it fail**

```bash
set -a && . ./.env && set +a
export PGURL="postgresql://postgres.qkmgmzhrwduvigccwgcz@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -w -v ON_ERROR_STOP=1 -f db/rls_assertions.sql 2>&1 | tail -5
```

Expected: every earlier block passes, then `ERROR: ... function public.save_availability(jsonb, jsonb, jsonb) does not exist` (raised inside the first `expect_raises`, which therefore *passes* — the first real failure is `overlapping ranges on one day are refused` reporting `expected "overlapping_hours", got "function public.save_availability…"`). The transaction rolls back; nothing is left behind.

- [ ] **Step 3: Commit**

```bash
git add db/rls_assertions.sql
git commit -m "test(m5a): harness block for booking core"
```

---

## Task 2 · Migration 0020

**Files:**
- Create: `supabase/migrations/0020_m5a_booking.sql`

**Interfaces:**
- Consumes: Task 1's contract.
- Produces (all `authenticated`-executable unless noted):
  - `save_availability(p_hours JSONB, p_exceptions JSONB, p_rules JSONB) RETURNS TABLE (out_booking_id UUID, out_starts_at TIMESTAMPTZ)`
  - `booking_policy(p_pt UUID) RETURNS TABLE (lengths_min SMALLINT[], buffer_min SMALLINT, window_weeks SMALLINT, cutoff_hours SMALLINT, timezone TEXT)`
  - `pt_day_windows(p_from DATE, p_to DATE) RETURNS TABLE (win_date DATE, win_start TIMESTAMPTZ, win_end TIMESTAMPTZ)`
  - `open_slots(p_pt UUID, p_from DATE, p_to DATE, p_length SMALLINT, p_ignore UUID DEFAULT NULL) RETURNS TABLE (slot_date DATE, slot_start TIMESTAMPTZ)`
  - `preview_series(p_start TIMESTAMPTZ, p_length SMALLINT, p_every_weeks SMALLINT, p_count SMALLINT, p_until DATE) RETURNS TABLE (n SMALLINT, occ_start TIMESTAMPTZ, after_offset_change BOOLEAN, conflict BOOLEAN)`
  - `create_booking(p_id UUID, p_client_id UUID, p_starts_at TIMESTAMPTZ, p_length SMALLINT, p_every_weeks SMALLINT DEFAULT NULL, p_count SMALLINT DEFAULT NULL, p_until DATE DEFAULT NULL) RETURNS SETOF bookings`
  - `reschedule_booking(p_id UUID, p_new_start TIMESTAMPTZ, p_scope TEXT DEFAULT 'one') RETURNS SETOF bookings`
  - `cancel_booking(p_id UUID, p_scope TEXT DEFAULT 'one', p_counted BOOLEAN DEFAULT NULL, p_reason TEXT DEFAULT NULL) RETURNS SETOF bookings`
  - `mark_no_show(p_id UUID) RETURNS bookings`
  - internal (no `authenticated` grant): `rules_for(UUID)`, `pt_tz(UUID)`, `day_windows(UUID, DATE, TEXT)`, `series_occurrences(TIMESTAMPTZ, TEXT, SMALLINT, SMALLINT, DATE)`
  - `start_workout_session` / `complete_workout_session`: same signatures, now link and complete bookings.

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- 0020 · M5a booking core.
--
-- A PT publishes hours; a PT or a client books; both read their schedule.
-- Spec: docs/superpowers/specs/2026-10-11-m5a-booking-core-design.md.
--
--   1. booking_rules, availability_exceptions — the two things schedules
--      (0001) has nowhere to hold. Weekly ranges stay in schedules, one row
--      per range, so a break is just the gap between two rows (spec D1).
--   2. bookings gains length_min, created_by_user_id and the late-cancel
--      columns, and an exclusion constraint: two live bookings for one PT can
--      never overlap, however the requests race (D7).
--   3. SELECT-only RLS on all four tables. Every write is an RPC below.
--   4. All time arithmetic lives here. Bookings store UTC plus the PT's zone;
--      local wall time is converted per occurrence, so a 10:30 weekly series
--      stays 10:30 across DST and its UTC shifts (D4, D5, D6). The app never
--      converts between zones.
--   5. start_workout_session links the booking a session fulfils, and
--      complete_workout_session completes it. Same signatures as 0016, so the
--      M4b outbox replays them unchanged (plan correction to D11).
--
-- Errors are raised as bare tokens (slot_taken, inside_cutoff, …) that
-- packages/shared/src/schedule/errors.ts maps to copy. 'not authorized' keeps
-- 0015's wording and ERRCODE.
--
-- Reschedules are audited as booking_create with details.rescheduled_from:
-- audit_logs is partitioned, and a new verb would rewrite the CHECK on every
-- partition.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) Tables
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.booking_rules (
  pt_user_id   UUID        NOT NULL,
  lengths_min  SMALLINT[]  NOT NULL DEFAULT '{45,60,90}',
  buffer_min   SMALLINT    NOT NULL DEFAULT 15,
  window_weeks SMALLINT    NOT NULL DEFAULT 4,
  cutoff_hours SMALLINT    NOT NULL DEFAULT 12,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_booking_rules PRIMARY KEY (pt_user_id),
  CONSTRAINT fk_booking_rules_pt FOREIGN KEY (pt_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT chk_br_lengths CHECK (cardinality(lengths_min) BETWEEN 1 AND 4 AND lengths_min <@ '{30,45,60,90}'::SMALLINT[]),
  CONSTRAINT chk_br_buffer  CHECK (buffer_min BETWEEN 0 AND 60),
  CONSTRAINT chk_br_window  CHECK (window_weeks BETWEEN 1 AND 12),
  CONSTRAINT chk_br_cutoff  CHECK (cutoff_hours BETWEEN 0 AND 48)
);

-- 'off' empties the day; 'extra' ADDS ranges to the day's weekly hours.
CREATE TABLE public.availability_exceptions (
  id          UUID        NOT NULL DEFAULT uuid_v7(),
  pt_user_id  UUID        NOT NULL,
  on_date     DATE        NOT NULL,
  kind        VARCHAR(10) NOT NULL,
  ranges      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_availability_exceptions PRIMARY KEY (id),
  CONSTRAINT fk_ax_pt FOREIGN KEY (pt_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT uq_ax_pt_date UNIQUE (pt_user_id, on_date),
  CONSTRAINT chk_ax_kind CHECK (kind IN ('off', 'extra')),
  CONSTRAINT chk_ax_ranges CHECK (
    (kind = 'off' AND ranges IS NULL)
    OR (kind = 'extra' AND jsonb_typeof(ranges) = 'array' AND jsonb_array_length(ranges) > 0)
  )
);

ALTER TABLE public.bookings
  ADD COLUMN length_min         SMALLINT,
  ADD COLUMN created_by_user_id UUID,
  ADD COLUMN cancel_late        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN cancel_counted     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN cancel_reason      TEXT,
  ADD CONSTRAINT fk_bookings_created_by FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT chk_bookings_length CHECK (length_min IS NULL OR length_min IN (30, 45, 60, 90)),
  ADD CONSTRAINT ex_bookings_pt_overlap EXCLUDE USING gist (
    pt_user_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status <> 'cancelled');

CREATE INDEX idx_bookings_parent ON public.bookings (parent_booking_id) WHERE parent_booking_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) RLS — SELECT only. Clients never read raw hours or rules; they see slots
-- through open_slots and the policy through booking_policy.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.booking_rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY schedules_select ON public.schedules
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY booking_rules_select ON public.booking_rules
  FOR SELECT TO authenticated
  USING (pt_user_id = auth.uid() OR public.is_admin());

CREATE POLICY availability_exceptions_select ON public.availability_exceptions
  FOR SELECT TO authenticated
  USING (pt_user_id = auth.uid() OR public.is_admin());

CREATE POLICY bookings_select ON public.bookings
  FOR SELECT TO authenticated
  USING (
    pt_user_id = auth.uid()
    OR (client_id IS NOT NULL AND public.is_client_record_owner(client_id))
    OR public.is_admin()
  );

REVOKE INSERT, UPDATE, DELETE ON public.schedules               FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.booking_rules           FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.availability_exceptions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.bookings                FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (3) Internal helpers. Called only from the SECURITY DEFINER RPCs below.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.rules_for(p_pt UUID)
RETURNS public.booking_rules
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    (SELECT r FROM public.booking_rules r WHERE r.pt_user_id = p_pt),
    ROW(p_pt, '{45,60,90}'::SMALLINT[], 15::SMALLINT, 4::SMALLINT, 12::SMALLINT, NOW())::public.booking_rules
  );
$$;

CREATE FUNCTION public.pt_tz(p_pt UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE((SELECT timezone FROM public.users WHERE id = p_pt), 'Asia/Beirut');
$$;

-- The day's bookable windows as instants: weekly ranges unless the day is off,
-- plus any extra ranges. date + time is a local timestamp; AT TIME ZONE turns
-- it into the instant that wall time names in p_tz.
CREATE FUNCTION public.day_windows(p_pt UUID, p_date DATE, p_tz TEXT)
RETURNS TABLE (w_start TIMESTAMPTZ, w_end TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT (p_date + s.start_time) AT TIME ZONE p_tz, (p_date + s.end_time) AT TIME ZONE p_tz
    FROM public.schedules s
   WHERE s.user_id = p_pt
     AND s.is_active
     AND s.day_of_week = EXTRACT(DOW FROM p_date)::INT
     AND NOT EXISTS (
       SELECT 1 FROM public.availability_exceptions x
        WHERE x.pt_user_id = p_pt AND x.on_date = p_date AND x.kind = 'off'
     )
  UNION ALL
  SELECT (p_date + (r->>'start')::TIME) AT TIME ZONE p_tz, (p_date + (r->>'end')::TIME) AT TIME ZONE p_tz
    FROM public.availability_exceptions x, jsonb_array_elements(x.ranges) r
   WHERE x.pt_user_id = p_pt AND x.on_date = p_date AND x.kind = 'extra';
$$;

-- Every occurrence of a series at the same LOCAL time. after_offset_change
-- marks the first occurrence after a UTC-offset change (DST), which is where
-- the create screen draws its warning.
CREATE FUNCTION public.series_occurrences(
  p_start       TIMESTAMPTZ,
  p_tz          TEXT,
  p_every_weeks SMALLINT,
  p_count       SMALLINT,
  p_until       DATE
)
RETURNS TABLE (n SMALLINT, occ_start TIMESTAMPTZ, after_offset_change BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_local  TIMESTAMP := p_start AT TIME ZONE p_tz;
  v_i      INT := 0;
  v_occ    TIMESTAMP;
  v_offset INTERVAL;
  v_prev   INTERVAL;
BEGIN
  IF p_every_weeks IS NULL THEN
    n := 1;
    occ_start := p_start;
    after_offset_change := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_every_weeks NOT IN (1, 2) OR (p_count IS NULL) = (p_until IS NULL) THEN
    RAISE EXCEPTION 'bad_repeat';
  END IF;
  IF p_count IS NOT NULL AND (p_count < 2 OR p_count > 26) THEN
    RAISE EXCEPTION 'series_too_long';
  END IF;
  IF p_until IS NOT NULL AND (p_until < v_local::DATE OR p_until > v_local::DATE + 181) THEN
    RAISE EXCEPTION 'series_too_long';
  END IF;

  LOOP
    v_occ := v_local + make_interval(weeks => v_i * p_every_weeks);
    EXIT WHEN v_i >= 26
      OR (p_count IS NOT NULL AND v_i >= p_count)
      OR (p_until IS NOT NULL AND v_occ::DATE > p_until);
    v_i := v_i + 1;
    n := v_i;
    occ_start := v_occ AT TIME ZONE p_tz;
    v_offset := v_occ - (occ_start AT TIME ZONE 'UTC');
    after_offset_change := v_prev IS NOT NULL AND v_offset <> v_prev;
    v_prev := v_offset;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rules_for(UUID)                                              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pt_tz(UUID)                                                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.day_windows(UUID, DATE, TEXT)                                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.series_occurrences(TIMESTAMPTZ, TEXT, SMALLINT, SMALLINT, DATE) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (4) save_availability — the design's "three tabs, one Save" (D1).
--
-- Replaces the caller's weekly ranges and every exception from today on (past
-- exceptions are history and stay), upserts the rules, and returns the future
-- scheduled bookings that now fall outside the hours. Those bookings are NOT
-- touched: the Exceptions tab flags them and the PT decides.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.save_availability(p_hours JSONB, p_exceptions JSONB, p_rules JSONB)
RETURNS TABLE (out_booking_id UUID, out_starts_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tz TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'pt') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  v_tz := public.pt_tz(auth.uid());

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_hours, '[]'::jsonb)) h
     WHERE (h->>'dow')::INT NOT BETWEEN 0 AND 6 OR (h->>'end')::TIME <= (h->>'start')::TIME
  ) THEN
    RAISE EXCEPTION 'bad_range';
  END IF;
  -- WITH ORDINALITY gives each range an identity, so two identical ranges on
  -- one day count as overlapping too (validateHours in rules.ts agrees).
  IF EXISTS (
    WITH r AS (
      SELECT t.i, (t.h->>'dow')::INT AS dow, (t.h->>'start')::TIME AS s, (t.h->>'end')::TIME AS e
        FROM jsonb_array_elements(COALESCE(p_hours, '[]'::jsonb)) WITH ORDINALITY AS t(h, i)
    )
    SELECT 1 FROM r a JOIN r b ON a.dow = b.dow AND a.i < b.i AND a.s < b.e AND b.s < a.e
  ) THEN
    RAISE EXCEPTION 'overlapping_hours';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_exceptions, '[]'::jsonb)) x,
                  jsonb_array_elements(COALESCE(x->'ranges', '[]'::jsonb)) r
     WHERE (r->>'end')::TIME <= (r->>'start')::TIME
  ) THEN
    RAISE EXCEPTION 'bad_range';
  END IF;

  DELETE FROM public.schedules WHERE user_id = auth.uid();
  INSERT INTO public.schedules (user_id, day_of_week, start_time, end_time, timezone)
  SELECT auth.uid(), (h->>'dow')::INT, (h->>'start')::TIME, (h->>'end')::TIME, v_tz
    FROM jsonb_array_elements(COALESCE(p_hours, '[]'::jsonb)) h;

  DELETE FROM public.availability_exceptions WHERE pt_user_id = auth.uid() AND on_date >= CURRENT_DATE;
  INSERT INTO public.availability_exceptions (pt_user_id, on_date, kind, ranges)
  SELECT auth.uid(), (x->>'date')::DATE, x->>'kind', CASE WHEN x->>'kind' = 'extra' THEN x->'ranges' END
    FROM jsonb_array_elements(COALESCE(p_exceptions, '[]'::jsonb)) x
   WHERE (x->>'date')::DATE >= CURRENT_DATE;

  INSERT INTO public.booking_rules (pt_user_id, lengths_min, buffer_min, window_weeks, cutoff_hours, updated_at)
  VALUES (
    auth.uid(),
    ARRAY(SELECT jsonb_array_elements_text(p_rules->'lengths')::SMALLINT ORDER BY 1),
    (p_rules->>'buffer')::SMALLINT,
    (p_rules->>'window')::SMALLINT,
    (p_rules->>'cutoff')::SMALLINT,
    NOW()
  )
  ON CONFLICT (pt_user_id) DO UPDATE
    SET lengths_min = EXCLUDED.lengths_min, buffer_min = EXCLUDED.buffer_min,
        window_weeks = EXCLUDED.window_weeks, cutoff_hours = EXCLUDED.cutoff_hours, updated_at = NOW();

  RETURN QUERY
  SELECT b.id, b.starts_at
    FROM public.bookings b
   WHERE b.pt_user_id = auth.uid() AND b.status = 'scheduled' AND b.starts_at > NOW()
     AND NOT EXISTS (
       SELECT 1 FROM public.day_windows(auth.uid(), (b.starts_at AT TIME ZONE v_tz)::DATE, v_tz) w
        WHERE w.w_start <= b.starts_at AND b.ends_at <= w.w_end
     )
   ORDER BY b.starts_at;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (5) Reads for the app.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.booking_policy(p_pt UUID)
RETURNS TABLE (lengths_min SMALLINT[], buffer_min SMALLINT, window_weeks SMALLINT, cutoff_hours SMALLINT, timezone TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_r public.booking_rules;
BEGIN
  IF NOT (
    p_pt = auth.uid()
    OR public.is_admin()
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.pt_user_id = p_pt AND c.client_user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  v_r := public.rules_for(p_pt);
  lengths_min := v_r.lengths_min;
  buffer_min := v_r.buffer_min;
  window_weeks := v_r.window_weeks;
  cutoff_hours := v_r.cutoff_hours;
  timezone := public.pt_tz(p_pt);
  RETURN NEXT;
END;
$$;

CREATE FUNCTION public.pt_day_windows(p_from DATE, p_to DATE)
RETURNS TABLE (win_date DATE, win_start TIMESTAMPTZ, win_end TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tz  TEXT;
  v_day DATE := p_from;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'pt') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_to < p_from OR p_to - p_from > 41 THEN
    RAISE EXCEPTION 'range_too_long';
  END IF;
  v_tz := public.pt_tz(auth.uid());
  WHILE v_day <= p_to LOOP
    RETURN QUERY SELECT v_day, w.w_start, w.w_end FROM public.day_windows(auth.uid(), v_day, v_tz) w ORDER BY w.w_start;
    v_day := v_day + 1;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (6) open_slots — the single authority on what can be booked (D2, D3).
--
-- Inside each window, candidates start at the window start (or the next
-- quarter-hour after now) and step by length + buffer; a candidate that would
-- overlap a live booking ± buffer jumps to that booking's end + buffer. That
-- packs the day the way the design's grid shows (08:15, 09:30 …) instead of
-- leaving 15-minute crumbs. p_ignore lets a reschedule look past the booking
-- being moved.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.open_slots(p_pt UUID, p_from DATE, p_to DATE, p_length SMALLINT, p_ignore UUID DEFAULT NULL)
RETURNS TABLE (slot_date DATE, slot_start TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_is_pt  BOOLEAN := (p_pt = auth.uid());
  v_tz     TEXT;
  v_rules  public.booking_rules;
  v_len    INTERVAL := make_interval(mins => p_length);
  v_buf    INTERVAL;
  v_limit  TIMESTAMPTZ;
  v_day    DATE;
  v_win    RECORD;
  v_cursor TIMESTAMPTZ;
  v_block  TIMESTAMPTZ;
BEGIN
  IF NOT v_is_pt AND NOT EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.pt_user_id = p_pt AND c.client_user_id = auth.uid() AND c.state IN ('active', 'accepted')
  ) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_to < p_from OR p_to - p_from > 41 THEN
    RAISE EXCEPTION 'range_too_long';
  END IF;

  v_tz    := public.pt_tz(p_pt);
  v_rules := public.rules_for(p_pt);
  IF NOT (p_length = ANY (v_rules.lengths_min)) THEN
    RAISE EXCEPTION 'length_not_offered';
  END IF;
  v_buf   := make_interval(mins => v_rules.buffer_min);
  v_limit := CASE WHEN v_is_pt THEN 'infinity'::TIMESTAMPTZ
                  ELSE NOW() + make_interval(weeks => v_rules.window_weeks) END;

  v_day := p_from;
  WHILE v_day <= p_to LOOP
    FOR v_win IN SELECT w.w_start, w.w_end FROM public.day_windows(p_pt, v_day, v_tz) w ORDER BY w.w_start LOOP
      v_cursor := v_win.w_start;
      IF v_cursor < NOW() THEN
        v_cursor := v_win.w_start
          + make_interval(mins => (CEIL(EXTRACT(EPOCH FROM (NOW() - v_win.w_start)) / 900) * 15)::INT);
      END IF;
      LOOP
        EXIT WHEN v_cursor + v_len > v_win.w_end OR v_cursor > v_limit;
        SELECT MAX(b.ends_at) INTO v_block
          FROM public.bookings b
         WHERE b.pt_user_id = p_pt
           AND b.status <> 'cancelled'
           AND b.id IS DISTINCT FROM p_ignore
           AND b.starts_at < v_cursor + v_len + v_buf
           AND b.ends_at + v_buf > v_cursor;
        IF v_block IS NOT NULL THEN
          v_cursor := v_block + v_buf;
          CONTINUE;
        END IF;
        slot_date  := v_day;
        slot_start := v_cursor;
        RETURN NEXT;
        v_cursor := v_cursor + v_len + v_buf;
      END LOOP;
    END LOOP;
    v_day := v_day + 1;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (7) preview_series — the create screen's list of dates and DST flag (D6).
-- conflict = overlaps a live booking (no buffer: a PT booking only has to not
-- overlap, see plan Corrections).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.preview_series(
  p_start       TIMESTAMPTZ,
  p_length      SMALLINT,
  p_every_weeks SMALLINT,
  p_count       SMALLINT,
  p_until       DATE
)
RETURNS TABLE (n SMALLINT, occ_start TIMESTAMPTZ, after_offset_change BOOLEAN, conflict BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'pt') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT o.n, o.occ_start, o.after_offset_change,
         EXISTS (
           SELECT 1 FROM public.bookings b
            WHERE b.pt_user_id = auth.uid() AND b.status <> 'cancelled'
              AND b.starts_at < o.occ_start + make_interval(mins => p_length)
              AND b.ends_at > o.occ_start
         )
    FROM public.series_occurrences(p_start, public.pt_tz(auth.uid()), p_every_weeks, p_count, p_until) o
   ORDER BY o.n;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (8) create_booking — idempotent by the app's id (D12).
--
-- A PT books any active/accepted client of theirs, including their own self
-- row, one-off or as a series, inside or outside published hours (overlap is
-- the only hard rule). A client books themselves, one session, and only a
-- start open_slots returns. A series is all-or-nothing: the exclusion
-- violation of any occurrence rolls back the whole subtransaction.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.create_booking(
  p_id          UUID,
  p_client_id   UUID,
  p_starts_at   TIMESTAMPTZ,
  p_length      SMALLINT,
  p_every_weeks SMALLINT DEFAULT NULL,
  p_count       SMALLINT DEFAULT NULL,
  p_until       DATE     DEFAULT NULL
)
RETURNS SETOF public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_client public.clients;
  v_is_pt  BOOLEAN;
  v_tz     TEXT;
  v_rules  public.booking_rules;
  v_day    DATE;
  v_rule   TEXT;
  v_total  INT := 1;
  v_occ    RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = p_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = p_id AND created_by_user_id = auth.uid()) THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT * FROM public.bookings WHERE id = p_id OR parent_booking_id = p_id ORDER BY starts_at;
    RETURN;
  END IF;

  v_is_pt := public.is_pt_of_client(p_client_id);
  IF NOT (v_is_pt OR public.is_client_record_owner(p_client_id)) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
  IF v_client.state NOT IN ('active', 'accepted') THEN
    RAISE EXCEPTION 'client_not_bookable';
  END IF;

  v_tz    := public.pt_tz(v_client.pt_user_id);
  v_rules := public.rules_for(v_client.pt_user_id);

  IF p_starts_at <= NOW() THEN
    RAISE EXCEPTION 'in_past';
  END IF;
  IF NOT (p_length = ANY (v_rules.lengths_min)) THEN
    RAISE EXCEPTION 'length_not_offered';
  END IF;

  IF NOT v_is_pt THEN
    IF p_every_weeks IS NOT NULL THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    IF p_starts_at > NOW() + make_interval(weeks => v_rules.window_weeks) THEN
      RAISE EXCEPTION 'outside_window';
    END IF;
    v_day := (p_starts_at AT TIME ZONE v_tz)::DATE;
    IF NOT EXISTS (
      SELECT 1 FROM public.open_slots(v_client.pt_user_id, v_day, v_day, p_length) s WHERE s.slot_start = p_starts_at
    ) THEN
      IF EXISTS (
        SELECT 1 FROM public.bookings b
         WHERE b.pt_user_id = v_client.pt_user_id AND b.status <> 'cancelled'
           AND b.starts_at < p_starts_at + make_interval(mins => p_length + v_rules.buffer_min)
           AND b.ends_at + make_interval(mins => v_rules.buffer_min) > p_starts_at
      ) THEN
        RAISE EXCEPTION 'slot_taken';
      END IF;
      RAISE EXCEPTION 'outside_hours';
    END IF;
  END IF;

  IF p_every_weeks IS NOT NULL THEN
    SELECT count(*) INTO v_total FROM public.series_occurrences(p_starts_at, v_tz, p_every_weeks, p_count, p_until);
    v_rule := format('FREQ=WEEKLY;INTERVAL=%s;COUNT=%s', p_every_weeks, v_total);
  END IF;

  BEGIN
    FOR v_occ IN SELECT * FROM public.series_occurrences(p_starts_at, v_tz, p_every_weeks, p_count, p_until) LOOP
      INSERT INTO public.bookings (
        id, pt_user_id, client_id, status, starts_at, ends_at, originating_timezone,
        recurrence_rule, parent_booking_id, length_min, created_by_user_id
      )
      VALUES (
        CASE WHEN v_occ.n = 1 THEN p_id ELSE uuid_v7() END,
        v_client.pt_user_id, p_client_id, 'scheduled',
        v_occ.occ_start, v_occ.occ_start + make_interval(mins => p_length), v_tz,
        v_rule, CASE WHEN v_occ.n = 1 THEN NULL ELSE p_id END, p_length, auth.uid()
      );
    END LOOP;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_taken';
  END;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), v_client.client_user_id, 'booking_create', 'booking', p_id,
          jsonb_build_object('occurrences', v_total, 'length_min', p_length,
                             'by', CASE WHEN v_is_pt THEN 'pt' ELSE 'client' END));

  RETURN QUERY SELECT * FROM public.bookings WHERE id = p_id OR parent_booking_id = p_id ORDER BY starts_at;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (9) reschedule_booking — D10.
--
-- The change is a LOCAL-time delta, applied to each row in the PT's zone, so
-- "this and following" keeps a series on its wall-clock time across DST.
-- Rows are moved in the direction of travel (latest first when moving later)
-- so a shift larger than the series spacing never collides with a sibling
-- that hasn't moved yet.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.reschedule_booking(p_id UUID, p_new_start TIMESTAMPTZ, p_scope TEXT DEFAULT 'one')
RETURNS SETOF public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_b      public.bookings;
  v_is_pt  BOOLEAN;
  v_rules  public.booking_rules;
  v_tz     TEXT;
  v_delta  INTERVAL;
  v_series UUID;
  v_ids    UUID[];
  v_id     UUID;
  v_day    DATE;
BEGIN
  IF p_scope NOT IN ('one', 'following') THEN
    RAISE EXCEPTION 'bad_repeat';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = p_id FOR UPDATE;
  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  v_is_pt := v_b.pt_user_id = auth.uid();
  IF NOT v_is_pt AND NOT (v_b.client_id IS NOT NULL AND public.is_client_record_owner(v_b.client_id)) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_b.status <> 'scheduled' THEN
    RAISE EXCEPTION 'booking_closed';
  END IF;

  v_rules := public.rules_for(v_b.pt_user_id);
  v_tz    := v_b.originating_timezone;

  IF NOT v_is_pt THEN
    IF p_scope <> 'one' THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    IF v_b.starts_at - make_interval(hours => v_rules.cutoff_hours) <= NOW() THEN
      RAISE EXCEPTION 'inside_cutoff';
    END IF;
  END IF;
  IF p_new_start <= NOW() THEN
    RAISE EXCEPTION 'in_past';
  END IF;
  IF NOT v_is_pt THEN
    IF p_new_start > NOW() + make_interval(weeks => v_rules.window_weeks) THEN
      RAISE EXCEPTION 'outside_window';
    END IF;
    v_day := (p_new_start AT TIME ZONE v_tz)::DATE;
    IF NOT EXISTS (
      SELECT 1 FROM public.open_slots(v_b.pt_user_id, v_day, v_day, v_b.length_min, p_id) s WHERE s.slot_start = p_new_start
    ) THEN
      RAISE EXCEPTION 'slot_taken';
    END IF;
  END IF;

  v_delta  := (p_new_start AT TIME ZONE v_tz) - (v_b.starts_at AT TIME ZONE v_tz);
  v_series := COALESCE(v_b.parent_booking_id, v_b.id);

  SELECT array_agg(id ORDER BY CASE WHEN v_delta > interval '0' THEN starts_at END DESC NULLS LAST, starts_at ASC)
    INTO v_ids
    FROM public.bookings
   WHERE (p_scope = 'one' AND id = p_id)
      OR (p_scope = 'following' AND COALESCE(parent_booking_id, id) = v_series
          AND starts_at >= v_b.starts_at AND status = 'scheduled');

  BEGIN
    FOREACH v_id IN ARRAY v_ids LOOP
      UPDATE public.bookings
         SET starts_at  = ((starts_at AT TIME ZONE v_tz) + v_delta) AT TIME ZONE v_tz,
             ends_at    = (((starts_at AT TIME ZONE v_tz) + v_delta) AT TIME ZONE v_tz) + (ends_at - starts_at),
             updated_at = NOW()
       WHERE id = v_id;
    END LOOP;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_taken';
  END;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), c.client_user_id, 'booking_create', 'booking', p_id,
         jsonb_build_object('rescheduled_from', v_b.starts_at, 'scope', p_scope, 'count', cardinality(v_ids))
    FROM public.clients c WHERE c.id = v_b.client_id;

  RETURN QUERY SELECT * FROM public.bookings WHERE id = ANY (v_ids) ORDER BY starts_at;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (10) cancel_booking — D8. Late = the cutoff has been reached (<=), the same
-- instant the app's canClientChange() turns false. Only the row the caller
-- pressed can be late; "following" rows are ordinary cancellations.
-- Idempotent on an already-cancelled booking.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.cancel_booking(
  p_id      UUID,
  p_scope   TEXT    DEFAULT 'one',
  p_counted BOOLEAN DEFAULT NULL,
  p_reason  TEXT    DEFAULT NULL
)
RETURNS SETOF public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_b      public.bookings;
  v_is_pt  BOOLEAN;
  v_late   BOOLEAN;
  v_series UUID;
  v_ids    UUID[];
BEGIN
  IF p_scope NOT IN ('one', 'following') THEN
    RAISE EXCEPTION 'bad_repeat';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = p_id FOR UPDATE;
  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  v_is_pt := v_b.pt_user_id = auth.uid();
  IF NOT v_is_pt AND NOT (v_b.client_id IS NOT NULL AND public.is_client_record_owner(v_b.client_id)) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF v_b.status = 'cancelled' THEN
    RETURN QUERY SELECT * FROM public.bookings WHERE id = p_id;
    RETURN;
  END IF;
  IF v_b.status <> 'scheduled' THEN
    RAISE EXCEPTION 'booking_closed';
  END IF;

  v_late := v_b.starts_at - make_interval(hours => (public.rules_for(v_b.pt_user_id)).cutoff_hours) <= NOW();

  IF NOT v_is_pt THEN
    IF p_scope <> 'one' THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    IF v_late THEN
      RAISE EXCEPTION 'inside_cutoff';
    END IF;
  END IF;

  v_series := COALESCE(v_b.parent_booking_id, v_b.id);
  SELECT array_agg(id) INTO v_ids
    FROM public.bookings
   WHERE id = p_id
      OR (p_scope = 'following' AND COALESCE(parent_booking_id, id) = v_series
          AND starts_at > v_b.starts_at AND status = 'scheduled');

  UPDATE public.bookings
     SET status         = 'cancelled',
         cancelled_at   = NOW(),
         cancelled_by   = CASE WHEN v_is_pt THEN 'pt' ELSE 'client' END,
         cancel_late    = (id = p_id AND v_late),
         cancel_counted = (id = p_id AND v_late AND v_is_pt AND COALESCE(p_counted, TRUE)),
         cancel_reason  = NULLIF(btrim(p_reason), ''),
         updated_at     = NOW()
   WHERE id = ANY (v_ids);

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), c.client_user_id, 'booking_cancel', 'booking', p_id,
         jsonb_build_object('late', v_late, 'counted', v_late AND v_is_pt AND COALESCE(p_counted, TRUE),
                            'scope', p_scope, 'count', cardinality(v_ids))
    FROM public.clients c WHERE c.id = v_b.client_id;

  RETURN QUERY SELECT * FROM public.bookings WHERE id = ANY (v_ids) ORDER BY starts_at;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (11) mark_no_show — D9. PT only, from 15 minutes after the start, and never
-- once a session has been started against the booking.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.mark_no_show(p_id UUID)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_b public.bookings;
BEGIN
  SELECT * INTO v_b FROM public.bookings WHERE id = p_id FOR UPDATE;
  IF v_b.id IS NULL OR v_b.pt_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_b.status = 'no_show' THEN
    RETURN v_b;
  END IF;
  IF EXISTS (SELECT 1 FROM public.workout_sessions WHERE booking_id = p_id) THEN
    RAISE EXCEPTION 'session_started';
  END IF;
  IF v_b.status <> 'scheduled' THEN
    RAISE EXCEPTION 'booking_closed';
  END IF;
  IF NOW() < v_b.starts_at + interval '15 minutes' THEN
    RAISE EXCEPTION 'too_early_for_no_show';
  END IF;

  UPDATE public.bookings
     SET status = 'no_show', no_show_marked_at = NOW(), updated_at = NOW()
   WHERE id = p_id
   RETURNING * INTO v_b;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), c.client_user_id, 'booking_no_show', 'booking', p_id, '{}'::jsonb
    FROM public.clients c WHERE c.id = v_b.client_id;

  RETURN v_b;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (12) Sessions fulfil bookings. 0016's bodies, plus the marked blocks only.
-- Same signatures, so CREATE OR REPLACE keeps the grants and the M4b outbox
-- replays these exactly as before.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_workout_session(
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
  v_booking     UUID;
BEGIN
  v_is_pt     := public.is_pt_of_client(p_client_id);
  v_is_client := public.is_client_record_owner(p_client_id);
  IF NOT (v_is_pt OR v_is_client) THEN
    RAISE EXCEPTION 'not authorized for this client';
  END IF;

  PERFORM 1 FROM public.clients WHERE id = p_client_id FOR UPDATE;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.workout_sessions WHERE id = p_id;
    IF v_row.id IS NOT NULL THEN
      IF v_row.client_id <> p_client_id THEN
        RAISE EXCEPTION 'session id belongs to another client' USING ERRCODE = '42501';
      END IF;
      RETURN v_row;
    END IF;
  END IF;

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

  -- M5a: the scheduled booking this session fulfils — the nearest whose
  -- [start − 30 min, end] contains the session's start and has no session yet.
  SELECT b.id INTO v_booking
    FROM public.bookings b
   WHERE b.client_id = p_client_id AND b.status = 'scheduled'
     AND v_started BETWEEN b.starts_at - interval '30 minutes' AND b.ends_at
     AND NOT EXISTS (SELECT 1 FROM public.workout_sessions o WHERE o.booking_id = b.id)
   ORDER BY abs(EXTRACT(EPOCH FROM (b.starts_at - v_started)))
   LIMIT 1;

  INSERT INTO public.workout_sessions (
    id, client_id, logged_by_user_id, program_day_id, status, scheduled_date, started_at, is_pt_led,
    day_label, day_number, week_number, booking_id
  )
  VALUES (
    COALESCE(p_id, uuid_v7()), p_client_id, auth.uid(), p_program_day_id, 'in_progress', v_started::DATE, v_started, v_is_pt,
    v_day_label, v_day_number, v_week_number, v_booking
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), c.client_user_id, 'workout_start', 'workout_session', v_row.id,
         jsonb_build_object('is_pt_led', v_is_pt, 'program_day_id', p_program_day_id,
                            'client_generated_id', p_id IS NOT NULL, 'booking_id', v_booking)
    FROM public.clients c WHERE c.id = p_client_id;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_workout_session(
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

  -- M5a: completing the session completes the booking it fulfilled.
  IF v_row.booking_id IS NOT NULL THEN
    UPDATE public.bookings SET status = 'completed', updated_at = NOW()
     WHERE id = v_row.booking_id AND status = 'scheduled';
    IF FOUND THEN
      INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
      SELECT auth.uid(), c.client_user_id, 'booking_complete', 'booking', v_row.booking_id,
             jsonb_build_object('workout_session_id', v_row.id)
        FROM public.clients c WHERE c.id = v_row.client_id;
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (13) Grants
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.save_availability(JSONB, JSONB, JSONB)                                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.booking_policy(UUID)                                                        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pt_day_windows(DATE, DATE)                                                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.open_slots(UUID, DATE, DATE, SMALLINT, UUID)                                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.preview_series(TIMESTAMPTZ, SMALLINT, SMALLINT, SMALLINT, DATE)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_booking(UUID, UUID, TIMESTAMPTZ, SMALLINT, SMALLINT, SMALLINT, DATE) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reschedule_booking(UUID, TIMESTAMPTZ, TEXT)                                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT, BOOLEAN, TEXT)                                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_no_show(UUID)                                                          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.save_availability(JSONB, JSONB, JSONB)                                      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.booking_policy(UUID)                                                        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.pt_day_windows(DATE, DATE)                                                  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.open_slots(UUID, DATE, DATE, SMALLINT, UUID)                                TO authenticated;
GRANT  EXECUTE ON FUNCTION public.preview_series(TIMESTAMPTZ, SMALLINT, SMALLINT, SMALLINT, DATE)             TO authenticated;
GRANT  EXECUTE ON FUNCTION public.create_booking(UUID, UUID, TIMESTAMPTZ, SMALLINT, SMALLINT, SMALLINT, DATE) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.reschedule_booking(UUID, TIMESTAMPTZ, TEXT)                                 TO authenticated;
GRANT  EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT, BOOLEAN, TEXT)                                   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_no_show(UUID)                                                          TO authenticated;

COMMIT;
```

Notes for the implementer:
- `schedules.chk_sched_times` (`end_time > start_time`) backs up `bad_range`; the explicit check exists so the app gets a token, not a constraint name.
- `open_slots` and `booking_policy` call `auth.uid()` — inside a SECURITY DEFINER function that is still the caller's JWT `sub`, which is what makes `create_booking`'s client path reuse `open_slots` for the client's own authorization.
- If `CREATE OR REPLACE` on `start_workout_session` complains that the parameter defaults differ, the four defaults above match 0016 exactly — diff them before reaching for `DROP`.

- [ ] **Step 2: Commit (unapplied)**

```bash
git add supabase/migrations/0020_m5a_booking.sql
git commit -m "feat(db): 0020 booking core — rules, exceptions, slots, series, RLS"
```

---

## Task 3 · Apply, prove, regenerate types

**Files:**
- Modify: `packages/shared/src/database.types.ts` (generated)

- [ ] **Step 1: Push**

```powershell
& "$env:APPDATA\nvm\v24.15.0\supabase.cmd" db push
& "$env:APPDATA\nvm\v24.15.0\supabase.cmd" migration list
```
Expected: `0020_m5a_booking` applied; local and remote columns agree through 0020.

- [ ] **Step 2: Run the harness**

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -w -v ON_ERROR_STOP=1 -f db/rls_assertions.sql 2>&1 | grep -E "FAIL|ERROR|pass" | tail -80
```
Expected: no `FAIL`, no `ERROR`; the last notice is `pass  a paused client still reads their own bookings`. If a case fails, fix the migration with a follow-up `0021_m5a_fix.sql` (0020 is already applied) — never edit an applied migration.

- [ ] **Step 3: Regenerate types**

```powershell
$env:COREPACK_INTEGRITY_KEYS='0'; pnpm types:gen
```
Expected: `database.types.ts` gains `booking_rules`, `availability_exceptions`, the five `bookings` columns and the nine new functions under `Functions`. `git diff --stat` shows only that file.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/database.types.ts
git commit -m "chore(types): regenerate after 0020"
```


---

## Task 4 · Shared: the schedule module

**Files:**
- Create: `packages/shared/src/schedule/errors.ts`, `errors.test.ts`, `time.ts`, `time.test.ts`, `layout.ts`, `layout.test.ts`, `rules.ts`, `rules.test.ts`, `index.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing (pure). Error tokens from Task 2.
- Produces (exported from `@forge/shared`):
  - `BOOKING_ERROR_CODES`, `type BookingErrorCode`, `bookingErrorCode(message?: string | null): BookingErrorCode`, `bookingErrorKey(code: BookingErrorCode): string`
  - `cancelDeadline(startsAt: string, cutoffHours: number): Date`, `canClientChange(startsAt: string, cutoffHours: number, now: number): boolean`, `NO_SHOW_GRACE_MIN`, `noShowUnlocksAt(startsAt: string): Date`, `canMarkNoShow(startsAt: string, now: number): boolean`, `hhmm(min: number): string`, `parseHhmm(s: string): number | null`, `minuteOfDay(d: Date): number`, `localDayKey(d: Date): string`, `addDays(d: Date, n: number): Date`, `durationLabel(min: number): string`
  - `type BookingState`, `bookingState(status: string, isSelf: boolean): BookingState`, `type Span`, `type DayRow<T>`, `dayRows<T>(windows, blocks, nowMin, minGap?)`, `monthCells(year: number, month0: number): (number | null)[]`, `slotCountsByDay(slots: { date: string }[]): Record<string, number>`, `seriesProgress(rows, currentStartsAt): { total: number; left: number }`
  - `ALL_LENGTHS`, `DEFAULT_RULES`, `RULE_BOUNDS`, `type BookingRules`, `type RuleKey`, `stepRule`, `toggleLength`, `type TimeRange`, `type HoursRange`, `type ExceptionInput`, `validateHours`, `weeklyMinutes`, `copyMondayToWeekdays`, `dayRanges`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/schedule/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import { BOOKING_ERROR_CODES, bookingErrorCode, bookingErrorKey } from './errors';

function lookup(path: string): unknown {
  return path.split('.').reduce<unknown>((node, k) => (node as Record<string, unknown> | undefined)?.[k], en);
}

describe('bookingErrorCode', () => {
  it('recognises every token the RPCs raise', () => {
    for (const code of BOOKING_ERROR_CODES) {
      if (code === 'not_authorized') continue;
      expect(bookingErrorCode(code)).toBe(code);
    }
  });
  it("maps 0015's 'not authorized' wording", () => {
    expect(bookingErrorCode('not authorized')).toBe('not_authorized');
  });
  it('treats a fetch failure as offline', () => {
    expect(bookingErrorCode('TypeError: Failed to fetch')).toBe('offline');
    expect(bookingErrorCode('Network request failed')).toBe('offline');
  });
  it('falls back to unknown', () => {
    expect(bookingErrorCode('duplicate key value violates unique constraint')).toBe('unknown');
    expect(bookingErrorCode(null)).toBe('unknown');
  });
});

describe('bookingErrorKey', () => {
  it('has English copy for every code', () => {
    for (const code of [...BOOKING_ERROR_CODES, 'unknown', 'offline'] as const) {
      expect(typeof lookup(bookingErrorKey(code))).toBe('string');
    }
  });
});
```

`packages/shared/src/schedule/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addDays, cancelDeadline, canClientChange, canMarkNoShow, durationLabel, hhmm, localDayKey, minuteOfDay,
  noShowUnlocksAt, parseHhmm,
} from './time';

const START = '2026-10-20T10:00:00.000Z';

describe('cutoff', () => {
  it('puts the deadline cutoff hours before the start', () => {
    expect(cancelDeadline(START, 12).toISOString()).toBe('2026-10-19T22:00:00.000Z');
  });
  it('is already too late exactly at the deadline — same instant cancel_booking refuses (Review Focus 2)', () => {
    const deadline = Date.parse('2026-10-19T22:00:00.000Z');
    expect(canClientChange(START, 12, deadline - 1)).toBe(true);
    expect(canClientChange(START, 12, deadline)).toBe(false);
  });
  it('a zero cutoff allows changes until the start', () => {
    expect(canClientChange(START, 0, Date.parse(START) - 1)).toBe(true);
    expect(canClientChange(START, 0, Date.parse(START))).toBe(false);
  });
});

describe('no-show', () => {
  it('unlocks 15 minutes after the start', () => {
    expect(noShowUnlocksAt(START).toISOString()).toBe('2026-10-20T10:15:00.000Z');
    expect(canMarkNoShow(START, Date.parse('2026-10-20T10:14:59.999Z'))).toBe(false);
    expect(canMarkNoShow(START, Date.parse('2026-10-20T10:15:00.000Z'))).toBe(true);
  });
});

describe('clock helpers', () => {
  it('formats and parses HH:MM', () => {
    expect(hhmm(75)).toBe('01:15');
    expect(hhmm(0)).toBe('00:00');
    expect(parseHhmm('07:05')).toBe(425);
    expect(parseHhmm('24:00')).toBeNull();
    expect(parseHhmm('7:05')).toBeNull();
  });
  it('reads minutes and day keys from local fields', () => {
    expect(minuteOfDay(new Date(2026, 9, 5, 9, 42))).toBe(582);
    expect(localDayKey(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
    expect(localDayKey(addDays(new Date(2026, 9, 31, 12), 1))).toBe('2026-11-01');
  });
  it('labels durations the way the design does', () => {
    expect(durationLabel(150)).toBe('2h 30');
    expect(durationLabel(120)).toBe('2h');
    expect(durationLabel(45)).toBe('45m');
  });
});
```

`packages/shared/src/schedule/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bookingState, dayRows, monthCells, seriesProgress, slotCountsByDay } from './layout';

const W = [{ startMin: 360, endMin: 720 }];

describe('bookingState', () => {
  it('maps statuses to the six design states', () => {
    expect(bookingState('scheduled', false)).toBe('booked');
    expect(bookingState('checked_in', false)).toBe('checked');
    expect(bookingState('completed', false)).toBe('done');
    expect(bookingState('no_show', false)).toBe('noshow');
    expect(bookingState('cancelled', false)).toBe('cancelled');
  });
  it('draws own training as ME unless it was cancelled', () => {
    expect(bookingState('scheduled', true)).toBe('me');
    expect(bookingState('completed', true)).toBe('me');
    expect(bookingState('cancelled', true)).toBe('cancelled');
  });
});

describe('dayRows', () => {
  it('splits a window around a booking into open gaps', () => {
    const rows = dayRows(W, [{ startMin: 540, endMin: 600, item: 'a', occupies: true }], null);
    expect(rows).toEqual([
      { kind: 'gap', startMin: 360, endMin: 540 },
      { kind: 'block', startMin: 540, endMin: 600, item: 'a' },
      { kind: 'gap', startMin: 600, endMin: 720 },
    ]);
  });
  it('a cancelled booking is listed but leaves its time open', () => {
    const rows = dayRows(W, [{ startMin: 540, endMin: 600, item: 'x', occupies: false }], null);
    expect(rows.map((r) => r.kind)).toEqual(['gap', 'block']);
    expect(rows[0]).toEqual({ kind: 'gap', startMin: 360, endMin: 720 });
  });
  it('drops gaps already in the past and places the now line', () => {
    const rows = dayRows(W, [{ startMin: 540, endMin: 600, item: 'a', occupies: true }], 582);
    expect(rows).toEqual([
      { kind: 'block', startMin: 540, endMin: 600, item: 'a' },
      { kind: 'now', min: 582 },
      { kind: 'gap', startMin: 600, endMin: 720 },
    ]);
  });
  it('clips a gap that now cuts through to the next quarter hour', () => {
    expect(dayRows(W, [], 400)).toEqual([{ kind: 'now', min: 400 }, { kind: 'gap', startMin: 405, endMin: 720 }]);
  });
  it('drops gaps shorter than the minimum', () => {
    const rows = dayRows(W, [{ startMin: 360, endMin: 700, item: 'a', occupies: true }], null);
    expect(rows.filter((r) => r.kind === 'gap')).toEqual([]);
  });
  it('puts the now line last when the day is over', () => {
    expect(dayRows(W, [], 1300)).toEqual([{ kind: 'now', min: 1300 }]);
  });
});

describe('monthCells', () => {
  it('is Monday-first and trimmed to whole weeks', () => {
    const oct = monthCells(2026, 9); // 1 Oct 2026 is a Thursday
    expect(oct.length).toBe(35);
    expect(oct.slice(0, 4)).toEqual([null, null, null, 1]);
    expect(oct[34]).toBe(31);
    expect(monthCells(2027, 1).length).toBe(28); // Feb 2027 starts on a Monday
  });
});

describe('slotCountsByDay', () => {
  it('counts openings per day', () => {
    expect(slotCountsByDay([{ date: '2026-10-19' }, { date: '2026-10-19' }, { date: '2026-10-21' }])).toEqual({
      '2026-10-19': 2,
      '2026-10-21': 1,
    });
  });
});

describe('seriesProgress', () => {
  it('counts what is left from this session on', () => {
    const rows = [
      { starts_at: '2026-10-01T07:00:00+00:00', status: 'completed' },
      { starts_at: '2026-10-08T07:00:00+00:00', status: 'scheduled' },
      { starts_at: '2026-10-15T07:00:00+00:00', status: 'scheduled' },
      { starts_at: '2026-10-22T07:00:00+00:00', status: 'cancelled' },
    ];
    expect(seriesProgress(rows, '2026-10-08T07:00:00+00:00')).toEqual({ total: 4, left: 2 });
  });
});
```

`packages/shared/src/schedule/rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { copyMondayToWeekdays, DEFAULT_RULES, stepRule, toggleLength, validateHours, weeklyMinutes } from './rules';

describe('stepRule', () => {
  it('steps by the bound and clamps', () => {
    expect(stepRule(DEFAULT_RULES, 'bufferMin', 1).bufferMin).toBe(20);
    expect(stepRule({ ...DEFAULT_RULES, bufferMin: 60 }, 'bufferMin', 1).bufferMin).toBe(60);
    expect(stepRule({ ...DEFAULT_RULES, cutoffHours: 0 }, 'cutoffHours', -1).cutoffHours).toBe(0);
    expect(stepRule({ ...DEFAULT_RULES, windowWeeks: 12 }, 'windowWeeks', 1).windowWeeks).toBe(12);
  });
});

describe('toggleLength', () => {
  it('adds in order and never removes the last one', () => {
    expect(toggleLength([45, 90], 60)).toEqual([45, 60, 90]);
    expect(toggleLength([45, 60], 45)).toEqual([60]);
    expect(toggleLength([60], 60)).toEqual([60]);
  });
});

describe('validateHours — the same cases save_availability refuses (Review Focus 4)', () => {
  it('accepts touching ranges', () => {
    expect(validateHours([{ dow: 1, start: '06:00', end: '12:00' }, { dow: 1, start: '12:00', end: '14:00' }])).toEqual({ ok: true });
  });
  it('refuses a reversed range', () => {
    expect(validateHours([{ dow: 1, start: '12:00', end: '06:00' }])).toEqual({ ok: false, code: 'bad_range', dow: 1 });
  });
  it('refuses overlapping ranges on one day, including identical ones', () => {
    expect(validateHours([{ dow: 2, start: '06:00', end: '12:00' }, { dow: 2, start: '11:00', end: '14:00' }])).toEqual({
      ok: false, code: 'overlapping_hours', dow: 2,
    });
    expect(validateHours([{ dow: 3, start: '06:00', end: '07:00' }, { dow: 3, start: '06:00', end: '07:00' }])).toEqual({
      ok: false, code: 'overlapping_hours', dow: 3,
    });
  });
  it('allows the same range on different days', () => {
    expect(validateHours([{ dow: 1, start: '06:00', end: '12:00' }, { dow: 2, start: '06:00', end: '12:00' }])).toEqual({ ok: true });
  });
});

describe('weekly hours helpers', () => {
  it('totals the week', () => {
    expect(weeklyMinutes([{ dow: 1, start: '06:00', end: '12:00' }, { dow: 2, start: '15:00', end: '20:00' }])).toBe(660);
  });
  it('copies Monday onto Tuesday–Friday and leaves the weekend alone', () => {
    const out = copyMondayToWeekdays([
      { dow: 1, start: '06:00', end: '12:00' },
      { dow: 3, start: '09:00', end: '10:00' },
      { dow: 6, start: '09:00', end: '12:00' },
    ]);
    expect(out.filter((h) => h.dow === 3)).toEqual([{ dow: 3, start: '06:00', end: '12:00' }]);
    expect(out.filter((h) => h.dow === 6)).toEqual([{ dow: 6, start: '09:00', end: '12:00' }]);
    expect(out.length).toBe(6);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @forge/shared test -- schedule`
Expected: FAIL — `Cannot find module './errors'` (and the other three).

- [ ] **Step 3: Implement**

`packages/shared/src/schedule/errors.ts`:

```ts
/**
 * The tokens 0020's RPCs raise, one-to-one with screen copy. The RPCs raise
 * the bare token as the message, so PostgREST hands it back verbatim in
 * `error.message`. 'not authorized' is 0015's wording, kept for consistency.
 */
export const BOOKING_ERROR_CODES = [
  'slot_taken',
  'outside_hours',
  'outside_window',
  'inside_cutoff',
  'in_past',
  'length_not_offered',
  'too_early_for_no_show',
  'series_too_long',
  'booking_closed',
  'session_started',
  'overlapping_hours',
  'bad_range',
  'client_not_bookable',
  'bad_repeat',
  'range_too_long',
  'not_authorized',
] as const;

export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number] | 'offline' | 'unknown';

const KEYS: Record<BookingErrorCode, string> = {
  slot_taken: 'schedule.errors.slotTaken',
  outside_hours: 'schedule.errors.outsideHours',
  outside_window: 'schedule.errors.outsideWindow',
  inside_cutoff: 'schedule.errors.insideCutoff',
  in_past: 'schedule.errors.inPast',
  length_not_offered: 'schedule.errors.lengthNotOffered',
  too_early_for_no_show: 'schedule.errors.tooEarlyForNoShow',
  series_too_long: 'schedule.errors.seriesTooLong',
  booking_closed: 'schedule.errors.bookingClosed',
  session_started: 'schedule.errors.sessionStarted',
  overlapping_hours: 'schedule.errors.overlappingHours',
  bad_range: 'schedule.errors.badRange',
  client_not_bookable: 'schedule.errors.clientNotBookable',
  bad_repeat: 'schedule.errors.badRepeat',
  range_too_long: 'schedule.errors.unknown',
  not_authorized: 'schedule.errors.notAuthorized',
  offline: 'schedule.errors.offline',
  unknown: 'schedule.errors.unknown',
};

const OFFLINE = /failed to fetch|network request failed|load failed|networkerror/i;

export function bookingErrorCode(message?: string | null): BookingErrorCode {
  if (!message) return 'unknown';
  if (message === 'not authorized') return 'not_authorized';
  if (OFFLINE.test(message)) return 'offline';
  return (BOOKING_ERROR_CODES as readonly string[]).includes(message) ? (message as BookingErrorCode) : 'unknown';
}

export function bookingErrorKey(code: BookingErrorCode): string {
  return KEYS[code];
}
```

`packages/shared/src/schedule/time.ts`:

```ts
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Mirrors 0020: no-show unlocks this long after the start. */
export const NO_SHOW_GRACE_MIN = 15;

export function cancelDeadline(startsAt: string, cutoffHours: number): Date {
  return new Date(Date.parse(startsAt) - cutoffHours * HOUR);
}

/**
 * Mirrors cancel_booking / reschedule_booking: a booking is late once
 * `starts_at − cutoff <= now`, so a client may change it only strictly before.
 * The SQL side is tested in db/rls_assertions.sql at the same boundary.
 */
export function canClientChange(startsAt: string, cutoffHours: number, now: number): boolean {
  return cancelDeadline(startsAt, cutoffHours).getTime() > now;
}

export function noShowUnlocksAt(startsAt: string): Date {
  return new Date(Date.parse(startsAt) + NO_SHOW_GRACE_MIN * MIN);
}

export function canMarkNoShow(startsAt: string, now: number): boolean {
  return now >= noShowUnlocksAt(startsAt).getTime();
}

const pad = (n: number) => String(n).padStart(2, '0');

export function hhmm(min: number): string {
  return pad(Math.floor(min / 60)) + ':' + pad(min % 60);
}

export function parseHhmm(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Local wall-clock fields of the device. The app never converts zones (plan Global Constraints). */
export function minuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function localDayKey(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
}

export function durationLabel(min: number): string {
  if (min < 60) return min + 'm';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? h + 'h ' + m : h + 'h';
}
```

`packages/shared/src/schedule/layout.ts`:

```ts
export type BookingState = 'booked' | 'checked' | 'done' | 'noshow' | 'cancelled' | 'me';

/** The design's six states. The PT's own training is ME whatever its status, unless cancelled. */
export function bookingState(status: string, isSelf: boolean): BookingState {
  if (status === 'cancelled') return 'cancelled';
  if (isSelf) return 'me';
  if (status === 'no_show') return 'noshow';
  if (status === 'completed' || status === 'checked_out') return 'done';
  if (status === 'checked_in' || status === 'in_progress') return 'checked';
  return 'booked';
}

export type Span = { startMin: number; endMin: number };
export type DayRow<T> =
  | { kind: 'block'; startMin: number; endMin: number; item: T }
  | { kind: 'gap'; startMin: number; endMin: number }
  | { kind: 'now'; min: number };

const byStart = (a: Span, b: Span) => a.startMin - b.startMin;

/**
 * The Day view's rows: every booking, the open gaps left in the published
 * windows (cancelled bookings don't occupy time), and the now line. Gaps
 * already in the past are dropped; one that now cuts through starts at the
 * next quarter hour. Minutes are local minutes of the day being drawn.
 */
export function dayRows<T>(
  windows: readonly Span[],
  blocks: ReadonlyArray<Span & { item: T; occupies: boolean }>,
  nowMin: number | null,
  minGap = 30,
): DayRow<T>[] {
  const busy = blocks.filter((b) => b.occupies).sort(byStart);
  const gaps: Span[] = [];
  for (const w of [...windows].sort(byStart)) {
    let cursor = w.startMin;
    for (const b of busy) {
      if (b.endMin <= cursor || b.startMin >= w.endMin) continue;
      if (b.startMin > cursor) gaps.push({ startMin: cursor, endMin: b.startMin });
      cursor = Math.max(cursor, b.endMin);
    }
    if (cursor < w.endMin) gaps.push({ startMin: cursor, endMin: w.endMin });
  }

  const floor = nowMin === null ? null : Math.ceil(nowMin / 15) * 15;
  const open = gaps
    .map((g) => (floor === null ? g : { startMin: Math.max(g.startMin, floor), endMin: g.endMin }))
    .filter((g) => g.endMin - g.startMin >= minGap);

  const rows: Array<Extract<DayRow<T>, { kind: 'block' | 'gap' }>> = [
    ...blocks.map((b) => ({ kind: 'block' as const, startMin: b.startMin, endMin: b.endMin, item: b.item })),
    ...open.map((g) => ({ kind: 'gap' as const, startMin: g.startMin, endMin: g.endMin })),
  ].sort((a, b) => a.startMin - b.startMin || (a.kind === 'block' ? -1 : 1));

  if (nowMin === null) return rows;
  const at = rows.findIndex((r) => r.startMin > nowMin);
  const out: DayRow<T>[] = [...rows];
  out.splice(at === -1 ? out.length : at, 0, { kind: 'now', min: nowMin });
  return out;
}

/** Day numbers for a Monday-first month grid, null for padding, trimmed to whole weeks. */
export function monthCells(year: number, month0: number): (number | null)[] {
  const lead = (new Date(year, month0, 1).getDay() + 6) % 7;
  const days = new Date(year, month0 + 1, 0).getDate();
  const total = Math.ceil((lead + days) / 7) * 7;
  return Array.from({ length: total }, (_, i) => {
    const d = i - lead + 1;
    return d >= 1 && d <= days ? d : null;
  });
}

export function slotCountsByDay(slots: ReadonlyArray<{ date: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of slots) out[s.date] = (out[s.date] ?? 0) + 1;
  return out;
}

/** "6 of 8 left": every row in the series, and the scheduled ones from this session on. */
export function seriesProgress(
  rows: ReadonlyArray<{ starts_at: string; status: string }>,
  currentStartsAt: string,
): { total: number; left: number } {
  const from = Date.parse(currentStartsAt);
  return {
    total: rows.length,
    left: rows.filter((r) => r.status === 'scheduled' && Date.parse(r.starts_at) >= from).length,
  };
}
```

`packages/shared/src/schedule/rules.ts`:

```ts
import { parseHhmm } from './time';

export const ALL_LENGTHS = [30, 45, 60, 90] as const;

export type BookingRules = { lengths: number[]; bufferMin: number; windowWeeks: number; cutoffHours: number };

/** Display defaults only. The server's defaults (rules_for in 0020) are authoritative and arrive via booking_policy. */
export const DEFAULT_RULES: BookingRules = { lengths: [45, 60, 90], bufferMin: 15, windowWeeks: 4, cutoffHours: 12 };

/** Same bounds as 0020's CHECK constraints on booking_rules. */
export const RULE_BOUNDS = {
  bufferMin: { min: 0, max: 60, step: 5 },
  windowWeeks: { min: 1, max: 12, step: 1 },
  cutoffHours: { min: 0, max: 48, step: 1 },
} as const;

export type RuleKey = keyof typeof RULE_BOUNDS;

export function stepRule(rules: BookingRules, key: RuleKey, dir: 1 | -1): BookingRules {
  const b = RULE_BOUNDS[key];
  return { ...rules, [key]: Math.min(b.max, Math.max(b.min, rules[key] + dir * b.step)) };
}

/** "At least one stays on" (design, Rules tab). */
export function toggleLength(lengths: readonly number[], len: number): number[] {
  if (lengths.includes(len)) return lengths.length === 1 ? [...lengths] : lengths.filter((l) => l !== len);
  return [...lengths, len].sort((a, b) => a - b);
}

export type TimeRange = { start: string; end: string };
export type HoursRange = TimeRange & { dow: number };
export type ExceptionInput = { date: string; kind: 'off' | 'extra'; ranges: TimeRange[] | null };

export type HoursCheck = { ok: true } | { ok: false; code: 'bad_range' | 'overlapping_hours'; dow: number };

/**
 * The same two refusals as save_availability, checked before the round trip.
 * Zero-padded HH:MM strings order the same way as the times they name, so
 * once both ends have parsed they are compared as strings.
 */
export function validateHours(hours: readonly HoursRange[]): HoursCheck {
  for (const h of hours) {
    const s = parseHhmm(h.start);
    const e = parseHhmm(h.end);
    if (s === null || e === null || e <= s || h.dow < 0 || h.dow > 6) return { ok: false, code: 'bad_range', dow: h.dow };
  }
  for (let i = 0; i < hours.length; i++) {
    for (let j = i + 1; j < hours.length; j++) {
      const a = hours[i]!;
      const b = hours[j]!;
      if (a.dow === b.dow && a.start < b.end && b.start < a.end) return { ok: false, code: 'overlapping_hours', dow: a.dow };
    }
  }
  return { ok: true };
}

export function weeklyMinutes(hours: readonly HoursRange[]): number {
  return hours.reduce((sum, h) => sum + ((parseHhmm(h.end) ?? 0) - (parseHhmm(h.start) ?? 0)), 0);
}

export function dayRanges(hours: readonly HoursRange[], dow: number): HoursRange[] {
  return hours.filter((h) => h.dow === dow).sort((a, b) => a.start.localeCompare(b.start));
}

/** Tue–Fri become exact copies of Monday; Sunday and Saturday are untouched. */
export function copyMondayToWeekdays(hours: readonly HoursRange[]): HoursRange[] {
  const monday = dayRanges(hours, 1);
  const keep = hours.filter((h) => h.dow < 2 || h.dow > 5);
  const copies = [2, 3, 4, 5].flatMap((dow) => monday.map((m) => ({ ...m, dow })));
  return [...keep, ...copies].sort((a, b) => a.dow - b.dow || a.start.localeCompare(b.start));
}
```

`packages/shared/src/schedule/index.ts`:

```ts
export * from './errors';
export * from './time';
export * from './layout';
export * from './rules';
```

Append to `packages/shared/src/index.ts`:

```ts
export * from './schedule/index';
```

- [ ] **Step 4: Run them**

Run: `pnpm --filter @forge/shared test -- schedule`
Expected: `time`, `layout`, `rules` PASS. `errors` fails only on "has English copy for every code" — Task 5 adds the copy.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schedule packages/shared/src/index.ts
git commit -m "feat(shared): schedule module — errors, deadlines, day rows, hours rules"
```

---

## Task 5 · Shared: copy (en + ar)

**Files:**
- Modify: `packages/shared/src/i18n/en.json`, `packages/shared/src/i18n/ar.json`

**Interfaces:**
- Produces: `common.tabs.schedule`, `schedule.*`, `bookings.*`. Every screen task uses these exact paths.

- [ ] **Step 1: English**

In `en.json` add `"schedule": "Schedule"` to `common.tabs` after `"library"`, then add these two top-level objects after `"body"`:

```json
  "schedule": {
    "title": "Schedule",
    "views": { "day": "Day", "week": "Week", "month": "Month" },
    "hours": "Hours",
    "newBooking": "New booking",
    "states": {
      "booked": "BOOKED", "checked": "CHECKED IN", "done": "COMPLETED",
      "noshow": "NO-SHOW", "cancelled": "CANCELLED", "me": "ME"
    },
    "me": "Me",
    "ownTraining": "Own training",
    "open": "Open · {{range}}",
    "openBook": "+ Book",
    "dayCount": "{{date}} · booked: {{count}}",
    "weekNoHours": "No hours set on this day",
    "monthNone": "Nothing booked · not a working day",
    "monthNothing": "Nothing booked",
    "lateCancelNote": "Cancelled {{time}} · inside cutoff",
    "emptyTitle": "Nothing booked this week",
    "emptyBody": "Your hours are live, so clients can book from their app. Or add a session yourself.",
    "emptyBodyNoHours": "Set your hours so clients can book from their app. Or add a session yourself.",
    "setHours": "Set your hours",
    "errorTitle": "Schedule didn't load",
    "errorBody": "Forge couldn't reach the server. Bookings already on this phone are safe.",
    "retry": "Try again",
    "offlineBanner": "OFFLINE · SCHEDULE AS OF {{time}}",
    "offlineBody": "Check-in and logging still work. New bookings wait for a connection.",
    "availability": {
      "title": "Availability",
      "save": "Save",
      "saved": "Published. Clients see your new hours.",
      "savedFlagged": "Published. Bookings outside your new hours: {{count}}. They stay booked.",
      "tabs": { "hours": "Hours", "exceptions": "Exceptions", "rules": "Rules" },
      "weeklyTotal": "{{total}} open per week · {{tz}}",
      "unavailable": "Unavailable",
      "add": "+ Add",
      "breakLabel": "{{length}} break",
      "copyMonday": "Copy Monday to all weekdays",
      "dayOn": "Works on {{day}}",
      "dayOff": "Day off",
      "extra": "Extra",
      "upcoming": "Upcoming exceptions",
      "noExceptions": "No exceptions coming up.",
      "addException": "+ Add exception",
      "exceptionDate": "Date",
      "exceptionKind": "What changes",
      "flagged": "Still booked that day: {{count}}",
      "remove": "Remove",
      "rangeTitle": "Hours",
      "from": "From",
      "to": "To",
      "earlier": "Earlier",
      "later": "Later",
      "less": "Less",
      "more": "More",
      "done": "Done",
      "lengthsTitle": "Session lengths offered",
      "lengthsHelp": "Clients pick from these when they book. At least one stays on.",
      "min": "min",
      "buffer": "Buffer between sessions",
      "bufferValue": "{{min}} min",
      "bufferHelp": "Forge keeps {{min}} min clear after every session. Clients never see it.",
      "bufferHelpZero": "Sessions can be booked back to back.",
      "window": "Booking window",
      "windowValue": "{{weeks}} wk",
      "windowHelp": "Clients can book up to {{weeks}} wk ahead.",
      "cutoff": "Cancel cutoff",
      "cutoffValue": "{{hours}} h",
      "cutoffHelp": "Clients can cancel or reschedule until {{hours}} h before. After that, only you can.",
      "cutoffHelpZero": "Clients can cancel any time before the start.",
      "emptyTitle": "No working hours yet",
      "emptyBody": "Clients can't book you until at least one day has hours.",
      "emptyCta": "Set weekly hours",
      "errorTitle": "Availability didn't load",
      "errorBody": "Your published hours still apply to bookings.",
      "offline": "OFFLINE · SAVING NEEDS A CONNECTION",
      "offlineBody": "Clients keep seeing your last published hours until then."
    },
    "form": {
      "titleNew": "New booking",
      "titleEdit": "Move booking",
      "cancel": "Cancel",
      "client": "Client",
      "change": "Change",
      "pickClient": "Pick a client",
      "length": "Length",
      "min": "min",
      "day": "Day",
      "time": "Time · {{date}}",
      "noTime": "No open time this day. Pick another day.",
      "repeat": "Repeat",
      "repeatNone": "Doesn't repeat",
      "repeatWeekly": "Weekly",
      "repeatBiweekly": "Every 2 wks",
      "endsCount": "After a count",
      "endsDate": "On a date",
      "endsAfter": "Ends after",
      "sessions": "× {{count}}",
      "last": "Last: {{date}}",
      "endsOn": "Ends on",
      "dstTitle": "CROSSES A CLOCK CHANGE · {{date}}",
      "dstBody": "Sessions after it stay at the same local time. A client in another time zone will see them shift by an hour.",
      "afterChange": "AFTER CHANGE",
      "taken": "TAKEN",
      "seriesTitle": "Sessions in this series",
      "seriesTaken": "Some dates are already taken. Change the time or the count.",
      "ctaOne": "Book {{time}}",
      "ctaSeries": "Book {{count}} sessions",
      "ctaPick": "Pick a time",
      "ctaMove": "Move to {{time}}",
      "scopeTitle": "Change which sessions?",
      "scopeOne": "This session only",
      "scopeFollowing": "This and following",
      "scopeFollowingSub": "{{count}} sessions",
      "keep": "Keep as is",
      "noClientsTitle": "No clients to book",
      "noClientsBody": "Invite a client first. A booking needs someone on the other end.",
      "noClientsCta": "Invite a client",
      "slotsErrorTitle": "Couldn't load open times",
      "slotsErrorBody": "Nothing was booked. Try again in a moment.",
      "offline": "OFFLINE · BOOKING NEEDS A CONNECTION",
      "offlineBody": "Open times can change while you're offline, so Forge won't confirm a slot until it can check."
    },
    "detail": {
      "back": "Schedule",
      "title": "Booking",
      "edit": "Edit",
      "repeats": "Repeats every {{every}} wk · {{left}} of {{total}} left",
      "program": "PROGRAM",
      "startSession": "Start session",
      "reschedule": "Reschedule",
      "noShow": "Mark no-show",
      "noShowLocked": "Unlocks at {{time}}",
      "cancel": "Cancel booking",
      "lateStarts": "Starts in {{time}}",
      "lateCutoff": "Cutoff is {{hours}} h",
      "lateTitle": "Cancel inside the cutoff?",
      "lateBody": "You decide whether this counts against {{name}}'s sessions.",
      "lateBodyNoName": "You decide whether this counts against the client's sessions.",
      "counts": "Counts as used",
      "waive": "Waive this once",
      "countsNote": "{{name}} sees it in My bookings as a late cancellation, counted.",
      "countsNoteNoName": "The client sees it in My bookings as a late cancellation, counted.",
      "waiveNote": "{{name}} sees it as cancelled by you. Nothing is counted.",
      "waiveNoteNoName": "The client sees it as cancelled by you. Nothing is counted.",
      "reason": "Reason · optional",
      "reasons": { "ill": "Client is ill", "clash": "Schedule clash", "travel": "Travel" },
      "keep": "Keep booking",
      "cancelTitle": "Cancel this booking?",
      "cancelScopeOne": "Only this session",
      "cancelScopeFollowing": "This and following",
      "noShowTitle": "Mark {{name}} as no-show?",
      "noShowTitleNoName": "Mark as no-show?",
      "noShowBody": "The session started at {{time}} and nobody checked in. It counts as used, and the client sees it in My bookings.",
      "notYet": "Not yet",
      "removedTitle": "This booking was removed",
      "removedBody": "It's gone from both schedules.",
      "backToSchedule": "Back to schedule",
      "errorTitle": "Booking didn't load",
      "errorBody": "Start session still works from the schedule.",
      "offline": "OFFLINE · SAVED COPY",
      "offlineBody": "Start session works. Reschedule and cancel need a connection."
    },
    "errors": {
      "slotTaken": "That time was just booked. Pick another.",
      "outsideHours": "That time isn't open any more. Pick another.",
      "outsideWindow": "That's further ahead than bookings are open.",
      "insideCutoff": "It's inside the cancel cutoff. Only your coach can change it now.",
      "inPast": "That time has already passed.",
      "lengthNotOffered": "That length isn't offered any more.",
      "tooEarlyForNoShow": "No-show unlocks 15 minutes after the start.",
      "seriesTooLong": "A series can run up to 26 sessions or 6 months.",
      "bookingClosed": "This booking can't be changed any more.",
      "sessionStarted": "A session was already started for this booking.",
      "overlappingHours": "Two ranges on one day overlap.",
      "badRange": "A range ends before it starts.",
      "clientNotBookable": "This client can't be booked right now.",
      "badRepeat": "Pick how the series ends.",
      "notAuthorized": "You can't change this booking.",
      "offline": "You're offline. Nothing was changed.",
      "unknown": "Something went wrong. Nothing was changed."
    }
  },
  "bookings": {
    "title": "My bookings",
    "upcoming": "Upcoming",
    "past": "Past",
    "next": "Next session",
    "withPt": "{{length}} min · {{name}}",
    "withPtNoName": "{{length}} min",
    "freeUntil": "Free to cancel or move until {{deadline}}",
    "reschedule": "Reschedule",
    "cancel": "Cancel",
    "tooLateTitle": "Too late to change here",
    "tooLateBody": "The {{hours}} h cutoff passed at {{time}}. Your coach can still move or cancel it.",
    "later": "Later",
    "pastStates": {
      "done": "Completed", "noshow": "No-show", "cancelled": "Cancelled",
      "lateCounted": "Late cancellation · counted", "me": "Own training"
    },
    "cancelTitle": "Cancel this session?",
    "cancelBody": "Free to cancel until {{deadline}}.",
    "cancelConfirm": "Cancel session",
    "keep": "Keep it",
    "emptyTitle": "No sessions booked",
    "emptyBody": "Pick a time that suits you.",
    "emptyCta": "Book a session",
    "errorTitle": "Bookings didn't load",
    "errorBody": "Nothing was cancelled. Your sessions are still on.",
    "offline": "OFFLINE · SAVED COPY FROM {{time}}",
    "offlineBody": "Cancel and reschedule need a connection.",
    "book": {
      "title": "Book a session",
      "titleMove": "Move this session",
      "with": "With {{name}} · {{tz}}",
      "withNoName": "{{tz}}",
      "length": "Length",
      "thisWeek": "This week",
      "nextWeek": "Next week",
      "noneTitle": "No openings this week",
      "noneBody": "Next week may have room.",
      "noneCta": "Go to next week",
      "takenTitle": "{{time}} was just booked",
      "takenBody": "Someone confirmed it a moment before you. The closest open times are outlined.",
      "policy": "Free to cancel or reschedule up to {{hours}} h before.",
      "policyZero": "Free to cancel any time before the start.",
      "cta": "Book {{time}}",
      "ctaMove": "Move to {{time}}",
      "ctaPick": "Pick a time",
      "doneTitle": "You're booked",
      "doneMoved": "Moved",
      "doneLength": "{{length}} min with {{name}}",
      "doneLengthNoName": "{{length}} min",
      "doneDeadline": "Free to cancel until {{deadline}}",
      "seeMine": "See my bookings",
      "closedTitle": "Booking isn't open yet",
      "closedBody": "Your coach hasn't published any hours yet. Ask at your next session.",
      "noCoachTitle": "No coach yet",
      "noCoachBody": "Booking opens once you've joined a coach.",
      "errorTitle": "Couldn't load open times",
      "errorBody": "Nothing was booked. Try again in a moment.",
      "offline": "OFFLINE · BOOKING NEEDS A CONNECTION",
      "offlineBody": "Open times can change while you're offline."
    },
    "home": {
      "next": "Next session",
      "none": "No session booked",
      "book": "Book a session",
      "mine": "My bookings"
    }
  }
```

- [ ] **Step 2: Arabic**

In `ar.json` add `"schedule": "الجدول"` to `common.tabs`, and the same two objects — same keys, same `{{vars}}`:

```json
  "schedule": {
    "title": "الجدول",
    "views": { "day": "يوم", "week": "أسبوع", "month": "شهر" },
    "hours": "الساعات",
    "newBooking": "حجز جديد",
    "states": {
      "booked": "محجوز", "checked": "تم الحضور", "done": "مكتمل",
      "noshow": "لم يحضر", "cancelled": "ملغى", "me": "أنا"
    },
    "me": "أنا",
    "ownTraining": "تمريني",
    "open": "متاح · {{range}}",
    "openBook": "+ احجز",
    "dayCount": "{{date}} · محجوز: {{count}}",
    "weekNoHours": "لا ساعات محددة لهذا اليوم",
    "monthNone": "لا حجوزات · ليس يوم عمل",
    "monthNothing": "لا حجوزات",
    "lateCancelNote": "أُلغي {{time}} · ضمن مهلة الإلغاء",
    "emptyTitle": "لا حجوزات هذا الأسبوع",
    "emptyBody": "ساعاتك منشورة، فيمكن للعملاء الحجز من تطبيقهم. أو أضف جلسة بنفسك.",
    "emptyBodyNoHours": "حدد ساعاتك ليتمكن العملاء من الحجز من تطبيقهم. أو أضف جلسة بنفسك.",
    "setHours": "حدد ساعاتك",
    "errorTitle": "تعذّر تحميل الجدول",
    "errorBody": "تعذّر على Forge الوصول إلى الخادم. الحجوزات المحفوظة على هذا الهاتف بأمان.",
    "retry": "حاول مجددًا",
    "offlineBanner": "غير متصل · الجدول كما في {{time}}",
    "offlineBody": "تسجيل الحضور والتمارين ما زال يعمل. الحجوزات الجديدة تنتظر الاتصال.",
    "availability": {
      "title": "أوقات التوفر",
      "save": "حفظ",
      "saved": "تم النشر. يرى العملاء ساعاتك الجديدة.",
      "savedFlagged": "تم النشر. حجوزات خارج ساعاتك الجديدة: {{count}}. تبقى محجوزة.",
      "tabs": { "hours": "الساعات", "exceptions": "الاستثناءات", "rules": "القواعد" },
      "weeklyTotal": "{{total}} متاحة أسبوعيًا · {{tz}}",
      "unavailable": "غير متاح",
      "add": "+ إضافة",
      "breakLabel": "استراحة {{length}}",
      "copyMonday": "انسخ الاثنين إلى كل أيام العمل",
      "dayOn": "يعمل يوم {{day}}",
      "dayOff": "يوم عطلة",
      "extra": "إضافي",
      "upcoming": "الاستثناءات القادمة",
      "noExceptions": "لا استثناءات قادمة.",
      "addException": "+ إضافة استثناء",
      "exceptionDate": "التاريخ",
      "exceptionKind": "ما الذي يتغير",
      "flagged": "ما زال محجوزًا في ذلك اليوم: {{count}}",
      "remove": "إزالة",
      "rangeTitle": "الساعات",
      "from": "من",
      "to": "إلى",
      "earlier": "أبكر",
      "later": "أبعد",
      "less": "أقل",
      "more": "أكثر",
      "done": "تم",
      "lengthsTitle": "مدد الجلسات المتاحة",
      "lengthsHelp": "يختار العملاء منها عند الحجز. تبقى واحدة على الأقل مفعّلة.",
      "min": "د",
      "buffer": "فاصل بين الجلسات",
      "bufferValue": "{{min}} د",
      "bufferHelp": "يُبقي Forge {{min}} دقيقة فارغة بعد كل جلسة. لا يراها العملاء.",
      "bufferHelpZero": "يمكن حجز الجلسات متتالية.",
      "window": "نافذة الحجز",
      "windowValue": "{{weeks}} أسبوع",
      "windowHelp": "يمكن للعملاء الحجز قبل {{weeks}} أسبوع كحد أقصى.",
      "cutoff": "مهلة الإلغاء",
      "cutoffValue": "{{hours}} س",
      "cutoffHelp": "يمكن للعملاء الإلغاء أو تغيير الموعد حتى {{hours}} ساعة قبله. بعد ذلك، أنت فقط.",
      "cutoffHelpZero": "يمكن للعملاء الإلغاء في أي وقت قبل البدء.",
      "emptyTitle": "لا ساعات عمل بعد",
      "emptyBody": "لا يمكن للعملاء حجزك حتى يكون ليوم واحد على الأقل ساعات.",
      "emptyCta": "حدد الساعات الأسبوعية",
      "errorTitle": "تعذّر تحميل أوقات التوفر",
      "errorBody": "ساعاتك المنشورة ما زالت سارية على الحجوزات.",
      "offline": "غير متصل · الحفظ يحتاج اتصالًا",
      "offlineBody": "يبقى العملاء يرون آخر ساعات نشرتها حتى ذلك الحين."
    },
    "form": {
      "titleNew": "حجز جديد",
      "titleEdit": "نقل الحجز",
      "cancel": "إلغاء",
      "client": "العميل",
      "change": "تغيير",
      "pickClient": "اختر عميلًا",
      "length": "المدة",
      "min": "د",
      "day": "اليوم",
      "time": "الوقت · {{date}}",
      "noTime": "لا وقت متاح في هذا اليوم. اختر يومًا آخر.",
      "repeat": "التكرار",
      "repeatNone": "بلا تكرار",
      "repeatWeekly": "أسبوعيًا",
      "repeatBiweekly": "كل أسبوعين",
      "endsCount": "بعد عدد",
      "endsDate": "في تاريخ",
      "endsAfter": "ينتهي بعد",
      "sessions": "× {{count}}",
      "last": "الأخيرة: {{date}}",
      "endsOn": "ينتهي في",
      "dstTitle": "يعبر تغيير الساعة · {{date}}",
      "dstBody": "الجلسات بعده تبقى على نفس التوقيت المحلي. العميل في منطقة زمنية أخرى سيراها تتغير ساعة.",
      "afterChange": "بعد التغيير",
      "taken": "محجوز",
      "seriesTitle": "جلسات هذه السلسلة",
      "seriesTaken": "بعض التواريخ محجوزة. غيّر الوقت أو العدد.",
      "ctaOne": "احجز {{time}}",
      "ctaSeries": "احجز {{count}} جلسات",
      "ctaPick": "اختر وقتًا",
      "ctaMove": "انقل إلى {{time}}",
      "scopeTitle": "أي جلسات تريد تغييرها؟",
      "scopeOne": "هذه الجلسة فقط",
      "scopeFollowing": "هذه وما بعدها",
      "scopeFollowingSub": "{{count}} جلسات",
      "keep": "أبقِها كما هي",
      "noClientsTitle": "لا عملاء للحجز",
      "noClientsBody": "ادعُ عميلًا أولًا. الحجز يحتاج شخصًا في الطرف الآخر.",
      "noClientsCta": "ادعُ عميلًا",
      "slotsErrorTitle": "تعذّر تحميل الأوقات المتاحة",
      "slotsErrorBody": "لم يُحجز شيء. حاول بعد قليل.",
      "offline": "غير متصل · الحجز يحتاج اتصالًا",
      "offlineBody": "قد تتغير الأوقات المتاحة وأنت غير متصل، لذا لن يؤكد Forge موعدًا قبل أن يتحقق."
    },
    "detail": {
      "back": "الجدول",
      "title": "الحجز",
      "edit": "تعديل",
      "repeats": "يتكرر كل {{every}} أسبوع · بقي {{left}} من {{total}}",
      "program": "البرنامج",
      "startSession": "ابدأ الجلسة",
      "reschedule": "تغيير الموعد",
      "noShow": "سجّل عدم حضور",
      "noShowLocked": "يُتاح عند {{time}}",
      "cancel": "إلغاء الحجز",
      "lateStarts": "يبدأ بعد {{time}}",
      "lateCutoff": "المهلة {{hours}} س",
      "lateTitle": "إلغاء ضمن المهلة؟",
      "lateBody": "أنت تقرر إن كان سيُحتسب من جلسات {{name}}.",
      "lateBodyNoName": "أنت تقرر إن كان سيُحتسب من جلسات العميل.",
      "counts": "يُحتسب كمستخدمة",
      "waive": "تجاوز هذه المرة",
      "countsNote": "يراه {{name}} في حجوزاتي كإلغاء متأخر، محتسب.",
      "countsNoteNoName": "يراه العميل في حجوزاتي كإلغاء متأخر، محتسب.",
      "waiveNote": "يراه {{name}} كإلغاء منك. لا شيء يُحتسب.",
      "waiveNoteNoName": "يراه العميل كإلغاء منك. لا شيء يُحتسب.",
      "reason": "السبب · اختياري",
      "reasons": { "ill": "العميل مريض", "clash": "تعارض في المواعيد", "travel": "سفر" },
      "keep": "أبقِ الحجز",
      "cancelTitle": "إلغاء هذا الحجز؟",
      "cancelScopeOne": "هذه الجلسة فقط",
      "cancelScopeFollowing": "هذه وما بعدها",
      "noShowTitle": "تسجيل {{name}} كغائب؟",
      "noShowTitleNoName": "تسجيل كغائب؟",
      "noShowBody": "بدأت الجلسة عند {{time}} ولم يسجّل أحد الحضور. تُحتسب كمستخدمة، ويراها العميل في حجوزاتي.",
      "notYet": "ليس بعد",
      "removedTitle": "أُزيل هذا الحجز",
      "removedBody": "لم يعد في أي من الجدولين.",
      "backToSchedule": "العودة إلى الجدول",
      "errorTitle": "تعذّر تحميل الحجز",
      "errorBody": "بدء الجلسة ما زال يعمل من الجدول.",
      "offline": "غير متصل · نسخة محفوظة",
      "offlineBody": "بدء الجلسة يعمل. تغيير الموعد والإلغاء يحتاجان اتصالًا."
    },
    "errors": {
      "slotTaken": "حُجز هذا الوقت للتو. اختر وقتًا آخر.",
      "outsideHours": "هذا الوقت لم يعد متاحًا. اختر وقتًا آخر.",
      "outsideWindow": "هذا أبعد مما يُسمح بالحجز مسبقًا.",
      "insideCutoff": "الموعد ضمن مهلة الإلغاء. مدربك فقط يمكنه تغييره الآن.",
      "inPast": "هذا الوقت مضى.",
      "lengthNotOffered": "هذه المدة لم تعد متاحة.",
      "tooEarlyForNoShow": "تسجيل عدم الحضور يُتاح بعد 15 دقيقة من البدء.",
      "seriesTooLong": "السلسلة تمتد حتى 26 جلسة أو 6 أشهر.",
      "bookingClosed": "لم يعد بالإمكان تغيير هذا الحجز.",
      "sessionStarted": "بدأت جلسة لهذا الحجز بالفعل.",
      "overlappingHours": "نطاقان في اليوم نفسه متداخلان.",
      "badRange": "نطاق ينتهي قبل أن يبدأ.",
      "clientNotBookable": "لا يمكن حجز هذا العميل الآن.",
      "badRepeat": "اختر كيف تنتهي السلسلة.",
      "notAuthorized": "لا يمكنك تغيير هذا الحجز.",
      "offline": "أنت غير متصل. لم يتغير شيء.",
      "unknown": "حدث خطأ. لم يتغير شيء."
    }
  },
  "bookings": {
    "title": "حجوزاتي",
    "upcoming": "القادمة",
    "past": "السابقة",
    "next": "الجلسة القادمة",
    "withPt": "{{length}} د · {{name}}",
    "withPtNoName": "{{length}} د",
    "freeUntil": "الإلغاء أو التغيير مجاني حتى {{deadline}}",
    "reschedule": "تغيير الموعد",
    "cancel": "إلغاء",
    "tooLateTitle": "فات وقت التغيير من هنا",
    "tooLateBody": "انتهت مهلة {{hours}} ساعة عند {{time}}. مدربك ما زال يستطيع نقلها أو إلغاءها.",
    "later": "لاحقًا",
    "pastStates": {
      "done": "مكتملة", "noshow": "لم تحضر", "cancelled": "ملغاة",
      "lateCounted": "إلغاء متأخر · محتسب", "me": "تمريني"
    },
    "cancelTitle": "إلغاء هذه الجلسة؟",
    "cancelBody": "الإلغاء مجاني حتى {{deadline}}.",
    "cancelConfirm": "إلغاء الجلسة",
    "keep": "أبقِها",
    "emptyTitle": "لا جلسات محجوزة",
    "emptyBody": "اختر وقتًا يناسبك.",
    "emptyCta": "احجز جلسة",
    "errorTitle": "تعذّر تحميل الحجوزات",
    "errorBody": "لم يُلغَ شيء. جلساتك ما زالت قائمة.",
    "offline": "غير متصل · نسخة محفوظة من {{time}}",
    "offlineBody": "الإلغاء وتغيير الموعد يحتاجان اتصالًا.",
    "book": {
      "title": "احجز جلسة",
      "titleMove": "انقل هذه الجلسة",
      "with": "مع {{name}} · {{tz}}",
      "withNoName": "{{tz}}",
      "length": "المدة",
      "thisWeek": "هذا الأسبوع",
      "nextWeek": "الأسبوع القادم",
      "noneTitle": "لا أوقات متاحة هذا الأسبوع",
      "noneBody": "قد يكون هناك متسع الأسبوع القادم.",
      "noneCta": "انتقل إلى الأسبوع القادم",
      "takenTitle": "حُجز {{time}} للتو",
      "takenBody": "أكّده شخص قبلك بلحظة. أقرب الأوقات المتاحة محددة.",
      "policy": "الإلغاء أو التغيير مجاني حتى {{hours}} ساعة قبل الموعد.",
      "policyZero": "الإلغاء مجاني في أي وقت قبل البدء.",
      "cta": "احجز {{time}}",
      "ctaMove": "انقل إلى {{time}}",
      "ctaPick": "اختر وقتًا",
      "doneTitle": "تم الحجز",
      "doneMoved": "تم النقل",
      "doneLength": "{{length}} د مع {{name}}",
      "doneLengthNoName": "{{length}} د",
      "doneDeadline": "الإلغاء مجاني حتى {{deadline}}",
      "seeMine": "عرض حجوزاتي",
      "closedTitle": "الحجز غير متاح بعد",
      "closedBody": "لم ينشر مدربك أي ساعات بعد. اسأله في جلستك القادمة.",
      "noCoachTitle": "لا مدرب بعد",
      "noCoachBody": "يُفتح الحجز بعد انضمامك إلى مدرب.",
      "errorTitle": "تعذّر تحميل الأوقات المتاحة",
      "errorBody": "لم يُحجز شيء. حاول بعد قليل.",
      "offline": "غير متصل · الحجز يحتاج اتصالًا",
      "offlineBody": "قد تتغير الأوقات المتاحة وأنت غير متصل."
    },
    "home": {
      "next": "الجلسة القادمة",
      "none": "لا جلسة محجوزة",
      "book": "احجز جلسة",
      "mine": "حجوزاتي"
    }
  }
```

- [ ] **Step 3: Run the shared suite**

Run: `pnpm --filter @forge/shared test`
Expected: PASS — `i18n.test.ts` (parity) and `errors.test.ts` (copy for every code) included.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/i18n/en.json packages/shared/src/i18n/ar.json
git commit -m "feat(i18n): schedule and bookings copy (en, ar)"
```

---

## Task 6 · Mobile: API wrappers, formatting, hooks

**Files:**
- Create: `apps/mobile/src/lib/consoleWidth.ts`
- Modify: `apps/mobile/src/app/(app)/sessions/[id]/index.tsx` (import the constant instead of declaring it)
- Create: `apps/mobile/src/lib/schedule/scheduleApi.ts`, `format.ts`, `stateStyle.ts`, `useNow.ts`, `useSchedule.ts`, `useAvailability.ts`, `useOpenSlots.ts`, `useMyBookings.ts`, `useBookingDetail.ts`

**Interfaces:**
- Consumes: Task 2 RPCs (via regenerated types), Task 4 helpers, `fetchRoster`, `cachedFetch`/`OFFLINE`, `useOffline`.
- Produces:
  - `CONSOLE_MIN_WIDTH: number` (900)
  - `scheduleApi`: types `BookingRow`, `BookingPolicy`, `Slot { date; startsAt }`, `DayWindow { date; start; end }`, `SeriesPreviewRow { n; startsAt; afterOffsetChange; conflict }`, `ApiResult<T>`, `Scope = 'one' | 'following'`; functions `fetchPolicy(pt)`, `fetchPtBookings(pt, fromIso, toIso)`, `fetchDayWindows(fromDate, toDate)`, `fetchOpenSlots(pt, fromDate, toDate, length, ignoreId?)`, `previewSeries({ start, length, everyWeeks, count, until })`, `createBooking({ id, clientId, startsAt, length, everyWeeks?, count?, until? })`, `rescheduleBooking(id, newStart, scope)`, `cancelBooking(id, scope, counted, reason)`, `markNoShow(id)`, `fetchAvailability(pt)`, `saveAvailability(hours, exceptions, rules)`, `fetchUserName(id)`
  - `format`: `timeLabel(iso)`, `dayLabel(dateOrIso, locale)`, `dowLabel(date, locale)`, `deadlineLabel(date, locale)`, `untilLabel(ms)`
  - `stateStyle(state, colors): StateStyle`
  - `useNow(ms?): number`
  - hooks: `useSchedule(pt, from, to)`, `useAvailability(pt)`, `useOpenSlots(pt, fromDate, toDate, length, ignoreId?)`, `useMyBookings(userId)`, `useBookingDetail(id)` — return shapes below.

- [ ] **Step 1: Share the iPad breakpoint**

`apps/mobile/src/lib/consoleWidth.ts`:

```ts
/**
 * The width at which a PT gets the iPad layouts instead of the phone ones:
 * the M4d logging console and the M5a week grid. One number, so the two can
 * never disagree about what counts as "the iPad".
 */
export const CONSOLE_MIN_WIDTH = 900;
```

In `app/(app)/sessions/[id]/index.tsx` delete `const CONSOLE_MIN_WIDTH = 900;` (line 14) and add `import { CONSOLE_MIN_WIDTH } from '../../../../lib/consoleWidth';` with the other imports.

- [ ] **Step 2: API wrappers**

`apps/mobile/src/lib/schedule/scheduleApi.ts`:

```ts
import {
  bookingErrorCode,
  type BookingErrorCode,
  type BookingRules,
  type Database,
  type ExceptionInput,
  type HoursRange,
} from '@forge/shared';
import { supabase } from '../supabase';

export type BookingRow = Database['public']['Tables']['bookings']['Row'];
export type BookingPolicy = { lengths: number[]; bufferMin: number; windowWeeks: number; cutoffHours: number; timezone: string };
export type Slot = { date: string; startsAt: string };
export type DayWindow = { date: string; start: string; end: string };
export type SeriesPreviewRow = { n: number; startsAt: string; afterOffsetChange: boolean; conflict: boolean };
export type ApiResult<T> = { data: T; error: null } | { data: null; error: BookingErrorCode };
export type Scope = 'one' | 'following';

/**
 * Thin typed wrappers over 0020. Every booking write goes through here, and
 * every error comes back as a BookingErrorCode the screens map to copy.
 */
const fail = (e: { message?: string } | null): { data: null; error: BookingErrorCode } => ({
  data: null,
  error: bookingErrorCode(e?.message),
});

export async function fetchPolicy(ptUserId: string): Promise<ApiResult<BookingPolicy>> {
  const { data, error } = await supabase.rpc('booking_policy', { p_pt: ptUserId });
  const row = data?.[0];
  if (error || !row) return fail(error);
  return {
    data: {
      lengths: row.lengths_min,
      bufferMin: row.buffer_min,
      windowWeeks: row.window_weeks,
      cutoffHours: row.cutoff_hours,
      timezone: row.timezone,
    },
    error: null,
  };
}

export async function fetchPtBookings(ptUserId: string, fromIso: string, toIso: string): Promise<ApiResult<BookingRow[]>> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('pt_user_id', ptUserId)
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .order('starts_at');
  if (error) return fail(error);
  return { data: data ?? [], error: null };
}

export async function fetchDayWindows(fromDate: string, toDate: string): Promise<ApiResult<DayWindow[]>> {
  const { data, error } = await supabase.rpc('pt_day_windows', { p_from: fromDate, p_to: toDate });
  if (error) return fail(error);
  return { data: (data ?? []).map((w) => ({ date: w.win_date, start: w.win_start, end: w.win_end })), error: null };
}

export async function fetchOpenSlots(
  ptUserId: string,
  fromDate: string,
  toDate: string,
  length: number,
  ignoreId?: string,
): Promise<ApiResult<Slot[]>> {
  const { data, error } = await supabase.rpc('open_slots', {
    p_pt: ptUserId,
    p_from: fromDate,
    p_to: toDate,
    p_length: length,
    ...(ignoreId ? { p_ignore: ignoreId } : {}),
  });
  if (error) return fail(error);
  return { data: (data ?? []).map((s) => ({ date: s.slot_date, startsAt: s.slot_start })), error: null };
}

export async function previewSeries(a: {
  start: string;
  length: number;
  everyWeeks: 1 | 2;
  count: number | null;
  until: string | null;
}): Promise<ApiResult<SeriesPreviewRow[]>> {
  const { data, error } = await supabase.rpc('preview_series', {
    p_start: a.start,
    p_length: a.length,
    p_every_weeks: a.everyWeeks,
    // Exactly one of these is null (series_occurrences enforces it). The SQL
    // params carry no DEFAULT, so the generator types them non-null; PostgREST
    // sends JSON null either way. Same cast log_set's wrapper makes.
    p_count: a.count as number,
    p_until: a.until as string,
  });
  if (error) return fail(error);
  return {
    data: (data ?? []).map((r) => ({ n: r.n, startsAt: r.occ_start, afterOffsetChange: r.after_offset_change, conflict: r.conflict })),
    error: null,
  };
}

export async function createBooking(a: {
  id: string;
  clientId: string;
  startsAt: string;
  length: number;
  everyWeeks?: 1 | 2;
  count?: number;
  until?: string;
}): Promise<ApiResult<BookingRow[]>> {
  const { data, error } = await supabase.rpc('create_booking', {
    p_id: a.id,
    p_client_id: a.clientId,
    p_starts_at: a.startsAt,
    p_length: a.length,
    ...(a.everyWeeks ? { p_every_weeks: a.everyWeeks } : {}),
    ...(a.count ? { p_count: a.count } : {}),
    ...(a.until ? { p_until: a.until } : {}),
  });
  if (error) return fail(error);
  return { data: data ?? [], error: null };
}

export async function rescheduleBooking(id: string, newStart: string, scope: Scope): Promise<ApiResult<BookingRow[]>> {
  const { data, error } = await supabase.rpc('reschedule_booking', { p_id: id, p_new_start: newStart, p_scope: scope });
  if (error) return fail(error);
  return { data: data ?? [], error: null };
}

export async function cancelBooking(
  id: string,
  scope: Scope,
  counted: boolean | null,
  reason: string | null,
): Promise<ApiResult<BookingRow[]>> {
  const { data, error } = await supabase.rpc('cancel_booking', {
    p_id: id,
    p_scope: scope,
    ...(counted !== null ? { p_counted: counted } : {}),
    ...(reason ? { p_reason: reason } : {}),
  });
  if (error) return fail(error);
  return { data: data ?? [], error: null };
}

export async function markNoShow(id: string): Promise<ApiResult<BookingRow>> {
  const { data, error } = await supabase.rpc('mark_no_show', { p_id: id });
  if (error || !data) return fail(error);
  return { data, error: null };
}

export async function fetchAvailability(
  ptUserId: string,
): Promise<ApiResult<{ hours: HoursRange[]; exceptions: ExceptionInput[] }>> {
  const today = new Date();
  const todayKey =
    today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const [h, x] = await Promise.all([
    supabase.from('schedules').select('day_of_week, start_time, end_time').eq('user_id', ptUserId).eq('is_active', true),
    supabase.from('availability_exceptions').select('on_date, kind, ranges').eq('pt_user_id', ptUserId).gte('on_date', todayKey).order('on_date'),
  ]);
  if (h.error) return fail(h.error);
  if (x.error) return fail(x.error);
  return {
    data: {
      // Postgres TIME comes back as HH:MM:SS.
      hours: (h.data ?? []).map((r) => ({ dow: r.day_of_week, start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5) })),
      exceptions: (x.data ?? []).map((r) => ({
        date: r.on_date,
        kind: r.kind === 'extra' ? 'extra' : 'off',
        ranges: Array.isArray(r.ranges) ? (r.ranges as { start: string; end: string }[]) : null,
      })),
    },
    error: null,
  };
}

export async function saveAvailability(
  hours: HoursRange[],
  exceptions: ExceptionInput[],
  rules: BookingRules,
): Promise<ApiResult<{ bookingId: string; startsAt: string }[]>> {
  const { data, error } = await supabase.rpc('save_availability', {
    p_hours: hours,
    p_exceptions: exceptions,
    p_rules: { lengths: rules.lengths, buffer: rules.bufferMin, window: rules.windowWeeks, cutoff: rules.cutoffHours },
  });
  if (error) return fail(error);
  return { data: (data ?? []).map((r) => ({ bookingId: r.out_booking_id, startsAt: r.out_starts_at })), error: null };
}

export async function fetchUserName(userId: string): Promise<string | null> {
  const { data } = await supabase.from('users').select('display_name').eq('id', userId).maybeSingle();
  return data?.display_name ?? null;
}
```

If `tsc` rejects a `p_*` key, read the generated signature in `database.types.ts` (`Functions.<name>.Args`) — an arg without a SQL `DEFAULT` is non-optional and a JSONB arg is typed `Json`. Cast at the call site with a one-line comment, as `previewSeries` does; do not loosen the wrapper's own parameter types.

- [ ] **Step 3: Formatting and state colours**

`apps/mobile/src/lib/schedule/format.ts`:

```ts
import { durationLabel, hhmm, minuteOfDay } from '@forge/shared';

/** HH:MM on the device's clock. Bookings are instants; the device shows its own wall time (plan Global Constraints). */
export function timeLabel(iso: string): string {
  return hhmm(minuteOfDay(new Date(iso)));
}

export function dayLabel(d: Date | string, locale: string): string {
  const date = typeof d === 'string' ? new Date(d.length === 10 ? d + 'T12:00:00' : d) : d;
  return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function dowLabel(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { weekday: 'short' });
}

/** "Wed 10 Sep, 22:30" — the exact deadline, not the rule (design, My bookings). */
export function deadlineLabel(d: Date, locale: string): string {
  return dayLabel(d, locale) + ', ' + hhmm(minuteOfDay(d));
}

/** "48m", "3h 10" — time left until something. */
export function untilLabel(ms: number): string {
  return durationLabel(Math.max(0, Math.round(ms / 60_000)));
}
```

(A `YYYY-MM-DD` key is parsed at local noon so a negative UTC offset can't turn it into the previous day.)

`apps/mobile/src/lib/schedule/stateStyle.ts`:

```ts
import type { BookingState } from '@forge/shared';
import type { Theme } from '../../theme/ThemeProvider';

export type StateStyle = { bar: string; bg: string; fg: string; border: string; dashed: boolean; strike: boolean; hatch: boolean };

/**
 * The design's six booking states on existing colour roles. Every pairing is
 * one tokens.test.ts already holds to 4.5:1 (status text always sits on its
 * own tinted surface), so no new palette entry is needed. Each block also
 * prints its state word: colour is never the only cue.
 */
export function stateStyle(state: BookingState, c: Theme['colors']): StateStyle {
  switch (state) {
    case 'booked':
      return { bar: c.accent, bg: c.accentSurfaceSoft, fg: c.onAccentSurfaceSoft, border: 'transparent', dashed: false, strike: false, hatch: false };
    case 'checked':
      return { bar: c.successAccent, bg: c.successSurface, fg: c.onSuccessSurface, border: 'transparent', dashed: false, strike: false, hatch: false };
    case 'done':
      return { bar: c.textMuted, bg: c.surfaceRaised, fg: c.textMuted, border: 'transparent', dashed: false, strike: false, hatch: false };
    case 'noshow':
      return { bar: c.warnAccent, bg: c.warnSurface, fg: c.onWarnSurface, border: 'transparent', dashed: false, strike: false, hatch: false };
    case 'cancelled':
      return { bar: c.textMuted, bg: 'transparent', fg: c.textMuted, border: c.border, dashed: true, strike: true, hatch: false };
    case 'me':
      return { bar: c.textPrimary, bg: c.surface, fg: c.textPrimary, border: c.border, dashed: false, strike: false, hatch: true };
  }
}
```

`apps/mobile/src/lib/schedule/useNow.ts`:

```ts
import { useEffect, useState } from 'react';

/**
 * A clock for render. React Compiler's purity rule forbids Date.now() in a
 * render body, and the schedule needs "now" for the now line, the no-show
 * unlock and the cancel deadline. Ticks every `ms`; setState only happens in
 * the interval callback, never synchronously in the effect.
 */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
```

- [ ] **Step 4: Hooks**

`apps/mobile/src/lib/schedule/useSchedule.ts`:

```ts
import { addDays, bookingErrorCode, bookingState, localDayKey, type BookingErrorCode, type BookingState } from '@forge/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { fetchRoster } from '../clients/useClientList';
import { cachedFetch, OFFLINE } from '../offline/cachedFetch';
import { useOffline } from '../offline/offlineContext';
import { supabase } from '../supabase';
import { fetchDayWindows, fetchPtBookings, type DayWindow } from './scheduleApi';

export type ScheduleItem = {
  id: string;
  clientId: string | null;
  name: string;
  isSelf: boolean;
  startsAt: string;
  endsAt: string;
  status: string;
  state: BookingState;
  lengthMin: number;
  seriesId: string | null;
  cancelLate: boolean;
  cancelledAt: string | null;
};

type Bundle = { items: ScheduleItem[]; windows: DayWindow[]; hasHours: boolean; fetchedAt: string; error: string | null };

/** One fetch for any visible range: bookings, published windows, names, and whether any hours exist at all. */
export async function fetchScheduleBundle(ptUserId: string, from: Date, to: Date): Promise<Bundle> {
  const fetchedAt = new Date().toISOString();
  const [b, w, roster, hours] = await Promise.all([
    fetchPtBookings(ptUserId, from.toISOString(), to.toISOString()),
    fetchDayWindows(localDayKey(from), localDayKey(addDays(to, -1))),
    fetchRoster(ptUserId),
    supabase.from('schedules').select('id', { count: 'exact', head: true }).eq('user_id', ptUserId),
  ]);
  const code: BookingErrorCode | null =
    b.error ?? w.error ?? (roster.error ? bookingErrorCode(roster.error) : null) ?? (hours.error ? bookingErrorCode(hours.error.message) : null);
  if (code) return { items: [], windows: [], hasHours: false, fetchedAt, error: code === 'offline' ? OFFLINE : code };

  const byId = Object.fromEntries(roster.rows.map((r) => [r.id, r]));
  const items: ScheduleItem[] = (b.data ?? []).map((row) => {
    const client = row.client_id ? byId[row.client_id] : undefined;
    const isSelf = client?.isSelf ?? false;
    return {
      id: row.id,
      clientId: row.client_id,
      name: client?.displayName ?? '',
      isSelf,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      state: bookingState(row.status, isSelf),
      lengthMin: row.length_min ?? Math.round((Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60_000),
      seriesId: row.parent_booking_id ?? (row.recurrence_rule ? row.id : null),
      cancelLate: row.cancel_late,
      cancelledAt: row.cancelled_at,
    };
  });
  return { items, windows: w.data ?? [], hasHours: (hours.count ?? 0) > 0, fetchedAt, error: null };
}

export type ScheduleData = Omit<Bundle, 'error'> & { loading: boolean; error: BookingErrorCode | null; refetch: () => void };

/**
 * The PT's schedule for [from, to). Refetches on focus (N12); only the newest
 * load sets state (O1). Read-through cached when the offline beta is on, so
 * the last fetched week survives losing the signal (spec D15).
 */
export function useSchedule(ptUserId: string | undefined, from: Date, to: Date): ScheduleData {
  const offline = useOffline();
  const fromKey = from.toISOString();
  const toKey = to.toISOString();
  const [state, setState] = useState<Omit<ScheduleData, 'refetch'>>({
    items: [], windows: [], hasHours: true, fetchedAt: '', loading: true, error: null,
  });
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!ptUserId) return () => {};
    const mine = ++seq.current;
    void cachedFetch({ enabled: offline.effective, online: offline.online }, `schedule:${ptUserId}:${fromKey}:${toKey}`, () =>
      fetchScheduleBundle(ptUserId, new Date(fromKey), new Date(toKey)),
    ).then((r) => {
      if (mine !== seq.current) return;
      setState({ ...r, loading: false, error: r.error ? bookingErrorCode(r.error) : null });
    });
    return () => {
      seq.current++;
    };
  }, [ptUserId, fromKey, toKey, offline.effective, offline.online]);

  useFocusEffect(load);
  return { ...state, refetch: () => void load() };
}
```

`apps/mobile/src/lib/schedule/useAvailability.ts`:

```ts
import { DEFAULT_RULES, type BookingErrorCode, type BookingRules, type ExceptionInput, type HoursRange } from '@forge/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { fetchAvailability, fetchPolicy } from './scheduleApi';

export type AvailabilityData = {
  loading: boolean;
  error: BookingErrorCode | null;
  /** Bumps on every successful load, so a screen can re-seed its draft behind an id guard. */
  version: number;
  hours: HoursRange[];
  exceptions: ExceptionInput[];
  rules: BookingRules;
  timezone: string;
  refetch: () => void;
};

export function useAvailability(ptUserId: string | undefined): AvailabilityData {
  const [state, setState] = useState<Omit<AvailabilityData, 'refetch'>>({
    loading: true, error: null, version: 0, hours: [], exceptions: [], rules: DEFAULT_RULES, timezone: 'Asia/Beirut',
  });
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!ptUserId) return () => {};
    const mine = ++seq.current;
    void Promise.all([fetchAvailability(ptUserId), fetchPolicy(ptUserId)]).then(([a, p]) => {
      if (mine !== seq.current) return;
      if (a.error || p.error) {
        setState((s) => ({ ...s, loading: false, error: a.error ?? p.error }));
        return;
      }
      setState((s) => ({
        loading: false,
        error: null,
        version: s.version + 1,
        hours: a.data.hours,
        exceptions: a.data.exceptions,
        rules: { lengths: p.data.lengths, bufferMin: p.data.bufferMin, windowWeeks: p.data.windowWeeks, cutoffHours: p.data.cutoffHours },
        timezone: p.data.timezone,
      }));
    });
    return () => {
      seq.current++;
    };
  }, [ptUserId]);

  useFocusEffect(load);
  return { ...state, refetch: () => void load() };
}
```

`apps/mobile/src/lib/schedule/useOpenSlots.ts`:

```ts
import type { BookingErrorCode } from '@forge/shared';
import { useEffect, useRef, useState } from 'react';
import { fetchOpenSlots, type Slot } from './scheduleApi';

export type OpenSlotsData = { loading: boolean; error: BookingErrorCode | null; slots: Slot[]; refetch: () => void };

type Loaded = { key: string; error: BookingErrorCode | null; slots: Slot[] };

/**
 * Online only: a slot list from the cache would be a promise the server may
 * not keep (spec D15). State is set only inside .then() (the
 * react-hooks/set-state-in-effect rule useClientList documents), so `loading`
 * is derived: the result on hand belongs to an older set of params.
 */
export function useOpenSlots(
  ptUserId: string | null,
  fromDate: string,
  toDate: string,
  length: number | null,
  ignoreId?: string,
): OpenSlotsData {
  const [nonce, setNonce] = useState(0);
  const key = [ptUserId, fromDate, toDate, length, ignoreId, nonce].join('|');
  const [loaded, setLoaded] = useState<Loaded>({ key: '', error: null, slots: [] });
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    const run: Promise<Loaded> =
      !ptUserId || !length
        ? Promise.resolve({ key, error: null, slots: [] })
        : fetchOpenSlots(ptUserId, fromDate, toDate, length, ignoreId).then((r) =>
            r.error ? { key, error: r.error, slots: [] } : { key, error: null, slots: r.data },
          );
    void run.then((next) => {
      if (mine === seq.current) setLoaded(next);
    });
    return () => {
      seq.current++;
    };
  }, [key, ptUserId, fromDate, toDate, length, ignoreId]);

  const current = loaded.key === key;
  return {
    loading: !current,
    error: current ? loaded.error : null,
    slots: current ? loaded.slots : [],
    refetch: () => setNonce((n) => n + 1),
  };
}
```

`apps/mobile/src/lib/schedule/useMyBookings.ts`:

```ts
import { bookingErrorCode, type BookingErrorCode } from '@forge/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { cachedFetch, OFFLINE } from '../offline/cachedFetch';
import { useOffline } from '../offline/offlineContext';
import { supabase } from '../supabase';
import { fetchPolicy, fetchUserName, type BookingPolicy, type BookingRow } from './scheduleApi';

export type Coach = { clientId: string; ptUserId: string; ptName: string | null };
type Bundle = {
  coach: Coach | null;
  policy: BookingPolicy | null;
  upcoming: BookingRow[];
  past: BookingRow[];
  fetchedAt: string;
  error: string | null;
};

/**
 * A client's coach, the coach's policy, and the client's bookings. "Coach" is
 * the first active/accepted non-self clients row — a client with several PTs
 * is M7's problem. Paused rows still contribute bookings to read.
 */
export async function fetchMyBookings(userId: string): Promise<Bundle> {
  const fetchedAt = new Date().toISOString();
  const empty: Bundle = { coach: null, policy: null, upcoming: [], past: [], fetchedAt, error: null };
  const rows = await supabase.from('clients').select('id, pt_user_id, client_user_id, state').eq('client_user_id', userId);
  if (rows.error) return { ...empty, error: bookingErrorCode(rows.error.message) === 'offline' ? OFFLINE : rows.error.message };
  const mine = (rows.data ?? []).filter((r) => r.pt_user_id !== r.client_user_id);
  const active = mine.find((r) => r.state === 'active' || r.state === 'accepted') ?? null;
  if (mine.length === 0) return empty;

  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [b, policy, ptName] = await Promise.all([
    supabase.from('bookings').select('*').in('client_id', mine.map((r) => r.id)).gte('starts_at', since).order('starts_at'),
    active ? fetchPolicy(active.pt_user_id) : Promise.resolve(null),
    active ? fetchUserName(active.pt_user_id) : Promise.resolve(null),
  ]);
  if (b.error) return { ...empty, error: bookingErrorCode(b.error.message) === 'offline' ? OFFLINE : b.error.message };

  const now = Date.now();
  const all = b.data ?? [];
  return {
    coach: active ? { clientId: active.id, ptUserId: active.pt_user_id, ptName } : null,
    policy: policy && !policy.error ? policy.data : null,
    upcoming: all.filter((r) => r.status === 'scheduled' && Date.parse(r.ends_at) > now),
    past: all.filter((r) => !(r.status === 'scheduled' && Date.parse(r.ends_at) > now)).reverse(),
    fetchedAt,
    error: null,
  };
}

export type MyBookingsData = Omit<Bundle, 'error'> & { loading: boolean; error: BookingErrorCode | null; refetch: () => void };

export function useMyBookings(userId: string | undefined): MyBookingsData {
  const offline = useOffline();
  const [state, setState] = useState<Omit<MyBookingsData, 'refetch'>>({
    coach: null, policy: null, upcoming: [], past: [], fetchedAt: '', loading: true, error: null,
  });
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!userId) return () => {};
    const mine = ++seq.current;
    void cachedFetch({ enabled: offline.effective, online: offline.online }, 'myBookings:' + userId, () => fetchMyBookings(userId)).then(
      (r) => {
        if (mine !== seq.current) return;
        setState({ ...r, loading: false, error: r.error ? bookingErrorCode(r.error) : null });
      },
    );
    return () => {
      seq.current++;
    };
  }, [userId, offline.effective, offline.online]);

  useFocusEffect(load);
  return { ...state, refetch: () => void load() };
}
```

`apps/mobile/src/lib/schedule/useBookingDetail.ts`:

```ts
import { bookingErrorCode, isSelfClientRow, type BookingErrorCode } from '@forge/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { cachedFetch, OFFLINE } from '../offline/cachedFetch';
import { useOffline } from '../offline/offlineContext';
import { supabase } from '../supabase';
import { fetchPolicy, fetchUserName, type BookingPolicy, type BookingRow } from './scheduleApi';

type Bundle = {
  booking: BookingRow | null;
  clientName: string | null;
  isSelf: boolean;
  programName: string | null;
  policy: BookingPolicy | null;
  series: { starts_at: string; status: string }[];
  fetchedAt: string;
  error: string | null;
};

export async function fetchBookingDetail(id: string): Promise<Bundle> {
  const fetchedAt = new Date().toISOString();
  const empty: Bundle = { booking: null, clientName: null, isSelf: false, programName: null, policy: null, series: [], fetchedAt, error: null };
  const b = await supabase.from('bookings').select('*').eq('id', id).maybeSingle();
  if (b.error) return { ...empty, error: bookingErrorCode(b.error.message) === 'offline' ? OFFLINE : b.error.message };
  const booking = b.data;
  if (!booking) return empty; // removed, or no longer visible: the design's "This booking was removed"

  const seriesId = booking.parent_booking_id ?? (booking.recurrence_rule ? booking.id : null);
  const [client, program, policy, series] = await Promise.all([
    booking.client_id
      ? supabase.from('clients').select('id, pt_user_id, client_user_id, invite_name, invite_email').eq('id', booking.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    booking.client_id
      ? supabase.from('programs').select('name').eq('client_id', booking.client_id).eq('state', 'active').limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    fetchPolicy(booking.pt_user_id),
    seriesId
      ? supabase.from('bookings').select('starts_at, status').or(`id.eq.${seriesId},parent_booking_id.eq.${seriesId}`).order('starts_at')
      : Promise.resolve({ data: [] }),
  ]);
  const c = client.data;
  const linkedName = c?.client_user_id ? await fetchUserName(c.client_user_id) : null;
  return {
    booking,
    clientName: linkedName ?? c?.invite_name ?? c?.invite_email ?? null,
    isSelf: c ? isSelfClientRow(c) : false,
    programName: program.data?.name ?? null,
    policy: policy.error ? null : policy.data,
    series: series.data ?? [],
    fetchedAt,
    error: null,
  };
}

export type BookingDetailData = Omit<Bundle, 'error'> & { loading: boolean; error: BookingErrorCode | null; refetch: () => void };

export function useBookingDetail(id: string | undefined): BookingDetailData {
  const offline = useOffline();
  const [state, setState] = useState<Omit<BookingDetailData, 'refetch'>>({
    booking: null, clientName: null, isSelf: false, programName: null, policy: null, series: [], fetchedAt: '', loading: true, error: null,
  });
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!id) return () => {};
    const mine = ++seq.current;
    void cachedFetch({ enabled: offline.effective, online: offline.online }, 'booking:' + id, () => fetchBookingDetail(id)).then((r) => {
      if (mine !== seq.current) return;
      setState({ ...r, loading: false, error: r.error ? bookingErrorCode(r.error) : null });
    });
    return () => {
      seq.current++;
    };
  }, [id, offline.effective, offline.online]);

  useFocusEffect(load);
  return { ...state, refetch: () => void load() };
}
```

`isSelfClientRow` is M4e's helper in `packages/shared/src/clients/selfClient.ts` (already exported). Confirm its parameter type accepts `{ pt_user_id, client_user_id }`; if it wants the full row, select `*` instead.

- [ ] **Step 5: Typecheck**

Run: `$env:COREPACK_INTEGRITY_KEYS='0'; pnpm --filter mobile typecheck`
Expected: PASS. (Nothing renders these yet.)

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/consoleWidth.ts apps/mobile/src/lib/schedule "apps/mobile/src/app/(app)/sessions/[id]/index.tsx"
git commit -m "feat(mobile): schedule API wrappers and hooks"
```

---

## Task 7 · Mobile: the new UI atoms

**Files:**
- Create: `apps/mobile/src/ui/BottomSheet.tsx`, `CalendarBlock.tsx`, `OpenGapRow.tsx`, `MonthGrid.tsx`, `TimeRangePill.tsx`, `DayStrip.tsx`, `SlotGrid.tsx`
- Modify: `apps/mobile/src/ui/index.ts`, `docs/DESIGN_SYSTEM_GAPS.md`

**Interfaces:**
- Consumes: `stateStyle` (Task 6), `monthCells` (Task 4).
- Produces:
  - `BottomSheet({ visible, onDismiss, children, dismissLabel })`
  - `CalendarBlock({ state, stateLabel, title, subtitle, note?, noteTone?, onPress?, minHeight?, selected? })`
  - `OpenGapRow({ label, actionLabel, onPress })`
  - `MonthGrid({ year, month0, dowLabels, dots, selected, today, onSelect })` — `dots: Record<number, string[]>` (colours)
  - `TimeRangePill({ label, onPress?, variant?: 'range' | 'break' })`
  - `DayStrip({ days: { key, dow, date, count, disabled? }[], selected, onSelect })`
  - `SlotGrid({ slots: { key, label }[], selected, outlined?, onSelect })`

- [ ] **Step 1: Write the atoms**

`apps/mobile/src/ui/BottomSheet.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type BottomSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  children: ReactNode;
  /** Screen-reader label for the scrim, which dismisses. */
  dismissLabel: string;
};

/** The design's sheets (late cancel, no-show, edit scope, range editor). Tapping the scrim dismisses. */
export function BottomSheet({ visible, onDismiss, children, dismissLabel }: BottomSheetProps) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
          onPress={onDismiss}
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(15,19,28,0.45)' }}
        />
        <View
          style={{
            backgroundColor: t.colors.surfaceRaised,
            borderTopLeftRadius: t.radius.xl,
            borderTopRightRadius: t.radius.xl,
            paddingHorizontal: 18,
            paddingTop: t.space[3],
            paddingBottom: t.space[6],
            gap: t.space[3],
          }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: t.colors.border }} />
          {children}
        </View>
      </View>
    </Modal>
  );
}
```

`apps/mobile/src/ui/CalendarBlock.tsx`:

```tsx
import type { BookingState } from '@forge/shared';
import { Pressable, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { stateStyle } from '../lib/schedule/stateStyle';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type CalendarBlockProps = {
  state: BookingState;
  stateLabel: string;
  title: string;
  subtitle: string;
  note?: string;
  noteTone?: 'muted' | 'warn';
  onPress?: () => void;
  /** Week grid: block height is the booking length. */
  minHeight?: number;
  selected?: boolean;
};

/**
 * One booking on a schedule: a state bar on the leading edge, the person, the
 * state word (never colour alone), time · what, and an optional note line.
 * The PT's own training is hatched so it can't be read as a client.
 */
export function CalendarBlock({ state, stateLabel, title, subtitle, note, noteTone = 'muted', onPress, minHeight, selected }: CalendarBlockProps) {
  const t = useTheme();
  const s = stateStyle(state, t.colors);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${stateLabel}, ${subtitle}`}
      onPress={onPress}
      disabled={!onPress}
      style={{
        flexDirection: 'row',
        minHeight: minHeight ?? 64,
        borderRadius: t.radius.md,
        overflow: 'hidden',
        backgroundColor: s.bg,
        borderWidth: selected ? 2 : s.border === 'transparent' ? 0 : 1,
        borderColor: selected ? t.colors.accent : s.border,
        borderStyle: s.dashed ? 'dashed' : 'solid',
      }}
    >
      {s.hatch ? (
        <Svg style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
          <Defs>
            <Pattern id="forge-me-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <Rect width="6" height="12" fill={t.colors.surfaceRaised} />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#forge-me-hatch)" />
        </Svg>
      ) : null}
      <View style={{ width: 4, backgroundColor: s.bar }} />
      <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text
            numberOfLines={1}
            style={{ flex: 1, fontWeight: '700', color: s.fg, textDecorationLine: s.strike ? 'line-through' : 'none' }}
          >
            {title}
          </Text>
          <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: s.fg }}>{stateLabel}</Text>
        </View>
        <Text numberOfLines={1} style={{ fontSize: 13, color: s.fg }}>
          {subtitle}
        </Text>
        {note ? (
          <Text numberOfLines={1} style={{ fontSize: 12, color: noteTone === 'warn' ? t.colors.onWarnSurface : t.colors.textMuted }}>
            {note}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
```

`apps/mobile/src/ui/OpenGapRow.tsx`:

```tsx
import { Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type OpenGapRowProps = { label: string; actionLabel: string; onPress: () => void };

/** A dashed open stretch of published hours. Tapping starts a booking at its start. */
export function OpenGapRow({ label, actionLabel, onPress }: OpenGapRowProps) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${actionLabel}`}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: t.touchTarget,
        paddingHorizontal: 12,
        borderRadius: t.radius.md,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: t.colors.borderStrong,
      }}
    >
      <Text style={{ fontSize: 13, color: t.colors.textSecondary }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: '700', color: t.colors.accentText }}>{actionLabel}</Text>
    </Pressable>
  );
}
```

`apps/mobile/src/ui/MonthGrid.tsx`:

```tsx
import { monthCells } from '@forge/shared';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type MonthGridProps = {
  year: number;
  month0: number;
  /** Seven labels, Monday first. */
  dowLabels: string[];
  /** Day of month → dot colours (at most three are drawn). */
  dots: Record<number, string[]>;
  selected: number | null;
  today: number | null;
  onSelect: (day: number) => void;
};

/** A Monday-first month with state dots per day. Used by the schedule's Month view and the Exceptions tab. */
export function MonthGrid({ year, month0, dowLabels, dots, selected, today, onSelect }: MonthGridProps) {
  const t = useTheme();
  const cells = monthCells(year, month0);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row' }}>
        {dowLabels.map((d) => (
          <Text key={d} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: t.colors.textMuted }}>
            {d}
          </Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, row) => (
        <View key={row} style={{ flexDirection: 'row' }}>
          {cells.slice(row * 7, row * 7 + 7).map((day, i) =>
            day === null ? (
              <View key={i} style={{ flex: 1, height: 48 }} />
            ) : (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityState={{ selected: selected === day }}
                onPress={() => onSelect(day)}
                style={{
                  flex: 1,
                  height: 48,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  borderRadius: t.radius.md,
                  backgroundColor: selected === day ? t.colors.accentSurfaceSoft : 'transparent',
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: today === day ? '800' : '500',
                    color: selected === day ? t.colors.onAccentSurfaceSoft : t.colors.textPrimary,
                  }}
                >
                  {day}
                </Text>
                <View style={{ flexDirection: 'row', gap: 2, height: 5 }}>
                  {(dots[day] ?? []).slice(0, 3).map((c, k) => (
                    <View key={k} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c }} />
                  ))}
                </View>
              </Pressable>
            ),
          )}
        </View>
      ))}
    </View>
  );
}
```

`apps/mobile/src/ui/TimeRangePill.tsx`:

```tsx
import { Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type TimeRangePillProps = { label: string; onPress?: () => void; variant?: 'range' | 'break' };

/** "06:00 – 12:00" as a tappable pill; a break is the same shape, muted and inert. */
export function TimeRangePill({ label, onPress, variant = 'range' }: TimeRangePillProps) {
  const t = useTheme();
  const isBreak = variant === 'break';
  return (
    <Pressable
      accessibilityRole={isBreak ? 'text' : 'button'}
      onPress={onPress}
      disabled={isBreak || !onPress}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: t.radius.pill,
        backgroundColor: isBreak ? 'transparent' : t.colors.surfaceSunken,
        borderWidth: isBreak ? 0 : 1,
        borderColor: t.colors.border,
      }}
    >
      <Text numeric style={{ fontSize: 13, color: isBreak ? t.colors.textMuted : t.colors.textPrimary }}>
        {label}
      </Text>
    </Pressable>
  );
}
```

`apps/mobile/src/ui/DayStrip.tsx`:

```tsx
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type DayStripDay = { key: string; dow: string; date: string; count: number | null; disabled?: boolean };
export type DayStripProps = { days: DayStripDay[]; selected: string | null; onSelect: (key: string) => void };

/**
 * Seven equal cells with open-slot counts, so an empty day is visible before
 * tapping (design note). A plain row of flex cells, not a horizontal
 * ScrollView — that stretches chips vertically (RN pitfall in memory).
 */
export function DayStrip({ days, selected, onSelect }: DayStripProps) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {days.map((d) => {
        const on = d.key === selected;
        const empty = d.count === 0;
        return (
          <Pressable
            key={d.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: d.disabled }}
            disabled={d.disabled}
            onPress={() => onSelect(d.key)}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 8,
              gap: 2,
              borderRadius: t.radius.md,
              borderWidth: 1.5,
              borderColor: on ? t.colors.accent : t.colors.border,
              backgroundColor: on ? t.colors.accentSurfaceSoft : t.colors.surfaceRaised,
              opacity: d.disabled ? 0.45 : 1,
            }}
          >
            <Text style={{ fontSize: 11, color: on ? t.colors.onAccentSurfaceSoft : t.colors.textMuted }}>{d.dow}</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: on ? t.colors.onAccentSurfaceSoft : t.colors.textPrimary }}>{d.date}</Text>
            <Text numeric style={{ fontSize: 11, color: empty ? t.colors.textMuted : t.colors.accentText }}>
              {d.count === null ? ' ' : String(d.count)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
```

`apps/mobile/src/ui/SlotGrid.tsx`:

```tsx
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type SlotGridProps = {
  slots: { key: string; label: string }[];
  selected: string | null;
  /** Slot taken: the nearest open times are outlined (design, Book · Slot taken). */
  outlined?: string[];
  onSelect: (key: string) => void;
};

export function SlotGrid({ slots, selected, outlined = [], onSelect }: SlotGridProps) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {slots.map((s) => {
        const on = s.key === selected;
        const ring = outlined.includes(s.key);
        return (
          <Pressable
            key={s.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(s.key)}
            style={{
              width: '23%',
              minHeight: t.touchTarget,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: t.radius.md,
              borderWidth: ring || on ? 2 : 1,
              borderColor: on || ring ? t.colors.accent : t.colors.border,
              backgroundColor: on ? t.colors.accent : t.colors.surfaceRaised,
            }}
          >
            <Text numeric style={{ fontWeight: '600', color: on ? t.colors.onAccent : t.colors.textPrimary }}>
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 2: Export them**

Append to `apps/mobile/src/ui/index.ts`:

```ts
export { BottomSheet } from './BottomSheet';
export type { BottomSheetProps } from './BottomSheet';
export { CalendarBlock } from './CalendarBlock';
export type { CalendarBlockProps } from './CalendarBlock';
export { DayStrip } from './DayStrip';
export type { DayStripDay, DayStripProps } from './DayStrip';
export { MonthGrid } from './MonthGrid';
export type { MonthGridProps } from './MonthGrid';
export { OpenGapRow } from './OpenGapRow';
export type { OpenGapRowProps } from './OpenGapRow';
export { SlotGrid } from './SlotGrid';
export type { SlotGridProps } from './SlotGrid';
export { TimeRangePill } from './TimeRangePill';
export type { TimeRangePillProps } from './TimeRangePill';
```

If `Text` has no `numeric` prop under that name, use whatever `Text.tsx` calls tabular figures (the M4 logging screen uses it); do not add a second prop.

- [ ] **Step 3: Record them in the gaps doc**

Append to `docs/DESIGN_SYSTEM_GAPS.md` a section `## M5a · built`, one bullet per atom above with one line on what it is, plus: "Booking states use existing colour roles (`lib/schedule/stateStyle.ts`) — no new palette entries; `Toggle` already existed, so the design's 'toggle not in DS' note was stale."

- [ ] **Step 4: Typecheck and lint**

Run: `$env:COREPACK_INTEGRITY_KEYS='0'; pnpm --filter mobile typecheck; pnpm --filter mobile lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/ui docs/DESIGN_SYSTEM_GAPS.md
git commit -m "feat(ui): calendar block, open gap, month grid, day strip, slot grid, time pill, sheet"
```

---

## Task 8 · Mobile: the PT Schedule tab (phone)

**Files:**
- Create: `apps/mobile/src/lib/schedule/blockProps.ts`, `apps/mobile/src/lib/schedule/OfflineNote.tsx`, `apps/mobile/src/app/(app)/(tabs)/schedule.tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `useSchedule`, `useNow`, `stateStyle`, `format`, Task 7 atoms, `dayRows`, `localDayKey`, `addDays`, `minuteOfDay`, `hhmm`.
- Produces: route `/(app)/(tabs)/schedule`; `OfflineNote({ title, body })`; `blockProps(item, t)` (Task 12 reuses it); `export function PhoneSchedule()` (Task 12 wraps it).

- [ ] **Step 1: Offline note and block props**

`apps/mobile/src/lib/schedule/blockProps.ts`:

```ts
import type { TFunction } from 'i18next';
import { timeLabel } from './format';
import type { ScheduleItem } from './useSchedule';

/** What a CalendarBlock shows for a booking. Shared by the phone views and the iPad week grid. */
export function blockProps(item: ScheduleItem, t: TFunction) {
  return {
    state: item.state,
    stateLabel: t(`schedule.states.${item.state}`),
    title: item.isSelf ? t('schedule.me') : item.name,
    subtitle: `${timeLabel(item.startsAt)}–${timeLabel(item.endsAt)}`,
    note: item.cancelLate && item.cancelledAt ? t('schedule.lateCancelNote', { time: timeLabel(item.cancelledAt) }) : undefined,
  };
}
```

`apps/mobile/src/lib/schedule/OfflineNote.tsx`:

```tsx
import { View } from 'react-native';
import { Banner, Text } from '../../ui';

/** The design's two-line offline strip: the kicker in a warn banner, the consequence under it. */
export function OfflineNote({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Banner variant="warn" message={title} />
      <Text variant="caption" tone="muted">
        {body}
      </Text>
    </View>
  );
}
```

- [ ] **Step 2: The screen**

`apps/mobile/src/app/(app)/(tabs)/schedule.tsx`:

```tsx
import { addDays, dayRows, hhmm, localDayKey, minuteOfDay, type DayRow } from '@forge/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { useOffline } from '../../../lib/offline/offlineContext';
import { blockProps } from '../../../lib/schedule/blockProps';
import { dayLabel, dowLabel, timeLabel } from '../../../lib/schedule/format';
import { OfflineNote } from '../../../lib/schedule/OfflineNote';
import { stateStyle } from '../../../lib/schedule/stateStyle';
import { useNow } from '../../../lib/schedule/useNow';
import { useSchedule, type ScheduleItem } from '../../../lib/schedule/useSchedule';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Button, CalendarBlock, EmptyState, IconButton, MonthGrid, OpenGapRow, Screen, SegmentedPill, Skeleton, Text,
} from '../../../ui';

type Mode = 'day' | 'week' | 'month';

/** 2026-10-12 is a Monday; seven days from it give Monday-first labels in any locale. */
const MONDAY = new Date(2026, 9, 12);

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const openDetail = (id: string) => router.push({ pathname: '/(app)/schedule/[id]', params: { id } });

export function PhoneSchedule() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const now = useNow();
  const [mode, setMode] = useState<Mode>('day');
  // One fetch serves all three views: the month so far and the coming week.
  const [range] = useState(() => {
    const today = startOfToday();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const weekEnd = addDays(today, 7);
    return { today, from: first, to: weekEnd > nextMonth ? weekEnd : nextMonth };
  });
  const [monthDay, setMonthDay] = useState(range.today.getDate());
  const data = useSchedule(auth.user?.id, range.from, range.to);
  const locale = i18n.language;

  const itemsOn = (key: string) => data.items.filter((i) => localDayKey(new Date(i.startsAt)) === key);
  const windowsOn = (key: string) =>
    data.windows
      .filter((w) => w.date === key)
      .map((w) => ({ startMin: minuteOfDay(new Date(w.start)), endMin: minuteOfDay(new Date(w.end)) || 1440 }));

  const todayKey = localDayKey(range.today);
  const weekItems = data.items.filter((i) => {
    const s = Date.parse(i.startsAt);
    return s >= range.today.getTime() && s < addDays(range.today, 7).getTime();
  });

  const newAt = (date: string, startMin: number) =>
    router.push({ pathname: '/(app)/schedule/new', params: { date, time: hhmm(startMin) } });

  const renderRow = (row: DayRow<ScheduleItem>, key: string, i: number) => {
    if (row.kind === 'now') {
      return (
        <View key={'now' + i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numeric style={{ fontSize: 12, fontWeight: '700', color: theme.colors.accentText }}>
            {hhmm(row.min)}
          </Text>
          <View style={{ flex: 1, height: 2, backgroundColor: theme.colors.accent }} />
        </View>
      );
    }
    if (row.kind === 'gap') {
      return (
        <OpenGapRow
          key={'gap' + row.startMin}
          label={t('schedule.open', { range: `${hhmm(row.startMin)} – ${hhmm(row.endMin)}` })}
          actionLabel={t('schedule.openBook')}
          onPress={() => newAt(key, row.startMin)}
        />
      );
    }
    return <CalendarBlock key={row.item.id} {...blockProps(row.item, t)} onPress={() => openDetail(row.item.id)} />;
  };

  const dayView = () => {
    const rows = dayRows(
      windowsOn(todayKey),
      itemsOn(todayKey).map((item) => ({
        startMin: minuteOfDay(new Date(item.startsAt)),
        endMin: minuteOfDay(new Date(item.endsAt)) || 1440,
        item,
        occupies: item.state !== 'cancelled',
      })),
      minuteOfDay(new Date(now)),
    );
    return <View style={{ gap: 8 }}>{rows.map((r, i) => renderRow(r, todayKey, i))}</View>;
  };

  const weekView = () => (
    <View style={{ gap: theme.space[4] }}>
      {Array.from({ length: 7 }, (_, i) => {
        const day = addDays(range.today, i);
        const key = localDayKey(day);
        const items = itemsOn(key);
        return (
          <View key={key} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700' }}>{dayLabel(day, locale)}</Text>
              <Text numeric tone="muted">
                {items.filter((x) => x.state !== 'cancelled').length}
              </Text>
            </View>
            {items.length === 0 && windowsOn(key).length === 0 ? (
              <Text variant="caption" tone="muted">
                {t('schedule.weekNoHours')}
              </Text>
            ) : null}
            {items.map((item) => (
              <CalendarBlock key={item.id} {...blockProps(item, t)} minHeight={52} onPress={() => openDetail(item.id)} />
            ))}
          </View>
        );
      })}
    </View>
  );

  const monthView = () => {
    const y = range.today.getFullYear();
    const m = range.today.getMonth();
    const dots: Record<number, string[]> = {};
    for (const item of data.items) {
      const d = new Date(item.startsAt);
      if (d.getMonth() !== m) continue;
      (dots[d.getDate()] ??= []).push(stateStyle(item.state, theme.colors).bar);
    }
    const selKey = localDayKey(new Date(y, m, monthDay));
    const items = itemsOn(selKey);
    return (
      <View style={{ gap: theme.space[3] }}>
        <MonthGrid
          year={y}
          month0={m}
          dowLabels={Array.from({ length: 7 }, (_, i) => dowLabel(addDays(MONDAY, i), locale))}
          dots={dots}
          selected={monthDay}
          today={range.today.getDate()}
          onSelect={setMonthDay}
        />
        <Text style={{ fontWeight: '700' }}>{dayLabel(new Date(y, m, monthDay), locale)}</Text>
        {items.length === 0 ? (
          <Text variant="caption" tone="muted">
            {windowsOn(selKey).length === 0 ? t('schedule.monthNone') : t('schedule.monthNothing')}
          </Text>
        ) : (
          items.map((item) => (
            <CalendarBlock key={item.id} {...blockProps(item, t)} minHeight={52} onPress={() => openDetail(item.id)} />
          ))
        )}
      </View>
    );
  };

  const showEmpty = !data.loading && !data.error && mode !== 'month' && weekItems.length === 0;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: theme.space[4], paddingBottom: theme.space[6], gap: theme.space[4] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <View style={{ flex: 1 }}>
            <Text variant="h2">{t('schedule.title')}</Text>
            <Text variant="caption" tone="muted">
              {dayLabel(range.today, locale)}
            </Text>
          </View>
          <Button label={t('schedule.hours')} variant="ghost" onPress={() => router.push('/(app)/schedule/availability')} />
          <IconButton icon="plus" accessibilityLabel={t('schedule.newBooking')} onPress={() => router.push('/(app)/schedule/new')} />
        </View>

        <SegmentedPill
          items={[
            { label: t('schedule.views.day'), value: 'day' },
            { label: t('schedule.views.week'), value: 'week' },
            { label: t('schedule.views.month'), value: 'month' },
          ]}
          selected={mode}
          onChange={(v) => setMode(v as Mode)}
        />

        {!offline.online && data.fetchedAt ? (
          <OfflineNote title={t('schedule.offlineBanner', { time: timeLabel(data.fetchedAt) })} body={t('schedule.offlineBody')} />
        ) : null}

        {data.loading ? (
          <View style={{ gap: 8 }}>
            <Skeleton height={64} radius={12} />
            <Skeleton height={64} radius={12} />
            <Skeleton height={64} radius={12} />
          </View>
        ) : data.error ? (
          <EmptyState
            icon="alert"
            tone="danger"
            title={t('schedule.errorTitle')}
            body={t('schedule.errorBody')}
            actionLabel={t('schedule.retry')}
            onAction={data.refetch}
          />
        ) : showEmpty ? (
          <View style={{ gap: theme.space[2] }}>
            <EmptyState
              icon="calendar"
              title={t('schedule.emptyTitle')}
              body={data.hasHours ? t('schedule.emptyBody') : t('schedule.emptyBodyNoHours')}
              actionLabel={t('schedule.newBooking')}
              onAction={() => router.push('/(app)/schedule/new')}
            />
            {!data.hasHours ? (
              <Button label={t('schedule.setHours')} variant="link" onPress={() => router.push('/(app)/schedule/availability')} />
            ) : null}
          </View>
        ) : mode === 'day' ? (
          dayView()
        ) : mode === 'week' ? (
          weekView()
        ) : (
          monthView()
        )}
      </ScrollView>
    </Screen>
  );
}

export default function ScheduleTab() {
  return <PhoneSchedule />;
}
```

- [ ] **Step 3: Register the tab**

In `apps/mobile/src/app/(app)/(tabs)/_layout.tsx`, add between the `index` and `clients` screens:

```tsx
      <Tabs.Screen
        name="schedule"
        options={{
          title: t('common.tabs.schedule'),
          href: isClient ? null : undefined,
          tabBarIcon: ({ color, focused }) => (
            <Icon name="clock" size={23} color={color} strokeWidth={focused ? 2.2 : 1.8} />
          ),
        }}
      />
```

and change the doc comment's first line to "The PT's five top-level destinations: Today, Schedule, Clients, Programs, Library."

- [ ] **Step 4: Typecheck**

Run: `$env:COREPACK_INTEGRITY_KEYS='0'; pnpm --filter mobile typecheck`
Expected: route-string errors for `/(app)/schedule/...` until those routes exist (Tasks 9–11) — that is V3's stale `router.d.ts`, not a bug. Every other error is real; fix it. Re-run after Task 11 and expect PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/src/app/(app)/(tabs)" apps/mobile/src/lib/schedule/OfflineNote.tsx apps/mobile/src/lib/schedule/blockProps.ts
git commit -m "feat(mobile): PT schedule tab — day, week, month"
```

---

## Task 9 · Mobile: Availability

**Files:**
- Create: `apps/mobile/src/app/(app)/schedule/availability.tsx`

**Interfaces:**
- Consumes: `useAvailability`, `saveAvailability`, `validateHours`, `weeklyMinutes`, `dayRanges`, `copyMondayToWeekdays`, `stepRule`, `toggleLength`, `ALL_LENGTHS`, `RULE_BOUNDS`, `durationLabel`, `parseHhmm`, `hhmm`, `bookingErrorKey`, Task 7 atoms, `MeasureStepper`, `Toggle`, `DateField`.
- Produces: route `/(app)/schedule/availability`.

- [ ] **Step 1: The screen**

`apps/mobile/src/app/(app)/schedule/availability.tsx`:

```tsx
import {
  ALL_LENGTHS, bookingErrorKey, copyMondayToWeekdays, DEFAULT_RULES, dayRanges, durationLabel, hhmm, localDayKey,
  parseHhmm, stepRule, toggleLength, validateHours, weeklyMinutes,
  type BookingRules, type ExceptionInput, type HoursRange, type RuleKey,
} from '@forge/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { useOffline } from '../../../lib/offline/offlineContext';
import { dayLabel, dowLabel } from '../../../lib/schedule/format';
import { OfflineNote } from '../../../lib/schedule/OfflineNote';
import { saveAvailability } from '../../../lib/schedule/scheduleApi';
import { useAvailability } from '../../../lib/schedule/useAvailability';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Banner, BottomSheet, Button, DateField, EmptyState, MeasureStepper, MonthGrid, NavHeader, Screen, SegmentedPill,
  Skeleton, Tag, Text, TimeRangePill, Toggle,
} from '../../../ui';

type Tab = 'hours' | 'exceptions' | 'rules';
const ROW_ORDER = [1, 2, 3, 4, 5, 6, 0];
/** 2026-10-11 is a Sunday, so + dow gives that weekday's name in any locale. */
const SUNDAY = new Date(2026, 9, 11);
const STEP = 15;
const LAST = 23 * 60 + 45;

const shift = (hm: string, by: number) => hhmm(Math.min(LAST, Math.max(0, (parseHhmm(hm) ?? 0) + by)));
const sameRange = (a: HoursRange, b: HoursRange) => a.dow === b.dow && a.start === b.start && a.end === b.end;

export default function AvailabilityScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const data = useAvailability(auth.user?.id);
  const locale = i18n.language;

  const [tab, setTab] = useState<Tab>('hours');
  const [seeded, setSeeded] = useState(0);
  const [hours, setHours] = useState<HoursRange[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionInput[]>([]);
  const [rules, setRules] = useState<BookingRules>(DEFAULT_RULES);
  // Seed the draft from each successful load during render, behind a version guard (never from an effect).
  if (data.version > 0 && data.version !== seeded) {
    setSeeded(data.version);
    setHours(data.hours);
    setExceptions(data.exceptions);
    setRules(data.rules);
  }

  const [editing, setEditing] = useState<HoursRange | null>(null);
  const [exDraft, setExDraft] = useState<(ExceptionInput & { existing: boolean }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ variant: 'success' | 'danger'; message: string } | null>(null);
  const [flagged, setFlagged] = useState<Record<string, number>>({});
  const [today] = useState(() => new Date());

  const dayName = (dow: number) => dowLabel(new Date(SUNDAY.getFullYear(), SUNDAY.getMonth(), SUNDAY.getDate() + dow), locale);

  const setDay = (dow: number, on: boolean) =>
    setHours((h) => (on ? (dayRanges(h, dow).length ? h : [...h, { dow, start: '06:00', end: '12:00' }]) : h.filter((r) => r.dow !== dow)));

  const addRange = (dow: number) =>
    setHours((h) => {
      const last = dayRanges(h, dow).at(-1);
      const start = last ? Math.min(LAST - 60, (parseHhmm(last.end) ?? 0) + 60) : 6 * 60;
      const end = Math.min(LAST, start + 120);
      return end > start ? [...h, { dow, start: hhmm(start), end: hhmm(end) }] : h;
    });

  const replaceRange = (old: HoursRange, next: HoursRange | null) =>
    setHours((h) => {
      const i = h.findIndex((r) => sameRange(r, old));
      if (i === -1) return h;
      const copy = [...h];
      if (next) copy[i] = next;
      else copy.splice(i, 1);
      return copy;
    });

  async function save() {
    setNotice(null);
    const check = validateHours(hours);
    if (!check.ok) {
      setTab('hours');
      setNotice({ variant: 'danger', message: t(bookingErrorKey(check.code)) });
      return;
    }
    setSaving(true);
    const r = await saveAvailability(hours, exceptions, rules);
    setSaving(false);
    if (r.error) {
      setNotice({ variant: 'danger', message: t(bookingErrorKey(r.error)) });
      return;
    }
    const byDay: Record<string, number> = {};
    for (const b of r.data) {
      const k = localDayKey(new Date(b.startsAt));
      byDay[k] = (byDay[k] ?? 0) + 1;
    }
    setFlagged(byDay);
    setNotice({
      variant: 'success',
      message: r.data.length ? t('schedule.availability.savedFlagged', { count: r.data.length }) : t('schedule.availability.saved'),
    });
    data.refetch();
  }

  const hoursTab = () => (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="caption" tone="muted">
        {t('schedule.availability.weeklyTotal', { total: durationLabel(weeklyMinutes(hours)), tz: data.timezone })}
      </Text>
      {hours.length === 0 ? (
        <EmptyState
          icon="clock"
          title={t('schedule.availability.emptyTitle')}
          body={t('schedule.availability.emptyBody')}
          actionLabel={t('schedule.availability.emptyCta')}
          onAction={() => setDay(1, true)}
        />
      ) : null}
      {ROW_ORDER.map((dow) => {
        const ranges = dayRanges(hours, dow);
        return (
          <View key={dow} style={{ gap: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <Toggle label={dayName(dow)} value={ranges.length > 0} onValueChange={(on) => setDay(dow, on)} />
            {ranges.length === 0 ? (
              <Text variant="caption" tone="muted">
                {t('schedule.availability.unavailable')}
              </Text>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {ranges.map((r, i) => (
                  <View key={r.start} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {i > 0 ? (
                      <TimeRangePill
                        variant="break"
                        label={t('schedule.availability.breakLabel', {
                          length: durationLabel((parseHhmm(r.start) ?? 0) - (parseHhmm(ranges[i - 1]!.end) ?? 0)),
                        })}
                      />
                    ) : null}
                    <TimeRangePill label={`${r.start} – ${r.end}`} onPress={() => setEditing(r)} />
                  </View>
                ))}
                <TimeRangePill label={t('schedule.availability.add')} onPress={() => addRange(dow)} />
              </View>
            )}
          </View>
        );
      })}
      <Button label={t('schedule.availability.copyMonday')} variant="link" onPress={() => setHours((h) => copyMondayToWeekdays(h))} />
    </View>
  );

  const exceptionsTab = () => {
    const y = today.getFullYear();
    const m = today.getMonth();
    const dots: Record<number, string[]> = {};
    for (const x of exceptions) {
      const d = new Date(x.date + 'T12:00:00');
      if (d.getFullYear() === y && d.getMonth() === m) {
        dots[d.getDate()] = [x.kind === 'off' ? theme.colors.textMuted : theme.colors.accent];
      }
    }
    const open = (date: string) => {
      const found = exceptions.find((x) => x.date === date);
      setExDraft(found ? { ...found, existing: true } : { date, kind: 'off', ranges: null, existing: false });
    };
    return (
      <View style={{ gap: theme.space[3] }}>
        <MonthGrid
          year={y}
          month0={m}
          dowLabels={ROW_ORDER.map(dayName)}
          dots={dots}
          selected={null}
          today={today.getDate()}
          onSelect={(day) => {
            if (day >= today.getDate()) open(localDayKey(new Date(y, m, day)));
          }}
        />
        <Text style={{ fontWeight: '700' }}>{t('schedule.availability.upcoming')}</Text>
        {exceptions.length === 0 ? (
          <Text variant="caption" tone="muted">
            {t('schedule.availability.noExceptions')}
          </Text>
        ) : (
          [...exceptions]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((x) => (
              <Pressable
                key={x.date}
                accessibilityRole="button"
                onPress={() => open(x.date)}
                style={{ gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, fontWeight: '600' }}>{dayLabel(x.date, locale)}</Text>
                  <Tag tone={x.kind === 'off' ? 'neutral' : 'accent'} label={x.kind === 'off' ? t('schedule.availability.dayOff') : t('schedule.availability.extra')} />
                </View>
                {x.kind === 'extra' && x.ranges ? (
                  <Text variant="caption" tone="muted" numeric>
                    {x.ranges.map((r) => `${r.start} – ${r.end}`).join(', ')}
                  </Text>
                ) : null}
                {flagged[x.date] ? (
                  <Text variant="caption" style={{ color: theme.colors.onWarnSurface }}>
                    {t('schedule.availability.flagged', { count: flagged[x.date] })}
                  </Text>
                ) : null}
              </Pressable>
            ))
        )}
        <Button label={t('schedule.availability.addException')} variant="link" onPress={() => open(localDayKey(today))} />
      </View>
    );
  };

  const ruleRow = (key: RuleKey, label: string, value: string, help: string) => (
    <View key={key} style={{ gap: 6 }}>
      <Text style={{ fontWeight: '600' }}>{label}</Text>
      <MeasureStepper
        value={value}
        unit=""
        onDecrement={() => setRules((r) => stepRule(r, key, -1))}
        onIncrement={() => setRules((r) => stepRule(r, key, 1))}
        decrementLabel={t('schedule.availability.less')}
        incrementLabel={t('schedule.availability.more')}
      />
      <Text variant="caption" tone="muted">
        {help}
      </Text>
    </View>
  );

  const rulesTab = () => (
    <View style={{ gap: theme.space[4] }}>
      <View style={{ gap: 8 }}>
        <Text style={{ fontWeight: '600' }}>{t('schedule.availability.lengthsTitle')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {ALL_LENGTHS.map((len) => {
            const on = rules.lengths.includes(len);
            return (
              <Pressable
                key={len}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setRules((r) => ({ ...r, lengths: toggleLength(r.lengths, len) }))}
                style={{
                  flex: 1,
                  minHeight: theme.touchTarget,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: theme.radius.md,
                  borderWidth: 1.5,
                  borderColor: on ? theme.colors.accent : theme.colors.border,
                  backgroundColor: on ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
                }}
              >
                <Text numeric style={{ fontWeight: '700', color: on ? theme.colors.onAccentSurfaceSoft : theme.colors.textPrimary }}>
                  {len}
                </Text>
                <Text style={{ fontSize: 11, color: on ? theme.colors.onAccentSurfaceSoft : theme.colors.textMuted }}>
                  {t('schedule.availability.min')}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text variant="caption" tone="muted">
          {t('schedule.availability.lengthsHelp')}
        </Text>
      </View>
      {ruleRow(
        'bufferMin',
        t('schedule.availability.buffer'),
        t('schedule.availability.bufferValue', { min: rules.bufferMin }),
        rules.bufferMin ? t('schedule.availability.bufferHelp', { min: rules.bufferMin }) : t('schedule.availability.bufferHelpZero'),
      )}
      {ruleRow(
        'windowWeeks',
        t('schedule.availability.window'),
        t('schedule.availability.windowValue', { weeks: rules.windowWeeks }),
        t('schedule.availability.windowHelp', { weeks: rules.windowWeeks }),
      )}
      {ruleRow(
        'cutoffHours',
        t('schedule.availability.cutoff'),
        t('schedule.availability.cutoffValue', { hours: rules.cutoffHours }),
        rules.cutoffHours ? t('schedule.availability.cutoffHelp', { hours: rules.cutoffHours }) : t('schedule.availability.cutoffHelpZero'),
      )}
    </View>
  );

  return (
    <Screen padded={false}>
      <NavHeader
        title={t('schedule.availability.title')}
        divider
        leading={
          <Button
            label={t('schedule.detail.back')}
            variant="link"
            icon="chevronBack"
            onPress={() => router.dismissTo('/(app)/(tabs)/schedule')}
          />
        }
        trailing={
          <Button
            label={t('schedule.availability.save')}
            variant="link"
            tone="accent"
            loading={saving}
            disabled={saving || !offline.online || data.loading || !!data.error}
            onPress={() => void save()}
          />
        }
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: theme.space[3], paddingBottom: theme.space[6], gap: theme.space[4] }}>
        <SegmentedPill
          items={[
            { label: t('schedule.availability.tabs.hours'), value: 'hours' },
            { label: t('schedule.availability.tabs.exceptions'), value: 'exceptions' },
            { label: t('schedule.availability.tabs.rules'), value: 'rules' },
          ]}
          selected={tab}
          onChange={(v) => setTab(v as Tab)}
        />
        {!offline.online ? (
          <OfflineNote title={t('schedule.availability.offline')} body={t('schedule.availability.offlineBody')} />
        ) : null}
        {notice ? <Banner variant={notice.variant} message={notice.message} /> : null}
        {data.loading ? (
          <Skeleton height={320} radius={14} />
        ) : data.error ? (
          <EmptyState
            icon="alert"
            tone="danger"
            title={t('schedule.availability.errorTitle')}
            body={t('schedule.availability.errorBody')}
            actionLabel={t('schedule.retry')}
            onAction={data.refetch}
          />
        ) : tab === 'hours' ? (
          hoursTab()
        ) : tab === 'exceptions' ? (
          exceptionsTab()
        ) : (
          rulesTab()
        )}
      </ScrollView>

      <BottomSheet visible={editing !== null} onDismiss={() => setEditing(null)} dismissLabel={t('schedule.availability.done')}>
        {editing ? (
          <View style={{ gap: theme.space[3] }}>
            <Text variant="h3">{dayName(editing.dow)}</Text>
            <Text style={{ fontWeight: '600' }}>{t('schedule.availability.from')}</Text>
            <MeasureStepper
              value={editing.start}
              unit=""
              onDecrement={() => setEditing((e) => (e ? { ...e, start: shift(e.start, -STEP) } : e))}
              onIncrement={() => setEditing((e) => (e ? { ...e, start: shift(e.start, STEP) } : e))}
              decrementLabel={t('schedule.availability.earlier')}
              incrementLabel={t('schedule.availability.later')}
            />
            <Text style={{ fontWeight: '600' }}>{t('schedule.availability.to')}</Text>
            <MeasureStepper
              value={editing.end}
              unit=""
              onDecrement={() => setEditing((e) => (e ? { ...e, end: shift(e.end, -STEP) } : e))}
              onIncrement={() => setEditing((e) => (e ? { ...e, end: shift(e.end, STEP) } : e))}
              decrementLabel={t('schedule.availability.earlier')}
              incrementLabel={t('schedule.availability.later')}
            />
            <Button
              label={t('schedule.availability.done')}
              variant="primary"
              onPress={() => {
                const original = hours.find((r) => r.dow === editing.dow && (r.start === editing.start || r.end === editing.end)) ?? null;
                if (original) replaceRange(original, editing);
                setEditing(null);
              }}
            />
            <Button
              label={t('schedule.availability.remove')}
              variant="link"
              tone="danger"
              onPress={() => {
                const original = hours.find((r) => r.dow === editing.dow && (r.start === editing.start || r.end === editing.end)) ?? null;
                if (original) replaceRange(original, null);
                setEditing(null);
              }}
            />
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet visible={exDraft !== null} onDismiss={() => setExDraft(null)} dismissLabel={t('schedule.availability.done')}>
        {exDraft ? (
          <View style={{ gap: theme.space[3] }}>
            <DateField
              label={t('schedule.availability.exceptionDate')}
              value={exDraft.date}
              minDate={localDayKey(today)}
              onChange={(date) => setExDraft((d) => (d ? { ...d, date } : d))}
            />
            <Text style={{ fontWeight: '600' }}>{t('schedule.availability.exceptionKind')}</Text>
            <SegmentedPill
              items={[
                { label: t('schedule.availability.dayOff'), value: 'off' },
                { label: t('schedule.availability.extra'), value: 'extra' },
              ]}
              selected={exDraft.kind}
              onChange={(v) =>
                setExDraft((d) =>
                  d ? { ...d, kind: v as 'off' | 'extra', ranges: v === 'extra' ? (d.ranges ?? [{ start: '17:00', end: '19:00' }]) : null } : d,
                )
              }
            />
            {exDraft.kind === 'extra' && exDraft.ranges?.[0] ? (
              <View style={{ gap: 6 }}>
                <MeasureStepper
                  value={exDraft.ranges[0].start}
                  unit=""
                  onDecrement={() => setExDraft((d) => (d?.ranges ? { ...d, ranges: [{ ...d.ranges[0]!, start: shift(d.ranges[0]!.start, -STEP) }] } : d))}
                  onIncrement={() => setExDraft((d) => (d?.ranges ? { ...d, ranges: [{ ...d.ranges[0]!, start: shift(d.ranges[0]!.start, STEP) }] } : d))}
                  decrementLabel={t('schedule.availability.earlier')}
                  incrementLabel={t('schedule.availability.later')}
                />
                <MeasureStepper
                  value={exDraft.ranges[0].end}
                  unit=""
                  onDecrement={() => setExDraft((d) => (d?.ranges ? { ...d, ranges: [{ ...d.ranges[0]!, end: shift(d.ranges[0]!.end, -STEP) }] } : d))}
                  onIncrement={() => setExDraft((d) => (d?.ranges ? { ...d, ranges: [{ ...d.ranges[0]!, end: shift(d.ranges[0]!.end, STEP) }] } : d))}
                  decrementLabel={t('schedule.availability.earlier')}
                  incrementLabel={t('schedule.availability.later')}
                />
              </View>
            ) : null}
            <Button
              label={t('schedule.availability.done')}
              variant="primary"
              onPress={() => {
                const { existing: _existing, ...x } = exDraft;
                setExceptions((all) => [...all.filter((e) => e.date !== x.date), x]);
                setExDraft(null);
              }}
            />
            {exDraft.existing ? (
              <Button
                label={t('schedule.availability.remove')}
                variant="link"
                tone="danger"
                onPress={() => {
                  setExceptions((all) => all.filter((e) => e.date !== exDraft.date));
                  setExDraft(null);
                }}
              />
            ) : null}
          </View>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}
```

Two implementation notes:
- The range editor keeps `editing` as the *edited* copy, so matching the original back by `start === || end ===` is how it finds the row it came from: one side has always moved at most. If that heuristic proves fragile, store `{ original, draft }` in `editing` instead — keep the behaviour, not this exact code.
- `Tag`'s props are `{ tone, label }` per the M4c context list; if it takes children instead, adapt.

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm --filter mobile typecheck; pnpm --filter mobile lint`
Expected: PASS, apart from route strings still pending from Tasks 10–11 (V3).

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/src/app/(app)/schedule/availability.tsx"
git commit -m "feat(mobile): availability — hours, exceptions, rules, one save"
```

---

## Task 10 · Mobile: Create and edit booking

**Files:**
- Create: `apps/mobile/src/lib/schedule/useSeriesPreview.ts`, `apps/mobile/src/lib/schedule/BookingForm.tsx`, `apps/mobile/src/app/(app)/schedule/new.tsx`, `apps/mobile/src/app/(app)/schedule/[id]/edit.tsx`

**Interfaces:**
- Consumes: `fetchRoster`, `fetchPolicy`, `useOpenSlots`, `previewSeries`, `createBooking`, `rescheduleBooking`, `useBookingDetail`, `seriesProgress`, Task 7 atoms, `expo-crypto`.
- Produces: routes `/(app)/schedule/new` (params `clientId?`, `date?` `YYYY-MM-DD`, `time?` `HH:MM`) and `/(app)/schedule/[id]/edit`; `BookingForm` props:
  `{ mode: 'new'; initialClientId?: string; initialDate?: string; initialTime?: string } | { mode: 'edit'; booking: BookingRow; clientName: string | null; isSelf: boolean; seriesLeft: number }`

- [ ] **Step 1: Series preview hook**

`apps/mobile/src/lib/schedule/useSeriesPreview.ts`:

```ts
import type { BookingErrorCode } from '@forge/shared';
import { useEffect, useRef, useState } from 'react';
import { previewSeries, type SeriesPreviewRow } from './scheduleApi';

type Args = { start: string; length: number; everyWeeks: 1 | 2; count: number | null; until: string | null } | null;
type Loaded = { key: string; rows: SeriesPreviewRow[]; error: BookingErrorCode | null };

/** The dates a series would create, with DST and conflict flags (spec D6). Same keyed shape as useOpenSlots. */
export function useSeriesPreview(args: Args): { loading: boolean; rows: SeriesPreviewRow[]; error: BookingErrorCode | null } {
  const key = args ? JSON.stringify(args) : '';
  const [loaded, setLoaded] = useState<Loaded>({ key: '', rows: [], error: null });
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    const run: Promise<Loaded> = args
      ? previewSeries(args).then((r) => (r.error ? { key, rows: [], error: r.error } : { key, rows: r.data, error: null }))
      : Promise.resolve({ key, rows: [], error: null });
    void run.then((next) => {
      if (mine === seq.current) setLoaded(next);
    });
    return () => {
      seq.current++;
    };
    // `key` is the serialised args; listing `args` too would refire on every render's new object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = loaded.key === key;
  return { loading: !current, rows: current ? loaded.rows : [], error: current ? loaded.error : null };
}
```

- [ ] **Step 2: The form**

`apps/mobile/src/lib/schedule/BookingForm.tsx`:

```tsx
import {
  addDays, bookingErrorKey, localDayKey, slotCountsByDay, type BookingErrorCode,
} from '@forge/shared';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Avatar, Banner, BottomSheet, Button, DateField, DayStrip, EmptyState, FooterBar, MeasureStepper, NavHeader, Screen,
  SegmentedPill, SlotGrid, Tag, Text,
} from '../../ui';
import { useAuth } from '../auth/AuthProvider';
import { fetchRoster, type ClientListItem } from '../clients/useClientList';
import { useOffline } from '../offline/offlineContext';
import { dayLabel, dowLabel, timeLabel } from './format';
import { OfflineNote } from './OfflineNote';
import { createBooking, fetchPolicy, rescheduleBooking, type BookingPolicy, type BookingRow, type Scope } from './scheduleApi';
import { useOpenSlots } from './useOpenSlots';
import { useSeriesPreview } from './useSeriesPreview';

export type BookingFormProps =
  | { mode: 'new'; initialClientId?: string; initialDate?: string; initialTime?: string }
  | { mode: 'edit'; booking: BookingRow; clientName: string | null; isSelf: boolean; seriesLeft: number };

type Repeat = 'none' | '1' | '2';
const WEEK = 7 * 86_400_000;

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * The PT's create and move screen: client, length, day, time, repeat — the
 * order a PT says it out loud (design note). Only lengths from Availability
 * appear; the day strip shows open counts; a series lists every date before
 * saving, with the DST warning on the first one after a clock change.
 */
export function BookingForm(props: BookingFormProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const locale = i18n.language;
  const pt = auth.user?.id ?? null;
  const edit = props.mode === 'edit' ? props.booking : null;

  const [id] = useState(() => Crypto.randomUUID());
  const [today] = useState(startOfToday);
  const [roster, setRoster] = useState<ClientListItem[] | null>(null);
  const [policy, setPolicy] = useState<BookingPolicy | null>(null);
  useEffect(() => {
    if (!pt) return;
    let live = true;
    void Promise.all([fetchRoster(pt), fetchPolicy(pt)]).then(([r, p]) => {
      if (!live) return;
      setRoster(r.rows.filter((c) => c.state === 'active' || c.state === 'accepted'));
      setPolicy(p.error ? null : p.data);
    });
    return () => {
      live = false;
    };
  }, [pt]);

  const initialDay =
    props.mode === 'new' && props.initialDate ? props.initialDate : edit ? localDayKey(new Date(edit.starts_at)) : localDayKey(today);
  const [clientId, setClientId] = useState<string | null>(edit?.client_id ?? (props.mode === 'new' ? (props.initialClientId ?? null) : null));
  const [picking, setPicking] = useState(false);
  const [length, setLength] = useState<number | null>(edit?.length_min ?? null);
  const [weekOffset, setWeekOffset] = useState(() =>
    Math.max(0, Math.floor((new Date(initialDay + 'T12:00:00').getTime() - today.getTime()) / WEEK)),
  );
  const [dayKey, setDayKey] = useState(initialDay);
  const [picked, setPicked] = useState<string | null>(edit?.starts_at ?? null);
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [ends, setEnds] = useState<'count' | 'date'>('count');
  const [count, setCount] = useState(8);
  const [until, setUntil] = useState('');
  const [error, setError] = useState<BookingErrorCode | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);

  const effectiveLength = length ?? (policy ? (policy.lengths.includes(60) ? 60 : (policy.lengths[0] ?? null)) : null);
  const weekStart = addDays(today, weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const slots = useOpenSlots(pt, localDayKey(days[0]!), localDayKey(days[6]!), effectiveLength, edit?.id);
  const counts = slotCountsByDay(slots.slots);
  const daySlots = slots.slots.filter((s) => s.date === dayKey);
  // A gap tap arrives with a time; it becomes the selection once that slot exists (derived, not an effect).
  const initialTime = props.mode === 'new' ? props.initialTime : undefined;
  const selected = picked ?? (initialTime ? (daySlots.find((s) => timeLabel(s.startsAt) === initialTime)?.startsAt ?? null) : null);

  const series = useSeriesPreview(
    props.mode === 'new' && repeat !== 'none' && selected && effectiveLength && (ends === 'count' || until)
      ? {
          start: selected,
          length: effectiveLength,
          everyWeeks: repeat === '1' ? 1 : 2,
          count: ends === 'count' ? count : null,
          until: ends === 'date' ? until : null,
        }
      : null,
  );
  const firstDst = series.rows.find((r) => r.afterOffsetChange) ?? null;
  const seriesConflict = series.rows.some((r) => r.conflict);

  const client = roster?.find((c) => c.id === clientId) ?? null;
  const clientLabel =
    props.mode === 'edit' ? (props.isSelf ? t('schedule.me') : (props.clientName ?? '')) : client ? (client.isSelf ? t('schedule.me') : client.displayName) : null;

  const cta =
    props.mode === 'edit'
      ? selected
        ? t('schedule.form.ctaMove', { time: timeLabel(selected) })
        : t('schedule.form.ctaPick')
      : !selected
        ? t('schedule.form.ctaPick')
        : repeat === 'none'
          ? t('schedule.form.ctaOne', { time: timeLabel(selected) })
          : t('schedule.form.ctaSeries', { count: series.rows.length });

  const blocked =
    !offline.online || submitting || !selected || !effectiveLength || !clientId || (repeat !== 'none' && (series.loading || seriesConflict || series.rows.length === 0));

  async function submitNew() {
    if (!selected || !effectiveLength || !clientId) return;
    setSubmitting(true);
    setError(null);
    const r = await createBooking({
      id,
      clientId,
      startsAt: selected,
      length: effectiveLength,
      ...(repeat !== 'none'
        ? { everyWeeks: repeat === '1' ? (1 as const) : (2 as const), ...(ends === 'count' ? { count } : { until }) }
        : {}),
    });
    setSubmitting(false);
    if (r.error) {
      setError(r.error);
      if (r.error === 'slot_taken' || r.error === 'outside_hours') {
        setPicked(null);
        slots.refetch();
      }
      return;
    }
    router.replace({ pathname: '/(app)/schedule/[id]', params: { id } });
  }

  async function submitMove(scope: Scope) {
    if (!edit || !selected) return;
    setScopeOpen(false);
    setSubmitting(true);
    setError(null);
    const r = await rescheduleBooking(edit.id, selected, scope);
    setSubmitting(false);
    if (r.error) {
      setError(r.error);
      if (r.error === 'slot_taken') {
        setPicked(null);
        slots.refetch();
      }
      return;
    }
    router.replace({ pathname: '/(app)/schedule/[id]', params: { id: edit.id } });
  }

  const onCta = () => {
    if (props.mode === 'new') void submitNew();
    else if (props.seriesLeft > 1) setScopeOpen(true);
    else void submitMove('one');
  };

  const leave = () =>
    edit ? router.dismissTo({ pathname: '/(app)/schedule/[id]', params: { id: edit.id } }) : router.dismissTo('/(app)/(tabs)/schedule');

  if (props.mode === 'new' && roster && roster.length === 0) {
    return (
      <Screen>
        <NavHeader leading={<Button label={t('schedule.form.cancel')} variant="link" onPress={leave} />} />
        <EmptyState
          icon="users"
          title={t('schedule.form.noClientsTitle')}
          body={t('schedule.form.noClientsBody')}
          actionLabel={t('schedule.form.noClientsCta')}
          onAction={() => router.push('/(app)/clients/invite')}
        />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <NavHeader
        title={props.mode === 'edit' ? t('schedule.form.titleEdit') : t('schedule.form.titleNew')}
        divider
        leading={<Button label={t('schedule.form.cancel')} variant="link" onPress={leave} />}
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: theme.space[3], paddingBottom: theme.space[6], gap: theme.space[4] }}>
        {!offline.online ? <OfflineNote title={t('schedule.form.offline')} body={t('schedule.form.offlineBody')} /> : null}
        {error ? <Banner variant="danger" message={t(bookingErrorKey(error))} /> : null}

        <View style={{ gap: 8 }}>
          <Text variant="caption" tone="muted">
            {t('schedule.form.client')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar name={clientLabel ?? '?'} size={40} />
            <Text style={{ flex: 1, fontWeight: '700' }}>{clientLabel ?? t('schedule.form.pickClient')}</Text>
            {props.mode === 'new' ? <Button label={t('schedule.form.change')} variant="link" onPress={() => setPicking(true)} /> : null}
          </View>
        </View>

        {policy ? (
          <View style={{ gap: 8 }}>
            <Text variant="caption" tone="muted">
              {t('schedule.form.length')}
            </Text>
            <SegmentedPill
              items={policy.lengths.map((l) => ({
                label: `${l} ${t('schedule.form.min')}`,
                value: String(l),
                disabled: props.mode === 'edit' && l !== edit?.length_min,
              }))}
              selected={String(effectiveLength)}
              onChange={(v) => {
                setLength(Number(v));
                setPicked(null);
              }}
            />
          </View>
        ) : null}

        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>
              {t('schedule.form.day')}
            </Text>
            {weekOffset > 0 ? <Button label="‹" variant="link" onPress={() => setWeekOffset((w) => w - 1)} /> : null}
            <Button label="›" variant="link" onPress={() => setWeekOffset((w) => w + 1)} />
          </View>
          <DayStrip
            days={days.map((d) => {
              const key = localDayKey(d);
              return { key, dow: dowLabel(d, locale), date: String(d.getDate()), count: slots.loading ? null : (counts[key] ?? 0) };
            })}
            selected={dayKey}
            onSelect={(k) => {
              setDayKey(k);
              setPicked(null);
            }}
          />
        </View>

        <View style={{ gap: 8 }}>
          <Text variant="caption" tone="muted">
            {t('schedule.form.time', { date: dayLabel(dayKey, locale) })}
          </Text>
          {slots.error ? (
            <EmptyState
              icon="alert"
              tone="danger"
              title={t('schedule.form.slotsErrorTitle')}
              body={t('schedule.form.slotsErrorBody')}
              actionLabel={t('schedule.retry')}
              onAction={slots.refetch}
            />
          ) : !slots.loading && daySlots.length === 0 ? (
            <Text variant="caption" tone="muted">
              {t('schedule.form.noTime')}
            </Text>
          ) : (
            <SlotGrid
              slots={daySlots.map((s) => ({ key: s.startsAt, label: timeLabel(s.startsAt) }))}
              selected={selected}
              onSelect={setPicked}
            />
          )}
        </View>

        {props.mode === 'new' ? (
          <View style={{ gap: 8 }}>
            <Text variant="caption" tone="muted">
              {t('schedule.form.repeat')}
            </Text>
            <SegmentedPill
              items={[
                { label: t('schedule.form.repeatNone'), value: 'none' },
                { label: t('schedule.form.repeatWeekly'), value: '1' },
                { label: t('schedule.form.repeatBiweekly'), value: '2' },
              ]}
              selected={repeat}
              onChange={(v) => setRepeat(v as Repeat)}
            />
            {repeat !== 'none' ? (
              <View style={{ gap: theme.space[3] }}>
                <SegmentedPill
                  items={[
                    { label: t('schedule.form.endsCount'), value: 'count' },
                    { label: t('schedule.form.endsDate'), value: 'date' },
                  ]}
                  selected={ends}
                  onChange={(v) => setEnds(v as 'count' | 'date')}
                />
                {ends === 'count' ? (
                  <MeasureStepper
                    value={t('schedule.form.sessions', { count })}
                    unit=""
                    onDecrement={() => setCount((c) => Math.max(2, c - 1))}
                    onIncrement={() => setCount((c) => Math.min(26, c + 1))}
                    decrementLabel={t('schedule.availability.less')}
                    incrementLabel={t('schedule.availability.more')}
                  />
                ) : (
                  <DateField label={t('schedule.form.endsOn')} value={until} minDate={dayKey} onChange={setUntil} />
                )}
                {firstDst ? (
                  <Banner
                    variant="warn"
                    message={`${t('schedule.form.dstTitle', { date: dayLabel(firstDst.startsAt, locale) })} — ${t('schedule.form.dstBody')}`}
                  />
                ) : null}
                {seriesConflict ? <Banner variant="danger" message={t('schedule.form.seriesTaken')} /> : null}
                {series.error ? <Banner variant="danger" message={t(bookingErrorKey(series.error))} /> : null}
                {series.rows.length ? (
                  <View style={{ gap: 4 }}>
                    <Text style={{ fontWeight: '700' }}>{t('schedule.form.seriesTitle')}</Text>
                    {series.rows.map((r) => (
                      <View key={r.n} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 }}>
                        <Text numeric tone="muted" style={{ width: 24 }}>
                          {String(r.n).padStart(2, '0')}
                        </Text>
                        <Text style={{ flex: 1 }}>{dayLabel(r.startsAt, locale)}</Text>
                        {r.afterOffsetChange ? <Tag tone="warn" label={t('schedule.form.afterChange')} /> : null}
                        {r.conflict ? <Tag tone="danger" label={t('schedule.form.taken')} /> : null}
                        <Text numeric>{timeLabel(r.startsAt)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <FooterBar>
        <Button label={cta} variant="primary" size="lg" loading={submitting} disabled={blocked} onPress={onCta} />
      </FooterBar>

      <BottomSheet visible={picking} onDismiss={() => setPicking(false)} dismissLabel={t('schedule.form.cancel')}>
        <Text variant="h3">{t('schedule.form.pickClient')}</Text>
        <ScrollView style={{ maxHeight: 360 }}>
          {[...(roster ?? [])]
            .sort((a, b) => Number(b.isSelf) - Number(a.isSelf))
            .map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                onPress={() => {
                  setClientId(c.id);
                  setPicking(false);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 }}
              >
                <Avatar name={c.isSelf ? t('schedule.me') : c.displayName} size={32} />
                <Text style={{ flex: 1, fontWeight: c.id === clientId ? '700' : '400' }}>{c.isSelf ? t('schedule.me') : c.displayName}</Text>
              </Pressable>
            ))}
        </ScrollView>
      </BottomSheet>

      {props.mode === 'edit' ? (
        <BottomSheet visible={scopeOpen} onDismiss={() => setScopeOpen(false)} dismissLabel={t('schedule.form.keep')}>
          <Text variant="h3">{t('schedule.form.scopeTitle')}</Text>
          <Button label={t('schedule.form.scopeOne')} variant="ghost" onPress={() => void submitMove('one')} />
          <Button
            label={`${t('schedule.form.scopeFollowing')} · ${t('schedule.form.scopeFollowingSub', { count: props.seriesLeft })}`}
            variant="ghost"
            onPress={() => void submitMove('following')}
          />
          <Button label={t('schedule.form.keep')} variant="link" onPress={() => setScopeOpen(false)} />
        </BottomSheet>
      ) : null}
    </Screen>
  );
}
```

Check `Avatar`'s props in `ui/Avatar.tsx` before relying on `{ name, size }`; it exports `initialsFor`, so it is name-driven, but match its real prop names.

- [ ] **Step 3: The two routes**

`apps/mobile/src/app/(app)/schedule/new.tsx`:

```tsx
import { useLocalSearchParams } from 'expo-router';
import { BookingForm } from '../../../lib/schedule/BookingForm';

/** PT create. Entered from the + button, an open gap (date + time), or a client (clientId). */
export default function NewBooking() {
  const p = useLocalSearchParams<{ clientId?: string; date?: string; time?: string }>();
  return <BookingForm mode="new" initialClientId={p.clientId} initialDate={p.date} initialTime={p.time} />;
}
```

`apps/mobile/src/app/(app)/schedule/[id]/edit.tsx`:

```tsx
import { seriesProgress } from '@forge/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BookingForm } from '../../../../lib/schedule/BookingForm';
import { useBookingDetail } from '../../../../lib/schedule/useBookingDetail';
import { Button, EmptyState, NavHeader, Screen, Skeleton } from '../../../../ui';

export default function EditBooking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const d = useBookingDetail(id);
  if (d.loading) {
    return (
      <Screen>
        <Skeleton height={320} radius={14} />
      </Screen>
    );
  }
  if (!d.booking || d.booking.status !== 'scheduled') {
    return (
      <Screen>
        <NavHeader
          leading={<Button label={t('schedule.detail.back')} variant="link" icon="chevronBack" onPress={() => router.dismissTo('/(app)/(tabs)/schedule')} />}
        />
        <EmptyState icon="calendar" title={t('schedule.detail.removedTitle')} body={t('schedule.detail.removedBody')} />
      </Screen>
    );
  }
  const { left } = seriesProgress(d.series, d.booking.starts_at);
  return <BookingForm mode="edit" booking={d.booking} clientName={d.clientName} isSelf={d.isSelf} seriesLeft={left} />;
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm --filter mobile typecheck; pnpm --filter mobile lint`
Expected: PASS except `/(app)/schedule/[id]` pending Task 11 (V3).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/schedule/useSeriesPreview.ts apps/mobile/src/lib/schedule/BookingForm.tsx "apps/mobile/src/app/(app)/schedule"
git commit -m "feat(mobile): create and move bookings — slots, series, DST warning, edit scope"
```

---

## Task 11 · Mobile: Booking detail

**Files:**
- Create: `apps/mobile/src/lib/schedule/BookingDetailBody.tsx`, `apps/mobile/src/app/(app)/schedule/[id]/index.tsx`

**Interfaces:**
- Consumes: `useBookingDetail`, `useNow`, `cancelBooking`, `markNoShow`, `StartSessionSheet`, `bookingState`, `canClientChange`, `canMarkNoShow`, `cancelDeadline`, `noShowUnlocksAt`, `seriesProgress`, `untilLabel`, Task 7 atoms.
- Produces: route `/(app)/schedule/[id]`; `BookingDetailBody({ id, embedded? })` — Task 12 renders it in the iPad pane with `embedded`.

- [ ] **Step 1: The body**

`apps/mobile/src/lib/schedule/BookingDetailBody.tsx`:

```tsx
import {
  bookingErrorKey, bookingState, canClientChange, canMarkNoShow, noShowUnlocksAt, seriesProgress,
  type BookingErrorCode,
} from '@forge/shared';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Avatar, Banner, BottomSheet, Button, ChipRow, EmptyState, NavHeader, Screen, SegmentedPill, Skeleton, Tag, Text,
} from '../../ui';
import { StartSessionSheet } from '../logging/StartSessionSheet';
import { useOffline } from '../offline/offlineContext';
import { dayLabel, timeLabel, untilLabel } from './format';
import { OfflineNote } from './OfflineNote';
import { cancelBooking, markNoShow, type Scope } from './scheduleApi';
import { useBookingDetail } from './useBookingDetail';
import { useNow } from './useNow';

type Sheet = 'late' | 'cancel' | 'noshow' | null;
const REASONS = ['ill', 'clash', 'travel'] as const;

/**
 * One booking, for the PT. Start session is the only accent action. No-show
 * stays locked until 15 minutes after the start and says when it unlocks.
 * Cancel inside the cutoff states time left vs. the policy first, then lets
 * the PT decide whether it counts. Destructive actions sit last.
 */
export function BookingDetailBody({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const offline = useOffline();
  const d = useBookingDetail(id);
  const now = useNow(15_000);
  const locale = i18n.language;

  const [sheet, setSheet] = useState<Sheet>(null);
  const [counted, setCounted] = useState(true);
  const [reason, setReason] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('one');
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BookingErrorCode | null>(null);

  const back = () => router.dismissTo('/(app)/(tabs)/schedule');
  const wrap = (children: ReactNode) =>
    embedded ? (
      <View style={{ flex: 1 }}>{children}</View>
    ) : (
      <Screen padded={false}>
        <NavHeader
          title={t('schedule.detail.title')}
          leading={<Button label={t('schedule.detail.back')} variant="link" icon="chevronBack" onPress={back} />}
          trailing={
            d.booking?.status === 'scheduled' && offline.online ? (
              <Button
                label={t('schedule.detail.edit')}
                variant="link"
                tone="accent"
                onPress={() => router.push({ pathname: '/(app)/schedule/[id]/edit', params: { id } })}
              />
            ) : undefined
          }
        />
        {children}
      </Screen>
    );

  if (d.loading) return wrap(<View style={{ padding: 18 }}><Skeleton height={280} radius={14} /></View>);
  if (d.error) {
    return wrap(
      <EmptyState
        icon="alert"
        tone="danger"
        title={t('schedule.detail.errorTitle')}
        body={t('schedule.detail.errorBody')}
        actionLabel={t('schedule.retry')}
        onAction={d.refetch}
      />,
    );
  }
  if (!d.booking) {
    return wrap(
      <EmptyState
        icon="calendar"
        title={t('schedule.detail.removedTitle')}
        body={t('schedule.detail.removedBody')}
        actionLabel={embedded ? undefined : t('schedule.detail.backToSchedule')}
        onAction={embedded ? undefined : back}
      />,
    );
  }

  const b = d.booking;
  const state = bookingState(b.status, d.isSelf);
  const name = d.isSelf ? t('schedule.me') : d.clientName;
  const cutoff = d.policy?.cutoffHours ?? 12;
  // For the PT, "late" is exactly when a client could no longer change it.
  const late = !canClientChange(b.starts_at, cutoff, now);
  const noShowOk = canMarkNoShow(b.starts_at, now);
  const scheduled = b.status === 'scheduled';
  const progress = d.series.length ? seriesProgress(d.series, b.starts_at) : null;
  const every = b.recurrence_rule?.includes('INTERVAL=2') ? 2 : 1;
  const writable = scheduled && offline.online && !busy;

  async function doCancel() {
    setBusy(true);
    setError(null);
    const r = await cancelBooking(b.id, scope, late ? counted : null, reason ? t(`schedule.detail.reasons.${reason}`) : null);
    setBusy(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    setSheet(null);
    d.refetch();
  }

  async function doNoShow() {
    setBusy(true);
    setError(null);
    const r = await markNoShow(b.id);
    setBusy(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    setSheet(null);
    d.refetch();
  }

  const actionRow = (label: string, sub: string | null, onPress: () => void, enabled: boolean, danger = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        opacity: enabled ? 1 : 0.5,
      }}
    >
      <Text style={{ flex: 1, fontWeight: '600', color: danger ? theme.colors.dangerAccent : theme.colors.textPrimary }}>{label}</Text>
      {sub ? (
        <Text variant="caption" tone="muted">
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );

  return wrap(
    <>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: theme.space[3], paddingBottom: theme.space[6], gap: theme.space[4] }}>
        {!offline.online ? <OfflineNote title={t('schedule.detail.offline')} body={t('schedule.detail.offlineBody')} /> : null}
        {error ? <Banner variant="danger" message={t(bookingErrorKey(error))} /> : null}
        <Tag label={t(`schedule.states.${state}`)} tone={state === 'noshow' ? 'warn' : state === 'checked' ? 'success' : state === 'booked' ? 'accent' : 'neutral'} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name={name ?? '?'} size={48} />
          <View style={{ flex: 1 }}>
            <Text variant="h3">{name ?? ''}</Text>
            <Text variant="caption" tone="muted">
              {dayLabel(b.starts_at, locale)}
            </Text>
          </View>
        </View>
        <Text numeric style={{ fontSize: 28, fontWeight: '800' }}>
          {timeLabel(b.starts_at)} – {timeLabel(b.ends_at)}
        </Text>
        {progress && progress.total > 1 ? (
          <Text tone="muted">{t('schedule.detail.repeats', { every, left: progress.left, total: progress.total })}</Text>
        ) : null}
        {d.programName && b.client_id ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => (d.isSelf ? router.push('/(app)/me') : router.push({ pathname: '/(app)/clients/[id]', params: { id: b.client_id! } }))}
            style={{ padding: 14, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceRaised, gap: 2 }}
          >
            <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: theme.colors.textMuted }}>{t('schedule.detail.program')}</Text>
            <Text style={{ fontWeight: '700' }}>{d.programName}</Text>
          </Pressable>
        ) : null}
        {scheduled && b.client_id ? (
          <Button label={t('schedule.detail.startSession')} variant="primary" size="lg" onPress={() => setStarting(true)} />
        ) : null}
        {scheduled ? (
          <View>
            {actionRow(t('schedule.detail.reschedule'), null, () => router.push({ pathname: '/(app)/schedule/[id]/edit', params: { id } }), writable)}
            {d.isSelf
              ? null
              : actionRow(
                  t('schedule.detail.noShow'),
                  noShowOk ? null : t('schedule.detail.noShowLocked', { time: timeLabel(noShowUnlocksAt(b.starts_at).toISOString()) }),
                  () => setSheet('noshow'),
                  writable && noShowOk,
                )}
            {actionRow(t('schedule.detail.cancel'), null, () => setSheet(late && !d.isSelf ? 'late' : 'cancel'), writable, true)}
          </View>
        ) : null}
      </ScrollView>

      {b.client_id ? (
        <StartSessionSheet
          visible={starting}
          clientId={b.client_id}
          viewerIsPt
          // From a pushed screen the Programs TAB must be reached by dismissing, not pushing (PITFALLS N9).
          onNoProgram={() => router.dismissTo('/(app)/(tabs)/programs')}
          onDismiss={() => setStarting(false)}
        />
      ) : null}

      <BottomSheet visible={sheet === 'cancel'} onDismiss={() => setSheet(null)} dismissLabel={t('schedule.detail.keep')}>
        <Text variant="h3">{t('schedule.detail.cancelTitle')}</Text>
        {progress && progress.left > 1 ? (
          <SegmentedPill
            items={[
              { label: t('schedule.detail.cancelScopeOne'), value: 'one' },
              { label: t('schedule.detail.cancelScopeFollowing'), value: 'following' },
            ]}
            selected={scope}
            onChange={(v) => setScope(v as Scope)}
          />
        ) : null}
        <Button label={t('schedule.detail.cancel')} variant="ghost" tone="danger" loading={busy} onPress={() => void doCancel()} />
        <Button label={t('schedule.detail.keep')} variant="link" onPress={() => setSheet(null)} />
      </BottomSheet>

      <BottomSheet visible={sheet === 'late'} onDismiss={() => setSheet(null)} dismissLabel={t('schedule.detail.keep')}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Tag tone="warn" label={t('schedule.detail.lateStarts', { time: untilLabel(Date.parse(b.starts_at) - now) })} />
          <Tag label={t('schedule.detail.lateCutoff', { hours: cutoff })} />
        </View>
        <Text variant="h3">{t('schedule.detail.lateTitle')}</Text>
        <Text tone="muted">{name ? t('schedule.detail.lateBody', { name }) : t('schedule.detail.lateBodyNoName')}</Text>
        <SegmentedPill
          items={[
            { label: t('schedule.detail.counts'), value: 'counts' },
            { label: t('schedule.detail.waive'), value: 'waive' },
          ]}
          selected={counted ? 'counts' : 'waive'}
          onChange={(v) => setCounted(v === 'counts')}
        />
        <Text variant="caption" tone="muted">
          {counted
            ? name
              ? t('schedule.detail.countsNote', { name })
              : t('schedule.detail.countsNoteNoName')
            : name
              ? t('schedule.detail.waiveNote', { name })
              : t('schedule.detail.waiveNoteNoName')}
        </Text>
        <Text variant="caption" tone="muted">
          {t('schedule.detail.reason')}
        </Text>
        <ChipRow
          options={REASONS.map((r) => t(`schedule.detail.reasons.${r}`))}
          selected={reason ? [t(`schedule.detail.reasons.${reason}`)] : []}
          onToggle={(label) => {
            const hit = REASONS.find((r) => t(`schedule.detail.reasons.${r}`) === label) ?? null;
            setReason((cur) => (cur === hit ? null : hit));
          }}
        />
        <Button label={t('schedule.detail.cancel')} variant="ghost" tone="danger" loading={busy} onPress={() => void doCancel()} />
        <Button label={t('schedule.detail.keep')} variant="link" onPress={() => setSheet(null)} />
      </BottomSheet>

      <BottomSheet visible={sheet === 'noshow'} onDismiss={() => setSheet(null)} dismissLabel={t('schedule.detail.notYet')}>
        <Text variant="h3">{name ? t('schedule.detail.noShowTitle', { name }) : t('schedule.detail.noShowTitleNoName')}</Text>
        <Text tone="muted">{t('schedule.detail.noShowBody', { time: timeLabel(b.starts_at) })}</Text>
        <Button label={t('schedule.detail.noShow')} variant="ghost" tone="danger" loading={busy} onPress={() => void doNoShow()} />
        <Button label={t('schedule.detail.notYet')} variant="link" onPress={() => setSheet(null)} />
      </BottomSheet>
    </>,
  );
}
```

The self row gets neither the late sheet nor no-show: a PT can't be absent from their own training in any way that counts against anyone.

- [ ] **Step 2: The route**

`apps/mobile/src/app/(app)/schedule/[id]/index.tsx`:

```tsx
import { useLocalSearchParams } from 'expo-router';
import { BookingDetailBody } from '../../../../lib/schedule/BookingDetailBody';

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BookingDetailBody id={id} />;
}
```

- [ ] **Step 3: Typecheck and lint — every route now exists**

Run: `pnpm --filter mobile typecheck; pnpm --filter mobile lint`
Expected: PASS. If route strings still fail, start the dev server once (`pnpm --filter mobile start`, stop it when the bundler is up) to regenerate `.expo/types/router.d.ts` (V3).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/lib/schedule/BookingDetailBody.tsx "apps/mobile/src/app/(app)/schedule/[id]/index.tsx"
git commit -m "feat(mobile): booking detail — start session, late cancel, no-show"
```

---

## Task 12 · Mobile: the iPad week grid

**Files:**
- Create: `apps/mobile/src/lib/schedule/IpadWeek.tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/schedule.tsx` (default export picks the layout)

**Interfaces:**
- Consumes: `useSchedule`, `blockProps`, `BookingDetailBody` (embedded), `CalendarBlock`, `CONSOLE_MIN_WIDTH`.
- Produces: `IpadWeek()`.

- [ ] **Step 1: The grid**

`apps/mobile/src/lib/schedule/IpadWeek.tsx`:

```tsx
import { addDays, localDayKey, minuteOfDay } from '@forge/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, CalendarBlock, IconButton, Screen, Skeleton, Text } from '../../ui';
import { useAuth } from '../auth/AuthProvider';
import { blockProps } from './blockProps';
import { BookingDetailBody } from './BookingDetailBody';
import { dayLabel } from './format';
import { useSchedule } from './useSchedule';

const FIRST = 6 * 60;
const LAST = 21 * 60;
const PX = 1; // 60 pt per hour
const GUTTER = 48;

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * A real week grid on iPad, starting today. Block height is the booking
 * length. Selecting a block fills the right pane with booking detail;
 * nothing navigates away (design, iPad schedule). Same state colours and ME
 * hatch as the phone, through the same CalendarBlock.
 */
export function IpadWeek() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const [range] = useState(() => {
    const today = startOfToday();
    return { today, to: addDays(today, 7) };
  });
  const data = useSchedule(auth.user?.id, range.today, range.to);
  const [selected, setSelected] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(range.today, i));
  const hours = Array.from({ length: (LAST - FIRST) / 60 + 1 }, (_, i) => FIRST / 60 + i);

  return (
    <Screen padded={false}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 12 }}>
            <Text variant="h2" style={{ flex: 1 }}>
              {t('schedule.title')}
            </Text>
            <Button label={t('schedule.hours')} variant="ghost" onPress={() => router.push('/(app)/schedule/availability')} />
            <IconButton icon="plus" accessibilityLabel={t('schedule.newBooking')} onPress={() => router.push('/(app)/schedule/new')} />
          </View>
          <View style={{ flexDirection: 'row', paddingStart: GUTTER }}>
            {days.map((d) => (
              <Text key={localDayKey(d)} style={{ flex: 1, textAlign: 'center', fontWeight: '700', paddingBottom: 6 }}>
                {dayLabel(d, i18n.language)}
              </Text>
            ))}
          </View>
          {data.loading ? (
            <View style={{ padding: 18 }}>
              <Skeleton height={400} radius={14} />
            </View>
          ) : (
            <ScrollView>
              <View style={{ flexDirection: 'row', height: (LAST - FIRST) * PX + 20 }}>
                <View style={{ width: GUTTER }}>
                  {hours.map((h) => (
                    <Text
                      key={h}
                      numeric
                      tone="muted"
                      style={{ position: 'absolute', top: (h * 60 - FIRST) * PX - 7, fontSize: 11, width: GUTTER - 6, textAlign: 'right' }}
                    >
                      {String(h).padStart(2, '0')}:00
                    </Text>
                  ))}
                </View>
                {days.map((d) => {
                  const key = localDayKey(d);
                  const items = data.items.filter((i) => localDayKey(new Date(i.startsAt)) === key);
                  return (
                    <View key={key} style={{ flex: 1, borderStartWidth: 1, borderStartColor: theme.colors.border }}>
                      {items.map((item) => {
                        const start = Math.max(FIRST, minuteOfDay(new Date(item.startsAt)));
                        const end = Math.min(LAST, minuteOfDay(new Date(item.endsAt)) || LAST);
                        return (
                          <View key={item.id} style={{ position: 'absolute', top: (start - FIRST) * PX, left: 2, right: 2 }}>
                            <CalendarBlock
                              {...blockProps(item, t)}
                              minHeight={Math.max(28, (end - start) * PX)}
                              selected={item.id === selected}
                              onPress={() => setSelected(item.id)}
                            />
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </View>
        <View style={{ width: 380, borderStartWidth: 1, borderStartColor: theme.colors.border }}>
          {selected ? (
            <BookingDetailBody key={selected} id={selected} embedded />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {t('schedule.emptyBody')}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Screen>
  );
}
```

The empty right pane reuses `schedule.emptyBody` deliberately: it is the one line that tells a PT what this screen is for. If the design review wants different copy, add a key — don't hardcode English.

- [ ] **Step 2: Pick the layout by width**

In `apps/mobile/src/app/(app)/(tabs)/schedule.tsx` replace the default export:

```tsx
export default function ScheduleTab() {
  const { width } = useWindowDimensions();
  return width >= CONSOLE_MIN_WIDTH ? <IpadWeek /> : <PhoneSchedule />;
}
```

adding `useWindowDimensions` to the `react-native` import, `import { CONSOLE_MIN_WIDTH } from '../../../lib/consoleWidth';` and `import { IpadWeek } from '../../../lib/schedule/IpadWeek';`.

- [ ] **Step 3: Typecheck, lint, commit**

```bash
pnpm --filter mobile typecheck && pnpm --filter mobile lint
git add apps/mobile/src/lib/schedule/IpadWeek.tsx "apps/mobile/src/app/(app)/(tabs)/schedule.tsx"
git commit -m "feat(mobile): iPad week grid with detail pane"
```

---

## Task 13 · Mobile: the client's bookings

**Files:**
- Create: `apps/mobile/src/lib/schedule/NextSessionCard.tsx`, `apps/mobile/src/app/(app)/bookings/index.tsx`, `apps/mobile/src/app/(app)/bookings/book.tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/index.tsx` (`ClientHome`)

**Interfaces:**
- Consumes: `useMyBookings`, `useOpenSlots`, `createBooking`, `rescheduleBooking`, `cancelBooking`, `useNow`, `canClientChange`, `cancelDeadline`, `bookingState`, `slotCountsByDay`, Task 7 atoms.
- Produces: routes `/(app)/bookings` and `/(app)/bookings/book` (params `move?` booking id, `from?` `'mine'`); `NextSessionCard()`.

- [ ] **Step 1: Today card**

`apps/mobile/src/lib/schedule/NextSessionCard.tsx`:

```tsx
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, Text } from '../../ui';
import { useAuth } from '../auth/AuthProvider';
import { dayLabel, timeLabel } from './format';
import { useMyBookings } from './useMyBookings';

/** The client's way into booking: their next session, or a way to book one. Hidden until they have a coach. */
export function NextSessionCard() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const data = useMyBookings(auth.user?.id);
  if (data.loading || (!data.coach && data.upcoming.length === 0)) return null;
  const next = data.upcoming[0];
  return (
    <View style={{ padding: 16, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceRaised, gap: 8 }}>
      <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: theme.colors.textMuted }}>{t('bookings.home.next')}</Text>
      {next ? (
        <>
          <Text variant="h3">{dayLabel(next.starts_at, i18n.language)}</Text>
          <Text numeric>
            {timeLabel(next.starts_at)} – {timeLabel(next.ends_at)}
          </Text>
        </>
      ) : (
        <Text tone="muted">{t('bookings.home.none')}</Text>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {data.coach ? <Button label={t('bookings.home.book')} variant="ghost" onPress={() => router.push('/(app)/bookings/book')} /> : null}
        <Button label={t('bookings.home.mine')} variant="link" onPress={() => router.push('/(app)/bookings')} />
      </View>
    </View>
  );
}
```

In `apps/mobile/src/app/(app)/(tabs)/index.tsx`, inside `ClientHome`'s returned JSX, place `<NextSessionCard />` directly after the `<HomeHeader … />` element, and add `import { NextSessionCard } from '../../../lib/schedule/NextSessionCard';`.

- [ ] **Step 2: My bookings**

`apps/mobile/src/app/(app)/bookings/index.tsx`:

```tsx
import { bookingErrorKey, bookingState, canClientChange, cancelDeadline, type BookingErrorCode } from '@forge/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { useOffline } from '../../../lib/offline/offlineContext';
import { dayLabel, deadlineLabel, timeLabel } from '../../../lib/schedule/format';
import { OfflineNote } from '../../../lib/schedule/OfflineNote';
import { cancelBooking, type BookingRow } from '../../../lib/schedule/scheduleApi';
import { useMyBookings } from '../../../lib/schedule/useMyBookings';
import { useNow } from '../../../lib/schedule/useNow';
import { useTheme } from '../../../theme/ThemeProvider';
import { Banner, BottomSheet, Button, EmptyState, NavHeader, Screen, SegmentedPill, Skeleton, Text } from '../../../ui';

export default function MyBookings() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const now = useNow();
  const data = useMyBookings(auth.user?.id);
  const locale = i18n.language;
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [confirm, setConfirm] = useState<BookingRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BookingErrorCode | null>(null);
  const cutoff = data.policy?.cutoffHours ?? 12;
  const ptName = data.coach?.ptName ?? null;

  const lengthOf = (b: BookingRow) => b.length_min ?? Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000);
  const withPt = (b: BookingRow) =>
    ptName ? t('bookings.withPt', { length: lengthOf(b), name: ptName }) : t('bookings.withPtNoName', { length: lengthOf(b) });

  async function doCancel() {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    const r = await cancelBooking(confirm.id, 'one', null, null);
    setBusy(false);
    setConfirm(null);
    if (r.error) setError(r.error);
    data.refetch();
  }

  const pastLabel = (b: BookingRow) => {
    if (b.status === 'cancelled' && b.cancel_counted) return t('bookings.pastStates.lateCounted');
    const s = bookingState(b.status, false);
    return s === 'noshow' ? t('bookings.pastStates.noshow') : s === 'cancelled' ? t('bookings.pastStates.cancelled') : t('bookings.pastStates.done');
  };

  const upcoming = () => {
    const [next, ...later] = data.upcoming;
    if (!next) {
      return (
        <EmptyState
          icon="calendar"
          title={t('bookings.emptyTitle')}
          body={t('bookings.emptyBody')}
          actionLabel={data.coach ? t('bookings.emptyCta') : undefined}
          onAction={data.coach ? () => router.push({ pathname: '/(app)/bookings/book', params: { from: 'mine' } }) : undefined}
        />
      );
    }
    const ok = canClientChange(next.starts_at, cutoff, now);
    const deadline = cancelDeadline(next.starts_at, cutoff);
    const can = ok && offline.online && !busy;
    return (
      <View style={{ gap: theme.space[4] }}>
        <View style={{ padding: 16, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceRaised, gap: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: theme.colors.textMuted }}>{t('bookings.next')}</Text>
          <Text variant="h3">{dayLabel(next.starts_at, locale)}</Text>
          <Text numeric style={{ fontSize: 22, fontWeight: '800' }}>
            {timeLabel(next.starts_at)} – {timeLabel(next.ends_at)}
          </Text>
          <Text tone="muted">{withPt(next)}</Text>
          {ok ? (
            <Text variant="caption" tone="muted">
              {t('bookings.freeUntil', { deadline: deadlineLabel(deadline, locale) })}
            </Text>
          ) : (
            <View style={{ padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.warnSurface, gap: 2 }}>
              <Text style={{ fontWeight: '700', color: theme.colors.onWarnSurface }}>{t('bookings.tooLateTitle')}</Text>
              <Text style={{ color: theme.colors.onWarnSurface }}>
                {t('bookings.tooLateBody', { hours: cutoff, time: timeLabel(deadline.toISOString()) })}
              </Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              label={t('bookings.reschedule')}
              variant="ghost"
              disabled={!can}
              onPress={() => router.push({ pathname: '/(app)/bookings/book', params: { move: next.id } })}
            />
            <Button label={t('bookings.cancel')} variant="ghost" tone="danger" disabled={!can} onPress={() => setConfirm(next)} />
          </View>
        </View>
        {later.length ? (
          <View style={{ gap: 6 }}>
            <Text style={{ fontWeight: '700' }}>{t('bookings.later')}</Text>
            {later.map((b) => (
              <View key={b.id} style={{ flexDirection: 'row', minHeight: 44, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                <Text style={{ flex: 1 }}>{dayLabel(b.starts_at, locale)}</Text>
                <Text numeric>{timeLabel(b.starts_at)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {data.coach ? (
          <Button
            label={t('bookings.emptyCta')}
            variant="link"
            onPress={() => router.push({ pathname: '/(app)/bookings/book', params: { from: 'mine' } })}
          />
        ) : null}
      </View>
    );
  };

  const past = () => (
    <View style={{ gap: 6 }}>
      {data.past.map((b) => (
        <View key={b.id} style={{ minHeight: 52, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
          <View style={{ flexDirection: 'row' }}>
            <Text style={{ flex: 1 }}>{dayLabel(b.starts_at, locale)}</Text>
            <Text numeric>{timeLabel(b.starts_at)}</Text>
          </View>
          <Text variant="caption" tone="muted">
            {pastLabel(b)}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <Screen padded={false}>
      <NavHeader
        title={t('bookings.title')}
        leading={<Button label={t('common.back')} variant="link" icon="chevronBack" onPress={() => router.dismissTo('/')} />}
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: theme.space[3], paddingBottom: theme.space[6], gap: theme.space[4] }}>
        <SegmentedPill
          items={[
            { label: t('bookings.upcoming'), value: 'upcoming' },
            { label: t('bookings.past'), value: 'past' },
          ]}
          selected={tab}
          onChange={(v) => setTab(v as 'upcoming' | 'past')}
        />
        {!offline.online && data.fetchedAt ? (
          <OfflineNote title={t('bookings.offline', { time: timeLabel(data.fetchedAt) })} body={t('bookings.offlineBody')} />
        ) : null}
        {error ? <Banner variant="danger" message={t(bookingErrorKey(error))} /> : null}
        {data.loading ? (
          <Skeleton height={220} radius={14} />
        ) : data.error ? (
          <EmptyState
            icon="alert"
            tone="danger"
            title={t('bookings.errorTitle')}
            body={t('bookings.errorBody')}
            actionLabel={t('schedule.retry')}
            onAction={data.refetch}
          />
        ) : !data.coach && data.upcoming.length === 0 && data.past.length === 0 ? (
          <EmptyState icon="users" title={t('bookings.book.noCoachTitle')} body={t('bookings.book.noCoachBody')} />
        ) : tab === 'upcoming' ? (
          upcoming()
        ) : (
          past()
        )}
      </ScrollView>
      <BottomSheet visible={confirm !== null} onDismiss={() => setConfirm(null)} dismissLabel={t('bookings.keep')}>
        <Text variant="h3">{t('bookings.cancelTitle')}</Text>
        {confirm ? (
          <Text tone="muted">
            {t('bookings.cancelBody', { deadline: deadlineLabel(cancelDeadline(confirm.starts_at, cutoff), locale) })}
          </Text>
        ) : null}
        <Button label={t('bookings.cancelConfirm')} variant="ghost" tone="danger" loading={busy} onPress={() => void doCancel()} />
        <Button label={t('bookings.keep')} variant="link" onPress={() => setConfirm(null)} />
      </BottomSheet>
    </Screen>
  );
}
```

- [ ] **Step 3: Book a session**

`apps/mobile/src/app/(app)/bookings/book.tsx`:

```tsx
import { addDays, bookingErrorKey, cancelDeadline, localDayKey, slotCountsByDay, type BookingErrorCode } from '@forge/shared';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { useOffline } from '../../../lib/offline/offlineContext';
import { dayLabel, deadlineLabel, dowLabel, timeLabel } from '../../../lib/schedule/format';
import { OfflineNote } from '../../../lib/schedule/OfflineNote';
import { createBooking, rescheduleBooking, type BookingRow } from '../../../lib/schedule/scheduleApi';
import { useMyBookings } from '../../../lib/schedule/useMyBookings';
import { useOpenSlots } from '../../../lib/schedule/useOpenSlots';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Banner, Button, DayStrip, EmptyState, FooterBar, Icon, NavHeader, Screen, SegmentedPill, Skeleton, SlotGrid, Text,
} from '../../../ui';

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * The client books (or, with ?move=, moves) one session inside their coach's
 * open slots. The policy sits beside the button, before commitment. A slot
 * taken in the meantime keeps the day and length and outlines the nearest
 * open times; an empty week offers the next one rather than a dead end.
 */
export default function BookSession() {
  const { move, from } = useLocalSearchParams<{ move?: string; from?: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const data = useMyBookings(auth.user?.id);
  const locale = i18n.language;

  const moving = move ? (data.upcoming.find((b) => b.id === move) ?? null) : null;
  const [id] = useState(() => Crypto.randomUUID());
  const [today] = useState(startOfToday);
  const [length, setLength] = useState<number | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayPick, setDayPick] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [taken, setTaken] = useState<{ label: string; at: number } | null>(null);
  const [error, setError] = useState<BookingErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<BookingRow | null>(null);

  const policy = data.policy;
  const len = moving?.length_min ?? length ?? (policy ? (policy.lengths.includes(60) ? 60 : (policy.lengths[0] ?? null)) : null);
  const maxOffset = Math.max(0, (policy?.windowWeeks ?? 1) - 1);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, weekOffset * 7 + i));
  const slots = useOpenSlots(data.coach?.ptUserId ?? null, localDayKey(days[0]!), localDayKey(days[6]!), len, moving?.id);
  const counts = slotCountsByDay(slots.slots);
  const dayKey = dayPick ?? days.map(localDayKey).find((k) => (counts[k] ?? 0) > 0) ?? localDayKey(days[0]!);
  const daySlots = slots.slots.filter((s) => s.date === dayKey);
  const outlined = taken
    ? [...daySlots].sort((a, b) => Math.abs(Date.parse(a.startsAt) - taken.at) - Math.abs(Date.parse(b.startsAt) - taken.at)).slice(0, 2).map((s) => s.startsAt)
    : [];
  const leave = () => (moving || from === 'mine' ? router.dismissTo('/(app)/bookings') : router.dismissTo('/'));

  async function submit() {
    if (!picked || !len || !data.coach) return;
    setBusy(true);
    setError(null);
    const r = moving ? await rescheduleBooking(moving.id, picked, 'one') : await createBooking({ id, clientId: data.coach.clientId, startsAt: picked, length: len });
    setBusy(false);
    if (r.error) {
      if (r.error === 'slot_taken' || r.error === 'outside_hours') {
        setTaken({ label: timeLabel(picked), at: Date.parse(picked) });
        setPicked(null);
        slots.refetch();
      } else {
        setError(r.error);
      }
      return;
    }
    setDone(r.data[0] ?? null);
  }

  // ?move= names a booking that is no longer upcoming (cancelled, passed, or
  // never ours). Without this guard the screen would quietly book a NEW session.
  if (move && !data.loading && !moving && !done) {
    return (
      <Screen>
        <NavHeader leading={<Button label={t('common.back')} variant="link" icon="chevronBack" onPress={leave} />} />
        <EmptyState icon="calendar" title={t('schedule.detail.removedTitle')} body={t('schedule.errors.bookingClosed')} />
      </Screen>
    );
  }

  if (done) {
    const ptName = data.coach?.ptName;
    const minutes = done.length_min ?? len ?? 0;
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, padding: 24 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.successSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={28} color={theme.colors.onSuccessSurface} />
          </View>
          <Text variant="h2">{moving ? t('bookings.book.doneMoved') : t('bookings.book.doneTitle')}</Text>
          <Text numeric>
            {dayLabel(done.starts_at, locale)} · {timeLabel(done.starts_at)} – {timeLabel(done.ends_at)}
          </Text>
          <Text tone="muted">
            {ptName ? t('bookings.book.doneLength', { length: minutes, name: ptName }) : t('bookings.book.doneLengthNoName', { length: minutes })}
          </Text>
          {policy ? (
            <Text variant="caption" tone="muted">
              {t('bookings.book.doneDeadline', { deadline: deadlineLabel(cancelDeadline(done.starts_at, policy.cutoffHours), locale) })}
            </Text>
          ) : null}
        </View>
        <Button label={t('bookings.book.seeMine')} variant="primary" size="lg" onPress={() => router.replace('/(app)/bookings')} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <NavHeader
        title={moving ? t('bookings.book.titleMove') : t('bookings.book.title')}
        leading={<Button label={t('common.back')} variant="link" icon="chevronBack" onPress={leave} />}
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: theme.space[3], paddingBottom: theme.space[6], gap: theme.space[4] }}>
        {!offline.online ? <OfflineNote title={t('bookings.book.offline')} body={t('bookings.book.offlineBody')} /> : null}
        {error ? <Banner variant="danger" message={t(bookingErrorKey(error))} /> : null}
        {data.loading ? (
          <Skeleton height={320} radius={14} />
        ) : !data.coach ? (
          <EmptyState icon="users" title={t('bookings.book.noCoachTitle')} body={t('bookings.book.noCoachBody')} />
        ) : (
          <>
            <Text tone="muted">
              {data.coach.ptName
                ? t('bookings.book.with', { name: data.coach.ptName, tz: policy?.timezone ?? '' })
                : t('bookings.book.withNoName', { tz: policy?.timezone ?? '' })}
            </Text>
            {policy && !moving ? (
              <View style={{ gap: 8 }}>
                <Text variant="caption" tone="muted">
                  {t('bookings.book.length')}
                </Text>
                <SegmentedPill
                  items={policy.lengths.map((l) => ({ label: `${l} ${t('schedule.form.min')}`, value: String(l) }))}
                  selected={String(len)}
                  onChange={(v) => {
                    setLength(Number(v));
                    setPicked(null);
                    setTaken(null);
                  }}
                />
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                label={t('bookings.book.thisWeek')}
                variant={weekOffset === 0 ? 'ghost' : 'link'}
                onPress={() => {
                  setWeekOffset(0);
                  setDayPick(null);
                  setPicked(null);
                }}
              />
              <Button
                label={`${t('bookings.book.nextWeek')} ›`}
                variant={weekOffset > 0 ? 'ghost' : 'link'}
                disabled={weekOffset >= maxOffset}
                onPress={() => {
                  setWeekOffset((w) => Math.min(maxOffset, w + 1));
                  setDayPick(null);
                  setPicked(null);
                }}
              />
            </View>
            <DayStrip
              days={days.map((d) => {
                const key = localDayKey(d);
                return { key, dow: dowLabel(d, locale), date: String(d.getDate()), count: slots.loading ? null : (counts[key] ?? 0) };
              })}
              selected={dayKey}
              onSelect={(k) => {
                setDayPick(k);
                setPicked(null);
              }}
            />
            {slots.error ? (
              <EmptyState
                icon="alert"
                tone="danger"
                title={t('bookings.book.errorTitle')}
                body={t('bookings.book.errorBody')}
                actionLabel={t('schedule.retry')}
                onAction={slots.refetch}
              />
            ) : !slots.loading && slots.slots.length === 0 ? (
              <EmptyState
                icon="calendar"
                title={t('bookings.book.noneTitle')}
                body={t('bookings.book.noneBody')}
                actionLabel={weekOffset < maxOffset ? t('bookings.book.noneCta') : undefined}
                onAction={weekOffset < maxOffset ? () => setWeekOffset((w) => w + 1) : undefined}
              />
            ) : (
              <View style={{ gap: 8 }}>
                {taken ? (
                  <Banner variant="warn" message={`${t('bookings.book.takenTitle', { time: taken.label })} — ${t('bookings.book.takenBody')}`} />
                ) : null}
                <Text style={{ fontWeight: '700' }}>{dayLabel(dayKey, locale)}</Text>
                <SlotGrid
                  slots={daySlots.map((s) => ({ key: s.startsAt, label: timeLabel(s.startsAt) }))}
                  selected={picked}
                  outlined={outlined}
                  onSelect={setPicked}
                />
              </View>
            )}
          </>
        )}
      </ScrollView>
      {data.coach ? (
        <FooterBar>
          <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            {policy?.cutoffHours ? t('bookings.book.policy', { hours: policy.cutoffHours }) : t('bookings.book.policyZero')}
          </Text>
          <Button
            label={
              picked
                ? moving
                  ? t('bookings.book.ctaMove', { time: timeLabel(picked) })
                  : t('bookings.book.cta', { time: timeLabel(picked) })
                : t('bookings.book.ctaPick')
            }
            variant="primary"
            size="lg"
            loading={busy}
            disabled={!picked || busy || !offline.online}
            onPress={() => void submit()}
          />
        </FooterBar>
      ) : null}
    </Screen>
  );
}
```

`FooterBar` takes `children` only; if it lays them out in a row, wrap the two in a `View style={{ gap: 8 }}`.

- [ ] **Step 4: Typecheck, lint, tests**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: PASS across the monorepo.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/schedule/NextSessionCard.tsx "apps/mobile/src/app/(app)/bookings" "apps/mobile/src/app/(app)/(tabs)/index.tsx"
git commit -m "feat(mobile): client booking — book, move, cancel, my bookings, Today card"
```

---

## Task 14 · Web: admin bookings section

**Files:**
- Modify: `apps/web/app/admin/users/[id]/page.tsx`

**Interfaces:**
- Consumes: `bookings_select` RLS (`is_admin()` branch), regenerated types.
- Produces: a read-only Bookings card on a PT's or client's admin page.

- [ ] **Step 1: Load**

After the existing Body data is loaded, add:

```ts
  type AdminBooking = Pick<
    Database['public']['Tables']['bookings']['Row'],
    'id' | 'starts_at' | 'status' | 'length_min' | 'cancel_late' | 'cancel_counted' | 'cancelled_by' | 'recurrence_rule'
  >;
  let bookings: AdminBooking[] | null = null;
  const bookingCols = 'id, starts_at, status, length_min, cancel_late, cancel_counted, cancelled_by, recurrence_rule';
  if (target.role === 'pt') {
    const { data } = await supabase.from('bookings').select(bookingCols).eq('pt_user_id', id).order('starts_at', { ascending: false }).limit(50);
    bookings = data ?? [];
  } else if (target.role === 'client') {
    const { data: rows } = await supabase.from('clients').select('id').eq('client_user_id', id);
    const ids = (rows ?? []).map((r) => r.id);
    if (ids.length) {
      const { data } = await supabase.from('bookings').select(bookingCols).in('client_id', ids).order('starts_at', { ascending: false }).limit(50);
      bookings = data ?? [];
    } else {
      bookings = [];
    }
  }
```

- [ ] **Step 2: Render**

Before `</main>`, add:

```tsx
      {bookings ? (
        <section style={ui.card}>
          <h2 style={{ ...ui.h2, marginBottom: 'var(--s-3)' }}>Bookings</h2>
          <p style={ui.muted}>Latest 50. Times are shown in this browser&apos;s zone; bookings are stored as UTC instants.</p>
          {bookings.length === 0 ? (
            <p style={ui.muted}>No bookings.</p>
          ) : (
            <table style={ui.table}>
              <thead>
                <tr>
                  <th style={ui.th}>Starts</th>
                  <th style={ui.th}>Length</th>
                  <th style={ui.th}>Status</th>
                  <th style={ui.th}>Late cancel</th>
                  <th style={ui.th}>Cancelled by</th>
                  <th style={ui.th}>Series</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id}>
                    <td style={ui.td}>{new Date(b.starts_at).toLocaleString()}</td>
                    <td style={ui.td}>{b.length_min ? `${b.length_min} min` : '—'}</td>
                    <td style={ui.td}>
                      <span style={b.status === 'no_show' ? ui.dangerBadge : ui.neutralBadge}>{b.status}</span>
                    </td>
                    <td style={ui.td}>{b.cancel_late ? (b.cancel_counted ? 'late · counted' : 'late · waived') : '—'}</td>
                    <td style={ui.td}>{b.cancelled_by ?? '—'}</td>
                    <td style={ui.td}>{b.recurrence_rule ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
```

- [ ] **Step 3: Typecheck and lint, commit**

```bash
pnpm --filter web typecheck && pnpm --filter web lint
git add "apps/web/app/admin/users/[id]/page.tsx"
git commit -m "feat(web): admin bookings section"
```

---

## Task 15 · Screen walk and live-DB proof

**Files:**
- Create (throwaway, scratchpad only): the walk script the `forge-screen-walk` skill produces.

A static review is not a test (PITFALLS V1). This task is the gate.

- [ ] **Step 1: Seed hours for the PT test account**

Sign in as `pt.test@forge.dev` in the walk and publish hours through the Availability screen (that is itself the first walk step). Do not seed by SQL — Availability must prove it can save.

- [ ] **Step 2: Run the walk**

Invoke the `forge-screen-walk` skill. Walk, screenshotting each step:

1. **PT** → Schedule tab exists between Today and Clients; Day view empty state with "Set your hours".
2. **PT** → Hours → turn on Mon–Sat 06:00–12:00 and 15:00–20:00 (Copy Monday), Rules: lengths 45/60/90, buffer 15, window 4, cutoff 12 → Save → "Published" banner.
3. **PT** → Hours → add two overlapping ranges on one day → Save → "Two ranges on one day overlap." and nothing saved (reload shows the previous hours).
4. **Client** (`client.test`) → Today shows the Next session card → Book a session → 60 min → a day with openings → pick a slot → Book → "You're booked" with the exact cancel deadline.
5. **Client** → same slot again from a second tab/session → "was just booked" banner with outlined alternatives (Review Focus 1 / D7 on the real stack).
6. **PT** → Schedule (refocus) → the client's booking is on the day/week view as BOOKED; open gaps are dashed and tappable.
7. **PT** → tap an open gap → Create booking prefilled with that day and time → Repeat weekly × 4 across **Sunday 2026-10-25** (pick a Thursday on or before 2026-10-22) → the series list shows the AFTER CHANGE tag on the first date after the change and the DST banner → Book 4 sessions → detail shows "Repeats every 1 wk · 4 of 4 left".
8. **PT** → that booking → Edit → move +1 h → scope sheet → "This and following" → the later three moved, the first did not.
9. **PT** → booking detail of the client's booking → Cancel → when > 12 h away it is the plain sheet; then create a booking for `client.test` starting within the next 12 h and cancel it → late sheet: "Starts in …", "Cutoff is 12 h", Counts/Waive → Waive → status CANCELLED.
10. **Client** → My bookings → Upcoming shows "Free to cancel or move until <exact time>"; Past shows the waived cancellation as "Cancelled".
11. **PT** → create a booking for `client.test` in the next open slot (create refuses a start in the past, so "now" means the soonest slot) → detail → Mark no-show is disabled with "Unlocks at HH:MM" → Start session (allowed from 30 min before the start) → log one set → Finish → back on Schedule the booking is COMPLETED.
12. **PT** → `/me` self row → book "Me" at 07:00 (outside hours) → it shows hatched with ME.
13. **iPad**: re-run the PT Schedule step at 1100 px width → week grid with blocks sized by length; tapping a block fills the right pane; nothing navigates.
14. **Offline** (per the M4b walk recipe in memory: offline beta on, drop the socket too — PITFALLS O2): Schedule shows "OFFLINE · SCHEDULE AS OF HH:MM"; Availability Save is disabled; Book CTA is disabled.

- [ ] **Step 3: Prove the writes landed on the live DB**

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -w -c "
select b.status, b.length_min, to_char(b.starts_at at time zone b.originating_timezone, 'Dy DD Mon HH24:MI') local_start,
       b.cancel_late, b.cancel_counted, b.recurrence_rule, (select count(*) from workout_sessions w where w.booking_id = b.id) sessions
  from bookings b join users u on u.id = b.pt_user_id
 where u.email = 'pt.test@forge.dev' order by b.starts_at;"
```

Expected: the walk's bookings with the statuses it produced; the DST series rows all `HH24:MI` = the same local time; the completed booking has `sessions = 1`; the waived late cancel shows `t | f`.

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -w -c "
select action, count(*) from audit_logs where action like 'booking_%' and created_at > now() - interval '1 day' group by 1 order by 1;"
```

Expected: `booking_cancel`, `booking_complete`, `booking_create` all non-zero.

- [ ] **Step 4: Re-run the harness**

Run: `psql "$PGURL" -w -v ON_ERROR_STOP=1 -f db/rls_assertions.sql` — no FAIL.

- [ ] **Step 5: Clean up walk data, commit fixes**

Cancel or leave the walk's bookings as the next milestone's seed — say which in the tracker log. Any fix found by the walk is its own commit with the walk step it fixes in the message.

---

## Task 16 · Close-out

**Files:**
- Modify: `docs/M5_Scheduling.md`, `CLAUDE.md`, `docs/PITFALLS.md` (only if a new repeatable class turned up), this plan (As-built)

- [ ] **Step 1: Log M5a in the tracker**

Append to `docs/M5_Scheduling.md` → Log a dated `### M5a · Booking core — landed` entry with four sub-lists: **Shipped** (screens, migration, RPCs), **Verified** (harness case count, vitest count, walk steps passed, live-DB query results), **Deviations from the design** (copy this plan's Corrections plus anything the walk changed), **For you to check** (the ten-minute manual pass: steps 4, 7, 9 and 13 of the walk on a real device; the Arabic copy; that late-cancel "counted" means what you want before M6). Flip the M5a row's status to "done".

- [ ] **Step 2: CLAUDE.md**

Update: migration count (20) and a one-line `0020` summary in the Supabase sentence; the Status paragraph gains one sentence on scheduling; the milestone table gains `M5a · Booking core ✅`, `M5b · Check-in`, `M5c · Calendar` rows in place of the single M5 row; the Documentation table gains the M5a spec/plan row and `docs/M5_Scheduling.md`.

- [ ] **Step 3: As-built**

Fill this plan's "As built — deviations from this plan" section with every place the code differs from the steps above and why.

- [ ] **Step 4: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: M5a close-out — tracker log, as-built, CLAUDE.md"
```

---

## Verification

| Layer | Command | Gate |
|---|---|---|
| SQL / RLS | `psql "$PGURL" -w -v ON_ERROR_STOP=1 -f db/rls_assertions.sql` | no `FAIL`; every M5a case passes |
| Shared | `pnpm --filter @forge/shared test` | all pass, incl. `schedule/*` and i18n parity |
| Monorepo | `pnpm typecheck; pnpm lint; pnpm test` | all pass (CI runs the same) |
| Screens | `forge-screen-walk`, Task 15's 14 steps | screenshots for each; live-DB queries match |

## Risks

- **Packed slots can hide a free time.** A client may only take a start `open_slots` returns; a free 45 minutes that doesn't land on the packing grid is invisible to clients (a PT can still book it). Acceptable for M5a; revisit if PTs ask for "any quarter hour".
- **Device clock = PT clock.** The app formats with the device's zone. A client travelling abroad sees shifted times — which the design says is correct — but the Availability screen's day boundaries assume the PT's phone is in the PT's zone.
- **`booking_rules` defaults live in SQL only.** `DEFAULT_RULES` in TS is for first render; if the two drift, the screen shows wrong defaults for one frame before `booking_policy` arrives.
- **The DST walk step depends on the calendar.** After 2026-10-25 the walk must pick the next clock change (last Sunday of March 2027 in Beirut). The harness uses 2027-10-31 and stays valid until then.

## Deliberately out of scope

M5b (QR check-in/out, scan, rating/comment/tip, receipt and session price, reminder settings), M5c (Google Calendar, conflict line, `.ics`), group classes (`class_id`), gym locations (`gym_id`), sending reminders (M9), money for counted late cancels (M6), Realtime on bookings, messaging ("Message {{name}}").

## As built — deviations from this plan

Every place the code differs from the steps above, and why.

- **Task 1 — harness read of `audit_logs`.** The block read the `booking_complete` audit row as `authenticated`; `audit_logs` has RLS on and no policies, so that role sees zero rows. The assertion now runs after `RESET ROLE`, as the M4a block's audit checks do (`c11bc97`). Caught by a dry run — migration and harness in one rolled-back transaction — before `db push`, so 0020 needed no follow-up migration.
- **Task 1 — harness environment.** On 2026-10-11 the harness failed on the *base* commit at the M4b broadcast assertion: `realtime.messages` had no daily partition after 2026-09-23 because the Realtime tenant had been idle, so broadcasts were silently dropped. One anonymous Realtime subscribe woke the tenant and it created partitions to 2026-10-14. No code change; it will recur whenever the project's Realtime sits idle for days.
- **Task 4 — `monthCells` test.** 1 Oct 2026 is a Thursday, so day 31 sits at index 33 and index 34 is padding; the test asserted `oct[34] === 31`. The test was wrong, not the function.
- **Tasks 6 and 10 — newest-wins in `useOpenSlots` / `useSeriesPreview`.** A ref bumped in effect cleanup trips `react-hooks/exhaustive-deps`; both use a per-effect `live` flag instead (cleanup runs before the next effect, so the O1 guarantee is the same).
- **Task 6 — `sessions/[id]`.** The doc comment that sat above the removed `CONSOLE_MIN_WIDTH` const moved to the `wide` line it describes.
- **Task 7 — gaps doc.** The section is `## Built (M5a)` above `## Outstanding`, matching the file's other milestone sections.
- **Task 9 — range editor.** `editing` holds `{ original, draft }` rather than re-finding the row by `start === || end ===`, which loses the edit once both ends move (the plan's note allowed this).
- **Tasks 9 and 10 — `DateField`.** It requires `labels` (and takes `placeholder`, `locale`); both forms pass the `common.datePicker` set, as `programs/[id]/assign.tsx` does.
- **Walk fixes (Task 15).** `breakBefore()` in `schedule/rules.ts` (vitest) so overlapping ranges draw no "-60m break" pill (`263ce03`); the move form shows only the booking's own length, because disabled `SegmentedPill` items read "Coming soon" (`f1ece18`); `CalendarBlock` gained `compact` (state word above the name), iPad grid blocks are clipped to their length, and the grid scale is 84 pt per hour instead of 60 so a 60-minute block holds state, name and time (`5f1a6b9`).
- **Walk step 12 could not be done as written.** The create form offers only `open_slots` starts, so a PT cannot book outside published hours from the app, although `create_booking` allows it (the harness proves the server side). The step booked Me inside hours instead. The Risks line "a PT can still book it" is therefore true of the server only. Left for the user to decide (tracker, For you to check).
- **Day view shows only today.** There is no previous/next day in the phone Day view, so open-gap rows exist only for today. The walk added an extra-hours exception for 11 Oct to have time inside the 12 h cutoff. Left for the user to decide.

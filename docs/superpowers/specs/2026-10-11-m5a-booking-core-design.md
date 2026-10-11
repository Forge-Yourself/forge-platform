# M5a · Booking Core — Design

**Date:** 2026-10-11
**Scope:** The first of three M5 sub-milestones. A PT publishes availability; a PT or a client books sessions, one-off or recurring across DST; both see their schedule; a PT cancels late (counted or waived) or marks a no-show; a booking starts an M4 logging session and completes when that session does. Online writes. No check-in, no rating, no receipt, no reminders, no Google.
**Parent:** `2026-09-09-forge-v1-implementation-design.md` §5 M5 (EP-09). Tracker: `docs/M5_Scheduling.md`. Design: `docs/Forge M5 Scheduling.html` screens 01–04, 08–10.

---

## 1. Goal

A PT can stop running their week from WhatsApp. They set their hours once, clients book themselves inside those hours, and the PT's day opens on a schedule that shows who is coming, who is done, who didn't show, and when they themselves train.

Success means:
- A client books an open slot and the PT sees it on next focus. Two clients can't hold the same slot — the second gets "slot just taken" and the nearest openings.
- A weekly series created in September keeps its 10:30 local time after Lebanon's clocks change in October, and the PT was warned before saving.
- Start session on a booking opens the existing logging screen, and completing the session turns the booking grey (completed).
- A client can't cancel inside the cutoff; the PT can, and decides whether it counts.

## 2. State of the ground

- `schedules`, `bookings`, `check_ins` exist since `0001_baseline`. **RLS is enabled on all three with no policies** — the same gap M3 and M4a found. Nothing reads or writes them yet.
- `schedules` is one weekly range per row (`day_of_week`, `start_time`, `end_time`, `timezone`) with a `slot_duration_min` CHECK of 30/45/60/90/120. There is nowhere to put date exceptions or booking rules.
- `bookings` has `status` (10 values, CHECK), `starts_at`/`ends_at` TIMESTAMPTZ, `originating_timezone`, `recurrence_rule`, `parent_booking_id`, `cancelled_by`/`cancelled_at`, `no_show_marked_at`, plus `class_id`/`gym_id`/`schedule_id` and reminder/Google columns M5a leaves alone. There is **no overlap protection**.
- `workout_sessions.booking_id` exists with an FK to `bookings` (`ON DELETE SET NULL`). `start_workout_session(p_client_id, p_program_day_id, p_id, p_started_at)` (0016) does not take it.
- Audit actions `booking_create`, `booking_cancel`, `booking_no_show`, `booking_complete` are already allowed (0005).
- `users.timezone` exists, default `Asia/Beirut`. `btree_gist` is installed.
- M4e's self-client row means a PT's own training can be an ordinary booking whose `client_id` is their self row — no special case needed for the "ME" block.
- PT tabs: Today / Clients / Programs / Library. Client has Today only. `CONSOLE_MIN_WIDTH` (M4d) is the iPad breakpoint.

## 3. Decisions

Each is a choice where the design is silent. Review these first.

- **D1 · Availability lives in three places, saved as one.** Weekly ranges stay in `schedules` (one row per range, so a "break" is just the gap between two rows — exactly how the design draws it). New `availability_exceptions` (a date: day off, or replacement ranges) and `booking_rules` (one row per PT: offered lengths, buffer, window, cutoff). One RPC, `save_availability`, replaces all three for the caller in one transaction — the design's "three tabs, one Save".
- **D2 · Open slots are computed only on the server.** `open_slots(pt, from, to, length)` is the single authority, used by the PT's create-booking and the client's Book screen alike. No TypeScript copy of the rule (PITFALLS: a rule in two languages needs tests on both sides — so don't write it twice). Booking already needs a connection per the design, so nothing is lost.
- **D3 · Slot packing.** Within each available range, candidate starts begin at the range start and at every blocking booking's end + buffer, stepping by length + buffer. That matches the design's irregular grid (08:15, 09:30…) and packs the day instead of leaving 15-minute crumbs. Slots earlier than now are dropped; slots beyond the booking window are dropped for clients only — a PT may book further out.
- **D4 · Times are wall-clock in the PT's timezone.** Every booking stores UTC `starts_at` plus `originating_timezone` = the PT's `users.timezone`. Recurrence is computed at local wall time and converted per occurrence, so a 10:30 series stays 10:30 across DST and its UTC shifts by an hour. Postgres's tz database does the conversion; the app never does timezone math.
- **D5 · Recurring series are materialised rows.** Creating "weekly × 8" inserts 8 rows sharing `parent_booking_id` (the first row's id) and a `recurrence_rule` string kept for display/export. Cap: 26 occurrences or 6 months. Rejected: a rule plus on-the-fly expansion — every query (slots, schedule, overlap) would have to expand it, and per-occurrence cancel/no-show needs real rows anyway.
- **D6 · The DST preview is a server call.** `preview_series(...)` returns every occurrence with local and UTC times and a `after_offset_change` flag on the first one after a clock change. The screen renders the list and the warning from it. Same reason as D2/D4: no tz math on device (Hermes' `Intl` timezone support isn't something to bet on).
- **D7 · Overlap is a database constraint.** An exclusion constraint on `(pt_user_id, tstzrange(starts_at, ends_at))` for every status except `cancelled`. Two racing bookings can't both commit; the loser gets a typed `slot_taken` error that the Book screen turns into the design's "slot just taken" state. Buffer is a rule, enforced in the RPC, not in the constraint.
- **D8 · Late cancellation is recorded, not charged.** New columns `cancel_late` and `cancel_counted` (+ `cancel_reason`). A client can't cancel or reschedule inside the cutoff (RPC refuses). A PT can, and the design's sheet chooses "Counts as used" or "Waive this once". What "counted" costs is M6's problem — see the tracker.
- **D9 · No-show unlocks 15 minutes after start.** PT only. The RPC enforces the 15 minutes; the screen shows when it unlocks, as designed.
- **D10 · Edit scope.** "This session only" changes one row. "This and following" changes every row in the series at or after this one, applying the same local-time change to each (D4). A single-row edit leaves the row in its series.
- **D11 · A booking starts a session, and the session completes the booking.** `start_workout_session` gains `p_booking_id DEFAULT NULL` and stamps `workout_sessions.booking_id`. `complete_workout_session` sets that booking to `completed`. The outbox payload gains the optional field; replays that omit it behave exactly as today (PITFALLS O3 — the outbox and the RPC must agree, so the plan adds a test).
- **D12 · Writes are idempotent by client-generated id.** `create_booking` takes the new rows' ids from the app (one UUIDv7 for a single booking; the series parent's id for a series, children derived server-side). A retry after a dropped response returns the same booking instead of a second one. Same principle as M4a D1, without an outbox — booking is online-only.
- **D13 · Navigation.** A **Schedule** tab joins the PT tab bar (5 tabs). The client gets a Schedule tab too, which is My bookings with a Book button — today the client's bar has one tab, so this is the first second tab. On iPad (≥ `CONSOLE_MIN_WIDTH`) the PT's Schedule tab renders the week grid with the detail pane instead of the phone views.
- **D14 · Freshness by refetch on focus.** Schedule and My bookings refetch on focus (PITFALLS N12). No Realtime on bookings in M5a; the overlap constraint makes stale views safe — the worst case is "slot just taken".
- **D15 · Offline is read-only.** The last fetched schedule and bookings are cached through the M4b `KvStore`, shown under the design's "OFFLINE · SCHEDULE AS OF 08:12" banner. Every booking write requires a connection and says so. Start session from a cached booking still works, because session start already works offline (M4b).

## 4. Data and authorization — migration `0020_m5a_booking.sql`

### 4.1 Tables and columns

| Change | Detail |
|---|---|
| new `booking_rules` | `pt_user_id` PK/FK users, `lengths_min SMALLINT[]` (each in 30/45/60/90, non-empty), `buffer_min` 0–60, `window_weeks` 1–12, `cutoff_hours` 0–48, `updated_at`. Defaults = the design's: `{45,60,90}`, 15, 4, 12 |
| new `availability_exceptions` | `id`, `pt_user_id`, `on_date DATE`, `kind` `off`\|`hours`, `ranges JSONB` (array of `{start,end}`, required when `hours`), unique `(pt_user_id, on_date)` |
| `schedules` | unchanged. `slot_duration_min` is ignored (lengths come from `booking_rules`) |
| `bookings` | add `cancel_late BOOLEAN`, `cancel_counted BOOLEAN`, `cancel_reason TEXT`, `length_min SMALLINT` (what was booked; `ends_at` is derived), `created_by_user_id UUID`. Exclusion constraint per D7 |

Statuses M5a writes: `scheduled`, `completed`, `no_show`, `cancelled`. `checked_in` / `checked_out` are M5b's.

### 4.2 RLS (SELECT only — every write is an RPC)

| Table | Who reads |
|---|---|
| `schedules`, `availability_exceptions`, `booking_rules` | the owning PT; admins. Clients never read raw hours — they see slots through `open_slots` |
| `bookings` | the PT (`pt_user_id = auth.uid()`), the client (`is_client_record_owner(client_id)`), admins |

### 4.3 RPCs (all `SECURITY DEFINER`, `authenticated` only, audit-logged where an action exists)

| RPC | Who | Does |
|---|---|---|
| `save_availability(p_hours, p_exceptions, p_rules)` | PT | Replace-all for the caller (D1). Validates ranges don't overlap within a day. Returns which existing bookings now fall outside hours, for the exceptions list's flag |
| `open_slots(p_pt, p_from, p_to, p_length)` | the PT, or a client of that PT | D2/D3. Returns `{day, start_utc, local_time}` |
| `preview_series(p_start_local, p_length, p_every_weeks, p_count \| p_until)` | PT | D6 |
| `create_booking(p_id, p_client_id, p_start, p_length, p_every_weeks, p_count, p_until)` | PT for any of their clients (incl. self); client for themselves, single only | D5/D7/D12. Client path also checks the slot is in `open_slots` and inside the window |
| `reschedule_booking(p_id, p_new_start, p_scope)` | PT; client outside cutoff, single only | D10 |
| `cancel_booking(p_id, p_scope, p_counted, p_reason)` | PT; client outside cutoff | D8 |
| `mark_no_show(p_id)` | PT, ≥ 15 min after start | D9 |
| `start_workout_session(…, p_booking_id)` / `complete_workout_session` | as today | D11 |

Typed errors (`slot_taken`, `outside_hours`, `inside_cutoff`, `outside_window`, `too_early_for_no_show`, `series_too_long`) map one-to-one to screen copy.

## 5. Screens

All copy, states and variants come from the design. Each screen ships Loading / Empty / Error / Offline from the design's `COPY` table.

| Screen | Route | Notes |
|---|---|---|
| Schedule (PT) | `(tabs)/schedule` | Day / Week / Month segmented. Day opens on today with the now line; open gaps are dashed rows that open Create booking at that time. ME bookings hatched. Google overlap line is M5c — the row component takes an optional note so M5c only feeds it |
| Schedule (iPad) | same route, wide | Week grid from today, block height = length, selection fills the right pane with Booking detail |
| Availability | `schedule/availability` | Hours / Exceptions / Rules tabs, one Save. Day toggle, time-range pills, ± steppers reused from body metrics |
| Create / edit booking | `schedule/booking-new`, `schedule/booking/[id]/edit` | Client → length → day strip (open counts) → slot grid → repeat. Recurring lists every date from `preview_series` and flags DST. Edit opens the scope sheet |
| Booking detail | `schedule/booking/[id]` | Start session (sole accent), program link, reschedule, cancel (late-cancel sheet inside cutoff), no-show (locked until +15 min) |
| Book a session (client) | `schedule/book` | Lengths from the PT's rules, day strip, slots, policy line beside Book. Slot taken / no slots this week (jump to next opening) |
| My bookings (client) | `(tabs)/schedule` for clients | Next session expanded with exact cancel deadline; too-late state; past rows (rating/receipt links arrive in M5b) |
| Admin | web `admin/users/[id]` | Read-only bookings list per PT/client with status and late/counted flags |

**New design-system pieces** (from the design's own gap notes; built once, used by M5b/M5c too): six booking-state tokens (light + dark), `CalendarBlock`, `OpenGapRow`, `MonthCell`, `Toggle`, `TimeRangePill`, `DayStrip`, `SlotGrid`. `docs/DESIGN_SYSTEM_GAPS.md` gets updated.

## 6. Code layout

- `supabase/migrations/0020_m5a_booking.sql` — tables, constraint, RLS, RPCs.
- `packages/shared/src/schedule/` — zod schemas for RPC inputs/outputs, the typed-error map, date-label helpers (no tz math), state→token map. Vitest.
- `packages/shared/src/offline/` — outbox payload gains optional `booking_id` (D11).
- `apps/mobile/src/features/schedule/` — hooks (`useSchedule`, `useAvailability`, `useOpenSlots`, `useMyBookings`) and the new components.
- i18n keys in `en.json` / `ar.json`, with no-name variants for every `{{name}}` (PITFALLS I3).

## 7. Errors

- Every typed error has its own copy; unknown errors fall back to the design's "didn't load / nothing was booked" copy.
- `slot_taken` keeps the chosen day and length and refetches slots, highlighting the nearest (design: Book · Slot taken).
- A save that leaves bookings outside new hours succeeds; the bookings stay and are flagged in Exceptions (design note on Availability).

## 8. Verification

The four layers that gated M4:
1. **SQL** — `db/rls_assertions.sql` gains booking cases: client A can't read client B's bookings; a client can't read raw hours; client cancel inside cutoff fails; no-show before +15 min fails; two overlapping creates → one `slot_taken`; a weekly series across 2026-10-25 (Beirut DST end) keeps local 10:30 and shifts UTC; buffer respected in `open_slots`.
2. **Vitest** — shared schemas, error map, outbox payload with and without `booking_id`.
3. **Typecheck / lint / test** in CI.
4. **`forge-screen-walk`** on the web target: PT sets hours → client books → PT sees it → PT cancels late (counted) → client sees it; recurring create with DST warning; Start session from a booking → complete → booking completed; iPad width week grid.

RTL can't be verified on web (PITFALLS V5); Arabic copy is checked by key coverage only.

## 9. Out of scope (later sub-milestones)

- M5b: QR check-in/out, scan, rating/comment/tip sheet, receipt and session price, reminder settings.
- M5c: Google Calendar, conflict line, `.ics`.
- Later: group classes (`class_id`), gym locations (`gym_id`), sending reminders (M9 push), money for counted late cancels (M6), Realtime on bookings.

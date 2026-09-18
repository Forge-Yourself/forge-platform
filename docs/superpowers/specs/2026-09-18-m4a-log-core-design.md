# M4a · Log Core — Design

**Date:** 2026-09-18
**Scope:** The first of four M4 sub-milestones. PT-led and client self-logged set logging, online, through idempotent RPCs; the phone logging screen with rest timer and PR moment; session history for both personas; an admin session inspector. No offline store, no live mirror, no body metrics, no iPad or voice.
**Parent:** `2026-09-09-forge-v1-implementation-design.md` §5 M4 (EP-05, EP-06). Prototype artboards `timer`, `lock`, `ipad_console`; design-system mockup 04 (PT-led logging).

---

## 1. Why M4 is cut in four

The M4 line in the v1 spec names eight subsystems: offline SQLite with outbox, idempotent sync, Realtime mirror, rest timer surviving screen lock, RPE and notes, voice, iPad console with switcher, PR detection plus body metrics plus photos. Half of them are native-only (SQLite, speech, Live Activity, camera) and cannot be exercised on the Expo web target this project develops against; the other half are testable today. One spec would mix both and ship nothing until all of it works.

| Sub-milestone | Scope | Depends on |
|---|---|---|
| **M4a · Log core** (this spec) | Partition automation, RLS and RPCs on the logging tables, phone logging screen, RPE and notes, PR detection, in-app rest timer, session history, admin inspector. Online writes. | M3 |
| M4b · Offline and mirror | `expo-sqlite` outbox replaying the M4a RPCs, sync, the PT-vs-client conflict rule beyond RLS denial, Supabase Realtime live mirror, offline chip and sync-pending queue view. | M4a |
| M4c · Body | Body metrics entry, trend charts and plateau flag, progress photos with pose guides, side-by-side compare, the encryption decision. | M4a |
| M4d · Floor ergonomics | iPad three-pane console, multi-client switcher, voice logging, Live Activity lock-screen timer. All need dev-client builds. | M4a, M4b |

M4a is designed so M4b slots in underneath it: every write is a client-keyed, idempotent RPC that an outbox can replay verbatim.

## 2. State of the ground

- `workout_sessions`, `sets` (partitioned by month, ULID PK), `exercise_prs`, `body_metrics`, `progress_photos` exist since `0001_baseline`. **No RLS policy exists on any of them** — the same gap M3 found on the programming tables. `0003_rls` enabled RLS on every table but wrote policies for seven.
- `sets` has no `logged_by_user_id` and no `notes`. `workout_sessions.logged_by_user_id` records who started the session, which is not who logged each set once a client can self-log into a PT-led session.
- FKs out of `sets` are app-enforced (partitioned table). Nothing enforces them today.
- Monthly partitions on `sets`, `food_logs`, `notifications`, `audit_logs` exist on the live project through `2027-06`, but **no migration created the ones after `2026-10`** — they were made out of band. Repo and database disagree. `pg_cron` 1.6.4 is available and not enabled.
- `0007`'s `save_program` replaces a program's children on save. `workout_sessions.program_day_id` is `ON DELETE SET NULL`, so rebuilding a week orphans any session that pointed at it (the "LANDMINE for M4" note in `0007`).
- `chk_audit_logs_action` already permits `workout_start`, `workout_complete`, `workout_review`. No new audit action is needed.
- The client-detail screen already pins a Start session button to the bottom third, gated on a submitted intake, with copy "Session logging arrives in a later update."
- `ui/NumericKeypad` exists with an `extraKey` slot, built for M4 weight entry. `ExerciseLibrary` exposes `onSelect(exerciseId)`, usable as a picker.
- `users.unit_system` is `metric | imperial`. All weights are stored in kg.
- Exercises carry no measurement type. Of 205: 13 cardio, 11 isometric, 15 stretch; the rest are load × reps movements.

## 3. Decisions

- **D1 · RPC write path, idempotent by ULID.** The app generates the set's ULID and calls `log_set`; the RPC upserts on `id`, so the same call twice yields one row. Rejected: direct PostgREST inserts with triggers (PR result not returned to the caller, FK-check triggers fire per partition, trigger logic is harder to test than a function) and SQLite-first now (contradicts the split, and `expo-sqlite` on web is experimental).
- **D2 · Both personas log in M4a.** EP-05 says the client can self-log but cannot overwrite PT data. Per-set attribution (`sets.logged_by_user_id`) carries that rule now, in RLS and in the RPCs, before offline makes retrofitting it hard.
- **D3 · Load × reps only.** One log layout, one keypad flow. Bodyweight, isometric and stretch movements log reps with weight empty. `distance_m` and `duration_sec` stay unused until cardio content needs them; no schema change then, because the columns exist.
- **D4 · One in-progress session per client.** `start_workout_session` returns the existing in-progress session if there is one. That is cross-device resume for free, and it is what makes "both personas log into the same session" coherent.
- **D5 · PR detection inside `log_set`.** Atomic with the insert, one round trip from Lebanon to Frankfurt, result returned inline for the celebration moment. Rule in §4.4.
- **D6 · The repo owns partitions.** One function creates twelve months ahead for all four partitioned tables with `IF NOT EXISTS`, adopting the out-of-band ones; `pg_cron` runs it monthly. Rejected: `pg_partman`, whose naming template (`sets_p2026_05`) does not match the existing `sets_2026_05` partitions and would mean a parallel scheme.
- **D7 · Snapshot the day label.** `workout_sessions.day_label` is written at start so history still reads "Push · Week 3" after `program_day_id` is nulled by a week rebuild. Sets carry `exercise_id`, so the set list survives regardless. Fixing `save_program` to diff-and-patch is out of scope.
- **D8 · One session route, state-driven.** `/(app)/sessions/[id]` renders the logging UI while `in_progress` and the read-only summary once `completed`, for both personas. Two entry points, one screen (PITFALLS N13). Rights come from the data, never from the role string.

## 4. Data and authorization — migration `0015_m4a_logging.sql`

### 4.1 Columns

| Table | Column | Why |
|---|---|---|
| `sets` | `logged_by_user_id UUID NOT NULL` | Per-set attribution; drives edit rights (D2). |
| `sets` | `notes TEXT` | EP-05 requires a note per set. |
| `workout_sessions` | `day_label TEXT` | D7 snapshot. |

No other schema change. `is_synced`, `synced_at`, `conflict_resolved`, `device_id` on `sets` are written by M4b; M4a sets `is_synced = TRUE` and `synced_at = NOW()` on every server write so M4b's unsynced index means what it says.

### 4.2 Session rules

- Statuses used: `in_progress`, `completed`. `programmed`, `today`, `reviewed`, `skipped` are untouched by M4a.
- `is_pt_led = TRUE` when the PT starts the session; `FALSE` when the client does.
- Either party logs into whichever session is in progress for that client.
- Completing: the PT of the client may complete any session; the client may complete only one with `is_pt_led = FALSE`.
- There is no abandon action. A stale in-progress session is completed by whoever opens it next.

### 4.3 Set rights

| Actor | Insert | Update / delete |
|---|---|---|
| PT of the client (`is_pt_of_client`) | any set in the client's sessions | any set |
| Client (`is_client_record_owner`) | into own client's sessions | only where `logged_by_user_id = auth.uid()` |

The same rule is written twice — RLS policies for direct reads and any future direct write, and explicit checks inside the RPCs — and tested on both sides (PITFALLS R1).

### 4.4 RPCs

All `SECURITY DEFINER`, `SET search_path = public, extensions`, `EXECUTE` revoked from `PUBLIC, anon`, granted to `authenticated`.

- `start_workout_session(p_client_id UUID, p_program_day_id UUID DEFAULT NULL) RETURNS workout_sessions`
  Authorizes as PT-of-client or client-owner. Returns the existing `in_progress` row for the client if one exists (D4). Otherwise inserts with `status = 'in_progress'`, `started_at = NOW()`, `is_pt_led` from the caller's relationship, `day_label` snapshotted from the day's label and week number, and writes a `workout_start` audit row.
- `complete_workout_session(p_session_id UUID, p_rating SMALLINT DEFAULT NULL, p_notes TEXT DEFAULT NULL) RETURNS workout_sessions`
  Rights per §4.2. Sets `completed_at`, `duration_min`, `status = 'completed'`, rating and notes (client notes → `session_notes`, PT notes → `pt_notes`). Already completed → returns the row unchanged, no error. Writes `workout_complete`.
- `log_set(p_id CHAR(26), p_session_id UUID, p_exercise_id UUID, p_set_number SMALLINT, p_weight_kg NUMERIC, p_reps SMALLINT, p_rpe NUMERIC, p_notes TEXT, p_is_warmup BOOLEAN, p_device_id TEXT) RETURNS TABLE (set_row sets, new_prs TEXT[])`
  Validates the ULID shape, that the session exists and is `in_progress`, that the exercise exists and is active, and the caller's rights. `INSERT … ON CONFLICT (id, created_at) DO UPDATE` — the upsert must carry the original `created_at`, so on conflict the function first reads the existing row's partition key by `id`; a replayed ULID therefore lands on the same row. On a first insert (not an update) of a non-warmup set, evaluates PRs and inserts `exercise_prs` rows. Returns the row and the PR types hit.
- `delete_set(p_id CHAR(26)) RETURNS VOID`
  Rights per §4.3. Hard delete. PRs are not re-evaluated (documented limitation).

Reads are plain PostgREST under RLS: a client's sessions, a session with its sets and exercises, the last completed set for a client × exercise (the "Last:" line).

### 4.5 PR rule

Per client × exercise, non-warmup sets only, evaluated on first insert:

| `pr_type` | New PR when |
|---|---|
| `weight` | `weight_kg` exceeds the max `weight_kg` on record |
| `reps` | `reps` exceeds the max `reps` on record |
| `volume` | `weight_kg × reps` exceeds the max single-set volume on record |

"On record" means `exercise_prs` for that type, falling back to a scan of the client's sets when no PR row exists yet. Each hit inserts one `exercise_prs` row with `set_id`. Editing or deleting a set never re-evaluates.

### 4.6 Partitions

- `ensure_month_partitions(p_months_ahead INT DEFAULT 12) RETURNS VOID`, `SECURITY DEFINER`, owner-only. For each of `sets`, `food_logs`, `notifications`, `audit_logs`: `CREATE TABLE IF NOT EXISTS <table>_YYYY_MM PARTITION OF <table> FOR VALUES FROM (month) TO (next month)` from the current month forward. Idempotent, so it adopts the out-of-band partitions.
- `CREATE EXTENSION IF NOT EXISTS pg_cron`; `cron.schedule('ensure_month_partitions', '0 3 1 * *', $$SELECT public.ensure_month_partitions()$$)`.
- The migration calls the function once.

### 4.7 RLS

`workout_sessions`: select for PT-of-client, client-owner, admin. No direct insert/update/delete — RPC-only, the approach `0014` took for `clients`.
`sets`: select for the same three. Insert/update/delete revoked at table level; RPC-only.
`exercise_prs`: select for the same three; writes RPC-only.
`body_metrics`, `progress_photos`: untouched, still default-deny, M4c.

## 5. Session lifecycle and navigation

### 5.1 Entry points

- **PT:** client detail → Start session. Gated as today on a submitted intake. The Today screen shows a **Resume** banner when any of the PT's clients has an in-progress session, naming the client.
- **Client:** Today → **Start workout** card when an active program exists, otherwise a smaller "Start a freestyle workout" row. The same Resume banner when their own session is in progress.

### 5.2 Start sheet

Bottom sheet, both personas.

- Lists the active program's days for the current week. Week = weeks elapsed since `programs.start_date`, plus one, clamped to `[1, duration_weeks]`; no `start_date` → week 1. The computation lives in `packages/shared` and is tested.
- A day row shows a check when a `completed` session already points at its `program_day_id`. The first unchecked day is pre-highlighted.
- Last row: **Freestyle session** (no program day).
- No active program: freestyle only. Copy for the PT: "No program assigned yet — assign one" with "assign one" tappable to the assign flow (PITFALLS N14). Copy for the client: "Your coach hasn't assigned a program yet."
- Tap → `start_workout_session` → `router.replace` to `/(app)/sessions/[id]` (PITFALLS N3). If the RPC returned an existing session, the sheet says "Resuming Tuesday's session" for a beat and continues.

### 5.3 Session screen `/(app)/sessions/[id]`

- Data: the session row, its sets, the program day tree (via `program_tree` filtered to the day) when `program_day_id` is set, and the "Last:" set per exercise.
- Exercise list = the program day's exercises in block order, then any exercise that has a set in this session but is not in the day (added ad hoc). Freestyle starts empty.
- **Add exercise** opens `ExerciseLibrary` in a modal with `onSelect`; the pick appends to the list. Nothing is written until a set is logged against it.
- Finish → summary sheet (rating 1–5, session note) → `complete_workout_session` → the same route re-reads and renders the completed state.
- Back mid-session leaves the session in progress. Header Back uses `dismissTo` (PITFALLS N15).

### 5.4 History

- Client detail: a **Sessions** section between Intake and Manage, last 3, "See all" → `/(app)/clients/[id]/sessions`.
- Client Today: **Recent workouts**, last 3, "See all" → `/(app)/my-sessions`.
- Rows: day label or "Freestyle", date, set count, "Coach" tag when `is_pt_led`. Tap → the session route.

### 5.5 Units

Stored kg. Displayed in `users.unit_system`. `kgToDisplay` / `displayToKg` in `packages/shared`, rounding to 0.5 for display and storing the exact kg value. Steppers move ±1 / ±5 in the display unit.

## 6. The logging screen

Design-system mockup 04 is the reference; the prototype has no phone logging artboard for M4.

### 6.1 Anatomy

- **Header:** client display name (PT) or program name (client); elapsed time in mono; Finish as a text action on the trailing edge. No live-mirror badge — M4b.
- **Focus card:** exercise name; "Set 3 of 4" (target sets from the program, or the count so far in freestyle); weight × reps in large mono; "Last: 95 kg × 8 · RPE 7" from the client's most recent completed set on this exercise, or "First time" when none. Tapping weight or reps opens `NumericKeypad` in a bottom sheet — `extraKey` "." for weight, none for reps. Below the numbers: `SetStepper`, four keys −5 −1 +1 +5 in the display unit.
- **RPE row:** `SegmentedPill` of 6 · 7 · 8 · 9 · 10 plus a leading "—" for skip. Values under 6 are enterable through the edit sheet, not the pill.
- **Note:** a "Note" chip that expands a one-line `TextField`.
- **Previous sets** for this exercise in this session, as read-only `BuilderRow`s. Tap → edit sheet (same keypad, RPE, note, warm-up toggle, Delete). A client sees PT-logged sets with a "Coach" `Tag` and no edit affordance; the RPC denies anyway.
- **Exercise rail:** horizontal `ChipRow` of the session's exercises, current highlighted, trailing "+" for Add exercise. Chips follow the RN chip-height rule already in memory.
- **Log this set:** 56pt accent button in `FooterBar`. Pre-filled with the previous set's weight and reps (or the program target for the first set), so the fast path is one tap and the ≤2-tap acceptance holds. Generates the ULID, calls `log_set`, appends the row optimistically, then reconciles.

### 6.2 Rest timer

Prototype `timer` artboard, in-app only.

- Auto-starts after Log with the exercise's `rest_sec`, default 90 s. Full-screen dark surface regardless of theme; 52 px mono time; the ring is a secondary cue.
- States: running, paused, complete. Controls: Pause / Resume (primary, 56 pt), +30 s, Skip rest.
- At zero: audio cue via `expo-audio`, haptic via `expo-haptics`; both guarded so the web target no-ops (PITFALLS W4). `expo-keep-awake` is active while the session screen is mounted.
- Dismiss returns to the focus card with the set number advanced.
- Lock-screen persistence and Live Activity are M4d. The timer stops if the app is killed; that is a stated M4a limitation.

### 6.3 PR moment

`log_set` returns `new_prs`. When non-empty, `PrBanner` slides over the focus card for 2.5 s — "New weight PR · 102.5 kg" — with a success haptic. Never a modal; logging continues underneath. The summary state lists every PR hit in the session.

### 6.4 Completed state

Same route. `StatTile` row: duration, sets, total volume, PRs. Exercise list with sets as read-only `BuilderRow`s. Rating as five dots, notes below. Header Back → history.

### 6.5 Components

New in `ui/`: `RestTimer`, `SetStepper`, `PrBanner`. Everything else reuses `NumericKeypad`, `SegmentedPill`, `BuilderRow`, `ChipRow`, `FooterBar`, `StatTile`, `Tag`, `Banner`, `EmptyState`, `Skeleton`. All three new components go into `DESIGN_SYSTEM_GAPS.md`.

### 6.6 Shared package

- Schemas: `logSetSchema` (weight 0–500 kg optional, reps 0–200 optional, at least one of them present, RPE 1–10 in 0.5 steps optional, notes ≤ 280), `completeSessionSchema` (rating 1–5 optional, notes ≤ 1000).
- Helpers: `kgToDisplay`, `displayToKg`, `currentWeekNumber`, `formatElapsed`, `sessionVolume`, `mapLoggingError` (SQLSTATE → i18n key: `42501` denied, `23514` validation, `P0001` custom message, else generic).
- The PR rule mirrored in TS for the summary's PR list and tested against the same fixtures as the SQL harness (R1).
- i18n: every new key in `en.json` and `ar.json` in the same order (I1); every `{{name}}` has a no-name variant (I3).

### 6.7 Dependencies

`expo-keep-awake`, `expo-haptics`, `expo-audio`, `ulidx`, `expo-crypto` (random source for `ulidx` on native).

## 7. Errors

- `log_set` fails → the optimistic row flips to an inline retry state, inputs preserved. Copy names the cause: offline ("You're offline. This set stays on screen — retry when you're back."), denied ("Only your coach can change this set."), generic. Never a modal. M4b turns the offline branch into the outbox.
- `start_workout_session` returning an existing session is a resume, not an error (§5.2).
- `complete_workout_session` on an already-completed session is a success; the route re-reads.
- A failed PR banner never blocks the logged set.
- Session id RLS hides → `EmptyState` with Back via `dismissTo`.

## 8. Admin web

- `/admin/users/[id]` gains a Sessions table for a client: date, day label, logged by, sets, duration, PRs. Row → `/admin/sessions/[id]`: read-only set list with attribution. Service-role reads, same pattern as the program inspector.

## 9. Testing

- **SQL harness** (`db/rls_assertions.sql`): PT starts and logs; second start returns the same session; client logs into a PT-led session; client cannot update or delete a PT set (RLS and RPC); client edits own set; cross-PT read and write denied; ULID replay yields one row; weight, reps, volume PR detection and no PR on a warm-up; client cannot complete a PT-led session; completing twice is a no-op; `day_label` survives nulling `program_day_id`; `ensure_month_partitions` is idempotent and covers all four tables.
- **Shared** (vitest): schemas, unit conversion round trips, `currentWeekNumber` edge cases (no start date, before start, past end), `formatElapsed`, `mapLoggingError`, PR rule fixtures.
- **Mobile** (`forge-screen-walk`, web target, both `@forge.dev` roles): PT: client detail → start → log three sets → timer → finish → summary → history row → summary. Client: Today → start → log → finish; open a PT-led session and confirm Coach sets are read-only. Screenshots kept (V1).
- **Live DB** (psql, read-only): `sets`, `exercise_prs`, `audit_logs` rows after the walk (N5).

## 10. Out of scope, by name

- Offline SQLite outbox, sync, conflict rule beyond RLS denial, Realtime live mirror, offline chip, sync-pending queue → M4b.
- Body metrics, progress photos, encryption → M4c.
- iPad console, multi-client switcher, voice, Live Activity lock screen → M4d.
- Timed and distance sets; session `reviewed` state; PR re-evaluation on edit or delete; an abandon-session action; `save_program` diff-and-patch; "today's bookings first" (needs M5 bookings).

## 11. Corrections to source documents

- Prototype `timer` artboard says "Skip rest", `lock` artboard says "Skip". In-app copy is **Skip rest**.
- Client-detail copy "Session logging arrives in a later update." is removed; the button starts a session.
- `CLAUDE.md`'s M4 row becomes four rows on M4a completion.

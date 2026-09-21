# M4e — PT self-training ("Me" client record)

**Status:** complete (2026-09-20). Branch: `feature/m4d-floor`.

## Why

A PT could coach, programme and measure other people but could not be a
*subject* in Forge. Their own weight, photos and workouts had nowhere to live.
This closes that, and gives a trainer a zero-risk place to learn the
client-facing half of the product on their own data.

## The finding that shaped the work

The database already permitted it. Every write predicate in M3, M4a, M4b and
M4c is the same disjunction —

```sql
public.is_pt_of_client(p_client_id) OR public.is_client_record_owner(p_client_id)
```

— and neither helper reads `users.role` (`0003_rls.sql:66-90`). A `clients` row
with `pt_user_id = client_user_id` satisfies *both* disjuncts, so
`record_body_metric`, `start_workout_session`, `log_set`,
`complete_workout_session`, `record_progress_photo`, `set_photo_shared`,
`assign_program` and the `progress-photos` `storage.objects` policies all accept
it unchanged. `clients` carries no `CHECK (pt_user_id <> client_user_id)` and no
unique index (`0001_baseline.sql:314-345`).

So **no permission migration was needed**. `0019` adds only the row's creation
and its guard rails, and `db/rls_assertions.sql` proves each accepting RPC
rather than leaving it inferred from the predicates.

## Decisions

- **Full client mode** — body metrics, photos, own logging, self-assigned
  programmes, and a self home screen.
- **`users.role` stays a single scalar.** No multi-role work. A PT keeps the PT
  shell and the PT affordances (voice, swap, editable sets) while training
  themselves: they *are* coaching themselves.
- **No intake / PAR-Q on the self record.** `intake_progress` returns no row,
  `useClientDetail` uses `maybeSingle`, and the UI renders "not started"
  without crashing — verified, not assumed.
- **Self sessions are `is_pt_led = true`**, notes in `pt_notes`. That is what
  the server infers and what `SessionSummary` reads back for a `role='pt'`
  viewer. See the pitfall below — this is load-bearing, not incidental.
- **Creation is lazy and opt-in.** A PT who never taps "Start training myself"
  gets no row, so nothing appears in their roster, counts or pickers.
- **`/me` is its own route**, not a self-branch inside `clients/[id]`. That
  screen gates Start on `hasSubmittedIntake`, which the self record
  deliberately lacks, so reuse would leave a PT permanently unable to start
  their own session. Five further sections would need `isSelf ?` wrappers —
  the same line count as a new screen, with six places where a later change to
  client detail silently applies to a record nobody reviewed it against
  (PITFALLS N13).
- **A self session still joins the iPad `ConsoleShell` and the floor rail.**
  Deliberate: a PT training between clients on the gym iPad is M4d's case, and
  the rail is how they get back to it. Recorded in `/me`'s header comment so it
  is not "fixed" later.

## Corrections this work makes to the original sketch

- **The self row must leave `useClientList.items`, not merely sort first.**
  `usePtDashboard` (`:134-137`) counts every active client with no signed
  waiver as "awaiting intake". The self record has no intake *by design*, so
  that tile would have read ≥ 1 forever and "Needs you" would have carried a
  row titled with the PT's own name.
- **The pinned "Me" row renders above the empty/no-match ternary.**
  `clients.tsx` is `isEmpty ? … : isNoMatch ? … : <list>`; a PT who only trains
  themselves has an empty roster by definition, so a row inside the list branch
  would be invisible in exactly the state that needs it.
- **`set_client_state`'s guard is not a security control.** Neither helper
  reads `state`, so a paused self row would still log and read. The reason to
  refuse it is that `assign.tsx:69` filters to `active|accepted`, so pausing
  would silently remove the self record from the only screen that can give it a
  programme.
- **`invite_client` needed its own guard.** A PT inviting their own address
  creates a row with `client_user_id IS NULL`, which `uq_clients_self` cannot
  see and `claim_client_invites` never reaches (it only ever runs from the
  client home screen). The result would have been a permanent, unclearable
  "Needs you" entry.
- **`viewerIsClient` was left alone.** The original sketch wanted a
  cross-cutting `isOwnRecord`. Most of its call sites already handle the self
  case correctly (`recordedBy === auth.user?.id` is true for a self row), and
  two would have got *worse* — the photo list's "private" shield would paint on
  every self photo forever. Only the camera facing, the capture note and the
  back destination are genuine third cases.
- **`warmCache` needed nothing.** `fetchRoster` still returns the self row, so
  the existing active-client loop already warms `client:`/`week:`/`last:` for
  it.
- **`usePtFloor.live` must NOT filter the self session out.** `usePtFloor:137`
  calls `restStore.keepOnly(live.map(...))`, so hiding it there would prune the
  PT's own rest clock on every floor load. Only the rendered *name* changes.

## As built

**SQL — `supabase/migrations/0019_self_client.sql`** (applied to the live
Frankfurt project, verified with `to_regprocedure` + `pg_get_functiondef`)

| Object | What |
|---|---|
| `uq_clients_self` | partial unique index — one self row per PT |
| `ensure_self_client()` | the only creator; PT-only, idempotent, `state='active'`, no `intake_forms` row |
| `set_client_state()` | + self-row guard (see Corrections) |
| `invite_client()` | + own-address guard |

`ON CONFLICT` repeats the index predicate — inference against a partial unique
index fails without it, and a bare `ON CONFLICT DO NOTHING` would swallow a PK
collision too. `RETURNING` yields no row on conflict, hence insert-then-select.

**Shared** — `packages/shared/src/clients/selfClient.ts`: `isSelfClientRow`,
`splitRoster`, with 9 vitest cases. The rule lives in one tested place because
the same mistake is easy to make in several screens and only one fails loudly.

**Mobile**

- `AuthProvider` gains `selfClientId`, read alongside `pt_profiles` in the
  existing `role === 'pt'` branch and cached in the `profile:<id>` KV payload.
- `lib/clients/ensureSelfClient.ts` — RPC then `refreshAuthProfile()`. The
  second call is load-bearing: an RPC fires none of the auth events
  `loadProfile` listens for.
- `app/(app)/me/index.tsx` — the hub. `app/(app)/me/sessions.tsx` — full
  history, sharing `lib/logging/SessionHistoryScreen.tsx` with client detail.
- `StartSessionSheet` gains `onNoProgram` — its default pushes the Programs
  *tab*, which mounts a second tab navigator from under a pushed screen (N9).
- `clients/[id]` redirects to `/me` for the self row; `bodyBack` takes a
  three-way `BodyOrigin`; `useSessionController` gains `subjectName`.
- Entry points: a card on PtHome (the only place that can create the row) and a
  row on `profile.tsx` (only once it exists).

## Verification

| Layer | Result |
|---|---|
| Migration | applied; all four objects confirmed on the live DB |
| RLS harness | **238 assertions pass, 0 fail** (~30 new) |
| typecheck / lint / test | all green; **396 unit tests** |
| Screen walk | 13 + 4 + 2 steps, 1 scripted-assertion miss (probe sliced too few chars — the header does read "Me"), no page errors |

The walk exercised, on `pt.test@forge.dev`: opt-in → `/me`; dashboard counts
unchanged afterwards; the pinned Me row in the empty *and* no-match states with
the denominator excluding it; a freestyle self session logged, finished, PR
detected, summary reading "Me · Freestyle"; a weight recorded; the capture
screen showing the self note and no share toggle; `clients/<selfId>`
redirecting; a cold `/me` with a working Back; **and the offline leg** — a
session started with the signal cut, drained on reconnect, read back from psql
as `is_pt_led = true`.

Also found while harnessing: `db/rls_assertions.sql` asserted
`app_config.offline_logging = "off"` against the *live* row, which sits at
`"beta"` whenever offline logging is being tested. Now pinned inside the
transaction (which ends in `ROLLBACK`, so the live value is untouched).

## Known limitations, stated not fixed

- **Master PT visibility (M7).** `is_pt_of_client` also matches an active
  `client_pt_assignments` row. Nothing creates one for a self row today, so a
  Sub-PT's own photos stay private — but a future Master bulk-assign could
  expose them. Flag in the M7 spec.
- **Web admin** branches `role === 'pt'` vs `'client'` as disjoint cases, so a
  self-training PT's own sessions and metrics are invisible to staff.
- **`useInProgressSession` is singular** (`limit(1)`, most recently started). A
  PT with a client mid-session *and* their own running sees whichever started
  last on Today. Pre-existing; self-training makes it likely rather than
  theoretical.
- **The post-finish summary renders its note one fetch late.** Pre-existing
  M4a staleness, not introduced here: the note is in `pt_notes` immediately and
  appears on any reload.
- **RTL layout for `/me` is unverified.** `react-native-web`'s `I18nManager` is
  a no-op, so the web walk proves Arabic copy only (PITFALLS V5).

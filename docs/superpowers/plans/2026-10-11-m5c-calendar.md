# M5c · Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PT connects Google Calendar so bookings are copied into a "Forge sessions" calendar and ticked calendars' busy times close booking slots; overlaps show on the schedule and on a review screen; a PT exports four weeks as `.ics` and a client adds a new booking to their own calendar.

**Architecture:** Migration `0022` adds six tables (connection, sealed tokens, OAuth states, busy blocks, sync queue, kept overlaps), a trigger that queues booking changes for connected PTs, a busy-aware `open_slots`, PT RPCs (`calendar_overlaps`, `set_busy_calendars`, `keep_overlap`) and service-only RPCs (`google_replace_busy`, `google_enqueue_all`, `google_queue_batch`). `apps/web/lib/google/` holds the OAuth client, the Calendar REST client and the sync orchestrator behind injected `fetch` and a `SyncStore` interface, tested with vitest; five thin routes use them. `packages/shared/src/calendar/` holds `buildIcs` and the overlap/title helpers. Mobile gets Calendar sync and Overlaps screens, a header button, schedule notes, export and "Add to my calendar".

**Tech Stack:** Supabase Postgres (plpgsql), Next.js 16 route handlers, Node `crypto` (AES-256-GCM, PKCE), Google OAuth 2.0 + Calendar API v3 over `fetch` (no `googleapis` dependency), vitest 2, Expo SDK 57 (`expo-web-browser`, `expo-file-system`, `expo-sharing`).

**Spec:** `docs/superpowers/specs/2026-10-11-m5c-calendar-design.md` (D1–D19). Design: `docs/Forge M5 Scheduling.html` screen 06, the overlap note on 01, "Add to my calendar" on 09. Tracker: `docs/M5_Scheduling.md`. The user waived review of spec and plan; record deviations in **As built**.

## Global Constraints

- Scopes exactly: `openid email https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly`; `access_type=offline`, `prompt=consent`, PKCE S256.
- Env (Vercel only): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_KEY` (base64 of 32 bytes), optional `GOOGLE_REDIRECT_ORIGIN`. A missing var makes connect answer 503 `not_configured`; nothing else breaks.
- Sealed token format: `v1.<iv b64url>.<ciphertext b64url>.<tag b64url>`, 12-byte IV.
- Event id: `'forge' + bookingId.replace(/-/g, '')` (lowercase).
- Title: `Forge · <first word of display name>`, self → `Forge · Me`, no name → `Forge · Session`.
- Sync horizon: now − 1 day … now + 12 weeks. Busy refresh when `busy_refreshed_at` is null or older than 5 min, or forced. Queue batch 50; a row with `attempts >= 5` is skipped.
- `returnTo` accepted only if it starts with `forge://` or its origin passes `isOriginAllowed`.
- No table in this migration grants INSERT/UPDATE/DELETE to `anon`/`authenticated`; tokens and states grant nothing at all.
- `.ics`: CRLF line ends, lines folded at 75 octets, `PRODID:-//Forge//Schedule//EN`, `UID:<booking id>@forge.app`, `DTSTAMP`/`DTSTART`/`DTEND` in UTC `YYYYMMDDTHHMMSSZ`, TEXT escaped (`\\`, `\;`, `\,`, newline → `\n`).
- Screens: own `NavHeader` + `router.dismissTo` back (N1/N15); refetch on focus (N12); newest load wins (O1); every `{{name}}` has a no-name variant (I3); en/ar key parity; native-only modules required conditionally with a web path (R1/R3).

## Review Focus

1. **An all-day Google event** (a holiday) — blocks that whole local day in the PT's zone, not a UTC day. Test: Task 1 (`google_replace_busy` with `start_date` → no slot that day).
2. **A free ("transparent") or declined event** — must not block anything. Test: Task 3 (`busyFromEvents` drops both).
3. **Google revokes access mid-life** — one `invalid_grant` flips the link to `error` once (the first `error_at` is kept), the queue keeps growing, and a reconnect drains it. Test: Task 3 (`syncPt` with a refresh that returns `invalid_grant`, then with a good one).
4. **A cancelled-then-recreated booking whose event was deleted** — Google answers `PUT` 404 and the insert 409 (deleted ids stay reserved); the sync must still end with the event confirmed. Test: Task 3 (`putEvent` 404 → insert 409 → `PUT` retried).
5. **A client reading Google data** — busy titles, links, queue: zero rows; `open_slots` still hides the time. Test: Task 1.

---

## Context

- Branch `feature/m5c-calendar` is cut from the unmerged `feature/m5b-check-in` @ `09b3720` (which contains M5a).
- Harness end state: `:'pt_a'`, `:'pt_b'`, `:'client_b'` (client of pt_a via `:'cb_row'`), `:'client_row'`, `:'admin_a'` exist; `pt_a` publishes 06:00–12:00 and 15:00–20:00 every day, lengths 45/60/90, buffer 15; helpers `pg_temp.expect`, `expect_error`, `expect_raises`, `expect_rls_block`, `act_as`.
- `open_slots` must keep its exact signature `(UUID, DATE, DATE, SMALLINT, UUID)` so grants and generated types stay.
- Mobile has no test runner: logic with branches goes to `packages/shared` (vitest). `apps/web` gains vitest in this milestone.
- `CalendarBlock` already takes `note` + `noteTone: 'muted' | 'warn'`.

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0022_m5c_calendar.sql` | tables, trigger, RLS, RPCs, busy-aware `open_slots` |
| `db/rls_assertions.sql` | M5c block before the final `ROLLBACK` |
| `packages/shared/src/calendar/ics.ts` (+test) | `buildIcs`, `icsDate`, `foldLine`, `escapeText` |
| `packages/shared/src/calendar/title.ts` (+test) | `eventTitle(name, isSelf)`, `firstName` |
| `packages/shared/src/calendar/overlap.ts` (+test) | `overlapFraction` geometry for the review axis |
| `packages/shared/src/i18n/{en,ar}.json` | `calendar.*` |
| `apps/web/lib/google/{seal,oauth,calendarApi,events,returnTo,sync}.ts` (+tests) | server logic |
| `apps/web/lib/google/{config,store}.ts` | env + service-role `SyncStore` |
| `apps/web/app/api/google/{connect,callback,sync,disconnect}/route.ts`, `app/api/cron/google-sync/route.ts` | routes |
| `apps/web/vercel.json` | cron entry |
| `apps/mobile/src/lib/calendar/{api,share,useCalendarLink}.ts` | RPCs, routes, export |
| `apps/mobile/src/app/(app)/schedule/calendar.tsx` | Calendar sync |
| `apps/mobile/src/app/(app)/schedule/overlaps.tsx` | overlap review |
| existing: `(tabs)/schedule.tsx`, `IpadWeek.tsx`, `blockProps.ts`, `useSchedule.ts`, `scheduleApi.ts`, `bookings/book.tsx` | entry points + nudges |
| `apps/web/app/admin/users/[id]/page.tsx` | one status line |

## Task 1 · Harness first, then migration 0022

**Files:** `db/rls_assertions.sql`, `supabase/migrations/0022_m5c_calendar.sql`

**Produces (SQL):** the tables and functions in spec §4.

- [ ] **Step 1: Harness block** (before `ROLLBACK;`), day `d2 = CURRENT_DATE + 10`:
  - client_b cannot select `google_calendar_tokens`, `google_oauth_states` (insufficient privilege), reads 0 rows of `google_calendar_links` / `google_busy_blocks` / `google_sync_queue`; cannot execute `google_replace_busy`, `google_enqueue_all`, `google_queue_batch`
  - without a link, `create_booking` for pt_a on d2 queues nothing
  - as owner: insert a link for pt_a (`calendars` = primary `pa@x` + `team@x`, busy `{pa@x}`)
  - PT `set_busy_calendars('{pa@x,team@x}')` → 2 ids; `'{nope}'` → `unknown_calendar`; client → not authorized
  - a new PT booking on d2 at 07:15 queues one row; cancelling it keeps one row (upsert, not two)
  - as service_role: `google_replace_busy(pt_a, …, [{timed 16:15–17:00 d2}, {all-day d2+1}])` → 2 blocks; replace again with the same timed block → same id; with an empty array → 0 blocks for that window
  - client_b `open_slots(pt_a, d2, d2, 60)`: the 16:15 slot is gone, 17:00 present (busy end, already on a quarter); all-day d2+1 → 0 slots
  - booking bko (scheduled, owner insert, cb_row, d2 15:00–16:00 overlapping busy 15:30–16:30 inserted as service): PT `calendar_overlaps(d2, d2+1)` returns bko with overlap 15:30–16:00; pt_b sees 0; client_b raises
  - PT `keep_overlap(bko, busy)` → overlap gone; pt_b `keep_overlap` → not authorized
  - `google_enqueue_all(pt_a)` queues every pt_a booking in the horizon (count = bookings in range)
  - `google_queue_batch(pt_a, 50)` returns `out_title` `Forge · Client` for cb_row (client_b's display name "Client B") and `Forge · Me` for a self-row booking
  - admin reads pt_a's link, not tokens
- [ ] **Step 2: Dry-run harness alone** — fails at the first M5c case.
- [ ] **Step 3: Write 0022** per spec §4 and D7, D9–D12.
- [ ] **Step 4: Dry-run migration + harness** in one rolled-back transaction. Zero FAIL.
- [ ] **Step 5: `supabase db push`, harness against live, `pnpm types:gen`.**
- [ ] **Step 6: Commit** `feat(db): M5c google calendar sync, busy blocks, overlaps (0022)`.

## Task 2 · Shared `calendar` module + copy

**Files:** `packages/shared/src/calendar/*`, `packages/shared/src/index.ts`, `i18n/{en,ar}.json`

**Produces:**
- `buildIcs(events: IcsEvent[], now: Date): string` with `IcsEvent = { uid: string; title: string; start: string; end: string; sequence?: number }`
- `eventTitle(displayName: string | null | undefined, isSelf: boolean): string`
- `overlapGeometry(a: Span, b: Span, padMin = 30): { axisStart; axisEnd; ticks: number[]; a: Pct; b: Pct; overlap: Pct | null }` with `Span = {start: string; end: string}`, `Pct = {left: number; width: number}` (0–1)

- [ ] **Step 1: Tests:** ics — CRLF only, folding of a 120-char title at 75 octets with continuation lines starting with a space and multi-byte Arabic never split mid-character, escaping `,;\` and newline, UTC formatting, empty list still a valid VCALENDAR, UID/SEQUENCE present. title — "Rami Nassif" → "Forge · Rami", self → "Forge · Me", blank → "Forge · Session". geometry — the design's 17:00–18:00 vs 17:30–18:30 → axis 16:30–19:00, booking left 0.2 width 0.4, overlap 17:30–18:00; disjoint → overlap null.
- [ ] **Step 2: Run, see fail. Step 3: implement. Step 4: pass.**
- [ ] **Step 5: Copy** `calendar.*` en + ar (all screen 06 strings, overlap note, export, add-to-calendar, errors).
- [ ] **Step 6: Commit** `feat(shared): ics builder, event titles, overlap geometry, M5c copy`.

## Task 3 · Server Google logic (`apps/web/lib/google`) with vitest

**Files:** `apps/web/package.json` (vitest, `test` script), `apps/web/vitest.config.ts`, `lib/google/*.ts` + `*.test.ts`

**Produces:**
- `seal(plain: string, keyB64: string): string`, `open(sealed: string, keyB64: string): string`
- `pkcePair(): { verifier: string; challenge: string }`, `consentUrl(a: { clientId; redirectUri; state; challenge; selectAccount?: boolean }): string`, `exchangeCode(f, a): Promise<TokenSet>`, `refreshAccess(f, a): Promise<TokenSet>` (throws `GoogleAuthRevoked` on `invalid_grant`), `revokeToken(f, token)`, `emailFromIdToken(idToken): string | null`
- `calendarApi(f, accessToken)` → `{ createCalendar(summary, timeZone), getCalendar(id), listCalendars(), putEvent(calId, id, body), deleteEvent(calId, id), listEvents(calId, fromIso, toIso) }`; non-2xx → `GoogleHttpError(status)`; 401 → `GoogleAuthRevoked`
- `eventIdFor(bookingId)`, `eventBodyFor(b: QueuedBooking)`, `busyFromEvents(calendarId, items): BusyInput[]`
- `isReturnToAllowed(url: string): boolean`
- `syncPt(deps: { store: SyncStore; f: typeof fetch; clientId; clientSecret; key; now: Date }, ptId, opts?: { forceBusy?: boolean }): Promise<SyncOutcome>`; `SyncOutcome = { status: 'synced' | 'revoked' | 'unreachable' | 'not_connected'; pushed: number; failed: number }`

- [ ] **Step 1: Tests** with a scripted fake `fetch` and an in-memory `SyncStore`: seal round-trip + tamper → throws; consent URL carries scopes/PKCE/state/offline/consent; refresh `invalid_grant` → `GoogleAuthRevoked`; `putEvent` 404 → insert, insert 409 → PUT again; delete 410 → ok; `busyFromEvents` drops transparent, declined, cancelled; all-day → `start_date`; `syncPt`: expired access → refresh + save; queue of 2 (one live, one cancelled) → PUT + DELETE, dequeued; missing Forge calendar (404) → created and saved; busy refreshed only when stale; revoked → store `markError` once and outcome `revoked`; 500 on calendar list → `unreachable` and queue kept; `isReturnToAllowed` — `forge://schedule/calendar` yes, `https://evil.example` no, `http://localhost:8081/x` yes outside production.
- [ ] **Step 2–4: fail → implement → pass.**
- [ ] **Step 5: Commit** `feat(web): google oauth, calendar client, sync engine (tested)`.

## Task 4 · Routes + cron + admin line

**Files:** `apps/web/lib/google/{config,store}.ts`, five route files, `vercel.json`, `app/admin/users/[id]/page.tsx`

- [ ] connect: bearer → user (role `pt` via `users`), `returnTo` allow-listed, config present, insert state (service), return `{ url }`.
- [ ] callback: look up + delete state (≤ 10 min), on `error=access_denied` → `returnTo?gcal=denied`; exchange; email from id token; upsert link (same email keeps calendar + ticks, else resets), save sealed tokens, `google_enqueue_all`, `syncPt(force)`, redirect `?gcal=connected` (or `nocalendars` when the list is empty, `error` on failure).
- [ ] sync: bearer → PT ids = self if a link exists, else the PTs of the caller's active client rows that have links; `syncPt` each (throttle: skip busy refresh unless stale; `force` only for the PT themselves with `{force:true}`); 200 `{ status, lastSyncedAt, queued }`, 502 when unreachable.
- [ ] disconnect: revoke (best effort), delete link (cascades tokens? no FK—delete each table explicitly), 200.
- [ ] cron: `CRON_SECRET`, sweep all links, sequential.
- [ ] admin: one line under the PT's bookings.
- [ ] `pnpm --filter web typecheck lint test`; commit `feat(web): google calendar routes, daily sweep, admin status`.

## Task 5 · Mobile: api, export, schedule notes, nudges

**Files:** `apps/mobile/src/lib/calendar/*`, `blockProps.ts`, `useSchedule.ts`, `scheduleApi.ts`, `(tabs)/schedule.tsx`, `IpadWeek.tsx`, `bookings/book.tsx`, `package.json` (`expo-sharing`)

- [ ] `api.ts`: `fetchLink`, `fetchOverlaps(fromIso,toIso)`, `setBusyCalendars`, `keepOverlap`, `connectGoogle({selectAccount})` (POST connect → `openAuthSessionAsync(url, returnTo)` → parse `gcal`), `disconnectGoogle`, `syncNow(force)`, `nudgeCalendarSync()`.
- [ ] `share.ts`: `shareIcs(filename, text)` — web Blob download; native `expo-file-system` `File` in `Paths.cache` + conditional `expo-sharing`, fallback `Share.share({ message })`.
- [ ] `ScheduleItem.overlap?: { title; start }`; `fetchScheduleBundle` adds `calendar_overlaps`; `blockProps` sets warn note when no late-cancel note.
- [ ] Header "Google" button (phone + iPad) → `/(app)/schedule/calendar`.
- [ ] Nudge after `createBooking`/`rescheduleBooking`/`cancelBooking`/`markNoShow` success; Book a session nudges on focus.
- [ ] "Add to my calendar" on the client's booked confirmation.
- [ ] Commit `feat(mobile): calendar api, ics export, overlap notes, sync nudges`.

## Task 6 · Mobile: Calendar sync + Overlaps screens

- [ ] `schedule/calendar.tsx` — states per spec §6, disconnect `BottomSheet`, export card everywhere, offline banner, `gcal` result banner after connect.
- [ ] `schedule/overlaps.tsx` — cards from `calendar_overlaps(today, today+7)`, geometry from `overlapGeometry`, Move → `/(app)/schedule/[id]/edit`, Keep both → `keepOverlap` + refetch.
- [ ] `pnpm typecheck lint test`; commit `feat(mobile): calendar sync and overlap review screens`.

## Task 7 · Verify

1. `pnpm typecheck`, `pnpm lint`, `pnpm test`.
2. Walk on web (gitignored `.claude/skills/forge-screen-walk/m5c/`): seed (psql, as owner) a link + busy blocks + an overlapping booking for pt.test; PT: Schedule shows the overlap note → Google → Connected with the email, "1 overlap this week", calendars ticked → tick a second (RPC) → reload persists → Review → bars drawn → Keep both → gone → Export (download captured) → parse the file. Error state: set `status='error'` → Sync stopped copy + queue count. Delete the link → Not connected copy → Connect tapped → consent URL request (the deployed API is reached only if CORS allows; record the result honestly). Client: Book a session → the busy hour has no slot; after booking, "Add to my calendar" downloads a one-event file.
3. Live-DB read of what the walk wrote; clean seeds.
4. Commit fixes as found.

## Task 8 · Close-out

Tracker log entry (+ "Things only you can do": Google Cloud project setup, Vercel env vars, redirect URI, verification), CLAUDE.md (status sentence, migration 0022, docs row, M5c ✅), DESIGN_SYSTEM_GAPS (overlap axis, calendar checklist), PITFALLS if a new class appears, memory. As-built section below.

## Verification

All four layers (SQL, vitest, typecheck/lint, walk + live read) before claiming done. The Google round trip itself (consent, token exchange, real Calendar writes) cannot be exercised here — no Google project credentials are deployed and consent needs a human Google login; the fakes in Task 3 stand in, and the tracker says so.

## As built — deviations from this plan

_Filled in at close-out._

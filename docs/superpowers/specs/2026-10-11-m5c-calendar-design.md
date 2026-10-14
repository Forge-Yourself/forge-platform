# M5c · Calendar — Design

**Date:** 2026-10-11
**Scope:** The third and last M5 sub-milestone. A PT connects Google Calendar: every booking is copied into a "Forge sessions" calendar Forge creates, and the busy times of the calendars the PT ticks block those slots for booking. An overlap between a booking and a Google event shows on the schedule and on a review screen where the PT moves the session or keeps both. A PT exports the next four weeks as an `.ics` file, and a client adds a booking they just made to their own calendar.
**Parent:** `2026-09-09-forge-v1-implementation-design.md` §5 M5 (EP-09: "Google Calendar two-way sync, `.ics` export"). Tracker: `docs/M5_Scheduling.md`. Design: `docs/Forge M5 Scheduling.html` screen 06 (Google Calendar) plus the overlap note on screen 01 and "Add to my calendar" on screen 09. Builds on M5a and M5b, both unmerged; this branch starts from `feature/m5b-check-in`.
**Review:** the user waived review of this spec and its plan ("plan m5c and implement it without my review", 2026-10-11). Every decision below is a choice made where the design is silent; the tracker entry lists them for after-the-fact review.

---

## 1. Goal

A PT keeps one calendar. Bookings appear in Google without retyping, and a dentist appointment in Google stops clients booking that hour.

Success means:
- After connecting, every live booking in the next 12 weeks is in a Google calendar called "Forge sessions", titled "Forge · <client first name>", and a cancel removes it.
- An event in a ticked Google calendar removes the slots it covers from `open_slots`, for the client and in the PT's own booking form.
- A booking that overlaps a Google event shows "Overlaps Google · <title> <time>" on the schedule; Calendar sync says "1 overlap this week" and the review draws both bars on one time axis.
- When Google revokes access, the screen says sync stopped, when, and how many bookings are waiting to be copied; Reconnect resumes and drains them.
- Export writes a valid `.ics` of the next four weeks that Apple Calendar, Google Calendar and Outlook import.
- No Google event title, and no Google token, ever reaches a client.

## 2. State of the ground

- `bookings` has unused `ical_uid` and `google_calendar_id` columns from `0001`. Nothing writes them; M5c doesn't need them either (D5) and leaves them alone.
- `apps/web` already brokers secrets for the app (`/api/ai/program-draft`), authenticates the app by bearer token (`lib/supabase/bearer.ts`), has a service-role client (`lib/supabase/service.ts`, used by the waiver routes and the photo-orphans cron), CORS for `/api/*` in `middleware.ts`, and one Vercel Cron (`vercel.json`). It has no test runner.
- The mobile app drives a browser OAuth flow for sign-in with `expo-web-browser`'s `openAuthSessionAsync` and `Linking.createURL` (`lib/auth/oauth.ts`). The scheme is `forge://`.
- `open_slots` (0020) is the one authority on what a client can book, and the PT's booking form only offers its slots. Busy times must therefore be applied inside `open_slots`.
- `CalendarBlock` takes `note` and `noteTone` — M5a built it so M5c "only feeds it".
- `expo-file-system` ships with `expo` and is autolinked; `expo-sharing` is not installed.
- `pg_net` is available but not installed; `pg_cron` is installed.
- The repo-root `.env` has `CLIENT_ID` / `CLIENT_SECRECT` entries (not read by any code). They look like the Google OAuth client for this milestone; M5c reads `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from Vercel's environment and does not touch `.env`.

## 3. Decisions

- **D1 · The server owns the Google connection.** The OAuth client secret, the refresh token and every Google API call live in `apps/web`. The app never holds a Google token. Connect: the app `POST`s `/api/google/connect` with its bearer token and a `returnTo` URL; the route stores a one-time `state` with a PKCE verifier and returns Google's consent URL; the app opens it with `openAuthSessionAsync`; Google redirects to `/api/google/callback`, which exchanges the code, stores the tokens, creates the Forge calendar, runs a first sync, and redirects to `returnTo?gcal=connected` (or `=denied` / `=error`).
- **D2 · `returnTo` is allow-listed.** Only `forge://…` (native) or an origin `lib/cors.ts` already allows (the Expo web dev server) is accepted; anything else is a 400. An open redirect on an OAuth callback would hand an attacker a trusted-looking bounce.
- **D3 · Scopes.** `openid email`, `calendar.app.created` (create the "Forge sessions" calendar and manage only its events), `calendar.calendarlist.readonly` (list calendars to tick), `calendar.events.readonly` (read event times and titles for busy blocks and the overlap review). Forge never asks to write to a calendar it didn't create, which is what "Forge never edits or deletes your own Google events" promises. All three calendar scopes are *sensitive*, so Google's verification is still needed before more than 100 test users (tracker).
- **D4 · Tokens are encrypted at rest and unreachable from the app.** Refresh and access tokens are sealed with AES-256-GCM under `GOOGLE_TOKEN_KEY` (32 bytes, base64, Vercel env only) and stored in `google_calendar_tokens`, which has RLS on, no policies, and no privileges for `anon`/`authenticated`. OAuth `state` rows live in `google_oauth_states` the same way, expire after 10 minutes and are deleted on use.
- **D5 · A Google event's id is derived from the booking id.** Event id = `forge` + the booking UUID's 32 hex digits (Google ids are base32hex `[a-v0-9]`, 5–1024 chars). Writes are therefore idempotent without a mapping table: `PUT` the event (status confirmed), and on 404 `POST` it with that id; a 409 on insert means it exists and the `PUT` is retried once. Delete is `DELETE`; 404/410 count as done.
- **D6 · What gets copied.** Live bookings (`scheduled`, `checked_in`, `completed`, `no_show`) are written; `cancelled` is deleted. Title "Forge · <first word of the client's display name>", "Forge · Me" for the PT's own training, no description, no location, no attendees — nothing a PT's shared Google calendar would leak beyond a first name. Times are UTC instants with the booking's `originating_timezone`. `extendedProperties.private.forgeBookingId` holds the id.
- **D7 · A queue, filled by a trigger.** `google_sync_queue (booking_id PK, pt_user_id, queued_at, attempts, last_error)`. An `AFTER INSERT OR UPDATE OF status, starts_at, ends_at, client_id` trigger on `bookings` upserts a row when the PT has a connection. Connecting enqueues every booking from 1 day ago to 12 weeks ahead. The callback, the sync route and the cron drain it; a booking that fails 5 times stays queued with its error but stops being retried until the next connect.
- **D8 · When sync runs.** No background worker runs every minute (Vercel Hobby crons are daily, and `pg_net` isn't installed). Instead the app nudges `POST /api/google/sync` after every booking write (create, move, cancel, no-show — PT or client) and when Calendar sync or Book a session opens; the route works out which PT(s) the caller's bookings belong to and syncs them with the service role. A daily cron (`/api/cron/google-sync`, 05:00 UTC) sweeps every connection. A nudge is fire-and-forget: a booking never waits for Google.
- **D9 · Busy blocks are stored, not looked up live.** Every sync whose busy data is older than 5 minutes (and every "Check for busy times" change) re-reads events from now − 1 day to now + 12 weeks on the ticked calendars (`singleEvents=true`), skipping `transparent` ("free") events, events the PT declined, cancelled events, and anything on the Forge calendar. They replace the PT's rows in `google_busy_blocks (id, pt_user_id, calendar_id, event_id, title, starts_at, ends_at)` through a service-only RPC that keeps each block's id stable across refreshes (upsert on `(pt, calendar, event, starts_at)`) and converts all-day events — Google sends dates, not instants — to local midnights in the PT's zone in SQL, keeping all time math in Postgres (M5a rule).
- **D10 · Which calendars count.** On connect, the primary calendar is ticked and the others are not. The list (`id`, `summary`, `primary`) is cached on the connection row and refreshed each sync; ticking one is the `set_busy_calendars(text[])` RPC (ids must be in the cached list), then a sync nudge.
- **D11 · Busy blocks close slots inside `open_slots`.** A candidate that overlaps a busy block jumps to the block's end, rounded up to the next quarter hour. No buffer around Google events (the PT's buffer is for their sessions). This applies to the PT's own form too, because that form only offers open slots. `create_booking` / `reschedule_booking` already defer to `open_slots` for clients, so no change there; a PT booking still only has to not overlap another booking (M5a correction), so the server lets a PT book over a busy block if a future UI asks it to.
- **D12 · An overlap is computed, not stored.** `calendar_overlaps(p_from, p_to)` (PT only) returns each live (`scheduled`/`checked_in`) booking that overlaps a busy block, with the block's title and times and the overlap range, minus pairs the PT kept. "Keep both" is `keep_overlap(booking_id, busy_id)`, stored in `google_overlap_kept` (cascade-deleted with either side, so an edited Google event that moves is a new block id only if its start changed — then it's a new overlap, which is right). "Move <name>'s session" opens M5a's move form. The design's line "A Google event was added after this booking was made" is shown as written: an overlap can only arise that way, because `open_slots` hides busy times before a booking is made.
- **D13 · Error state.** A refresh that Google answers with `invalid_grant` (revoked, password changed, 6 months idle) sets the connection to `error` with `error_at`. The screen shows "SYNC STOPPED · <time>", "Google asked you to sign in again", the queue count since then, Reconnect and "Disconnect instead". Busy blocks already stored keep blocking (the design: "busy times after <time> aren't blocked yet"). A network or 5xx failure is not an error state: the route answers 502 and the screen shows the design's "Couldn't reach Google · Your Forge schedule is unaffected. Sync resumes on its own." banner.
- **D14 · Reconnect keeps the calendar.** A reconnect with the same Google account keeps `forge_calendar_id` and the ticked calendars and drains the queue. A different account starts over (new Forge calendar, primary ticked). A connect where Google returns no calendars at all shows the design's "No calendars found" state with "Use another account" (consent with `prompt=select_account`).
- **D15 · Disconnect.** `POST /api/google/disconnect` revokes the refresh token at Google (best effort), then deletes the connection, tokens, busy blocks, kept overlaps and queue. Events already copied stay in Google, as the sheet says.
- **D16 · `.ics` is built on the phone.** `buildIcs()` in `packages/shared/src/calendar/` (RFC 5545: CRLF, 75-octet folding, escaped text, UTC `DTSTART`/`DTEND`, `UID:<booking id>@forge.app`, `SEQUENCE` from `updated_at` seconds so a re-import updates rather than duplicates, `STATUS:CANCELLED` never written — cancelled bookings are left out). The PT's export covers live bookings from today for 4 weeks with the same "Forge · <first name>" titles. A client's "Add to my calendar" after booking writes one event "Forge · Session with <PT name>". On web the file downloads; on native it is written with `expo-file-system` and handed to `expo-sharing` (required conditionally, PITFALLS R3, falling back to the share sheet with the text). Export works offline from the schedule already on screen.
- **D17 · Offline.** Calendar sync shows "OFFLINE · SYNC PAUSED / Changes made now copy to Google when you're back online." Connect, Reconnect, Disconnect and calendar ticks are disabled. Export stays available.
- **D18 · Admin.** A PT's page in the web admin shows one line: Google Calendar connected (email, last sync) / sync stopped / not connected, and the queue size. Admins read the connection row (RLS `is_admin()`), never tokens or busy titles.
- **D19 · Clients never see Google data.** `google_busy_blocks`, `google_calendar_links`, `google_sync_queue` and `google_overlap_kept` are readable by the owning PT (and admins for the link), never by a client. `open_slots` returns only starts.

## 4. Schema (`0022_m5c_calendar.sql`)

| Object | Shape | Access |
|---|---|---|
| `google_calendar_links` | `pt_user_id` PK → users, `google_email`, `status` (`connected`/`error`), `forge_calendar_id`, `calendars` JSONB (`[{id, summary, primary}]`), `busy_calendar_ids` TEXT[], `connected_at`, `last_synced_at`, `busy_refreshed_at`, `error_at` | SELECT own PT + admin; writes: service role, `set_busy_calendars` |
| `google_calendar_tokens` | `pt_user_id` PK, `refresh_token` (sealed), `access_token` (sealed), `access_expires_at` | none |
| `google_oauth_states` | `state` PK, `pt_user_id`, `return_to`, `code_verifier`, `created_at` | none |
| `google_busy_blocks` | `id` uuid_v7, `pt_user_id`, `calendar_id`, `event_id`, `title`, `starts_at`, `ends_at`; UNIQUE (`pt_user_id`, `calendar_id`, `event_id`, `starts_at`); index (`pt_user_id`, `starts_at`) | SELECT own PT |
| `google_sync_queue` | `booking_id` PK → bookings ON DELETE CASCADE, `pt_user_id`, `queued_at`, `attempts`, `last_error` | SELECT own PT |
| `google_overlap_kept` | (`booking_id`, `busy_id`) PK, cascades | SELECT own PT |
| `enqueue_google_sync()` | trigger on `bookings` | — |
| `open_slots` | re-created, same signature, busy-aware | unchanged grants |
| `calendar_overlaps(p_from, p_to)` | → `out_booking_id, out_busy_id, out_title, out_busy_start, out_busy_end, out_booking_start, out_booking_end, out_overlap_start, out_overlap_end` | authenticated (PT) |
| `set_busy_calendars(p_ids TEXT[])` | → link row | authenticated (PT) |
| `keep_overlap(p_booking_id, p_busy_id)` | → void | authenticated (PT) |
| `google_replace_busy(p_pt, p_from, p_to, p_blocks JSONB)` | blocks: `{calendar_id, event_id, title, start?, end?, start_date?, end_date?}` | service_role only |
| `google_enqueue_all(p_pt)` | queue every booking from now − 1 day to + 12 weeks | service_role only |
| `google_queue_batch(p_pt, p_limit)` | → queued bookings with `status`, times, zone, `title` | service_role only |

## 5. Server (`apps/web`)

- `lib/google/config.ts` — env, scopes, redirect URI (`${origin}/api/google/callback`, origin from `GOOGLE_REDIRECT_ORIGIN` or the request).
- `lib/google/seal.ts` — AES-256-GCM seal/open.
- `lib/google/oauth.ts` — PKCE, consent URL, code exchange, refresh, revoke, id-token email.
- `lib/google/calendarApi.ts` — calendar create/get, calendar list, event put/insert/delete, events list. Every function takes an injected `fetch`.
- `lib/google/events.ts` — `eventIdFor`, `eventBodyFor`, `busyFromEvents`.
- `lib/google/returnTo.ts` — allow-list.
- `lib/google/sync.ts` — `syncPt(store, google, ptId, now)` over a small `SyncStore` interface; `lib/google/store.ts` implements it with the service-role client.
- Routes: `POST /api/google/connect`, `GET /api/google/callback`, `POST /api/google/sync`, `POST /api/google/disconnect`, `GET /api/cron/google-sync`.
- `apps/web` gains vitest; every `lib/google/*` module except `store.ts` and `config.ts` is tested with fakes.

## 6. App

| Screen / piece | Route | Notes |
|---|---|---|
| Calendar sync | `schedule/calendar` | Not connected · Connected (+ overlap banner, Check for busy times, Write bookings to, Disconnect) · Sync stopped · No calendars found · Couldn't reach Google · Offline. Export .ics card in every state. Disconnect sheet. |
| Overlaps | `schedule/overlaps` | One card per overlap this week: day label, a time axis with the booking bar, the hatched Google bar and the dashed overlap band; "Move <name>'s session" (→ `schedule/[id]/edit`), "Keep both", "<name> isn't told about the overlap." |
| Schedule header | `(tabs)/schedule` | "Google" button between Hours and +. Block note "Overlaps Google · <title> <time>" in warn tone (phone + iPad). |
| You're booked | client book confirmation | "Add to my calendar" (one-event `.ics`). |
| Booking writes | `scheduleApi` | nudge sync after success. |

## 7. Out of scope

Two-way edits (moving the Forge event in Google does not move the booking — Forge is the source of truth and the next sync puts it back), Google push notifications (`events.watch` needs a verified domain and a public webhook), subscribing to a live `.ics` feed URL, Outlook/Apple calendar APIs, a client's own Google sync.

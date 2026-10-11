# M5 · Scheduling — tracker

**Started:** 2026-10-11
**Epics:** EP-09 (scheduling), EP-10 (check-in)
**Design:** `docs/Forge M5 Scheduling.html` — Claude Design bundle, 13 screens, each with Loading / Empty / Error / Offline states plus its own variants. Authoritative wherever it is explicit (see the M1–M4 rule: the prototype is the spec).
**Branch per sub-milestone:** `feature/m5a-booking-core`, `feature/m5b-check-in`, `feature/m5c-calendar`.

This file is the review log for M5. Each sub-milestone appends an entry under **Log** when it lands: what shipped, what was verified and how, what deviated from the design, and what is left for you to check. Read the entries in order.

---

## Why M5 is cut in three

The v1 spec's M5 line names seven things: availability, bookings, recurring with DST, Google Calendar two-way sync, `.ics` export, QR check-in/out, rating + tip + receipts. Google sync is the outlier — it needs a Google Cloud OAuth app whose calendar scope is *sensitive* (Google must verify the app before real users can connect), server-held refresh tokens, and a sync job. Bundling it with the booking core would hold everything else hostage to an external review queue.

| Sub-milestone | Scope | Depends on | Status |
|---|---|---|---|
| **M5a · Booking core** | Availability (hours, exceptions, rules), bookings + recurring + DST, PT schedule day/week/month, iPad week grid, create/edit booking, booking detail (late cancel, no-show), client Book + My bookings, Start session from a booking, admin booking view | M4e | done |
| **M5b · Check-in** | QR check-in (rotating signed code, 6-digit fallback, works offline), client scan, after-session sheet (rating, comment, tip placeholder), receipt (PT-recorded amount, no payment), reminder settings (copy only) | M5a | done (unmerged, branched from M5a) |
| **M5c · Calendar** | Google Calendar connect / sync / conflict / disconnect, conflict line on the schedule, `.ics` export | M5a | built (unmerged, branched from M5b); live Google needs your OAuth client — see "Things only you can do" |

## Design screen → sub-milestone

| # | Design screen | Sub-milestone |
|---|---|---|
| 01 | Schedule · day / week / month | M5a (Google overlap line → M5c) |
| 02 | Availability editor | M5a |
| 03 | Create / edit booking | M5a |
| 04 | Booking detail | M5a |
| 05 | QR check-in | M5b |
| 06 | Google Calendar | M5c |
| 07 | Reminder settings | M5b |
| 08 | iPad schedule · week | M5a |
| 09 | Book a session (client) | M5a |
| 10 | My bookings (client) | M5a (rating/receipt links on past rows → M5b) |
| 11 | Scan to check in (client) | M5b |
| 12 | After-session sheet | M5b |
| 13 | Receipt | M5b |

## Things only you can do

| When | What | Why |
|---|---|---|
| To turn M5c on | In Google Cloud: enable the **Google Calendar API**; create an OAuth client of type **Web application** with redirect URI `https://forge-admin-one.vercel.app/api/google/callback`; on the consent screen add the scopes `openid`, `email`, `…/auth/calendar.app.created`, `…/auth/calendar.calendarlist.readonly`, `…/auth/calendar.events.readonly`, and add your test Google accounts as test users | The callback URI must match exactly. The repo-root `.env` has `CLIENT_ID` / `CLIENT_SECRECT` entries that look like this client — if so, check its type and redirect URI |
| To turn M5c on | On the Vercel project set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_TOKEN_KEY` (32 random bytes, base64 — e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`), then deploy this branch. `CRON_SECRET` must already be set for the daily sweep | Without them, Connect answers "Google Calendar isn't set up on Forge's server yet" and nothing else changes. Losing `GOOGLE_TOKEN_KEY` means every PT reconnects |
| Before real users | Start Google's verification for the three calendar scopes (all *sensitive*) | Unverified apps are capped at 100 test users and show a warning screen. Verification takes days to weeks |
| Before M6 | Decide what a "counted" late cancellation does to money | M5a only records the flag; M6 owns money |

---

## Log

_Entries are appended here as each sub-milestone lands. Newest last._

### 2026-10-11 · M5 kickoff
- Design received: `docs/Forge M5 Scheduling.html`.
- Split agreed: M5a / M5b / M5c (option A).
- M5a spec written: `docs/superpowers/specs/2026-10-11-m5a-booking-core-design.md`. **Your review needed** — especially §3 Decisions; each one is a choice I made where the design is silent.
- M5a plan written: `docs/superpowers/plans/2026-10-11-m5a-booking-core.md` — 16 tasks, harness-first. Its **Corrections** section changes the spec in eight places; the two that matter most: a session links its booking by time on the server, so the offline outbox is untouched (D11), and the client gets no tab bar — booking is reached from a "Next session" card on Today (D13).

### 2026-10-11 · M5a · Booking core — landed

**Shipped**
- Migration `0020_m5a_booking.sql` (applied to the live project): `booking_rules` and `availability_exceptions` tables, five new `bookings` columns, an exclusion constraint so two live bookings for one PT can never overlap, SELECT-only RLS on all four scheduling tables.
- RPCs: `save_availability`, `booking_policy`, `pt_day_windows`, `open_slots`, `preview_series`, `create_booking`, `reschedule_booking`, `cancel_booking`, `mark_no_show`. `start_workout_session` now links the booking a session fulfils (same signature, so the offline outbox is untouched) and `complete_workout_session` completes it.
- PT: a fifth tab, **Schedule** (day / week / month; week grid with a detail pane on iPad), **Availability** (hours, exceptions, rules, one Save), **New / Move booking** (client, length, day strip with open counts, slot grid, weekly or two-weekly series with the dates listed and the clock-change warning), **Booking detail** (Start session, reschedule, cancel with the late-cancel sheet, no-show locked until 15 min after the start).
- Client: a **Next session** card on Today, **Book a session**, **My bookings** (exact cancel deadline, too-late state, past rows).
- Web admin: a read-only Bookings section on a PT's or client's page.
- `packages/shared/src/schedule/`: error-code map, cutoff and no-show times, day-row and month-grid geometry, hours validation.

**Verified**
- SQL harness `db/rls_assertions.sql`: 309 assertions pass, 71 of them new for M5a (replayed create is one booking, cancel exactly at the cutoff refused, a colliding series inserts nothing, overlapping hours refused, a paused client cannot book, a series across Beirut's 2027-10-31 change keeps 10:30 local).
- Vitest: 429 pass (33 in `schedule/*`, plus en/ar key parity). `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
- Screen walk on the web target, 14 steps, all passed against the live project. Live-DB read afterwards: the completed booking has its one session, the waived late cancel is `cancel_late = t, cancel_counted = f`, the weekly series from Thu 15 Oct holds its local time across the 25 Oct clock change (UTC moved 05:30 → 06:30), "this and following" moved the last three and not the first; `booking_create`, `booking_cancel`, `booking_complete` are audited.
- The walk found three display bugs, each fixed in its own commit: a "-60m break" pill between overlapping ranges, "Coming soon" on the lengths a move can't change, and squeezed, overflowing blocks on the iPad grid.

**Deviations from the design**
- A session links its booking by time on the server (the scheduled booking whose start − 30 min … end contains the session start), so Start session works from the booking, from client detail, from Today and from an offline replay without any app change.
- The client has no tab bar (they never had one); booking is reached from the Next session card on Today.
- An exception is "Day off" or "Extra": extra hours are *added* to that day's weekly hours, not a replacement.
- A PT booking only has to not overlap another booking — it is not held to published hours. **But the app's form only offers open slots,** so in practice a PT can't book outside their hours from the phone (see below).
- A reschedule is audited as `booking_create` with `rescheduled_from`, because a new audit verb would rewrite the check constraint on every `audit_logs` partition.
- Availability offline: Save is disabled and the banner says saving needs a connection (the design said edits save on reconnect; M5a queues no booking writes).
- Deferred: "Message {{name}}" (M9), "Add to my calendar" and the Google button (M5c), "Show check-in code" and the Reminders row (M5b), rating and receipt on past rows (M5b). The booking detail's program card shows the client's active program, not a specific day.

**For you to check**
- A ten-minute pass on a real phone: client books a slot (walk step 4), a weekly series across a clock change (step 7 — after 25 Oct pick the March 2027 change), a late cancel (step 9), and the iPad week grid (step 13).
- The Arabic copy — only key coverage is checked on web.
- That a "counted" late cancellation means what you want before M6 puts money on it.
- Two gaps the walk surfaced that I did not change: **Day view always shows today** (there is no previous/next day), and **a PT cannot book outside published hours from the app** although the server allows it. Say if either should be fixed before M5b.
- The walk's bookings were left in place for `pt.test` as M5b seed data: 8 bookings (one completed, one cancelled late, a 4-session series, Me on Monday), Mon–Sat hours and one extra-hours exception for 11 Oct.

### 2026-10-11 · M5b · Check-in — landed

Planned and built in one pass at your request ("plan m5b and implement it without my review"). Spec `docs/superpowers/specs/2026-10-11-m5b-check-in-design.md` (decisions D1–D15 — **review those first**, each is a choice where the design is silent), plan `docs/superpowers/plans/2026-10-11-m5b-check-in.md` with an As-built section. Branch `feature/m5b-check-in`, cut from the unmerged `feature/m5a-booking-core`.

**Shipped**
- Migration `0021_m5b_check_in.sql` (applied live): a server-only secret per booking; `check_in` / `check_out` / `rate_booking` / `set_booking_amount` / `save_reminder_settings` / `checkin_keys`; amount, rating and receipt-number columns on `bookings`; a default session price on `booking_rules`; `reminder_settings`; SELECT RLS on `check_ins`. Sessions now fulfil and check out checked-in bookings.
- PT: **Show check-in code** on Booking detail → QR screen (white code card, four-step strip, 60 s countdown, the six digits, Check in by hand → Checked in → Start session / Check out → Checked out). The code is computed on the phone from a cached secret, so it keeps working with no signal. **Amount** row on Booking detail; **Session price** and a Reminders link on Availability › Rules; **Reminders** in Settings.
- Client: **Scan to check in** on the Next session card and in My bookings from 30 min before the start; the scanner (dark camera, ember frame, no tap needed, 6-digit fallback, camera-denied path, offline save); the **after-session sheet** (opens itself once on Today after a completed session; 1–5, comment, tip "Coming soon", thanks); the **receipt** (receipt number, mono figures, amount or "Not recorded", Share); past bookings show Rate / Rated N and Receipt.
- Web admin: the bookings table gains Checked in, Rating and Amount (with the receipt number).

**Verified**
- SQL harness: **375 pass** (66 new), dry-run in a rolled-back transaction before `db push`, then against live. Covers the shared HMAC vector, secrets unreadable by every app role, expired/wrong/foreign codes, typed digits, the 10-minute double-scan guard, an offline scan replayed 2.5 h later (twice), manual check-in, a session checking a client out, receipts numbered once, ratings only by the booking's client and only when completed, default and per-booking amounts, reminder patches.
- Vitest: **472 pass** (43 new: `checkin/*` incl. the same HMAC vector and `PendingQueue`). `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
- Screen walk on the web target, 13 steps, all passing against the live project — **including a real QR scan**: headless Chrome's fake camera was fed a generated video frame of the PT's live code, and `expo-camera`'s web scanner read it and checked the client in; the PT's screen flipped on its own. Then wrong digits, "already checked in", a logged session completing and checking out, the rating sheet opening itself, receipt `FRG-2026-00009` with $45.00, Rated 5 on both sides, reminders persisting, the price field.
- Live-DB read afterwards: booking `completed`, `check_ins` by `qr_scan` with a check-out time, one completed session, `receipt_no` 9, rating 5 with its comment; `check_in`, `booking_complete`, `check_out` audited.
- The walk found one UI bug (the scanner frame stayed amber over a green "already checked in" result) and one web console warning (the QR's accessibility props leaking onto the SVG element). Both fixed.

**Deviations from the design**
- "Scanned · confirming" lights together with "Checked in": the server confirms in one round trip, so there is no separate moment to show.
- The PT's screen learns of a scan by polling every 3 s while open; no Realtime on bookings.
- **Download PDF is not built** — a native app can't open an authenticated PDF without putting a token in a URL. Share (text) is. The PDF belongs with M6's real invoices.
- Reminders offline: toggles lock with a banner rather than "save later" (same call as M5a's Availability).
- Receipt numbers have gaps: the harness's rolled-back runs consume sequence values. Sequential-without-gaps would need a counter table; say if invoices will need that in M6.
- The design writes "only he sees it"; the copy says "only they see it".

**For you to check**
- On a phone: the PT's QR at full brightness in gym light, scanned by a second phone (web proved the decode, not a real camera); airplane-mode on the PT's phone (code keeps rotating) and on the client's (scan saved, confirmed on reconnect).
- That a typed code being valid for the current and three previous minutes is loose enough for slow typists and tight enough for you.
- The Arabic copy (key coverage only).
- **Pre-existing, not M5b:** `JetBrains Mono` is never loaded (`useFonts` appears nowhere), so every `numeric` text in the app falls back to a serif on web — visible in every M5 screenshot. One-line fix in the root layout once you confirm the font files to ship.
- The walk left one completed, rated, receipted booking for client.test and pt.test's default price at $45; reminders for pt.test have 2 h on.


### 2026-10-11 · M5c · Calendar — landed

Planned and built in one pass at your request ("plan m5c and implement it without my review"). Spec `docs/superpowers/specs/2026-10-11-m5c-calendar-design.md` (decisions D1–D19 — **review those first**, each is a choice where the design is silent), plan `docs/superpowers/plans/2026-10-11-m5c-calendar.md` with an As-built section. Branch `feature/m5c-calendar`, cut from the unmerged `feature/m5b-check-in` (so it contains M5a and M5b).

**Shipped**
- Migration `0022_m5c_calendar.sql` (applied live): the Google connection (PT + admin readable), sealed tokens and one-time OAuth states (no app role can touch them), PT-only busy blocks, sync queue and kept overlaps; a trigger that queues booking changes for connected PTs; `open_slots` now skips Google busy time (same signature); `calendar_overlaps`, `set_busy_calendars`, `keep_overlap`; service-only `google_replace_busy` (all-day events become local midnights in SQL), `google_enqueue_all`, `google_queue_batch`.
- `apps/web`: `/api/google/connect` → Google consent (PKCE, one-time state, `returnTo` allow-listed) → `/api/google/callback` (exchanges, seals tokens with AES-256-GCM, creates "Forge sessions", ticks the main calendar, queues 12 weeks of bookings, first sync); `/api/google/sync` (the app's nudge; syncs the caller's own connection, or a client's PT's); `/api/google/disconnect` (revokes, deletes everything Forge held); `/api/cron/google-sync` daily at 05:00 UTC. The Google client is plain `fetch` (no `googleapis`). Admin: one Google Calendar line on a PT's page.
- PT: a **Google** button on Schedule (phone and iPad) → **Calendar sync**: Not connected (the three-row explainer), Connected (email, last sync, "N overlaps this week · Review", Check for busy times checklist, Write bookings to Forge sessions, Disconnect Google), Sync stopped (time, waiting count, Reconnect / Disconnect instead), No calendars found (Use another account), Couldn't reach Google, Offline, the disconnect sheet, and **Export .ics** in every state. **Overlap review**: both bars on one time axis with the overlap band, Move <name>'s session (→ move form), Keep both. Schedule blocks carry "Overlaps Google · <title> <time>" in warning text.
- Client: **Add to my calendar** on "You're booked" (one-event `.ics`).
- Every booking write (PT or client) nudges sync; Book a session and the PT's booking form nudge a busy-time refresh.

**Verified**
- SQL harness: **419 pass** (44 new), dry-run in a rolled-back transaction before `db push`, then against live. Covers: nothing Google readable or callable by a client; tokens unreadable even by their PT; a booking queues only once connected, and re-queues (not duplicates) on change; ticks only from Google's own list; a timed busy block closes 16:15 and the next slot starts at 17:00 where it ends; an all-day event closes the whole local day; a client can't book over one either; block ids survive a refresh; overlaps computed, scoped to the PT, cleared by Keep both; event titles "Forge · Client" / "Forge · Me"; admin reads the connection but never tokens or titles.
- Vitest: **541 pass** — 49 new in `apps/web/lib/google` (now has vitest) against a scripted Google and an in-memory store: token sealing and tamper refusal, consent URL, `invalid_grant` → Sync stopped once (first time kept), reconnect drains the queue, 401 mid-sync, Google 503 and a dead network leave the queue intact, a refused booking parked after its own error, 5-attempt cap, a deleted Forge calendar re-created, the PUT 404 → insert 409 → PUT revival of a deleted event, a booking edited mid-write re-pushed, busy refresh only when stale or forced, free/declined/cancelled events ignored; 20 new in `packages/shared/src/calendar` (RFC 5545 folding incl. Arabic, escaping, overlap geometry, titles). `pnpm typecheck`, `pnpm lint`, `pnpm test`, `next build` pass.
- Screen walk on the web target, **12 steps, all passing** against the live project, with the connection, busy blocks and queue seeded the way the callback and sync engine write them: overlap note on the week view → Calendar sync connected with "1 overlap this week" → tick a second calendar (persisted) → review with both bars → Move opens the move form → Keep both clears it → Export downloads an `.ics` with the walk booking → Sync stopped with "1 booking made since then…" → disconnect sheet → Not connected → Connect posts to the API → client: the Google-busy 07:15 is gone and 08:15 is offered → client books and Add to my calendar downloads one event. Seeds removed afterwards (live read: zero Google rows, zero walk bookings).
- The walk found one bug: the checklist's tick wasn't exposed to the DOM (react-native-web ignores `accessibilityState`) — fixed, and written up as PITFALLS V6.

**Not verified — needs you**
- **The real Google round trip** (consent, token exchange, events appearing in Google, busy times pulled from a real calendar). No OAuth client is configured on the API and consent needs a human Google login, so the fakes stand in. From `localhost:8081` the app's `/api/google/*` calls are refused by production CORS, and this branch isn't deployed, so the walk saw "Couldn't reach Google" — which is that state working, not the feature. See **Things only you can do** above for the three Vercel env vars and the Google Cloud settings.

**Deviations from the design**
- "Write bookings to" is fixed to the "Forge sessions" calendar Forge creates; there is no picker. Forge's scope (`calendar.app.created`) can only write to calendars it created, which is what lets the screen promise Forge never edits your own events.
- Not real-time: Google changes reach Forge on the next nudge (any booking write, opening Calendar sync or a booking screen, when the last refresh is over 5 minutes old) or the daily sweep. Google push notifications need a verified domain and a public webhook.
- Busy times close slots for the PT's own booking form too, because that form only offers open slots.
- Overlap copy is the design's "A Google event was added after this booking was made" — always true, because busy times are hidden before booking.
- `.ics` export needs a connection (reads bookings live).
- The admin line shows status, email and last sync but not the queue size (admins can't read the queue).

**For you to check**
- On a phone, after the env vars are set and this branch is deployed: Connect, check the Forge sessions calendar fills, add a Google event over a booking, open Calendar sync, see the overlap; revoke Forge at myaccount.google.com/permissions and see Sync stopped; Reconnect.
- `expo-sharing` is a new native module: Export / Add to my calendar on a device need a rebuilt dev client. An older build falls back to the share sheet with the calendar text.
- The Arabic copy (key coverage only).

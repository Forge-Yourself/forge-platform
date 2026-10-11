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
| **M5b · Check-in** | QR check-in (rotating signed code, 6-digit fallback, works offline), client scan, after-session sheet (rating, comment, tip placeholder), receipt (PT-recorded amount, no payment), reminder settings (copy only) | M5a | not started |
| **M5c · Calendar** | Google Calendar connect / sync / conflict / disconnect, conflict line on the schedule, `.ics` export | M5a | not started — needs a Google Cloud project from you |

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
| Before M5c | Create a Google Cloud project, enable the Calendar API, configure the OAuth consent screen, and start Google's verification for the `calendar.events` scope | Unverified apps are capped at 100 test users and show a warning screen. Verification takes days to weeks, so start it early |
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

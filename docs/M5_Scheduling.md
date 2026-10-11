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
| **M5a · Booking core** | Availability (hours, exceptions, rules), bookings + recurring + DST, PT schedule day/week/month, iPad week grid, create/edit booking, booking detail (late cancel, no-show), client Book + My bookings, Start session from a booking, admin booking view | M4e | spec written — awaiting review |
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

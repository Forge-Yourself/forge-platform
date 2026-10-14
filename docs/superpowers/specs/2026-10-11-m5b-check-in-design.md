# M5b · Check-in — Design

**Date:** 2026-10-11
**Scope:** The second of three M5 sub-milestones. A PT shows a rotating QR code (with a 6-digit fallback) for a booking; the client scans it or types the digits and is checked in; a second scan, the PT, or finishing the logged session checks them out. The client then rates the session, may leave a comment, sees a tip placeholder, and gets a receipt showing the amount the PT recorded. A PT sets reminder preferences that are saved but not sent.
**Parent:** `2026-09-09-forge-v1-implementation-design.md` §5 M5 (EP-10). Tracker: `docs/M5_Scheduling.md`. Design: `docs/Forge M5 Scheduling.html` screens 05, 07, 11, 12, 13. Builds on M5a (`2026-10-11-m5a-booking-core-design.md`), which is unmerged; this branch starts from `feature/m5a-booking-core`.
**Review:** the user waived review of this spec and its plan ("plan m5b and implement it without my review", 2026-10-11). Every decision below is a choice made where the design is silent; the tracker entry lists them for after-the-fact review.

---

## 1. Goal

The PT stops ticking clients off by memory. A client walks in, scans the PT's phone, and both phones agree they're here; at the end, the client rates the session in one tap and has a receipt.

Success means:
- A client scanning a fresh code is checked in, and the PT's screen shows it within a few seconds without a tap.
- A code photographed and replayed two minutes later is refused as expired; another client's code tells the scanner it's for a different session without naming anyone.
- Typing the six digits works exactly like scanning.
- With the PT's phone offline, the code still rotates and still checks the client in. With the client's phone offline, the scan is kept and confirmed when it reconnects.
- Completing the logged session checks the client out; the client is offered the rating sheet; the receipt shows the PT's recorded amount and a receipt number.

## 2. State of the ground

- `check_ins` exists since `0001_baseline`: `booking_id` UNIQUE, `check_in_method` (`qr_scan`/`manual`/`geofence`), `checked_in_at`, `checked_out_at`, `rating`, `feedback_text`, `checked_in_by_user_id`. RLS is enabled with **no policies**; nothing reads or writes it.
- Audit verbs `check_in` and `check_out` are already allowed by `chk_audit_logs_action` (0005). No CHECK change needed.
- `bookings.status` CHECK already allows `checked_in` and `checked_out`. M5a writes `scheduled`, `completed`, `no_show`, `cancelled`. `bookingState()` already maps `checked_in` → `checked` and `checked_out` → `done`.
- M5a's `start_workout_session` links only `scheduled` bookings; `complete_workout_session` completes only `scheduled` ones. Both need `checked_in` too.
- `pgcrypto` is installed (`hmac`, `gen_random_bytes`). `expo-camera` 57 scans QR codes on native and web (`useWebBarcodeScanner`). There is no QR *generator* and no HMAC in the app.
- The M4b `KvStore` is a single key/value table on both adapters; `KvTable` is just a string, so a new logical table needs no storage migration.

## 3. Decisions

- **D1 · The code is an HMAC of the booking and the minute.** Each booking gets a random 32-byte secret. The code for window `w = floor(unix_seconds / 60)` is HMAC-SHA256(secret, `"<booking_id>:<w>"`) truncated RFC 4226-style to 6 digits. The QR encodes `forge-checkin:1:<booking_id>:<w>:<code>`; the 6 digits under it are the same code. The rule exists in TypeScript (to display offline) and SQL (to verify), so both sides test one shared vector (PITFALLS: a rule in two languages needs tests on both).
- **D2 · Only the PT ever holds the secret.** Secrets live in `booking_checkin_keys` (RLS on, no policies, no grants). The PT reads them through `checkin_keys(p_from, p_to)` — their own bookings only — and the app caches them on the device, so the code renders with no signal ("OFFLINE · CODE STILL WORKS"). A client never sees a secret, so they can't check in without seeing the PT's screen.
- **D3 · The check-in window is 30 minutes before the start until the end.** Matches the design's empty states ("A code appears 30 minutes before a session starts", "You don't have a booking in the next 30 minutes").
- **D4 · One RPC checks in.** `check_in(p_booking_id, p_code, p_window, p_at)`:
  - Client with a QR: the booking must be theirs (else `wrong_booking`, which names no one), `p_window` within ±1 of `p_at`'s window (else `code_expired`), the code must match (else `bad_code`).
  - Client with typed digits (no booking id): searches their own bookings inside the window, trying the current and three previous windows (typing takes time). None open → `no_booking_now`; no match → `bad_code`.
  - The booking's PT: no code; method `manual` ("Check in by hand").
  - Idempotent: re-checking a checked-in booking returns it. A client's scan **10 or more minutes after** check-in checks them out ("the client scans again at the end"); a quicker re-scan is a no-op, so a double scan at the door can't end the session.
- **D5 · Device time is trusted inside 24 hours.** `p_at` is clamped to `[now − 24 h, now]` (same rule as M4b's session start), and the window check is against `p_at`. That is what lets an offline scan replay later and still verify. Replaying an old screenshot only works for the same booking, inside its own check-in window, which already needed the PT's screen.
- **D6 · Statuses: `scheduled → checked_in → completed`.** Checking out completes the booking; `checked_out` is not used as a booking status (the check-in row's `checked_out_at` records the moment). `start_workout_session` links `checked_in` bookings too; `complete_workout_session` completes them and stamps `checked_out_at`. `check_out(p_booking_id)` lets the PT close a checked-in booking with no session. Cancel, reschedule and no-show stay `scheduled`-only, so a checked-in client can't be marked a no-show.
- **D7 · The rating lives on the booking.** `bookings.rating` (1–5), `rating_comment`, `rated_at`, written only by `rate_booking` — the booking's client, a non-self booking, status `completed`. Not `check_ins.rating`: a booking completed through a session without a scan has no check-in row but must still be ratable. `check_ins.rating`/`feedback_text` stay unused.
- **D8 · The amount is recorded, not charged.** `booking_rules.price_cents` (nullable, the PT's default, set on Availability › Rules) is copied onto each new booking's `amount_cents` by a trigger, so `create_booking` is untouched. The PT changes one booking's amount with `set_booking_amount`. Currency is USD only (Lebanon prices in USD). M6 owns money.
- **D9 · Receipt numbers are assigned on completion.** A trigger gives a booking the next value of `receipt_no_seq` the first time it becomes `completed`. Displayed as `FRG-<year of the session>-<5 digits>`. Cancelled and no-show bookings have no receipt.
- **D10 · Client writes queue when offline.** A check-in scan and a rating go through `PendingQueue` (`packages/shared/src/checkin/`, vitest) over the device `KvStore`, table `pending`, keyed by booking (a newer rating replaces an older queued one). It drains on reconnect and on app focus, and drops an entry the server permanently refuses. It is not behind the offline-logging beta switch: both RPCs are idempotent and tiny.
- **D11 · The PT's screen learns of a scan by polling.** While the QR screen is focused and online, it re-reads the booking every 3 seconds. No Realtime on bookings (M5a D14 still holds). The design's "Scanned · confirming" step is lit together with "Checked in": the server confirms in one round trip, so there is no separate moment to show.
- **D12 · The after-session sheet opens itself once.** On the client's Today, the newest `completed` booking from the last 24 hours with no rating, not already dismissed on this device ("Not now"), opens the sheet. My bookings' past rows offer **Rate** (or "Rated N") and **Receipt**.
- **D13 · Reminders are saved, not sent.** `reminder_settings` (one row per PT, the design's six toggles and defaults), written by `save_reminder_settings`. The banner says nothing is sent yet. Reached from Settings and from Availability › Rules. Offline, the toggles are disabled with the design's banner (M5a's availability precedent; nothing is queued).
- **D14 · Receipt sharing.** Share sends the receipt as text through the OS share sheet. **Download PDF is deferred**: a native app can't open an authenticated PDF route without putting a token in a URL; it lands with M6's real invoices. The button is not shown.
- **D15 · Navigation.** PT: Booking detail gains **Show check-in code** → `schedule/[id]/check-in`. Client: the Next session card and My bookings' next card gain **Scan to check in** while the window is open → `bookings/scan`; `bookings/[id]/rate`; `bookings/[id]/receipt` (RLS lets the PT open it too). PT Settings → `settings/reminders`.

## 4. Data and authorization — migration `0021_m5b_check_in.sql`

| Change | Detail |
|---|---|
| new `booking_checkin_keys` | `booking_id` PK/FK bookings ON DELETE CASCADE, `secret BYTEA` (32 bytes), `created_at`. RLS on, no policies, all privileges revoked from `anon`/`authenticated` |
| new `reminder_settings` | `pt_user_id` PK/FK users, `client_24h` T, `client_2h` F, `client_change` T, `pt_agenda` T, `pt_book` T, `pt_late` T, `updated_at`. SELECT own or admin |
| `check_ins` | SELECT: the booking's PT, the booking's client, admin. No writes outside RPCs |
| `bookings` | add `amount_cents INTEGER` (≥ 0), `currency CHAR(3) DEFAULT 'USD'`, `receipt_no BIGINT UNIQUE`, `rating SMALLINT` (1–5), `rating_comment TEXT`, `rated_at TIMESTAMPTZ` |
| `booking_rules` | add `price_cents INTEGER` (≥ 0, nullable) |
| triggers | `bookings_default_amount` BEFORE INSERT; `bookings_receipt_no` BEFORE UPDATE OF status |

| RPC | Who | Does |
|---|---|---|
| `checkin_code(secret, booking, window)` | internal | D1 |
| `checkin_keys(p_from, p_to)` | PT | Their own `scheduled`/`checked_in` bookings in range, creating missing keys. Returns `booking_id, secret_hex` |
| `check_in(p_booking_id, p_code, p_window, p_at)` | client, PT | D4/D5. Returns `booking_id, status, checked_in_at, checked_out_at, outcome` (`checked_in`/`checked_out`/`already`) |
| `check_out(p_booking_id)` | PT | D6 |
| `rate_booking(p_id, p_rating, p_comment)` | client | D7 |
| `set_booking_amount(p_id, p_cents)` | PT | D8. Not on cancelled bookings |
| `save_availability` | PT | gains `price` in `p_rules` (cents or null) |
| `booking_policy` | unchanged | — |
| `save_reminder_settings(p JSONB)` | PT | D13 |
| `start_workout_session` / `complete_workout_session` | as today | D6 |

Typed errors: `wrong_booking`, `code_expired`, `bad_code`, `no_booking_now`, `outside_check_in`, `not_checked_in`, `not_ratable`, plus M5a's `booking_closed`.

## 5. Screens

| Screen | Route | Notes |
|---|---|---|
| QR check-in (PT) | `schedule/[id]/check-in` | White code card in every theme, four-step strip, 60 s countdown, 6 digits, Check in by hand. Checked in → Start session, Check out. Checked out → summary, Back to schedule. Empty (outside window), error (no key) → by hand. Offline banner |
| Scan (client) | `bookings/scan` | Dark camera with ember frame, scans with no tap. Success / wrong booking / expired / bad code / camera denied → 6-digit entry. Offline: saved on this phone |
| After-session sheet (client) | `bookings/[id]/rate` | 1–5 targets, one tap submits; comment; tip placeholder (Coming soon, disabled); thanks + View receipt |
| Receipt | `bookings/[id]/receipt` | Mono figures, receipt number, date, time, coach, length, program day if a session was logged, amount or "Not recorded", Share |
| Reminders (PT) | `settings/reminders` | "Not sent yet" banner, six toggles, empty state when no client reminder is on |
| My bookings | existing | Past rows: Rate / Rated N, Receipt; next card: Scan to check in |
| Booking detail | existing | Show check-in code; Amount row (edit sheet); checked-in state shows check-in time |
| Availability › Rules | existing | Session price stepper (USD, step $5, blank = not set); Reminders link |
| Admin | web `admin/users/[id]` | Bookings table gains Checked in, Rating, Amount |

## 6. Verification

1. **SQL** — harness cases: shared HMAC vector; a client can't read keys or `check_ins` of others; QR check-in; replay is idempotent; expired window refused; wrong client's code → `wrong_booking`; typed code finds the booking; no booking → `no_booking_now`; second scan < 10 min no-op, ≥ 10 min checks out; PT manual check-in; session links a checked-in booking and its completion checks out; receipt number assigned once; default amount copied; rating only by the client, only when completed; reminders own-only.
2. **Vitest** — `checkinCode` against the same vector, payload parse/format, window math, receipt number format, `PendingQueue` (dedupe, drain, permanent drop, transient keep), error map.
3. **Typecheck / lint / test.**
4. **Screen walk** on the web target: PT opens the code → client types it → PT screen flips to Checked in → PT starts and completes a session → client gets the rating sheet → rates → receipt shows amount and number; reminders toggle persists; wrong/expired code copy. Then a live-DB read.

## 7. Out of scope

Sending reminders (M9 push), tips and payment state (M6), receipt PDF (M6), geofence check-in, Google (M5c).

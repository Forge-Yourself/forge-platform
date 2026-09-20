# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Forge** is a PT-first (personal trainer) SaaS platform for trainers, studios, and the people they coach. Lebanon-first market, expanding to UAE.

- **Phase:** In development. M0 (foundation), M1 (auth & identity), M2 (clients & intake), M3 (programming), M4a (log core), M4b (offline + live mirror), M4c (body metrics and progress photos) and M4d (floor ergonomics: iPad console, voice, lock-screen rest) are complete. M5 (scheduling) is next. M4 was split into four sub-milestones on 2026-09-18 — see the M4a spec for why.
- **Repository:** pnpm + Turborepo monorepo — `apps/mobile` (Expo), `apps/web` (Next.js admin + API), `packages/shared` (tokens, i18n, zod schemas, generated DB types), `supabase/migrations`, `db/` (schema source + RLS harness).
- **Status:** Application code exists and is deployed. Expo app boots themed/RTL-capable with working Supabase Auth (email/password + Google), TOTP MFA, password reset, onboarding, profile, settings, a client roster with invite/claim/pause/deactivate, a resumable 5-step intake with PAR-Q red-flag detection, and waiver e-signature. Next.js admin is live on Vercel with staff login, user search, a PT's client roster, and a client's intake status; it also serves the waiver PDF API and the public `/join` invite-link page. Expo also has a PT tab bar (Today/Clients/Programs/Library), a 205-exercise library with search and custom exercises, a program builder with copy-week and assign, an AI draft flow metered by a credit ledger, and a client's read-only view of their assigned program. Expo also logs workouts: a PT or a client starts a session from client detail or the client's Today screen, logs weight x reps with RPE and notes against the programmed day or freestyle, gets a rest timer and a personal-record moment, and both personas see their session history. Behind a server-controlled beta switch (off by default), logging also works with no signal: writes queue in an on-device outbox (SQLite native, IndexedDB web) that replays the same four RPCs when the signal returns, the screens a session needs read from a warmed cache, a sync queue shows what is waiting, and a PT and a client on the same session see each other's sets live over a private Realtime topic. Expo also records body metrics (weight, body fat, six circumferences) as a PT or a client, with an 8-week trend line, 4/12/26-week windows and a plateau flag, and takes progress photos through a live camera with a pose outline and a ghost of the last same-pose photo; a client's photos stay private until they share them, a PT's are shared, and either can put two dates side by side. Expo also gives a PT running several clients on one iPad a console — a rail of live and this-week sessions, a plan pane, and a fixed logging panel — where switching clients keeps each one's own rest clock running, and the phone gets the same live sessions in a switcher sheet. The current set can be logged by voice in English or Arabic, heard back and corrected before it saves, through a deterministic on-device parser in `packages/shared` that needs no network and no AI credit. The rest timer now survives the lock screen on Android through a local Kotlin Expo module's ongoing countdown notification with +30s and Skip that work even with the app killed, and the same on iOS as a Live Activity that is written but never compiled — no Apple developer account, and the simulator build was not attempted. Next.js admin also has a read-only program and AI-generation inspector plus a session inspector (with device and late-set tags), an offline-logging switch at `/admin/settings` with a per-user beta flag, and serves the AI broker at `/api/ai/program-draft`. Supabase Postgres project is live in Frankfurt with 18 migrations, all applied (baseline, Supabase Auth wiring, RLS, M1 identity, M2 clients/intake/waiver, a client-reads-own-PT RLS fix, M3 programming RLS + RPCs, the exercise library import, program_summaries, client activation + wallet backfill, intake progress counting answers not keys, the PAR-Q `bool_and` NULL fix, `0013`'s server-side PAR-Q gate, `0014`'s security hardening (admin-only AI credit refunds, RPC-only writes to `clients`, and an invite claim that no longer trusts autoconfirm), and `0015`'s M4a logging: per-set attribution, SELECT-only RLS on `workout_sessions` / `sets` / `exercise_prs` with every write behind `start_workout_session` / `log_set` / `delete_set` / `complete_workout_session`, and `ensure_month_partitions()` on a monthly `pg_cron` job so a new month's partition is no longer a hand-written migration), and `0016`'s M4b offline + mirror: `start_workout_session` takes a client-generated id and device times clamped to 24 h, late sets append to completed sessions, broadcast triggers feed private `session:<id>` Realtime topics readable only by participants and admins, and the `app_config.offline_logging` switch with `users.offline_logging_beta` and two `is_admin()`-guarded RPCs, and `0017`'s M4c body: `body_metrics.recorded_by_user_id` with a six-site circumference CHECK, `progress_photos` storing bucket paths with `taken_by_user_id` and no `encryption_key_id`, SELECT-only RLS where a PT sees photos only when shared and an admin sees rows but can never sign an image, the private `progress-photos` bucket with its `storage.objects` policies, six RPCs (`record_body_metric`, `delete_body_metric`, `record_progress_photo`, `set_photo_shared`, `delete_progress_photo`, `body_plateau`) and a service-role-only `progress_photo_orphans()` read by a daily Vercel Cron sweep), and `0018`'s M4d floor: Realtime Presence on session topics for participants, never admins) and RLS enabled on all tables. CI runs typecheck/lint/test on GitHub Actions.

## Documentation

All product documentation lives in `docs/`. Start at `docs/index.html` for the hub.

| Document | Purpose |
|---|---|
| `docs/Forge_Architecture.html` | **Primary source of truth.** 14 sections, 51 Mermaid diagrams: ERD (D11-D15), runtime flows (D16-D32), lifecycles (D33-D39), epics (EP-01 to EP-21), pricing, NFR, compliance |
| `docs/Forge_Brand.html` | Brand guidelines, colors, typography |
| `docs/Forge_DesignSystem.html` | Component library, spacing, dark mode tokens |
| `docs/superpowers/specs/2026-09-09-forge-v1-implementation-design.md` | **Build plan source of truth.** Real stack, M0–M10 milestone definitions, decisions log |
| `docs/superpowers/specs/*.md` | Other design decision specs (gym tier, PT hierarchy) |
| `docs/superpowers/plans/*.md` | Per-milestone implementation plans, one per completed/in-flight milestone |
| `docs/Forge_DesignBrief_M1-M4.md` | Screen-by-screen design brief for the first four build milestones |
| `docs/Forge_Prototype.html` | Claude Design clickable prototype (M1–M4 screens + designer annotations) |
| `docs/DESIGN_SYSTEM_GAPS.md` | Components the prototype needs that the design system doesn't have yet — built vs. outstanding |
| `docs/PITFALLS.md` | **Read before adding a screen, an input, or an `/api/*` caller.** Traps this codebase already fell into, each with the rule that prevents a repeat: screens own their own back control (every stack sets `headerShown: false`), escape affordances never live in the scroll body, `replace` not `push` after a state-changing submit, dates go through `DateField` not a bare `TextField`, key presence is not an answer, a rule written in both TS and SQL needs tests on both sides, every `/api/*` route the mobile app calls needs CORS (web target only — native `fetch` has no same-origin policy), the root auth gate is passive so a screen that changes gate state must navigate itself, a gate `<Redirect>` re-fires every render unless guarded by `isCurrentRoute`, and `href: null` hides a tab button without unregistering the route; a tab list stays mounted under a pushed screen so lists refetch on focus (N12), a screen with two entry points must work from both (N13), copy that says "do X first" needs X tappable on that screen (N14), Back uses `dismissTo` not `router.back()` on cold deep links (N15), every `{{name}}` interpolation needs a no-name variant (I3), a static review is not a test: run the `forge-screen-walk` skill before claiming a flow works (V1), NetInfo on web misses the browser going offline (W6), overlapping loads land out of order so only the newest may set state and forward-only state stays monotonic (O1), an offline simulation must drop the Realtime socket too (O2), Storage objects are removed through the Storage API and never SQL (S5), a Storage policy that must exclude admins spells out its own predicate (S6), and a `tsc` failure on route strings that exist means the gitignored `.expo/types/router.d.ts` is stale (V3); M4d adds that a native-only feature ships a web no-op behind the same interface (R1), a zero cue belongs to whatever owns all the clocks rather than the screen showing one of them (R2), headless Chrome has no speech service so the walk mocks the recognizer (V4), two config plugins that touch one Info.plist key must agree on a string (C1), and RTL layout is unverifiable on the web target because react-native-web's `I18nManager` is a no-op (V5) |
| `docs/superpowers/specs/2026-09-18-m4a-log-core-design.md` | M4a's spec, and the record of why M4 is four sub-milestones. Decisions that outlive M4a: every logging write is an idempotent RPC keyed on a client-generated ULID (so M4b's outbox replays the same four calls), per-set `logged_by_user_id` is what lets a PT and a client share one session safely, and partitions are repo-owned via `ensure_month_partitions()` + `pg_cron` |
| `docs/superpowers/plans/2026-09-18-m4a-log-core.md` | M4a's plan, 16 tasks, harness-first. Its "Corrections this plan makes to the spec" section is authoritative over the spec where they differ |
| `docs/superpowers/specs/2026-09-19-m4b-offline-mirror-design.md` / `docs/superpowers/plans/2026-09-19-m4b-offline-mirror.md` | M4b's spec and plan. The plan's corrections and As-built sections win over the spec. Rules that outlive M4b: every rule about queued writes lives in `SyncEngine` (`packages/shared/src/offline/`, vitest) over a five-method `KvStore`; the mobile adapters stay thin; a server row never overwrites a pending local write; a completed session never regresses to in_progress |
| `docs/superpowers/specs/2026-09-19-m4c-body-design.md` / `docs/superpowers/plans/2026-09-19-m4c-body.md` | M4c's spec and plan. The plan's Corrections and As-built sections win over the spec. Rules that outlive M4c: progress photos are private-bucket + RLS + signed URLs, not E2E (supersedes EP-06's wording); objects are removed through the Storage API before their row, and a service-role cron sweeps leftovers; admins never sign photo URLs; the weight plateau rule lives in SQL (`body_plateau`) and TS (`plateau()`) with shared fixtures |
| `docs/superpowers/plans/2026-09-12-m3-programming.md` | M3's plan. Where it and `Forge_Prototype.html` disagree, the plan's "Corrections" section wins: the library search count and credit balance are read live rather than hardcoded, and the AI generating state says "Usually under 12 seconds. Keep this screen open." rather than promising a notification (M9 builds notifications; the call is synchronous by design) |
| `docs/superpowers/specs/2026-09-19-m4d-floor-design.md` / `docs/superpowers/plans/2026-09-19-m4d-floor.md` | M4d's spec and plan. The plan's Corrections and As-built sections win over the spec. Rules that outlive M4d: every native feature has a web no-op; the rest clock is a persisted store keyed by session, and the driver — not the screen — owns the zero cue; voice parses deterministically in `packages/shared/src/voice` with a ≥ 95% fixture gate |

## Tech Stack (Actual — see `docs/superpowers/specs/2026-09-09-forge-v1-implementation-design.md`)

This supersedes the stack described in `docs/Forge_Architecture.html` Section 05, which predates the Supabase/RevenueCat decision.

| Layer | Technology |
|---|---|
| Mobile | React Native (Expo), all four personas, iOS/Android/iPad |
| Web dashboard | Next.js 16 (App Router) on Vercel — internal admin UI plus `/api/*` routes. `16.3.4` is what `apps/web/package.json` actually pins |
| Backend | Supabase (hybrid: Supabase owns auth/storage/realtime/RLS; Next.js API routes own logic needing secrets or rules too complex for SQL) |
| Database | Supabase Postgres 15+ (project `qkmgmzhrwduvigccwgcz`, Frankfurt) with pgcrypto, citext, pg_trgm, postgis, btree_gist. Managed via `supabase/migrations/`, not raw `psql -f db/schema.sql` |
| Auth | Supabase Auth — email/password + Google (Apple written provider-agnostic, pending a developer account), TOTP MFA, custom SMTP via Resend |
| Storage | Supabase Storage — private `waivers` bucket (M2, service-role only) and private `progress-photos` bucket (M4c): `storage.objects` policies, 60 s signed URLs, Supabase at-rest encryption, no E2E (M4c spec D1). Objects are removed through the Storage API, never SQL (PITFALLS S5). Form-check videos are later |
| Real-time | Supabase Realtime (live mirror, from M5) |
| Payments | RevenueCat over Apple IAP + Google Play Billing, planned for M6. Replaces the originally documented Whish + Areeba plan — removes PCI scope and KYC delay for a solo developer |
| AI | Claude API — `claude-opus-5` via `@anthropic-ai/sdk`, brokered server-side by `apps/web/app/api/ai/program-draft/route.ts` (the only holder of `ANTHROPIC_API_KEY`). Structured output via `messages.parse` + `zodOutputFormat`; depth via `output_config.effort`, never `budget_tokens` (removed on this model). Meal plans (M8) and monthly recaps (M9) reuse the same ledger |

## Four Personas

1. **PT (Personal Trainer)** — operates in one of three modes:
   - **Solo:** independent trainer, manages own clients
   - **Master:** runs a team of Sub-PTs, assigns clients, sees all data
   - **Sub-under-Master:** works under a Master PT, sees only assigned clients
2. **Client** — trains under a PT, logs workouts, tracks nutrition
3. **Gym Account** — always free, no card required. Manages PT roster and offline member lists
4. **Platform Admin** — Forge staff, compliance, support

## Six Product Pillars

1. **P1 Logging** — offline-first set logging with ULID PKs, voice input, PR tracking
2. **P2 Programming** — program builder (weeks → days → blocks → exercises), AI draft generation
3. **P3 Coaching** — client onboarding, intake forms, progress photos, form-check video review
4. **P4 Business & Scheduling** — booking calendar, QR check-in, recurring sessions, Google Calendar sync
5. **P5 Insights & AI** — dashboards, monthly recaps, AI credit wallet system
6. **P6 Marketplace & Growth** — gym directory, PT listings, events, Forge Shop (v2/v3)

## Database Schema

Located in `db/`:

| File | Content |
|---|---|
| `db/schema.sql` | Baseline DDL: 54 tables, indexes, constraints, partitions, triggers. **Predates migration 0002 — see the header warning.** `pt_certifications` (55th table) was added by migration `0004`, not reflected here |
| `db/seed.sql` | Reference data: badge definitions, exercise stubs |
| `db/README.md` | Domain map, table inventory, relationship diagram |

### Key Architecture Decisions

- **UUIDv7** for all PKs (time-ordered), except `sets` table which uses **ULID** (client-generated for offline-first sync)
- **CITEXT** for emails (case-insensitive)
- **PostGIS GEOGRAPHY** for gym coordinates
- **CHECK constraints** for state enums (not CREATE TYPE — easier migrations)
- **Partitioned tables:** `sets`, `food_logs`, `notifications`, `audit_logs` (monthly range)
- **Append-only `audit_logs`** enforced via REVOKE UPDATE/DELETE
- **Application-enforced FKs** from partitioned tables (PostgreSQL limitation)
- **No inter-party payments** — Forge is always merchant of record (PT/Client pay Forge only)

### Running the Schema

There is no local Postgres (no Docker) — migrations apply directly to the live Frankfurt Supabase project. **`db/schema.sql` predates migration `0002` and is out of date** (see the header warning in that file); `supabase/migrations/` is authoritative. Do not run `psql -f db/schema.sql` against a real environment.

```bash
supabase db push          # apply pending migrations to the linked remote project
supabase migration list   # confirm local and remote agree
pnpm types:gen             # regenerate packages/shared/src/database.types.ts after any schema change
```

After any migration touching RLS policies, run the security harness and expect every assertion to pass:

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -v ON_ERROR_STOP=1 -f db/rls_assertions.sql
```

`$PGURL` is not stored anywhere — build it from `SUPABASE_DB_PASSWORD` in the repo-root
`.env` plus the project ref and region above:

```bash
set -a && . ./.env && set +a
export PGURL="postgresql://postgres.qkmgmzhrwduvigccwgcz@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
# The URL deliberately carries no password. Always pass -w as well: without it psql
# hangs silently at a password prompt instead of failing.
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -w -c "select email, role, onboarding_completed from public.users;"
```

A read-only query against the live project is usually the fastest way to settle "did that
write actually land?" — see `docs/PITFALLS.md` N5 for a bug where reasoning about RLS from
the migrations would have pointed at the wrong layer entirely.

## Build Order (M0–M10)

v1 (below) is reached through ordered milestones, each independently usable —
not one big-bang launch. See
`docs/superpowers/specs/2026-09-09-forge-v1-implementation-design.md` §5 for
the full definition of each; plans for completed/in-flight milestones live in
`docs/superpowers/plans/`.

| Milestone | Scope | Status |
|---|---|---|
| M0 | Foundation — monorepo, auth/RLS migrations, themed RTL app boot | ✅ done |
| M1 | Auth & identity — EP-01, EP-02 Solo profile | ✅ done |
| M2 | Clients & intake — EP-03 | ✅ done |
| M3 | Programming — EP-04, EP-15 (AI draft) | ✅ done |
| M4a | Log core — EP-05 online: RLS + RPCs, session screen, rest timer, PR detection, history | ✅ done |
| M4b | Offline + live mirror — `expo-sqlite` outbox replaying the M4a RPCs, Realtime | ✅ done |
| M4c | Body — EP-06 metrics, progress photos, encryption decision | ✅ done |
| M4d | Floor ergonomics — iPad console, voice logging, Live Activity rest timer | ✅ done |
| M5 | Scheduling — EP-09, EP-10 (Realtime) | next |
| M6 | Money — EP-11 (RevenueCat) | |
| M7 | Hierarchy & gyms — EP-02 remainder | |
| M8 | Nutrition — EP-08 | |
| M9 | Comms & insights — EP-12, EP-14, EP-18, EP-19 | |
| M10 | Launch gate — EP-20 remainder, EP-13, **full 2,000+ exercise library import** (M3 ships 205 curated movements covering every filter value; EP-04's "≥2,000 exercises with demos" needs the licensed import, which is a data-only regeneration of `supabase/migrations/0008` from a longer `db/exercises/forge_exercise_library_v1.json` — no code change) | |

## Phase Roadmap (product scope, by version)

The table below is the original architecture doc's version-scope split — what
ships in v1 vs. later versions, by table count. It's a different axis from
the M0–M10 build order above: v1 is the *destination* the M0–M10 milestones
build toward, not a milestone itself. v1.5/v2/v3 are all post-M10.

| Phase | Scope |
|---|---|
| v1 | Core: auth, client management, program builder, set logging, scheduling, billing, notifications (40 tables) — this is what M0–M10 build |
| v1.5 | Challenges, gamification enhancements (2 tables) |
| v2 | Group classes, video sessions, marketplace listings (3 tables) |
| v3 | Events, tickets, Forge Shop (4 tables) |

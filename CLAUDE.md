# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Forge** is a PT-first (personal trainer) SaaS platform for trainers, studios, and the people they coach. Lebanon-first market, expanding to UAE.

- **Phase:** In development. M0 (foundation) and M1 (auth & identity) are complete on `develop`. M2 (clients & intake) is next.
- **Repository:** pnpm + Turborepo monorepo — `apps/mobile` (Expo), `apps/web` (Next.js admin + API), `packages/shared` (tokens, i18n, zod schemas, generated DB types), `supabase/migrations`, `db/` (schema source + RLS harness).
- **Status:** Application code exists and is deployed. Expo app boots themed/RTL-capable with working Supabase Auth (email/password + Google), TOTP MFA, password reset, onboarding, profile, and settings. Next.js admin is live on Vercel with staff login and user search. Supabase Postgres project is live in Frankfurt with 4 migrations applied (baseline, Supabase Auth wiring, RLS, M1 identity) and RLS enabled on all tables. CI runs typecheck/lint/test on GitHub Actions.

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

## Tech Stack (Actual — see `docs/superpowers/specs/2026-09-09-forge-v1-implementation-design.md`)

This supersedes the stack described in `docs/Forge_Architecture.html` Section 05, which predates the Supabase/RevenueCat decision.

| Layer | Technology |
|---|---|
| Mobile | React Native (Expo), all four personas, iOS/Android/iPad |
| Web dashboard | Next.js 14+ (App Router) on Vercel — internal admin UI plus `/api/*` routes |
| Backend | Supabase (hybrid: Supabase owns auth/storage/realtime/RLS; Next.js API routes own logic needing secrets or rules too complex for SQL) |
| Database | Supabase Postgres 15+ (project `qkmgmzhrwduvigccwgcz`, Frankfurt) with pgcrypto, citext, pg_trgm, postgis, btree_gist. Managed via `supabase/migrations/`, not raw `psql -f db/schema.sql` |
| Auth | Supabase Auth — email/password + Google (Apple written provider-agnostic, pending a developer account), TOTP MFA, custom SMTP via Resend |
| Storage | Supabase Storage (progress photos, videos, PDFs) — not yet used before M4 |
| Real-time | Supabase Realtime (live mirror, from M5) |
| Payments | RevenueCat over Apple IAP + Google Play Billing, planned for M6. Replaces the originally documented Whish + Areeba plan — removes PCI scope and KYC delay for a solo developer |
| AI | Claude API (program drafts, meal plans, monthly recaps) — from M3 |

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
| M2 | Clients & intake — EP-03 | next |
| M3 | Programming — EP-04, EP-15 (AI draft) | |
| M4 | Logging — EP-05, EP-06 (offline sync, Storage) | |
| M5 | Scheduling — EP-09, EP-10 (Realtime) | |
| M6 | Money — EP-11 (RevenueCat) | |
| M7 | Hierarchy & gyms — EP-02 remainder | |
| M8 | Nutrition — EP-08 | |
| M9 | Comms & insights — EP-12, EP-14, EP-18, EP-19 | |
| M10 | Launch gate — EP-20 remainder, EP-13 | |

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

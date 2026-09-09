# Forge v1 — Implementation Design

**Date:** 2026-09-09
**Status:** Approved design, pending implementation plan
**Supersedes:** stack assumptions in `docs/Forge_Architecture.html` Section 05 (written before Supabase and RevenueCat were chosen)

---

## 1. Where the project stands

- Documentation complete: architecture (14 sections, 51 diagrams, 21 epics), brand, design system, gym-tier spec.
- Database schema complete: 54 tables, deployed to Supabase project **Forge** (`qkmgmzhrwduvigccwgcz`, Frankfurt, Frreelance org).
- No application code exists yet.
- Toolchain present locally: Node 24, pnpm 9.15, Supabase CLI 2.101, no Docker.

## 2. Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Backend shape | Hybrid: Supabase + thin API | Supabase owns auth, storage, realtime, RLS. API owns logic needing secrets or rules too complex for SQL. |
| D2 | Team | Solo developer + Claude | Every other decision optimizes for one person's throughput. |
| D3 | Client surfaces | Expo app (all personas) + Next.js admin web | One paying-customer surface. PT works in the app, including iPad console. Admin web is internal only. |
| D4 | v1 scope | Full documented v1 (16 epics) as destination | Reached through ordered milestones, each independently usable — not one big-bang launch. |
| D5 | API runtime | Next.js API routes on Vercel | Admin UI and API ship as one project. Accepts serverless limits; AI draft target of 12s fits well inside them. |
| D6 | Identity | Supabase Auth owns credentials | `public.users` becomes a profile table keyed to `auth.users(id)`. EP-01 becomes configuration rather than security-critical code. |
| D7 | Payments | RevenueCat over Apple IAP + Google Play Billing | Replaces Whish + Areeba in v1. Removes PCI scope, KYC delay, and risk R-1 entirely. |
| D8 | Testing | Unit tests only for now; no integration harness | No Docker locally. Compensated by an RLS assertion script and keeping sync-merge logic pure. |

### PT works in the app, not a dashboard

The PT's core loop is gym-floor work: log sets, check clients in, review progress. That is phone and iPad, and Expo builds tablet layouts from the same codebase (EP-05 already specifies an iPad PT-console).

The one genuinely dense screen is the program builder (EP-04). Rather than duplicate every screen on web to serve it, v1 replaces drag-and-drop with a list-based picker plus copy-week, and leans on the AI draft (EP-15) to produce the first version of a program that the PT then tweaks. A PT web dashboard is a v1.5/v2 decision, made only if design-partner PTs ask for one. The shared API means adding it later costs no rework.

## 3. Architecture

### Runtime topology

| Component | Responsibility |
|---|---|
| Expo app (iOS, Android, iPad) | All four personas. Simple reads go direct via `supabase-js` under RLS. Writes needing rules go to the API. |
| Next.js on Vercel | Platform Admin UI, plus `/api/*`: RevenueCat webhooks, AI broker, offline-sync endpoint, PDF generation, notification fan-out |
| Supabase | Postgres, Auth, Storage (photos, videos, PDFs), Realtime (EP-05 live mirror), `pg_cron` (partition rollover, streaks, reminder queue) |
| RevenueCat | Subscription state and entitlements over Apple IAP and Google Play Billing |
| Expo Push | APNs and FCM behind one abstraction (EP-18) |

### Repository layout

```
apps/mobile          Expo app
apps/web             Next.js: admin UI + /api routes
packages/shared      zod schemas, domain types, tier caps, adherence formula
db/schema.sql        schema source of truth
supabase/migrations  ordered migrations, baseline first
```

pnpm workspaces with Turborepo. Types generated from the live schema via `supabase gen types typescript` land in `packages/shared` and are consumed by both apps.

### Authorization model

Two enforcement layers, deliberately:

1. **RLS on all 54 tables** — the backstop if a client key is compromised. SQL helper functions encode the persona matrix: `is_pt_of_client()`, `is_master_of()`, `gym_member_pt()`.
2. **TypeScript checks in API routes** — rules too complex for SQL: tier caps, AI credit math, sync conflict resolution. These routes use the service-role key, so they must re-check every rule they bypass.

### Offline logging (EP-05)

Client-generated ULIDs in `expo-sqlite`, an outbound queue that survives app kill, and an idempotent `/api/sync` endpoint keyed on ULID. Merge logic stays a pure function so it is unit-testable without a database. Supabase Realtime drives the client-side live mirror.

## 4. Schema changes required

| Migration | Content |
|---|---|
| `0001_baseline` | Current `db/schema.sql` verbatim, then `supabase migration repair --status applied`. The schema was pushed by raw execution, so the migrations directory is empty and `db push` would otherwise try to recreate everything. |
| `0002_supabase_auth` | `public.users.id` references `auth.users(id)`. Drop `password_hash`, `mfa_enabled`, `mfa_method`, `mfa_key_id`, `failed_login_count`, `locked_until` — Supabase Auth owns all of it. Trigger creates the profile row on signup. |
| `0003_rls` | Enable RLS on all 54 tables, add helper functions, add policies for the tables M1–M4 touch. Later milestones extend policies as they add tables. |
| `00xx_revenuecat` (M6) | Add `store_product_id` to `subscriptions`; add a unique constraint on `charges.processor_ref` for webhook idempotency. Existing `payment_method` values `apple_iap` and `google_iap` already cover the stores; `processor_subscription_id` holds the RevenueCat identifier. `users.id` doubles as the RevenueCat app user id. |

**Security note:** the deployed database currently has zero RLS policies, and Supabase exposes every `public` table through PostgREST. No keys have been distributed, so present risk is nil, but `0003_rls` must land before the first client build ships.

## 5. Build sequence

### M0 · Foundation
Baseline, auth, and RLS migrations. Monorepo scaffold. Generated types. Theme ported from `Forge_DesignSystem.html`, **built RTL-first** — Arabic is a v1 requirement (risk R-6) and retrofitting RTL late is a known v1 killer. GitHub Actions running typecheck, lint, and unit tests. Vercel and EAS projects wired with secrets.
**Done when:** the app boots on a real device and shows a themed screen.

### M1 · Auth & identity — EP-01, EP-02 (Solo only)
Supabase Auth with email, Apple, and Google. MFA, email verification, role selection, PT profile. Admin web gets staff login and user search.
**Done when:** you can sign up on your phone, pick a role, and see your profile.

### M2 · Clients & intake — EP-03
PT invites a client. PAR-Q, goals, training history, anthropometrics, dietary restrictions. Pause and resume across devices. Red-flag review screen for the PT. Waiver e-signature generating a server-side PDF into Storage.

### M3 · Programming — EP-04, EP-15 (draft only)
Exercise library. Weeks → days → blocks → exercises builder. Templates that copy rather than mutate. AI 4-week program draft through the Claude broker, with the credit ledger and refund-on-failure path.

### M4 · Logging — EP-05, EP-06 *(the differentiator)*
Offline SQLite store with outbox and ULIDs. Idempotent sync. Realtime live mirror. Rest timer surviving screen lock. RPE and notes. Voice logging. iPad console layout with multi-client switcher. PR detection, body metrics, progress photos.

### M5 · Scheduling — EP-09, EP-10
Availability publishing, bookings, recurring sessions with DST handling, Google Calendar two-way sync, `.ics` export. QR check-in and check-out, one-tap rating and tip, receipts.

### M6 · Money — EP-11 (RevenueCat)
RevenueCat SDK in the app, entitlements mapped to the tier matrix, webhook endpoint updating subscription state idempotently. Tier caps enforced in both RLS and API. AI credit packs as consumables. Store products configured in App Store Connect and Play Console.

### M7 · Hierarchy & gyms — EP-02 remainder
Master invites Sub-PTs, assigns clients, sees aggregates. Gym Account (always free) with roster and offline member lists. M:N PT↔gym state machine, bidirectional invites. RLS policies extended for the hierarchy.
Deliberately placed after Solo works: it is pure authorization complexity with no revenue until Master PTs exist.

### M8 · Nutrition — EP-08
Macro targets, meal plans with swaps, barcode scanning, dietary tags, food database imported from OpenFoodFacts.

### M9 · Comms & insights — EP-12, EP-14, EP-18, EP-19
Broadcast announcements with read receipts. Push, email, SMS, and in-app notifications with quiet hours. Adherence scoring, monthly PDF reports, AI monthly recap. Streaks with weekly freeze, badges.

### M10 · Launch gate — EP-20 remainder, EP-13
GDPR export and delete jobs, audit log viewer, quarantine tooling. Form-check video review. Penetration test, Arabic QA with a native speaker, store submission.

## 6. Parallel track — no dev time, blocks launch if late

1. **Legal entity decision** (open decision #1: Lebanon, UAE, or Estonia) — gates everything financial, including the RevenueCat payout account.
2. Apple Developer and Google Play accounts — verification lag, and both are hard prerequisites for RevenueCat.
3. Exercise library sourcing and licensing for 2,000+ items with demos — needed before M3 completes.
4. Recruit design-partner PTs for weekly usability testing — the stated mitigation for risk R-5.

## 7. Known deviations from the architecture doc

| Doc says | v1 does | Why |
|---|---|---|
| Whish + Areeba payments (EP-11) | RevenueCat over store billing | Removes PCI scope and KYC delay for a solo developer. Costs 15–30% store commission. |
| NestJS/Fastify on AWS, Auth0, S3, managed WebSocket | Supabase + Next.js API routes on Vercel | Months of infrastructure work avoided; matches the deployed database. |
| Progress photos end-to-end encrypted (EP-06) | Private buckets, signed URLs, encryption at rest | True E2E is incompatible with PT viewing and server-side thumbnails. |
| Food database ≥1M items (EP-08) | OpenFoodFacts subset | Full corpus does not fit the intended Supabase tier or the ≤500ms query target without heavy tuning. |
| Drag-and-drop program builder (EP-04) | List-based picker, copy-week, AI draft | Drag-and-drop is poor on touch; AI drafting is the better mobile product. |

## 8. Risk register changes

- **R-1 (Whish/Areeba integration)** — closed by D7.
- **R-2 (Lebanese banking)** — reduced; RevenueCat pays out to the platform entity's account, not a Lebanese one.
- **New R-11: Lebanese cards fail on App Store and Play.** Under capital controls, many Lebanese cards are rejected for USD store purchases, so some PTs may be unable to subscribe at all. Mitigation: RevenueCat Web Billing as a second channel, offer codes for design partners, and validating this with a real Lebanese card before M6 completes.
- **New R-12: store commission compresses margin.** $15 Pro nets $10.50–12.75. Decide before launch whether to reprice.
- **R-10 (over-broad v1 scope)** stands and is the dominant risk given D2 and D4. Mitigation is the milestone ordering: something usable ships at the end of every milestone.

## 9. How we work

**Claude implements, you verify.** Per milestone:

1. Claude writes an implementation plan for the milestone; you approve it.
2. Claude implements one vertical slice at a time — small enough to test in minutes.
3. Claude verifies what is machine-checkable: typecheck, lint, unit tests, build, and database queries.
4. You verify what is not: tap the app on a real device, confirm it looks and feels right, report failures with screenshots.
5. Fix, then commit the slice. Small commits so any slice can be rolled back alone.

**What Claude cannot do, so it stays yours:** tapping through the app, judging visual design and feel, App Store Connect and Play Console configuration, RevenueCat dashboard setup, the legal entity decision, recruiting design partners, and Arabic copy review.

**Verification without integration tests (D8):** RLS policies get a SQL assertion script — a file of queries run as the wrong user that must fail — executed via `supabase db query`. Sync merge logic stays a pure function with unit tests. Everything else is verified by you on a device.

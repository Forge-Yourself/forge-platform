# M0 · Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to work this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn a docs-and-schema repo into a running monorepo — three migrations landed on the live Supabase DB with RLS on, an Expo app booting on a real Android device showing a themed RTL-capable screen, a Next.js admin deployed on Vercel, and CI green.

**Done when:** the app boots on a real device and shows a themed screen (spec §5, M0).

---

## Context

`docs/superpowers/specs/2026-09-09-forge-v1-implementation-design.md` is the approved design. It supersedes the stack section of the architecture doc: Supabase + a thin Next.js API, RevenueCat instead of Whish/Areeba, Expo for all four personas, admin web internal only.

Today the repo holds documentation, `db/schema.sql` (54 tables, already pushed to Supabase project `Forge` / `qkmgmzhrwduvigccwgcz`, Frankfurt), and no application code. Two things make M0 urgent rather than merely first:

1. **The live database has zero RLS policies** and PostgREST exposes every `public` table. No keys have been distributed, so present risk is nil — but this must close before any client build exists.
2. **`supabase/migrations/` is empty** because the schema was pushed by raw execution. A `db push` today would try to recreate all 54 tables. The baseline-then-repair sequence fixes that, and every later milestone depends on it.

M0 ships no user-facing feature. Its output is the ground M1–M10 stand on, so the two irreversible choices in it — RTL-first layout and token-driven theming — are made here deliberately rather than retrofitted.

### Decisions locked with the user (2026-09-09)

| # | Decision |
|---|---|
| Styling | Typed tokens in `packages/shared` + RN `StyleSheet` behind a small primitive set. Designs are being produced in Claude Design, so tokens are the single source both the RN theme and the web CSS vars derive from. All styling flows through primitives, keeping a later swap contained. |
| Deploy | Full wiring **minus iOS**: Vercel project created and deployed, EAS configured with an Android dev build. iOS build deferred until the Apple Developer account exists (parallel track item 2). |
| Migrations | Claude applies them to the remote DB; user supplies `SUPABASE_DB_PASSWORD`. |
| RLS scope | **Deviation from spec §4:** `0003_rls` enables RLS on all 54 tables + ships helper functions + policies for the M1/M2 identity and client tables only. M3/M4 tables stay default-deny (no policy = no access under the anon key) and gain policies in their own milestone, when the access patterns are real rather than guessed. Default-deny breaks nothing: no client code touches those tables yet. |

### Prerequisites the user must supply before Task 2

| Secret | How to get it | Used by |
|---|---|---|
| `SUPABASE_DB_PASSWORD` | Supabase dashboard → Project Settings → Database | `supabase db push` |
| Supabase anon + service-role keys | `supabase projects api-keys --project-ref qkmgmzhrwduvigccwgcz` (CLI is already authed) | app + web env |
| Vercel access | `vercel login` in a terminal, or a `VERCEL_TOKEN` | Task 8 |
| Expo access | `eas login`, or an `EXPO_TOKEN` | Task 8 |

CLI state confirmed: Node 24.15.0, pnpm 9.15.9, Supabase CLI 2.101.0 authed with project `Forge` linked (`supabase/.temp/project-ref`). No Docker — everything is verified against the remote DB or by pure unit tests (spec D8).

---

## File structure

```
package.json                      workspace root, scripts delegate to turbo
pnpm-workspace.yaml
.npmrc                            node-linker=hoisted  (Expo + pnpm requirement)
turbo.json                        typecheck / lint / test / build
tsconfig.base.json                strict, shared by all packages
.github/workflows/ci.yml

packages/shared/
  src/theme/tokens.ts             colors, spacing, radius, type scale, motion — SINGLE SOURCE
  src/theme/semantic.ts           light + dark role maps (surface, text, border, accent…)
  src/i18n/en.json, ar.json       string catalogs
  src/database.types.ts           generated, do not hand-edit
  src/index.ts
  scripts/tokens-to-css.ts        tokens.ts → apps/web CSS vars (prevents drift)

apps/mobile/                      Expo + expo-router
  app/_layout.tsx                 ThemeProvider + I18nProvider + RTL bootstrap
  app/index.tsx                   themed boot screen (the M0 deliverable)
  src/theme/ThemeProvider.tsx     consumes packages/shared tokens
  src/ui/                         Screen, Text, Button, Card — every style goes through here
  src/lib/supabase.ts             supabase-js + SecureStore adapter
  eas.json

apps/web/                         Next.js App Router: admin UI + /api
  app/globals.css                 generated CSS vars
  app/api/health/route.ts
  vercel.json

supabase/migrations/
  0001_baseline.sql               db/schema.sql verbatim — never applied, only repaired
  0002_supabase_auth.sql
  0003_rls.sql
db/rls_assertions.sql             queries that MUST fail; the RLS test harness (D8)
```

---

## Task 1 · Repo hygiene and monorepo skeleton

**Files:** create `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `turbo.json`, `tsconfig.base.json`; modify `.gitignore`; delete `nul`.

- [ ] **Step 1 — Copy this plan into the repo.** `docs/superpowers/plans/2026-09-09-m0-foundation.md` (the plans dir exists and is empty).
- [ ] **Step 2 — Delete the stray `nul` file.** 0 bytes, untracked, an artifact of a PowerShell `> nul` redirect. `git status` first; it is the only untracked entry.
- [ ] **Step 3 — Extend `.gitignore`:** `node_modules/`, `.expo/`, `.next/`, `.turbo/`, `dist/`, `.env`, `.env.*`, `!.env.example`, `.vercel`.
- [ ] **Step 4 — Root `package.json`:** `private: true`, `packageManager: "pnpm@9.15.9"`, scripts `dev`/`typecheck`/`lint`/`test`/`build` delegating to `turbo run`.
- [ ] **Step 5 — `.npmrc` with `node-linker=hoisted`.** Non-negotiable: Expo's Metro resolver does not follow pnpm's symlinked store. Skipping this produces module-resolution failures that look like missing packages.
- [ ] **Step 6 — `pnpm-workspace.yaml`** listing `apps/*` and `packages/*`; **`turbo.json`** with `typecheck`, `lint`, `test`, `build` (build `dependsOn: ["^build"]`); **`tsconfig.base.json`** with `strict: true`, `moduleResolution: "bundler"`, path alias `@forge/shared`.
- [ ] **Step 7 — Verify:** `pnpm install` completes; `git status` clean apart from intended files.
- [ ] **Step 8 — Commit:** `chore: scaffold pnpm + turborepo workspace`

## Task 2 · Migration 0001 — baseline the deployed schema

**Files:** create `supabase/migrations/0001_baseline.sql`.

The schema was applied by raw execution, so Postgres has the tables but `supabase_migrations.schema_migrations` is empty. Recording the baseline as *already applied* is what stops `db push` from recreating 54 tables.

- [ ] **Step 1 — Copy `db/schema.sql` verbatim** to `supabase/migrations/0001_baseline.sql`. No edits: it must match what is deployed.
- [ ] **Step 2 — Export the DB password** for the session (`SUPABASE_DB_PASSWORD`) so pushes stay non-interactive.
- [ ] **Step 3 — Mark it applied:** `supabase migration repair --status applied 0001`
- [ ] **Step 4 — Verify:** `supabase migration list` shows `0001` as applied both locally and remotely. **Stop here and report if it does not** — every later migration depends on this line being right.
- [ ] **Step 5 — Commit:** `feat(db): baseline migration for deployed schema`

## Task 3 · Migration 0002 — hand identity to Supabase Auth

**Files:** create `supabase/migrations/0002_supabase_auth.sql`.

`public.users` becomes a profile table keyed to `auth.users(id)` (spec D6). Confirmed against `db/schema.sql:65-104`.

- [ ] **Step 1 — Write the migration:**
  - Drop the `id` default (`uuid_v7()`) — ids now originate in `auth.users`.
  - Add `FK users.id → auth.users(id) ON DELETE CASCADE`.
  - Drop `password_hash`, `mfa_enabled`, `mfa_method`, `mfa_key_id`, `failed_login_count`, `locked_until`.
  - `public.handle_new_user()` — `SECURITY DEFINER`, `SET search_path = public`, inserts the profile row from `NEW.raw_user_meta_data` (`display_name`, `role` defaulting to `client`, `locale` defaulting to `en`), `ON CONFLICT (id) DO NOTHING`; trigger `AFTER INSERT ON auth.users`.
  - Leave `user_sessions` in place but unused — Supabase Auth owns sessions; Task 4 gives it a deny-all posture.
- [ ] **Step 2 — Push:** `supabase db push`
- [ ] **Step 3 — Verify the FK and the dropped columns** with `supabase db query` against `information_schema`; expect zero rows for the six dropped columns and one row for the `auth.users` constraint.
- [ ] **Step 4 — Verify the trigger end-to-end:** create a throwaway user via the Auth admin API, confirm a matching `public.users` row appears, then delete the auth user and confirm the profile row cascades away.
- [ ] **Step 5 — Commit:** `feat(db): key public.users to auth.users`

## Task 4 · Migration 0003 — RLS, the security gate

**Files:** create `supabase/migrations/0003_rls.sql`, `db/rls_assertions.sql`.

- [ ] **Step 1 — Enable RLS on every table in `public`** via a `DO` loop over `pg_tables` (covers the partitions of `sets`, `food_logs`, `notifications`, `audit_logs` as well as parents). Default-deny is the resting state; policies are additive.
- [ ] **Step 2 — Helper functions** (`STABLE`, `SECURITY DEFINER`, `SET search_path = public`), each keyed on `auth.uid()`:
  - `current_role()` → `users.role`
  - `is_admin()` → role = `admin`
  - `is_pt_of_client(client_id uuid)` → a row in `clients` where `pt_user_id = auth.uid()`, **or** an active `client_pt_assignments` row for the caller
  - `is_master_of(pt_user_id uuid)` → `master_sub_relations` with `state IN ('accepted','active')`
  - Column names verified against `db/schema.sql:314-377` (`clients.pt_user_id`, `clients.client_user_id`) and `:350-376` (`client_pt_assignments.pt_user_id`, `.master_user_id`, `.is_active`).
- [ ] **Step 3 — Policies for the M1/M2 tables only** — `users`, `pt_profiles`, `pt_modes`, `device_tokens`, `clients`, `client_pt_assignments`, `intake_forms`. Two patterns, applied per table:
  - *self-owned* (`users`, `device_tokens`, `pt_profiles`, `pt_modes`): `USING (user_id = auth.uid() OR is_admin())`, same expression as `WITH CHECK` on write.
  - *PT-scoped* (`clients`, `client_pt_assignments`, `intake_forms`): the client's own user id, or `is_pt_of_client()`, or `is_admin()`.
  - `user_sessions` and `audit_logs` get **no** policy — deny-all to clients, service-role only.
- [ ] **Step 4 — Write `db/rls_assertions.sql`:** queries run as the *wrong* user that must return zero rows or raise — PT A reading PT B's client, a client reading another client's intake, anon selecting from `users`, anon selecting from `audit_logs`. This file is the RLS test harness under D8; every later milestone appends to it.
- [ ] **Step 5 — Push and run:** `supabase db push`, then `supabase db query -f db/rls_assertions.sql`. **Every assertion must fail-as-expected.** Report actual output — an assertion that unexpectedly *succeeds* is a security hole, not a test nit.
- [ ] **Step 6 — Commit:** `feat(db): enable RLS with persona helper functions`

## Task 5 · Generated types + shared package

**Files:** create `packages/shared/{package.json,tsconfig.json,src/index.ts,src/database.types.ts}`.

- [ ] **Step 1 — Scaffold `packages/shared`** as `@forge/shared`, extending `tsconfig.base.json`, with `vitest` wired to the root `test` task.
- [ ] **Step 2 — Generate types:** `supabase gen types typescript --linked --schema public > packages/shared/src/database.types.ts`. Add a root script `types:gen` so this is repeatable after every migration.
- [ ] **Step 3 — Verify** the generated file contains a `users` row type **without** `password_hash` — that proves it was generated after 0002 rather than from a stale schema.
- [ ] **Step 4 — Commit:** `feat(shared): generate database types from live schema`

## Task 6 · Tokens, theme, and i18n — the RTL-first layer

**Files:** create `packages/shared/src/theme/{tokens.ts,semantic.ts}`, `packages/shared/src/i18n/{en.json,ar.json}`, `packages/shared/scripts/tokens-to-css.ts`, plus tests.

Ported from `docs/Forge_DesignSystem.html` (tokens at `:952-997`, type scale at `:254-290`). RTL is built in now because retrofitting it late is a known v1 killer (risk R-6).

- [ ] **Step 1 — `tokens.ts`:** the full brand ramp (charcoal 900/800/700, iron 600→100, cream 100/50, ember 700→100), semantic success/warn/danger with their backgrounds, the 4px spacing scale (4→80), radii (sm 6 · md 10 · lg 14 · xl 20 · pill 999), the type scale (display 48/900/-1, h1 32/800/-0.5, h2 24/700, h3 18/700, body 15/400, body-bold 15/600, caption 13), font stacks (sans + JetBrains Mono — **all numeric data is mono**, it is how PT brains read), and motion (80/150/220ms, `cubic-bezier(.2,.8,.2,1)`).
- [ ] **Step 2 — `semantic.ts`:** role maps for both schemes — `surface`, `surfaceRaised`, `textPrimary`, `textSecondary`, `border`, `accent`, `onAccent`, plus the semantic trio. The design system is dark-first (charcoal-800 is the primary surface); light mode inverts onto cream/white. Dark mode is not optional — gym floors are dark.
- [ ] **Step 3 — Write the failing contrast test first** (`tokens.test.ts`): a WCAG 2.2 AA assertion that body text on surface is ≥4.5:1 **in both schemes**. Run it, watch it fail, then fix the token mapping until it passes. This turns an accessibility requirement into a regression test rather than a code-review hope.
- [ ] **Step 4 — i18n catalogs** `en.json` / `ar.json` with the boot-screen strings, and an `isRTL(locale)` helper.
- [ ] **Step 5 — `tokens-to-css.ts`:** emit `apps/web/app/globals.css` CSS vars from the same `tokens.ts`. Root script `tokens:css`. One source, two surfaces, no drift when Claude Design output lands.
- [ ] **Step 6 — Verify:** `pnpm test` green including the contrast assertion.
- [ ] **Step 7 — Commit:** `feat(shared): port design tokens with RTL and dark mode`

## Task 7 · Expo app — the M0 deliverable

**Files:** create `apps/mobile/` (scaffolded), `app/_layout.tsx`, `app/index.tsx`, `src/theme/ThemeProvider.tsx`, `src/ui/*`, `src/lib/supabase.ts`, `.env.example`.

- [ ] **Step 1 — Scaffold** with `npx create-expo-app@latest` (default expo-router template) into `apps/mobile`, then **pin whatever versions it installs** — do not hand-write version numbers.
- [ ] **Step 2 — Wire the workspace:** `@forge/shared` as a workspace dep, Metro config extended to watch the monorepo root.
- [ ] **Step 3 — `ThemeProvider`** reading the device scheme and exposing `useTheme()`.
- [ ] **Step 4 — Primitives** (`Screen`, `Text`, `Button`, `Card`) using **logical** style props only — `paddingStart`/`marginEnd`, never `left`/`right`. Buttons get a ≥44×44pt touch target (design brief constraint). Every screen from M1 on is built from these, so a styling-approach change stays contained here.
- [ ] **Step 5 — i18n bootstrap:** `i18next` + `expo-localization`, and RTL applied through `I18nManager.forceRTL()` at startup. Note in code why the app must reload for a direction flip to take effect — it is a native-layer constraint, not a bug.
- [ ] **Step 6 — Supabase client** with an `expo-secure-store` adapter, reading `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Commit `.env.example`, never `.env`.
- [ ] **Step 7 — Boot screen** (`app/index.tsx`): Forge wordmark, the type scale rendered, a light/dark indicator, an EN⇄AR toggle, and a Supabase connectivity line proving the anon key reaches the project. This is the screen the milestone is graded on.
- [ ] **Step 8 — Verify (machine):** `pnpm typecheck` and `pnpm lint` green.
- [ ] **Step 9 — Verify (device, yours):** `pnpm --filter mobile start` → open on a real Android device → confirm the themed screen, dark mode, and that the AR toggle mirrors the layout. **I cannot do this step; report back with a screenshot.**
- [ ] **Step 10 — Commit:** `feat(mobile): themed RTL-capable boot screen`

## Task 8 · Next.js admin + CI + deploy wiring

**Files:** create `apps/web/` (scaffolded), `app/api/health/route.ts`, `vercel.json`, `.github/workflows/ci.yml`, `apps/mobile/eas.json`.

- [ ] **Step 1 — Scaffold `apps/web`** with `pnpm create next-app@latest` (App Router, TypeScript), importing the generated `globals.css` and a placeholder admin page. Confirm `apps/web` — not the repo root — is the Vercel root directory.
- [ ] **Step 2 — `/api/health`** returning schema reachability, so the deployment is verifiable without a UI.
- [ ] **Step 3 — CI workflow:** checkout → `pnpm/action-setup` → `setup-node` with pnpm cache → `pnpm install --frozen-lockfile` → `turbo run typecheck lint test`. Triggers on push and PR to `main` and `develop`.
- [ ] **Step 4 — Push the branch and confirm CI is green** on the real runner. Local-green is not the claim being made here.
- [ ] **Step 5 — Vercel:** `vercel link` + `vercel --prod`, set `SUPABASE_SERVICE_ROLE_KEY` and the public vars as project env. **Requires your login or a token.** I will report the deployment URL and confirm `/api/health` responds.
- [ ] **Step 6 — EAS:** `eas init` + `eas build:configure`; `eas.json` gets a `development` profile with `developmentClient: true` and an Android `preview` APK profile. Kick off **Android only** — iOS is deferred until the Apple Developer account exists.
- [ ] **Step 7 — Commit:** `ci: add typecheck/lint/test workflow and deploy config`

## Task 9 · Close-out

- [ ] **Step 1 — Document the wiring** in `README.md`: env vars, which dashboards need which secret, and the exact commands to run the app, the web, and the migrations.
- [ ] **Step 2 — Re-run the full verification list below** and report actual output, not expectations.
- [ ] **Step 3 — Commit and open the PR** to `develop`.

---

## Verification

| # | Check | Command | Who |
|---|---|---|---|
| 1 | Migrations recorded, none pending | `supabase migration list` | Claude |
| 2 | Auth FK live, six columns gone | `supabase db query` on `information_schema` | Claude |
| 3 | Signup trigger creates the profile row | create + delete a throwaway auth user | Claude |
| 4 | **RLS holds** — every assertion fails as intended | `supabase db query -f db/rls_assertions.sql` | Claude |
| 5 | Types match the post-0002 schema | `password_hash` absent from `database.types.ts` | Claude |
| 6 | Contrast ≥4.5:1 in both schemes | `pnpm test` | Claude |
| 7 | Typecheck + lint clean | `pnpm typecheck && pnpm lint` | Claude |
| 8 | CI green on the runner | GitHub Actions | Claude |
| 9 | Admin deployment answers | `curl <vercel-url>/api/health` | Claude |
| 10 | **App boots on a real device, themed, mirrors in Arabic** | Expo on Android | **You** |

Check 10 is the milestone's stated done-when, and it is the one I cannot run. Checks 1–9 are machine-verified with real output reported.

## Risks

- **`db push` after the baseline repair.** If Task 2's verify step is wrong, push could attempt a full recreate. Mitigation: Task 2 stops the plan on a failed `migration list` rather than continuing.
- **No local Postgres (no Docker).** Every migration lands directly on the live Frankfurt DB. Mitigation: the DB holds no production data yet, and `db/rls_assertions.sql` is run immediately after each push.
- **pnpm + Expo resolution.** `node-linker=hoisted` is load-bearing; without it Metro fails in ways that read as missing dependencies.
- **Claude Design output arrives mid-milestone.** Tokens and primitives are built to receive it. If the design changes the palette, `tokens.ts` is the single edit point and the web CSS regenerates from it.

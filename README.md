# Forge

Mobile and web training platform for personal trainers, studios, and the people they coach. Lebanon-first, expanding to UAE.

All product documentation lives in [`docs/`](docs/). Start at [`docs/index.html`](docs/index.html) for the hub linking brand, design system, architecture, specification, and brief. The build plan is [`docs/superpowers/specs/2026-09-09-forge-v1-implementation-design.md`](docs/superpowers/specs/2026-09-09-forge-v1-implementation-design.md).

## Layout

| Path | What it is |
|---|---|
| `apps/mobile` | Expo app — all four personas, iOS/Android/iPad |
| `apps/web` | Next.js — internal admin UI plus `/api/*` routes |
| `packages/shared` | Design tokens, i18n catalogs, generated database types |
| `supabase/migrations` | Ordered migrations, baseline first |
| `db/` | `schema.sql` source of truth, `rls_assertions.sql` security harness |

Design tokens live in exactly one place: [`packages/shared/src/theme/tokens.ts`](packages/shared/src/theme/tokens.ts). The app reads them directly; the web CSS variables are generated from them with `pnpm tokens:css`. Never hand-edit `apps/web/app/globals.css`.

## Running it

```bash
pnpm install
pnpm --filter mobile start     # then open in Expo Go on a device
pnpm --filter web dev          # admin at http://localhost:3000
pnpm turbo run typecheck lint test
```

Copy `apps/mobile/.env.example` to `apps/mobile/.env` and `apps/web/.env.example` to `apps/web/.env.local`, then fill them from:

```bash
supabase projects api-keys --project-ref qkmgmzhrwduvigccwgcz
```

`node-linker=hoisted` in `.npmrc` is load-bearing — Metro cannot follow pnpm's symlinked store without it.

## Database

Migrations run against the remote Frankfurt project; there is no local Postgres (no Docker). Put the database password in a root `.env` as `SUPABASE_DB_PASSWORD`, then:

```bash
supabase db push          # apply pending migrations
supabase migration list   # local and remote should agree
pnpm types:gen            # regenerate types after any schema change
```

After every migration that touches policies, run the security harness and expect all assertions to pass. `psql` is not on `PATH`; PostgreSQL 18 is installed at:

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -v ON_ERROR_STOP=1 -f db/rls_assertions.sql
```

It runs inside a transaction that ends in `ROLLBACK`, so it leaves nothing behind. It contains denials *and* positive controls — a suite of denials alone would pass even if every table were locked shut.

RLS is enabled on all 54 tables plus their partitions. Tables with no policy are deny-by-default and gain policies in the milestone that needs them.

## Auth & identity (M1)

M1 turned the M0 boot screen into a real product entrance. What's built:

- **Sign-up / sign-in** — email + password (Supabase Auth), and Google over the in-app browser OAuth flow (`signInWithOAuth` + `expo-web-browser`, PKCE flow type — no custom dev build needed, works in Expo Go).
- **Email verification** and **password reset**, both via deep links resolved with `verifyOtp`, sent through custom SMTP (Resend) rather than Supabase's rate-limited default sender.
- **TOTP MFA** — enroll and challenge screens; SMS is drawn disabled ("Coming soon"). No backup codes (Supabase issues none for TOTP) — a lost authenticator needs support until M10.
- **Onboarding** — role selection (PT / Client; Gym Account has no v1 self-serve path), and for PTs a 4-step profile builder (identity, certifications, specializations, languages) capped at roughly five minutes.
- **Profile** — read-only view plus edit, backed by RLS column grants (a write outside the grant list fails at the database with `42501`).
- **Settings** — language, units, per-device appearance override, quiet hours, consents, sign-out.
- **Admin staff login** — `apps/web`'s `/login` + `/admin` + `/admin/users/[id]`, role-gated to `users.role = 'admin'`, reading under the anon key via RLS (no service-role key involved). See [`apps/web/README.md`](apps/web/README.md) for the auth model and, below, how to create the first admin.

### Promoting the first admin account

There is no self-service path to the `admin` role by design (`handle_new_user()` clamps new signups to `pt | client | gym_account`, and `set_initial_role()` explicitly refuses `admin`). Sign up a normal account through the mobile app, then promote it directly in the database:

```sql
UPDATE public.users SET role = 'admin' WHERE email = 'the-persons-email@example.com';
```

Full detail — including the `supabase db query`/`psql` invocation — is documented in [`apps/web/README.md`](apps/web/README.md#promoting-the-first-admin-account).

## Deployment

| Branch | Result |
|---|---|
| `main` | Production deploy → https://forge-admin-one.vercel.app |
| `develop` | Preview deploy per push |

Day-to-day work happens on `develop`; merging to `main` releases. GitHub Actions runs typecheck, lint, and tests on both.

Vercel project `forge-admin` has root directory `apps/web` and holds `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The service-role key bypasses RLS — server-side only, never prefixed `NEXT_PUBLIC_`.

**Deployment Protection is off.** M1 shipped staff login (`/login`, role-gated to `users.role = 'admin'`) so the admin app is no longer wide open to anyone with the URL — but it is still a public Vercel preview reachable by anyone who has the link, and Deployment Protection in Project Settings → Deployment Protection has not been turned on. Now that the admin holds real auth and (once M2 lands) real client data, enabling it is a genuine near-term to-do, not a deferred M1 dependency.

### Mobile builds

Expo Go covers everyday testing. A custom dev build only becomes necessary at M6, when RevenueCat adds native code:

```bash
cd apps/mobile
eas build --platform android --profile development
```

iOS build profiles are deliberately absent until the Apple Developer account exists.

## Secrets

| Name | Where it lives | Notes |
|---|---|---|
| `SUPABASE_DB_PASSWORD` | root `.env` | migrations only |
| `EXPO_PUBLIC_SUPABASE_*` | `apps/mobile/.env` | public by design, RLS is the boundary |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_*` | `apps/web/.env.local`, Vercel project env | admin web reads under the signed-in admin's own session, anon key only |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel project env | bypasses RLS, server only — read by `apps/web/lib/supabase/service.ts` (M2's waiver API routes: Storage upload/signed-URL, and the two `intake_forms` columns a client's own session is deliberately forbidden from writing) |
| `RESEND_API_KEY` | root `.env` | Supabase Auth's custom SMTP password (`env(RESEND_API_KEY)` in `supabase/config.toml`), applied with `supabase config push`. Get it from resend.com → API Keys |
| `CLIENT_ID` / `CLIENT_SECRECT` | Supabase dashboard → Authentication → Providers → Google (typo in the var name — `CLIENT_SECRECT`, not `_SECRET` — is preserved from `supabase/config.toml`'s `[auth.external.google]` block, not a documentation error) | Google OAuth web client credentials. Create in Google Cloud Console → Credentials → OAuth client ID (Web application), redirect URI `https://qkmgmzhrwduvigccwgcz.supabase.co/auth/v1/callback` |
| `VERCEL_TOKEN` / `EXPO_TOKEN` | root `.env` | CLI automation |

Every `.env` is gitignored. The repository is public — check `git status` before committing anything that reads like a credential.

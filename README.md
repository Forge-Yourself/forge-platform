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

After every migration that touches policies, run the security harness and expect all assertions to pass:

```bash
psql "$PGURL" -v ON_ERROR_STOP=1 -f db/rls_assertions.sql
```

It runs inside a transaction that ends in `ROLLBACK`, so it leaves nothing behind. It contains denials *and* positive controls — a suite of denials alone would pass even if every table were locked shut.

RLS is enabled on all 54 tables plus their partitions. Tables with no policy are deny-by-default and gain policies in the milestone that needs them.

## Deployment

| Branch | Result |
|---|---|
| `main` | Production deploy → https://forge-admin-one.vercel.app |
| `develop` | Preview deploy per push |

Day-to-day work happens on `develop`; merging to `main` releases. GitHub Actions runs typecheck, lint, and tests on both.

Vercel project `forge-admin` has root directory `apps/web` and holds `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The service-role key bypasses RLS — server-side only, never prefixed `NEXT_PUBLIC_`.

**Deployment Protection is off for the development phase.** Re-enable it in Project Settings → Deployment Protection once the admin holds real user data, or rely on the Supabase staff login that arrives in M1.

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
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel project env | bypasses RLS, server only |
| `VERCEL_TOKEN` / `EXPO_TOKEN` | root `.env` | CLI automation |

Every `.env` is gitignored. The repository is public — check `git status` before committing anything that reads like a credential.

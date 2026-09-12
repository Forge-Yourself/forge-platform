# Forge Admin Web

Internal-only Next.js App Router app for Forge staff (sign-in, read-only
user search/detail, English-only, no i18n) plus two customer-facing surfaces
added in M2: the waiver PDF API (`/api/waiver/*`) the Expo app calls
directly, and the public `/join` invite-link landing page. M3 adds the AI
broker (`/api/ai/program-draft`) and a read-only admin inspector for
programs and AI generations.

## Setup

```bash
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY and
# ANTHROPIC_API_KEY
pnpm --filter web dev
```

`SUPABASE_SERVICE_ROLE_KEY` is read by `lib/supabase/service.ts` — the
waiver routes' Storage upload/signed-URL and the `intake_forms` columns a
client's own session can't write itself. The admin pages still never use it
(they read under the signed-in admin's own session, anon key only).

`ANTHROPIC_API_KEY` (M3) has exactly one consumer:
`app/api/ai/program-draft/route.ts`. The Expo app calls that route rather
than Anthropic directly so the key never leaves the server, and the route
authorizes the caller under their own bearer token before it spends
anything. Without the key set, the route returns 502 with
`charged: false` — the app's copy then correctly tells the PT no credit was
taken.

## Auth model

Staff and PTs/clients share one Supabase auth pool — there is no separate
"admin" Supabase project. Signing in at `/login` only proves the credentials
are valid; it does not prove the account is staff. After a successful
`signInWithPassword`, the login page reads the caller's own `users.role`
(allowed under RLS: `id = auth.uid()`) and immediately signs back out if the
role isn't `admin`.

Every `/admin/*` page re-checks `users.role = 'admin'` itself. `middleware.ts`
only confirms a session exists and redirects unauthenticated requests to
`/login` — it is not the security boundary, since role isn't knowable that
cheaply/safely from Edge middleware alone in a way we want to rely on for
authorization.

All reads (user search, user detail, PT profile) go through the **anon key**
under the signed-in admin's own session. `users_select`
(`supabase/migrations/0003_rls.sql:128-130`) grants admins full read via
`is_admin()`, so **no service-role key is used or needed anywhere in this
app**.

## Promoting the first admin account

There is no self-service path to the `admin` role, by design:
`handle_new_user()` clamps new accounts to `pt | client | gym_account`, and
`set_initial_role()` explicitly refuses `admin`. To create the first admin:

1. Sign up a normal account through the mobile app (any role).
2. Promote it directly in the database with the Supabase CLI:

   ```bash
   supabase db query "UPDATE public.users SET role = 'admin' WHERE email = 'the-persons-email@example.com';" \
     --db-url "postgresql://postgres:${SUPABASE_DB_PASSWORD}@<db-host>:5432/postgres"
   ```

   Or equivalently with `psql` directly:

   ```sql
   UPDATE public.users SET role = 'admin' WHERE email = 'the-persons-email@example.com';
   ```

   This is a one-off, out-of-band operation — there is intentionally no UI or
   API route in this app that runs it.

3. That account can now sign in at `/login`.

No admin account has been created or promoted as part of this task — there is
nothing to promote yet, since the mobile signup flow never produces one.

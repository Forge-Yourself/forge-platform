# M1 · Auth & identity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to work this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the M0 boot screen into a real product entrance — Supabase Auth with email/password and Google, verified email, TOTP MFA, password reset, role selection, PT profile creation and edit, account settings, and a staff-login + user-search admin web, built to the Claude Design prototype.

**Done when:** you can sign up on your phone, pick a role, and see your profile (spec §5, M1).

**Scope:** EP-01 in full, EP-02's *Solo profile* bullet only. Master, Sub-PT and Gym membership are M7 by design.

---

## Close-out addendum (2026-09-11, Task 13)

All 13 tasks and their sub-steps are ticked `[x]` **except** the items below,
which stay `[ ]` because they have not happened yet — not because the
surrounding work is incomplete:

- Task 7, Step 8 — sign up with a real address, tap the Resend email link on
  device, land verified and signed in; reset password end to end.
- Task 8, Step 6 — tap Google in Expo Go, complete the browser flow, reach
  the role chooser, confirm `users.role` becomes `pt`.
- Task 9, Step 5 — enroll TOTP with a real authenticator app, sign out, sign
  in, get challenged, get in; unenroll and confirm the challenge stops.
- Task 10, Step 7 — complete a PT profile from a cold signup and time it
  (target: ≤5 minutes).
- **Task 12, Step 8 — the code/build half is done** (`pnpm --filter web
  build` passes, re-verified repeatedly), **but the Vercel-preview admin
  sign-in has not run**: no admin account has ever been promoted (the
  README's admin-promotion SQL exists but was never executed against a real
  account), so "sign in as admin, confirm a PT is rejected" is genuinely
  unverified, not just device-pending like the four items above.
- Task 13, Step 8 — "open the PR." No feature branch exists to open one
  from: every M1 commit landed directly on `develop` (see the git-state note
  below), and `origin/develop` is currently unpushed relative to local. This
  is a process/repo-state gap, not a testing one.
- Verification table rows 13–17 (sign-up→home loop, Google sign-in, TOTP
  round-trip, password reset by email, Arabic/dark-mode screen parity) — all
  four "You" rows above plus the RTL/dark-mode visual check.

Everything else machine-checkable (migrations, RLS assertions, types,
contrast tests, zod tests, typecheck/lint/build) was re-run for real during
Task 13 and passed — see the Verification section at the end of this file
for actual output, and the Task 13 close-out report for the full transcript.

Also: **no PR was opened.** Every M1 task through Task 12 was committed
directly onto `develop` — there is no feature branch this milestone's work
sits on, so there is nothing to open a PR *from* into `develop`. `develop` is
29 commits ahead of `origin/develop` (unpushed). See Task 13 Step 8 below.

---

## Context

M0 landed the ground: three migrations on the live Frankfurt DB with RLS on all 54 tables, an Expo app booting themed and RTL-capable in Expo Go, a Next.js admin on Vercel, CI green. It shipped no user-facing feature — [`apps/web/app/page.tsx:36`](apps/web/app/page.tsx#L36) literally says *"Staff sign-in and user search arrive in M1."*

M1 is the first milestone a human can use. Three things make it the right next step:

1. **Nothing downstream can be built without a session.** Every M2+ screen is scoped by `auth.uid()`. RLS policies for the identity tables already exist ([`supabase/migrations/0003_rls.sql:128-169`](supabase/migrations/0003_rls.sql#L128-L169)) and are currently unexercised by any code.
2. **The admin web is unauthenticated and deployed.** README:67 points at "the Supabase staff login that arrives in M1".
3. **`public.users` has been a profile table since 0002** but no code writes to it. The signup trigger, the column grants, and the escalation block in `db/rls_assertions.sql:141-152` are untested against a real client.

### The design is done and it is the specification

`docs/Forge Prototype.html` (untracked as of 2026-09-10) is the Claude Design export — a working clickable prototype, not static artboards. It covers **M1 through M4**: 11 M1 screens, 8 M2, 10 M3, 3 M4. Each screen carries the designer's own notes and, where a component does not exist yet, an explicit design-system gap flag.

It is a bundled page: 689KB with a JS unpacker. The readable content is a JSON string on line 392 plus a gzip blob on line 380 (dc-runtime, React, ReactDOM, Inter and JetBrains Mono woff2 — no design content in those). Unpack with `JSON.parse` on line 392; screens are `<sc-if value="{{ is_<name> }}">` blocks and the annotation model is the `GROUPS` array in the first inline `<script>`.

**Two M1 components are flagged as absent from the design system** and must be built: the **password-strength meter** (three segments, semantic colors only) and the **numeric keypad** (56pt keys, bottom third — the designer notes it is reused by M4 weight entry, so build it to be reused).

**The design has no role-chooser screen.** The brief listed it as already existing, so the prototype starts from a signed-up PT. Mockup 02 in [`docs/Forge_DesignSystem.html:602-624`](docs/Forge_DesignSystem.html#L602-L624) is the anchor, and the screen slots between email verification and MFA enrollment.

### Token reconciliation — the design vs `tokens.ts`

M0's port was accurate. The light and dark surface triples, `textSecondary`, `textMuted` and the light `border` match the prototype's theme maps exactly. Four values differ, and one is a WCAG failure:

| Role | `tokens.ts` today | Prototype | Contrast | Action |
|---|---|---|---|---|
| `darkColors.border` | `iron600 #3A4150` | `#2C3342` | — | adopt; new palette entry `charcoal600` |
| `darkColors.accentText` | `ember500 #FF8A3D` | `ember300 #FFB068` | 7.02 → **9.15** | adopt |
| `darkColors.textPrimary` | `cream50 #FBFAF7` | `cream100 #F5F2EE` | 15.78 → 14.76 | adopt; both clear AA |
| **`onAccent` (CTA text)** | `charcoal900` on ember600 = **5.51** | `#FFFFFF` on ember600 = **3.37** | **fails AA** | **white on ember-700 `#B84812` = 5.28** |
| on-tint text | `charcoal900` on every tint | `#8A5300` warn · `#1A4F31` success · `#8C2A1F` danger | 5.67 / 7.57 / 6.56 | adopt; hue-matched and all pass |
| `--emberSoft` | no equivalent | `#FCE7D3` light · `rgba(232,99,26,.18)` dark | — | new role `accentSurfaceSoft` |

The CTA is the one real conflict. Both the prototype and `.btn-accent` at [`docs/Forge_DesignSystem.html:103`](docs/Forge_DesignSystem.html#L103) draw white on ember-600, which is 3.37:1 — below the 4.5:1 the design brief itself mandates, and 16px bold is not WCAG "large text". Ember-700 is already the documented `:hover` fill, so darkening the rest state keeps the white-on-orange look in-system and reaches 5.28:1.

One more, marginal: selected chips use `--emberText #B84812` on `--emberSoft #FCE7D3` = **4.41:1**, just under the bar. Nudge the chip text to `#A03D0E` and assert it.

### Two latent defects M1 is the first to trip

- **Every partitioned table ends at 2026-10-31.** `audit_logs`, `notifications`, `sets`, `food_logs` each have `2026_05` … `2026_10` only ([`db/schema.sql:191-201`](db/schema.sql#L191-L201) and the three siblings). M1 is the first milestone that writes to a partitioned table, so inserts fail on 2026-11-01.
- **`notification_preferences` has RLS on and no policy.** Settings needs quiet hours, which live in `quiet_start` / `quiet_end` ([`db/schema.sql:1555-1576`](db/schema.sql#L1555-L1576)).

### Decisions locked with the user (2026-09-10)

| # | Decision |
|---|---|
| Providers | **Email/password + Google.** Google goes through the browser flow (`signInWithOAuth` + `expo-web-browser` + a `Linking.createURL` deep link), so no native module is added and the app stays testable in Expo Go. Apple is written provider-agnostically and enabled as config once the Apple Developer account exists. |
| MFA | **TOTP only, but keep the segmented pill.** SMS renders disabled with a "Coming soon" label, preserving the drawn layout and signalling the roadmap. |
| MFA recovery | **No backup codes.** Supabase issues none for TOTP, so the challenge screen's "Use a backup code instead" link is dropped and enrollment copy states plainly that a lost authenticator needs support until M10. |
| Email | **Custom SMTP via Resend.** The built-in sender caps at 2 emails/hour, which makes verification and reset untestable. |
| CTA | **White on ember-700 `#B84812`**, 5.28:1. Contrast test updated to assert it. |
| Certifications | **New `pt_certifications` table** (name, issuer, expires_on, status) — `certifications TEXT[]` cannot carry the issuer line and expiry the design draws. **No document upload in M1**; status is always `unverified`, so no badge claims a review that is not happening. Upload and admin review land with Storage in M4/M10. |
| Delete account | **Button shown, routes to support.** The user's call, against my recommendation: the screen offers what reads as self-service and hands off to a support sheet instead. Noted so M10 closes it with a real erasure job. |
| Theme override | Settings' Appearance row is **per-device, stored locally** in SecureStore. No `users` column and no migration — a PT's phone and iPad legitimately differ. |
| Venue | Profile step 4's "Where you coach" needs a gym relation, and gyms are M7. M1 ships that step as languages + the completion banner. |

### Prerequisites the user must supply

| # | Item | How to get it | Blocks |
|---|---|---|---|
| 1 | **Google OAuth client** (Web application) — ID + secret | Google Cloud Console → Credentials. Redirect URI: `https://qkmgmzhrwduvigccwgcz.supabase.co/auth/v1/callback` | Task 8 |
| 2 | **Resend API key** + verified sending domain (or `onboarding@resend.dev` for testing) | resend.com → API Keys | Task 2 |
| 3 | Confirm TOTP MFA is enabled for the project | Supabase dashboard → Authentication → Multi-Factor Auth. TOTP is on Free; only Phone MFA is paid | Task 9 |
| 4 | `SUPABASE_DB_PASSWORD` in root `.env` | Already present from M0 | Task 1 |

`psql` is **not on `PATH`** but PostgreSQL 18 is installed. The RLS harness runs as:

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -v ON_ERROR_STOP=1 -f db/rls_assertions.sql
```

---

## File structure

```
docs/Forge_Prototype.html         RENAMED from "Forge Prototype.html" — the space breaks scripts
                                  and every sibling is Forge_*.html

supabase/migrations/
  0004_m1_identity.sql            partitions, notification_preferences policy,
                                  pt_certifications, set_initial_role, log_account_event
supabase/templates/               confirm.html, recovery.html (deep-link aware)
db/rls_assertions.sql             MODIFIED — M1 cases appended
db/schema.sql                     MODIFIED — header warning: migrations are authoritative

packages/shared/src/
  theme/tokens.ts                 MODIFIED — charcoal600, ember800, on-tint trio
  theme/semantic.ts               MODIFIED — 4 role changes + accentSurfaceSoft
  theme/tokens.test.ts            MODIFIED — new pairs asserted
  schemas/{auth,profile,index}.ts + tests
  i18n/{en,ar}.json               MODIFIED — auth/onboarding/profile/settings strings

apps/mobile/src/
  lib/supabase.ts                 MODIFIED — flowType: 'pkce'
  lib/auth/{AuthProvider,useSession,oauth,audit}.ts
  lib/appearance.ts               per-device theme override
  lib/deepLinks.ts
  ui/  TextField ChoiceCard ChipRow Toggle Banner Spinner Skeleton
       FormScreen SegmentedPill PasswordStrength NumericKeypad
       CodeCells ListRow SectionCard StepProgress
  app/_layout.tsx                 MODIFIED — AuthProvider + route gate
  app/(auth)/{sign-in,sign-up,verify-pending,verify-success,forgot-password,
              reset-password,mfa-challenge}.tsx
  app/(onboarding)/{role,mfa-enroll,pt-profile}.tsx
  app/(app)/{index,profile,profile-edit}.tsx
  app/(app)/settings/index.tsx

apps/web/
  lib/supabase/{client,server,middleware}.ts
  middleware.ts
  app/login/page.tsx
  app/admin/page.tsx
  app/admin/users/[id]/page.tsx
```

---

## Task 1 · Migration 0004 — the M1 database gaps

**Files:** create `supabase/migrations/0004_m1_identity.sql`; modify `db/rls_assertions.sql`.

- [x] **Step 1 — Copy this plan into the repo** as `docs/superpowers/plans/2026-09-10-m1-auth-identity.md`, matching the M0 convention.
- [x] **Step 2 — Rename the design export** to `docs/Forge_Prototype.html` and commit it. The space in the current filename breaks unquoted shell paths, and every sibling doc is `Forge_*.html`.
- [x] **Step 3 — Extend every partitioned table through 2027-06.** A `DO` loop over `('audit_logs','notifications','sets','food_logs')` × months `2026-11` … `2027-06` using `CREATE TABLE IF NOT EXISTS … PARTITION OF`. Without it the first audit write after 2026-10-31 raises `no partition of relation found for row`. `pg_cron` rollover is M9's job; this buys nine months.
- [x] **Step 4 — Policy for `notification_preferences`** — strictly self-owned, the same shape as `device_tokens_all` at `0003_rls.sql:166-169`.
- [x] **Step 5 — `public.pt_certifications`** — `id` (uuid_v7 default), `pt_user_id` → `users(id) ON DELETE CASCADE`, `name` NOT NULL, `issuer`, `expires_on DATE`, `status` NOT NULL DEFAULT `'unverified'` with `CHECK (status IN ('unverified','in_review','verified','rejected'))`, `document_url` (nullable, unused in M1), timestamps, plus the `trg_*_updated_at` trigger. Self-owned RLS policy, and readable by anyone when the parent `pt_profiles.is_published` is true, mirroring `pt_profiles_select`. **`certifications TEXT[]` stays on `pt_profiles`** — dropping it is a separate migration once nothing reads it.
- [x] **Step 6 — `public.set_initial_role(p_role TEXT)`** — `SECURITY DEFINER`, `SET search_path = public`. Google signup carries no `raw_user_meta_data.role`, so `handle_new_user` lands those users as `client` ([`0002_supabase_auth.sql:41-48`](supabase/migrations/0002_supabase_auth.sql#L41-L48)) and the role chooser must be able to correct it. Guards: acts only on `auth.uid()`; `p_role IN ('pt','client','gym_account')` — **never `admin`**; permitted only while `onboarding_completed = FALSE`. This is why `role` stays out of the column grants at `0003_rls.sql:141-144` and the escalation assertion keeps passing.
- [x] **Step 7 — `public.log_account_event(p_action TEXT, p_details JSONB)`** — `SECURITY DEFINER`, actor always `auth.uid()` (never a parameter, so it cannot be forged), `p_action` restricted to `('user_login','user_logout','user_mfa_enable','user_mfa_disable','user_password_change')`. `audit_logs` stays policy-free and append-only; this is the only authenticated write path in. Comment that `user_register` and `user_login_failed` are excluded because no session exists at those moments and Supabase records them in `auth.audit_log_entries`.
- [x] **Step 8 — Push:** `supabase db push`, then `supabase migration list` — local and remote must agree on `0004`.
- [x] **Step 9 — Append M1 cases to `db/rls_assertions.sql`** in the existing `pg_temp.expect` / `pg_temp.act_as` style:
  - denial: PT B cannot read PT A's `notification_preferences` or `pt_certifications`
  - denial: `set_initial_role('admin')` raises; `set_initial_role` after `onboarding_completed = TRUE` changes nothing
  - denial: `log_account_event('user_delete', …)` raises — the allow-list holds
  - positive: a user reads and updates their own `notification_preferences`
  - positive: `set_initial_role('pt')` flips the role while onboarding is incomplete
  - positive: `log_account_event('user_login', …)` inserts exactly one row with `actor_id = auth.uid()`
  - positive: a published PT's certifications are readable by another authenticated user
- [x] **Step 10 — Run the harness** with the full psql path above. **Report actual output.** An assertion that unexpectedly passes-as-permitted is a security hole, not a test nit.
- [x] **Step 11 — `pnpm types:gen`**; confirm `pt_certifications` and both functions appear.
- [x] **Step 12 — Commit:** `feat(db): M1 identity policies, certifications, role and audit RPCs`

## Task 2 · Supabase Auth configuration

**Files:** modify `supabase/config.toml`; create `supabase/templates/{confirm,recovery}.html`.

`config.toml` describes the local stack, but keeping it accurate makes remote settings reviewable in git rather than living only in a dashboard. Apply with `supabase config push`; if a key is rejected, set it in the dashboard and note that in the file.

- [x] **Step 1 — Email:** `enable_confirmations = true`, `secure_password_change = true`, `minimum_password_length = 8`, `password_requirements = "lower_upper_letters_digits"`. Mirror the rule in the zod schema (Task 4) so the client error matches the server's.
- [x] **Step 2 — OTP expiry.** The design states two different lifetimes — 30 minutes on verify-pending, 15 on forgot-password — and Supabase has a single `otp_expiry`. **Set `otp_expiry = 1800` and make both copy strings say 30 minutes.** Copy that overstates urgency is a support ticket when a link still works, and understating it is worse.
- [x] **Step 3 — Custom SMTP:** `[auth.email.smtp]` → `smtp.resend.com:587`, user `resend`, `pass = "env(RESEND_API_KEY)"`, sender name `Forge`. Add `RESEND_API_KEY` to root `.env` and `.env.example`.
- [x] **Step 4 — Redirect allow-list.** `additional_redirect_urls` gains `forge://auth/callback`, `forge://auth/confirm`, `forge://auth/reset`, an `exp://*` wildcard for Expo Go's dynamic LAN URLs, `http://localhost:3000/**`, and `https://forge-admin-one.vercel.app/**`. A missing entry fails by bouncing to `site_url`, which presents as "the link did nothing".
- [x] **Step 5 — MFA:** `[auth.mfa.totp] enroll_enabled = true`, `verify_enabled = true`. Leave `[auth.mfa.phone]` false.
- [x] **Step 6 — Email templates.** Default templates link to `{{ .ConfirmationURL }}`, which round-trips through the web. For mobile the link must carry `token_hash` + `type` to a deep link the app resolves with `verifyOtp`. Write `confirm.html` and `recovery.html` using `{{ .TokenHash }}`, styled from the brand palette.
- [x] **Step 7 — Verify:** `supabase config push`, read the settings back, and send one real signup email to yourself — confirm it arrives from Resend, not Supabase.
- [x] **Step 8 — Commit:** `feat(auth): configure Supabase Auth, SMTP, and deep-link templates`

## Task 3 · Reconcile tokens with the design

**Files:** modify `packages/shared/src/theme/{tokens.ts,semantic.ts,tokens.test.ts}`; regenerate `apps/web/app/globals.css`.

Do this **before** any screen is built. Every primitive in Task 5 reads these roles, so changing them afterwards means touching every screen.

- [x] **Step 1 — Write the failing assertions first** in `tokens.test.ts`, exactly as M0 did for contrast: `onAccent` on `accent` ≥ 4.5, chip text on `accentSurfaceSoft` ≥ 4.5, and each on-tint pair ≥ 4.5 in both schemes. Run, watch them fail, then move the tokens.
- [x] **Step 2 — `tokens.ts`:** add `charcoal600 '#2C3342'`, `ember800 '#A03D0E'`, and the on-tint trio `onWarn '#8A5300'`, `onSuccess '#1A4F31'`, `onDanger '#8C2A1F'`.
- [x] **Step 3 — `semantic.ts`:** `accent` → `ember700` with `onAccent` → `white` (5.28:1, the locked CTA decision); `darkColors.border` → `charcoal600`; `darkColors.accentText` → `ember300`; `darkColors.textPrimary` → `cream100`; `onSuccessSurface` / `onWarnSurface` / `onDangerSurface` → the hue-matched trio; add `accentSurfaceSoft` (`ember100` light, `rgba(232,99,26,0.18)` dark). Keep the existing comment convention explaining *why* each value is what it is.
- [x] **Step 4 — Input borders use `borderStrong`, not `border`.** WCAG 1.4.11 wants 3:1 on the boundary of an active control, and `border` is a divider value in both schemes — M0 already noted this at [`semantic.ts:50`](packages/shared/src/theme/semantic.ts#L50). The design draws all field borders as `--line`; this is a deliberate, documented deviation.
- [x] **Step 5 — `pnpm test`** green, then `pnpm tokens:css` to regenerate the web vars. Never hand-edit `globals.css`.
- [x] **Step 6 — Commit:** `feat(shared): reconcile tokens with the design prototype`

## Task 4 · Zod schemas in `packages/shared`

**Files:** create `packages/shared/src/schemas/{auth,profile,index}.ts` and tests; modify `src/index.ts`, `package.json`.

These are the only genuinely unit-testable pieces of M1 (D8: no integration harness), so they are written test-first.

- [x] **Step 1 — Add `zod`** to `@forge/shared`, and as a workspace consumer dep in `apps/mobile` and `apps/web`.
- [x] **Step 2 — Failing tests first:** password rejects <8 chars and rejects a value with no uppercase or no digit; email trims and lowercases; `signUpSchema` rejects a role outside `pt|client|gym_account`; `totpCodeSchema` accepts exactly 6 digits; `passwordStrength()` returns 0–3 and only reaches 3 with length ≥12 plus mixed classes.
- [x] **Step 3 — `auth.ts`:** `emailSchema`, `passwordSchema` (mirroring Task 2's server policy), `signInSchema`, `signUpSchema`, `forgotPasswordSchema`, `resetPasswordSchema` (confirm-match refinement), `totpCodeSchema`, and `passwordStrength()` feeding the three-segment meter.
- [x] **Step 4 — `profile.ts`:** `userProfileSchema` covering exactly the columns `authenticated` may update ([`0003_rls.sql:141-144`](supabase/migrations/0003_rls.sql#L141-L144)). `ptProfileSchema` with `bio` capped at **300 chars** (the design's counter), `specializations[]`, `languages[]`, `years_experience`, `profile_photo_url` — **`hourly_rate_cents` and `currency` deliberately excluded**; the columns exist but Forge never handles session pricing. `ptCertificationSchema` for the new table. `quietHoursSchema` for `quiet_start` / `quiet_end`.
- [x] **Step 5 — Verify:** `pnpm test` green including the M0 contrast suite and Task 3's new pairs.
- [x] **Step 6 — Commit:** `feat(shared): zod schemas for auth and profile`

## Task 5 · Primitives, built to the design's measurements

**Files:** create the `apps/mobile/src/ui/*` components listed in the file structure; modify `ui/index.ts` and `ui/Button.tsx`.

Same contract as the M0 primitives: every style from `useTheme()`, logical props only, no hardcoded left/right. Measurements below are lifted from the prototype, not invented.

- [x] **Step 1 — `Button` gains a `size` prop.** The design's primary CTA is **52pt** (`btn-lg` in the design system), not the current 44. `size: 'md' | 'lg'`, default `md`; `lg` is `minHeight 52`, `font 700 16`, radius `md`, and the ember glow `0 6px 16px rgba(232,99,26,.28)`. The `accent` fill now resolves to ember-700 via Task 3.
- [x] **Step 2 — `TextField`** — label `700 11px` uppercase `letterSpacing 1.4` in `textMuted`; 6pt gap to the input; input `fontSize 15`, `padding 12/14`, `radius md`, `borderWidth 1.5`, `minHeight 44`; 14pt bottom margin. States: default `borderStrong`, error `dangerAccent` + `500 12px` message, success `successAccent` + message. Error and helper never render together. `secureTextEntry` with a reveal toggle; correct `textContentType`/`autoComplete` per use, or password managers ignore the field. `textAlign` follows `I18nManager.isRTL` — RN does not mirror input alignment for you.
- [x] **Step 3 — `PasswordStrength`** *(DS gap #1)* — three 4pt segments, `gap 4`, `radius 2`, filled with `successAccent` and unfilled with `border`. Driven by `passwordStrength()` from Task 4. Semantic colors only, per the designer's note. Announce the level to screen readers; a color-only signal is a WCAG 1.4.1 failure.
- [x] **Step 4 — `NumericKeypad`** *(DS gap #2)* — 3-column grid, `gap 8`, keys `minHeight 56`, `radius 12`, `surfaceRaised`, mono `20px/700`. The designer notes M4 weight entry reuses it, so take `onKey`/`onDelete` callbacks rather than wiring it to MFA state.
- [x] **Step 5 — `CodeCells`** — 6 cells, `flex 1`, `aspectRatio 1/1.15`, `radius 10`, `1.5px` border, mono `22px/700`; the active cell borders `accent`. Pairs with `NumericKeypad`.
- [x] **Step 6 — `SegmentedPill`** — `radius pill`, 4pt padding on `surfaceRaised`, items `minHeight 38`, `700 13px`; selected is `accent` fill. Supports a **disabled item with a "Coming soon" label** — that is how the SMS tab renders.
- [x] **Step 7 — `ListRow` and `SectionCard`** — settings' repeated chrome: card `radius 14`, `1px` border, rows `minHeight 60` with a `1px` bottom divider except the last, title `600 15`, subtitle `400 12.5` in `textMuted`, trailing value in `accentText` or a chevron. Section headers are `700 11px` uppercase `letterSpacing 1.5`.
- [x] **Step 8 — `StepProgress`** — 4pt track, `radius 2`, `accent` fill, width animated over `motion.slow` with `motion.easing`. The tokens already carry both values.
- [x] **Step 9 — `ChoiceCard`, `ChipRow`, `Toggle`, `Banner`, `Spinner`, `Skeleton`, `FormScreen`.** Chips: `radius pill`, `padding 10/16`, `minHeight 44`, selected = `accentSurfaceSoft` fill + `accent` border + `ember800` text (Task 3's contrast fix). `FormScreen` is `Screen` + `KeyboardAvoidingView` + `ScrollView` with `keyboardShouldPersistTaps="handled"` and a sticky footer, since every M1 form pins its action to the bottom third.
- [x] **Step 10 — Verify:** typecheck and lint green, then render every primitive once on the boot screen in both schemes and both directions before wiring a real screen to any of them.
- [x] **Step 11 — Commit:** `feat(mobile): primitives built to the design prototype`

## Task 6 · Session layer and route gating

**Files:** modify `lib/supabase.ts`, `app/_layout.tsx`; create `lib/auth/*`, `lib/appearance.ts`, `lib/deepLinks.ts`, the group layouts.

- [x] **Step 1 — `flowType: 'pkce'`** in the `createClient` auth options. The default is implicit, which cannot survive a mobile deep-link round trip. This one line is a prerequisite for Tasks 7, 8 and 9 and the most likely source of a mystifying "invalid flow state" later.
- [x] **Step 2 — `AuthProvider`** — holds `session`, the `public.users` row, the `pt_profiles` row when role is `pt`, and the MFA factor list. Subscribes to `onAuthStateChange`, refetches on `SIGNED_IN` and `USER_UPDATED`, clears on `SIGNED_OUT`. Exposes `status: 'loading' | 'signedOut' | 'signedIn'`. Follow the M0 `ThemeProvider` shape — React 19 `use(Context)`, no state library.
- [x] **Step 3 — `appearance.ts`** — per-device theme override in SecureStore (`'system' | 'light' | 'dark'`), read at boot and fed to `ThemeProvider`, which currently only reads `useColorScheme()`. This is what the Appearance row writes.
- [x] **Step 4 — Restructure into route groups.** Move the M0 boot screen to `app/(app)/index.tsx` as the signed-in home placeholder, minus the language card. Keep the Supabase-reachability line — it is the fastest triage tool on flaky gym wifi.
- [x] **Step 5 — The gate,** in the root `_layout.tsx`, following the prototype's own flow: hold the splash while `loading`; `signedOut` → `(auth)/sign-in`; signed in but `aal1` with `nextLevel: 'aal2'` → `(auth)/mfa-challenge`; `onboarding_completed = false` → `(onboarding)/role`; role `pt` with no `pt_profiles` row → `(onboarding)/pt-profile`; else `(app)`. Redirect only after the router mounts, or expo-router throws.
- [x] **Step 6 — `deepLinks.ts`** — `type=signup` → `verifyOtp({type:'signup', token_hash})`; `type=recovery` → `verifyOtp` then `(auth)/reset-password`; OAuth callback → `exchangeCodeForSession`. Handle **both** cold start (`Linking.getInitialURL`) and warm (`addEventListener`) — missing the cold path is why "the email link works, but only if the app was already open".
- [x] **Step 7 — `audit.ts`** — `log_account_event` wrapper that never throws into the UI. An audit write failing must not block a login.
- [x] **Step 8 — Verify:** typecheck, lint, and confirm on device that the app boots to sign-in without flashing the wrong route.
- [x] **Step 9 — Commit:** `feat(mobile): auth session provider and route gating`

## Task 7 · Email and password screens

**Files:** create `app/(auth)/{sign-in,sign-up,verify-pending,verify-success,forgot-password,reset-password}.tsx`; modify the i18n catalogs.

Screens are specified by the prototype; the notes below are the behaviour behind the pixels.

- [x] **Step 1 — `sign-in`** — wordmark `900 34px letterSpacing 7`, "Welcome back.", two fields, 52pt CTA, ghost "Forgot password?", "No account? Sign up" pinned at the bottom. Map Supabase error codes to human strings; `invalid_credentials` must read identically whether or not the email exists (no account enumeration). On success `log_account_event('user_login')`. The designer's note — *"tapping Sign in goes to the MFA challenge, that is the real path for an enrolled PT"* — is the gate from Task 6 Step 5, not a per-screen branch.
- [x] **Step 2 — `sign-up`** — "Create your account" / "Two minutes. Then you're in." Full name, email, password with the strength meter, terms checkbox whose **whole row is the 44pt target**. **Validate on blur, not per keystroke** — the designer calls this out explicitly. Role goes in `options.data.role` so `handle_new_user` gets it right on the first insert. Consent checkbox writes `consent_analytics` / `consent_marketing`.
- [x] **Step 3 — `verify-pending`** — 64pt ember-soft mail tile, the address in bold, "expires in 30 minutes" (matching Task 2 Step 2), a pulsing mono `WAITING FOR CONFIRMATION` pill reusing the live-mirror indicator pattern, then "I've verified — continue", a ghost "Resend link" with a visible cooldown honouring the SMTP rate limit, and "Wrong address? Change it". **Only one accent button per viewport** — resend is ghost by design.
- [x] **Step 4 — `verify-success`** — 76pt success circle in `successSurface`, "Email verified", then "Set up two-factor" as the CTA and "Skip for now" as a text button. MFA is **offered, not forced**; that is what keeps profile completion under five minutes.
- [x] **Step 5 — `forgot-password`** — back affordance is a text button with a chevron **that flips in RTL**. Copy states the expiry up front. Confirmation reads identically whether or not the address exists.
- [x] **Step 6 — `reset-password`** — reached only through the recovery deep link with a session already established by `verifyOtp`. Confirm field shows the success border plus "Passwords match." Copy warns about being signed out elsewhere **before** the tap. On save: `updateUser`, `signOut({ scope: 'others' })`, `log_account_event('user_password_change')`.
- [x] **Step 7 — i18n:** every string in `en.json` **and** `ar.json`, Arabic marked placeholder pending native review per [`i18n/index.ts:22`](packages/shared/src/i18n/index.ts#L22).
- [ ] **Step 8 — Verify (yours):** sign up with a real address, receive the Resend mail, tap the link on the device, land verified and signed in; then reset the password end to end. **This is the milestone's core loop — I cannot run it.**
- [x] **Step 9 — Commit:** `feat(mobile): email auth, verification, and password reset`

## Task 8 · Google sign-in

**Files:** create `lib/auth/oauth.ts`; modify `sign-in.tsx`, `sign-up.tsx`, `config.toml`.

- [x] **Step 1 — Enable the Google provider** with the credentials from prerequisite 1.
- [x] **Step 2 — `signInWithProvider('google')`** — `signInWithOAuth({ provider, options: { redirectTo: Linking.createURL('/auth/callback'), skipBrowserRedirect: true }})` → `WebBrowser.openAuthSessionAsync(url, redirectTo)` → `exchangeCodeForSession`. `expo-web-browser` and `expo-linking` are already dependencies, so **no new native module and no custom dev build** — this stays in Expo Go. `Linking.createURL` is what makes one code path produce `exp://…` in Expo Go and `forge://…` in a build.
- [x] **Step 3 — Provider-agnostic signature.** Adding `'apple'` later is a config change plus a button, not a rewrite.
- [x] **Step 4 — Handle the role gap.** Google users arrive with no role metadata and default to `client`. The Task 6 gate routes them to `(onboarding)/role`, where `set_initial_role` corrects it. Verify this specific path — it is the one place the trigger's default becomes user-visible.
- [x] **Step 5 — Add the button** to sign-in and sign-up as a ghost `Button` with the provider mark, plus `WebBrowser.maybeCompleteAuthSession()` at module scope.
- [ ] **Step 6 — Verify (yours):** tap Google in Expo Go, complete the browser flow, land signed in, reach the role chooser, pick PT, confirm `users.role` is `pt` afterwards.
- [x] **Step 7 — Commit:** `feat(mobile): Google sign-in over the browser OAuth flow`

## Task 9 · TOTP MFA

**Files:** create `app/(onboarding)/mfa-enroll.tsx`, `app/(auth)/mfa-challenge.tsx`; modify settings.

- [x] **Step 1 — `mfa-enroll`** — "Two-factor" / "Pick how you want to confirm it's you." `SegmentedPill` with **Authenticator** active and **SMS disabled + "Coming soon"** (locked decision). `mfa.enroll({ factorType: 'totp' })` returns a QR SVG and a secret: render the QR at **176pt** so it scans from a second device, and the secret below in mono, selectable — on a phone the authenticator app is usually *on the same device* and cannot scan its own screen. Then `mfa.challenge` + `mfa.verify` before the factor is trusted.
- [x] **Step 2 — `mfa-challenge`** — "Enter your code", `CodeCells` + `NumericKeypad`, auto-submitting on the sixth digit. Reached from the Task 6 gate whenever `getAuthenticatorAssuranceLevel()` returns `aal1` with `nextLevel: 'aal2'`, so it covers every entry path rather than just the sign-in button. **The "Use a backup code instead" link from the design is dropped** — Supabase issues no TOTP backup codes.
- [x] **Step 3 — Enrollment copy states the recovery gap plainly:** losing the authenticator needs support until M10 adds recovery tooling. Do not imply a self-service path that does not exist.
- [x] **Step 4 — Settings row** shows an `ON` badge from `mfa.listFactors()`, and unenroll sits behind the destructive-confirm pattern. `log_account_event('user_mfa_enable' | 'user_mfa_disable')` on both transitions.
- [ ] **Step 5 — Verify (yours):** enroll with a real authenticator, sign out, sign in, get challenged, get in. Then unenroll and confirm the challenge stops.
- [x] **Step 6 — Commit:** `feat(mobile): TOTP enrollment and login challenge`

## Task 10 · Role selection, PT profile, profile edit

**Files:** create `app/(onboarding)/{role,pt-profile}.tsx`, `app/(app)/{profile,profile-edit}.tsx`.

Budget from the design brief: **a complete PT profile in ≤5 minutes** — progressive and skippable.

- [x] **Step 1 — `role`** *(not in the prototype — build from [`Forge_DesignSystem.html:602-624`](docs/Forge_DesignSystem.html#L602-L624))* — two `ChoiceCard`s, "I'm a personal trainer" / "I train with a coach", calling `set_initial_role`. Gym Account is a valid DB role with no v1 signup path (M7), so it is not offered.
- [x] **Step 2 — `pt-profile`, four steps** with a sticky Back/Continue footer and a per-step **Skip**, exactly as drawn. Header is `Step N of 4` plus the `StepProgress` bar.
  - **Step 1 "Who you are"** — 88pt avatar initials on `accentSurfaceSoft`, "Add a photo", display name, bio with a live `n / 300` counter.
  - **Step 2 "Certifications"** — cards from `pt_certifications` (name, issuer/expiry meta, status badge) plus a dashed `+ Add a certification` row. **Status is `unverified` for every row in M1** and the badge renders neutral — no VERIFIED or IN REVIEW until upload and review exist.
  - **Step 3 "What you offer"** — service chips into `specializations[]`, and the standing note: *"Forge never handles session pricing. You agree rates with your clients directly."* **No rates field anywhere.**
  - **Step 4 "Where and how"** — languages plus the completion banner. **The "Where you coach" card is deferred**: it needs a gym relation and gyms are M7.
  - Finishing sets `onboarding_completed = true`, which also closes the `set_initial_role` window.
- [x] **Step 3 — `profile`** — read-only view for both personas, with a loading skeleton and an error state per the cross-cutting requirement.
- [x] **Step 4 — `profile-edit`** — Cancel / title / Save header chrome. Writes `users` (granted columns only), `pt_profiles`, and `pt_certifications`. A write outside the grant list fails at the database, so any `42501` here means the form is reaching for a column it should not have.
- [x] **Step 5 — "Delete account"** at the bottom in danger outline, opening a support sheet (locked decision). Copy must not imply the account is gone when the sheet closes. M10 owns the real erasure job; leave a `TODO` naming that milestone.
- [x] **Step 6 — Avatar upload is deferred.** Storage buckets do not exist and their policies are a real design step; M4 builds that layer for progress photos. M1 accepts a URL and renders initials otherwise — which is what every prototype screen actually draws.
- [ ] **Step 7 — Verify (yours):** complete a PT profile from a cold signup and time it. Over five minutes means the field set is wrong, not the user.
- [x] **Step 8 — Commit:** `feat(mobile): role selection, PT profile, and profile edit`

## Task 11 · Account settings

**Files:** create `app/(app)/settings/index.tsx`.

Three `SectionCard`s — Preferences, Quiet hours, Account — exactly as drawn.

- [x] **Step 1 — Language row** — writes `users.locale`, calls the existing `setLocale` ([`lib/i18n.ts`](apps/mobile/src/lib/i18n.ts)), subtitle "Also flips the whole layout". Keep M0's honest note that direction is a native setting, so the layout mirrors on next launch.
- [x] **Step 2 — Units** — a `kg` / `lb` mono `SegmentedPill` writing `users.unit_system`.
- [x] **Step 3 — Appearance** — Light/Dark/System, written per-device via `appearance.ts`. Subtitle "Gym floors are dark".
- [x] **Step 4 — Quiet hours** — master mute `Toggle` plus FROM/UNTIL mono tiles, upserted onto `notification_preferences` against `uq_np_user_channel_cat`. This is what Task 1 Step 4's policy unblocks. Keep the design's copy — *"Session reminders still come through. Everything else waits."* — because it names the exception and stops people disabling it out of fear. Per-category control is M9.
- [x] **Step 5 — Account section** — "Edit profile" chevron row and the "Two-factor" row with its `ON` badge.
- [x] **Step 6 — Consents** — the three `consent_*` toggles. Not drawn, but GDPR requires withdrawal to be as easy as granting; add them as a fourth section rather than hiding them.
- [x] **Step 7 — Sign out** — `log_account_event('user_logout')` **before** `signOut()`, since the session is gone by the time the write would otherwise run.
- [x] **Step 8 — Commit:** `feat(mobile): account settings with language, units, and quiet hours`

## Task 12 · Admin web — staff login and user search

**Files:** create `apps/web/lib/supabase/*`, `middleware.ts`, `app/login/page.tsx`, `app/admin/page.tsx`, `app/admin/users/[id]/page.tsx`; modify `app/page.tsx`.

`apps/web` has no Supabase dependency today — the health route uses bare `fetch` — and never imports `@forge/shared` despite declaring it. The zod schemas are the first real use.

- [x] **Step 1 — Add `@supabase/supabase-js` and `@supabase/ssr`;** three clients (browser, server component, middleware) on the standard cookie pattern.
- [x] **Step 2 — `middleware.ts`** — refresh the session on every request, redirect unauthenticated `/admin/*` to `/login`. Middleware is not the security boundary; the pages re-check.
- [x] **Step 3 — `/login`** — email + password against the same project, then verify `users.role = 'admin'` and sign straight back out if not. Staff and PTs share an auth pool; the admin surface must not accept a PT session.
- [x] **Step 4 — Create the first admin out of band.** `handle_new_user` clamps to `pt|client|gym_account` and `set_initial_role` refuses `admin`, so no self-service path exists by design. Promote one account with a one-off `supabase db query` UPDATE and document the exact statement in the README.
- [x] **Step 5 — `/admin`** — user search by email or display name over the anon key under the admin's own session. `users_select` already grants admins full read via `is_admin()` ([`0003_rls.sql:128-130`](supabase/migrations/0003_rls.sql#L128-L130)), so **no service-role key is needed and none should be used.** `ilike` rides the existing `idx_users_email_trgm`. Paginate; PostgREST's `max_rows = 1000` applies.
- [x] **Step 6 — `/admin/users/[id]`** — read-only detail: role, provider, locale, consents, quarantine flags, created date, PT profile and certifications if present. No mutations in M1; quarantine tooling is M10.
- [x] **Step 7 — Replace the placeholder** on `app/page.tsx` — the line promising M1 is the thing being delivered. Reuse the generated CSS vars; never hand-edit `globals.css`.
- [ ] **Step 8 — Verify:** `pnpm --filter web build`, then the Vercel preview on `develop`, then sign in as admin and find a real user. Confirm a PT account is rejected at `/login`. **Partially done:** `pnpm --filter web build` passes locally and has been re-verified repeatedly through Task 13. The Vercel preview / real admin sign-in has NOT happened — no admin account has ever been created or promoted (see the README's admin-promotion SQL, never run). Pending the same device/deploy testing as the mobile "Verify (yours)" steps below.
- [x] **Step 9 — Commit:** `feat(web): staff login and user search`

## Task 13 · Close-out

- [x] **Step 1 — Tick this plan's checkboxes as work lands.** The M0 plan shipped 0 of 56 ticked and completion had to be reconstructed from commit messages. Do not repeat that.
- [x] **Step 2 — Fix `CLAUDE.md`.** It still says *"Phase: Pre-development"*, *"Repository: Monorepo (planned)"*, *"No application code yet"*, and lists a NestJS/Redis/S3/Whish+Areeba stack the implementation design superseded on 2026-09-09. Replace the phase and stack tables with what is deployed, and point the database section at `supabase db push` rather than `psql -f db/schema.sql`.
- [x] **Step 3 — Header warning on `db/schema.sql`** — `supabase/migrations/` is authoritative, and this file predates 0002 (it still declares `user_sessions` and the six dropped `users` columns). Anyone following the current README gets a pre-auth, pre-RLS database.
- [x] **Step 4 — Update `README.md`:** the full `psql` path, `RESEND_API_KEY`, the Google OAuth client, the admin-promotion SQL, the M1 flows, and the corrected deployment-protection note now that staff login exists.
- [x] **Step 5 — Link the spec, the design brief and the prototype from `docs/index.html`** — the hub the README sends readers to lists none of the three.
- [x] **Step 6 — Record the DS gaps for the designer:** password-strength meter and numeric keypad were built here; segmented step-progress + yes/no question card (M2), signature pad (M2), and the superset/4-cell builder row (M3) are still outstanding. They belong in `Forge_DesignSystem.html`, not as one-offs.
- [x] **Step 7 — Re-run the verification table and report real output**, not expectations.
- [ ] **Step 8 — Open the PR** to `develop`. **Not applicable as literally written** — every M1 task committed directly onto `develop` (no feature branch existed for this milestone; `git log` shows all M1 commits already on `develop`, which is 29 commits ahead of `origin/develop`). There is no branch to open a PR *from* into `develop`. See the addendum at the top of this file for the actual state and recommended next action (a `develop` → `main` release PR once `origin/develop` is pushed, or a plain push if trunk-based flow is preferred).

---

## Verification

Re-run 2026-09-11 during Task 13. Real output below every Claude row; "You" rows are pending device testing (see the addendum at the top of this file).

| # | Check | Command | Who | Result |
|---|---|---|---|---|
| 1 | `0004` applied, none pending | `supabase migration list` | Claude | **PASS** — local/remote agree on 0001, 0002, 0003, 0004, no pending migrations. |
| 2 | Partitions exist through 2027-06 | query on `pg_inherits` | Claude | **PASS** — `audit_logs`, `notifications`, `sets`, `food_logs` each have exactly 14 monthly partitions, `2026_05` through `2027_06`. |
| 3 | **RLS holds** — all M1 assertions pass, denials and positives | `"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -v ON_ERROR_STOP=1 -f db/rls_assertions.sql` | Claude | **PASS** — every assertion printed `NOTICE: pass …` (PT B denied on another PT's `notification_preferences`/`pt_certifications`; PT A reads/updates their own `notification_preferences`; unpublished certifications denied then allowed once published; `set_initial_role('admin')` rejected; role flips while onboarding incomplete, no-ops once complete; `log_account_event` rejects an out-of-allow-list action and inserts exactly one row for `user_login`). Script completed and rolled back cleanly, `ON_ERROR_STOP=1` never tripped. |
| 4 | `set_initial_role` refuses `admin` and a completed onboarding | inside the harness | Claude | **PASS** — covered by #3 above. |
| 5 | `log_account_event` refuses an action outside the allow-list | inside the harness | Claude | **PASS** — covered by #3 above. |
| 6 | Types include `pt_certifications` and both functions | `packages/shared/src/database.types.ts` | Claude | **PASS** — `pt_certifications` table type present (line 4488), `log_account_event` (line 6531) and `set_initial_role` (line 6576) function signatures present. |
| 7 | **Contrast: CTA, chips and on-tint pairs all ≥4.5:1 in both schemes** | `pnpm --filter @forge/shared test` | Claude | **PASS** — `src/theme/tokens.test.ts`, 40/40 tests passed. |
| 8 | Zod schemas green | `pnpm --filter @forge/shared test` | Claude | **PASS** — `src/schemas/auth.test.ts` 31/31, `src/schemas/profile.test.ts` 19/19. Full suite: 3 files, 90/90 tests passed. |
| 9 | Typecheck + lint clean | `pnpm turbo run typecheck lint` | Claude | **PASS** — 5/5 tasks successful across `@forge/shared`, `mobile`, `web` (typecheck + lint each), zero errors/warnings in output. |
| 10 | Web builds | `pnpm --filter web build` | Claude | **PASS** — `next build` (Turbopack) compiled successfully, typecheck finished in 6.1s, all 5 routes generated (`/`, `/admin`, `/admin/users/[id]`, `/api/health`, `/login`). |
| 11 | CI green on the runner | GitHub Actions | Claude | **NOT VERIFIABLE from here** — `gh` CLI is not installed/on `PATH` in this environment, so GitHub Actions run status could not be queried directly. More importantly: `develop` is 29 commits ahead of `origin/develop` (nothing since M1 work started has been pushed), so **CI has not actually run against any M1 commit yet**. This should be checked on GitHub directly after a push, not assumed green. |
| 12 | Admin login rejects a PT, accepts the admin | Vercel preview | Claude | **PARTIALLY VERIFIED** — `pnpm --filter web build` succeeds (#10) and the `/login` role-check logic (sign in → read own `users.role` → sign back out if not `admin`) is implemented and code-reviewed per Task 12. **Not end-to-end verified**: per `apps/web/README.md`, no admin account has been created or promoted yet ("there is nothing to promote yet"), so the actual PT-rejected / admin-accepted behavior has not been exercised against a live Vercel preview with a real admin session. |
| 13 | **Sign up → verify → role → MFA → PT profile → home** | Expo Go on Android | **You** | Pending. |
| 14 | **Google sign-in completes and reaches the role chooser** | Expo Go | **You** | Pending. |
| 15 | **TOTP enroll → sign out → challenge → in** | Expo Go + authenticator | **You** | Pending. |
| 16 | **Password reset by email lands in the app** | Expo Go | **You** | Pending. |
| 17 | **Screens match the prototype in Arabic and in dark mode** | Expo Go | **You** | Pending. |

Checks 13–17 are the stated done-when and the flows only a human can judge. Checks 1–12 are machine-verified with real output reported.

## Risks

- **PKCE + deep links is the hard part.** A redirect URL not on the allow-list fails silently by bouncing to `site_url`, which presents as "the link does nothing". Task 2 Step 4 front-loads the list; `Linking.createURL` keeps Expo Go and standalone builds on one path.
- **Expo Go's LAN URL moves with the network,** so the `exp://*` wildcard is required. If Supabase rejects it, deep-link testing needs a dev build sooner than M6 planned — flag that immediately rather than working around it.
- **The CTA color change touches every screen.** It is one token, but it lands before any screen is built (Task 3) precisely so it never has to be retrofitted.
- **`pt_certifications` renders a status the product cannot yet earn.** M1 ships `unverified` only. If a neutral badge still reads as a promise in testing, drop the badge rather than faking a review queue.
- **Resend domain verification can lag.** `onboarding@resend.dev` unblocks testing but only delivers to the account owner. Fine for M1, not for M2 client invites.
- **Every migration lands on the live Frankfurt DB** (no Docker, D8). `0004` is additive — partitions, one policy, one table, two functions — and the harness runs immediately after the push.
- **Arabic strings roughly triple.** Marked placeholder, consistent with M0; the mirroring is what gets verified now, not the copy.

## Deliberately out of scope

Apple Sign In (no developer account), SMS MFA (paid add-on — the tab ships disabled), TOTP backup codes (no Supabase primitive), certification document upload and admin review (needs Storage — M4/M10), avatar upload (same), real account deletion (M10 GDPR job — the button routes to support), "Where you coach" venue selection (needs gyms — M7), per-category notification preferences (M9), admin mutations and quarantine (M10), and the entire M7 hierarchy.

# M2 · Clients & intake — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to work this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A PT can invite a client by email; that client signs up in the Expo app, completes a resumable 5-step intake (PAR-Q, goals, history, anthropometrics, dietary) in ≤10 minutes, signs a liability waiver that becomes a server-rendered PDF, and the PT reads the submitted intake on one screen with red flags highlighted before session one.

**Architecture:** Seven new `SECURITY DEFINER` RPCs own every state transition on `clients`/`intake_forms` so `audit_logs` (policy-free, append-only) stays the single source of truth; plain RLS-scoped reads/updates cover everything else (intake progress saves, list reads). Waiver PDF rendering and Storage happen in a new `apps/web/app/api/waiver/*` route pair using the service-role key — the first real business logic in `apps/web`'s API surface, and the first use of Storage in the product (pulled forward from M4).

**Tech Stack:** Supabase Postgres/RLS/Storage, `packages/shared` zod schemas (vitest), Expo Router screens on the existing `apps/mobile/src/ui/*` primitives, Next.js API routes with `pdf-lib`.

**Spec:** `docs/superpowers/specs/2026-09-11-m2-clients-intake-design.md` — read it first; this plan does not repeat the seven locked decisions, only implements them.

---

## Context

M1 shipped identity only. `clients`, `client_pt_assignments` and `intake_forms` have existed since M0 (`db/schema.sql:338-428`) with RLS since `0003_rls.sql:172-215`, but no application code has ever touched them — `is_pt_of_client()`, `is_client_record_owner()`, `is_pt_of_user()` are dead helpers today. `docs/Forge_Prototype.html` carries 8 M2 screens (`clients`, `invite`, `client_detail`, `intake`, `intake_resume`, `intake_review`, `waiver`, `waiver_done`) with designer annotations flagging three missing DS components: segmented step-progress, yes/no question card, signature pad.

Two things the brainstorming pass found that this plan corrects, beyond the spec's own two conflicts:

- **`intake_forms_client_all` as drafted would still let a client tamper after submit** — a bare `FOR ALL` grants a client UPDATE on their own row in every state, including writing `red_flags = null` or `state = 'completed'` directly, bypassing `submit_intake`'s server-side PAR-Q derivation entirely. Task 1 splits client SELECT from client UPDATE and adds a `WITH CHECK` that blocks any client write once `state` has left `pending`/`in_progress`, and blocks the client from ever setting `red_flags`, `waiver_pdf_url`, `signed_at`, `reviewed_at`, `reviewed_by_id` themselves.
- **`clients_update` (0003_rls.sql:187) still lets `client_user_id = auth.uid()` update the row directly** — meaning a client could set their own `clients.state = 'active'` today with a bare PostgREST call, sidestepping the PT-only `set_client_state` RPC this plan adds. M2 is the first milestone that gives a client a session that can reach this policy at all, so Task 1 narrows it to the PT (+ admin) only.

Both are called out again in Task 1 itself, not just here.

---

## File structure

```
supabase/migrations/0005_m2_clients_intake.sql   — schema, RLS, Storage bucket, 7 RPCs

db/rls_assertions.sql                            — M2 cases appended

packages/shared/src/schemas/
  intake.ts / intake.test.ts                     — PAR-Q, template, derivations
  clients.ts / clients.test.ts                   — invite/state schemas
  index.ts                                        — barrel export (modified)
packages/shared/src/i18n/{en,ar}.json            — clients / intake / waiver trees (modified)

apps/mobile/src/ui/
  StepProgress.tsx                                — gains `segments?: number` (modified)
  YesNoCard.tsx                                    — new
  SignaturePad.tsx                                 — new
  index.ts                                         — modified

apps/mobile/src/lib/clients/
  useClientList.ts                                 — search + state filter
  useClientDetail.ts                               — one client + intake summary
  clientActions.ts                                 — RPC wrappers (invite/resend/revoke/setState)

apps/mobile/src/lib/intake/
  useIntakeForm.ts                                  — load/save/submit for the client's own form
  claimInvites.ts                                   — wraps claim_client_invites()

apps/mobile/src/app/(app)/
  index.tsx                                         — role branch: PtHome | ClientHome (modified)
  clients/index.tsx                                 — PT client list, 5 states
  clients/invite.tsx                                — invite sheet
  clients/[id]/index.tsx                            — client detail
  clients/[id]/intake.tsx                           — PT intake review
  intake/[id].tsx                                   — client's 5-step intake + resume
  intake/[id]/waiver.tsx                             — waiver + signature
  intake/done.tsx                                    — signed confirmation

apps/mobile/src/lib/deepLinks.ts                    — `type=join` handling (modified)

apps/web/lib/supabase/service.ts                    — service-role client (new)
apps/web/lib/waiver/text.ts                          — versioned waiver copy
apps/web/lib/waiver/pdf.ts                           — pdf-lib render
apps/web/app/api/waiver/route.ts                     — POST: render + store + stamp
apps/web/app/api/waiver/[intakeId]/route.ts          — GET: signed URL
apps/web/app/join/page.tsx                           — public deep-link landing page
apps/web/app/admin/users/[id]/page.tsx               — roster + intake block (modified)
```

---

## Task 1 · Migration 0005 — clients, intake, waiver storage, seven RPCs

**Files:** create `supabase/migrations/0005_m2_clients_intake.sql`.

- [x] **Step 1 — Copy this plan and the spec into the repo** (already at their target paths — confirm both are staged for the first commit of this task).

- [x] **Step 2 — `clients.invite_name`.** `ALTER TABLE public.clients ADD COLUMN invite_name VARCHAR(120);` — nullable. Holds the name the PT typed at invite time; shown in the `invited` list state until the client's own `display_name` exists.

- [x] **Step 3 — Extend `chk_audit_logs_action`.** `audit_logs` is `PARTITION BY RANGE`, so a `DROP CONSTRAINT` / `ADD CONSTRAINT` on the parent (`db/schema.sql:192`) is inherited by every partition automatically (native partitioning propagates parent CHECKs) — no need to touch each monthly table. Add exactly four values to the existing list: `'client_reactivate'`, `'client_invite_revoke'`, `'intake_submit'`, `'waiver_sign'`. Copy the full existing list verbatim from `db/schema.sql:197-213` plus these four — a partial re-list would silently drop every other value the CHECK currently allows.

- [x] **Step 4 — Tighten `clients_update`.** `DROP POLICY clients_update ON public.clients;` then recreate it as PT/admin only:
  ```sql
  CREATE POLICY clients_update ON public.clients
    FOR UPDATE TO authenticated
    USING (pt_user_id = auth.uid() OR public.is_admin())
    WITH CHECK (pt_user_id = auth.uid() OR public.is_admin());
  ```
  This removes the `client_user_id = auth.uid()` branch 0003 shipped. Comment inline why: a client never needs direct write access to their own `clients` row — invite claiming goes through `claim_client_invites()` (`SECURITY DEFINER`, bypasses RLS) and every state change through `set_client_state()` (PT-only). Leaving the old branch in place would let a client set their own `state = 'active'` with a bare PostgREST call, skipping the PT's role in that decision entirely.

- [x] **Step 5 — Replace `intake_forms_all` with five policies.** `DROP POLICY intake_forms_all ON public.intake_forms;` then:
  ```sql
  CREATE POLICY intake_forms_client_select ON public.intake_forms
    FOR SELECT TO authenticated
    USING (public.is_client_record_owner(client_id));

  CREATE POLICY intake_forms_client_update ON public.intake_forms
    FOR UPDATE TO authenticated
    USING (public.is_client_record_owner(client_id) AND state IN ('pending', 'in_progress'))
    WITH CHECK (
      public.is_client_record_owner(client_id)
      AND state IN ('pending', 'in_progress')
      AND red_flags IS NULL
      AND waiver_pdf_url IS NULL
      AND signed_at IS NULL
      AND reviewed_at IS NULL
      AND reviewed_by_id IS NULL
    );

  CREATE POLICY intake_forms_pt_select ON public.intake_forms
    FOR SELECT TO authenticated
    USING (public.is_pt_of_client(client_id) AND state IN ('completed', 'red_flag_review', 'waiver_signed'));

  CREATE POLICY intake_forms_pt_review ON public.intake_forms
    FOR UPDATE TO authenticated
    USING (public.is_pt_of_client(client_id) AND state IN ('completed', 'red_flag_review', 'waiver_signed'))
    WITH CHECK (public.is_pt_of_client(client_id) AND state IN ('completed', 'red_flag_review', 'waiver_signed'));

  CREATE POLICY intake_forms_admin_all ON public.intake_forms
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());
  ```
  The `WITH CHECK` on `intake_forms_client_update` is the enforcement for both of this task's own findings above and the spec's conflict #1: a client can save progress while `pending`/`in_progress`, cannot write at all once the state has moved on, and cannot ever set the five PT/system-owned columns themselves — those only ever get written by `submit_intake()`, `apps/web`'s service-role waiver route, or the PT's own `intake_forms_pt_review` policy.

- [x] **Step 6 — Private Storage bucket.**
  ```sql
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('waivers', 'waivers', false)
  ON CONFLICT (id) DO NOTHING;
  ```
  No `storage.objects` policies for `authenticated` — deliberately. The bucket is reachable only by the service role (which bypasses RLS in Supabase by design), and every read is brokered through `apps/web`'s signed-URL route after an RLS-backed authorization check against `intake_forms`. Path convention, enforced by the API route, not the DB: `waivers/<client_id>/<intake_form_id>.pdf`.

- [x] **Step 7 — `invite_client(p_email CITEXT, p_name TEXT DEFAULT NULL, p_tags TEXT[] DEFAULT '{}')` → UUID.** `SECURITY DEFINER`, `SET search_path = public`. Guards: caller must have `users.role = 'pt'`; refuses a second live invite to the same address (`state = 'invited'`) from the same PT. Inserts the `clients` row (`state = 'invited'`, `invite_expires_at = NOW() + INTERVAL '7 days'`) and, in the same transaction, the paired `intake_forms` row (`state = 'pending'`, `template_version = '1.0'`, `sections` = the five-section v1 template as a JSONB literal — the exact array Task 4's `INTAKE_TEMPLATE_V1` mirrors on the TypeScript side):
  ```sql
  '[
    {"id":"parq","title":"PAR-Q"},
    {"id":"goals","title":"Goals"},
    {"id":"history","title":"Training history"},
    {"id":"anthropometrics","title":"Anthropometrics"},
    {"id":"dietary","title":"Dietary restrictions"}
  ]'::JSONB
  ```
  Audits `client_invite` (`entity_type = 'client'`, `entity_id` = the new client id, `details = jsonb_build_object('invite_email', p_email)`). Returns the new client id.

- [x] **Step 8 — `resend_invite(p_client_id UUID, p_email CITEXT DEFAULT NULL)` → VOID.** `SECURITY DEFINER`. Locks the row (`FOR UPDATE`), authorizes `pt_user_id = auth.uid() OR is_admin()`, refuses once `state != 'invited'`. Extends `invite_expires_at` by 7 days from now; if `p_email` is given, re-points `invite_email` to it (the recovery path for a client who signed up under the wrong address). Audits `client_invite` again with `details = jsonb_build_object('resent', TRUE, 're_pointed', p_email IS NOT NULL)`.

- [x] **Step 9 — `revoke_invite(p_client_id UUID)` → VOID.** `SECURITY DEFINER`. Same lock/authorize/`state = 'invited'` guard as Step 8. Audits `client_invite_revoke` **before** deleting (no FK from `audit_logs.entity_id`, so the historical row is fine to keep), then `DELETE FROM public.clients WHERE id = p_client_id` — cascades the paired `intake_forms` row via its existing `ON DELETE CASCADE`.

- [x] **Step 10 — `claim_client_invites()` → INTEGER.** `SECURITY DEFINER`. Reads the caller's own `email` and `email_confirmed_at IS NOT NULL` straight from `auth.users` (the same table `handle_new_user`'s trigger already reads in `0002_supabase_auth.sql`). Returns `0` immediately if the email isn't confirmed. Otherwise loops every `clients` row where `invite_email` matches, `client_user_id IS NULL`, `state = 'invited'`, and `invite_expires_at > NOW()` (`FOR UPDATE` inside the loop), sets `client_user_id = auth.uid()`, `state = 'accepted'`, and audits one `client_accept` row per link (`target_user_id` = the PT, since they're the one who should see it happened). Returns the count linked — `0` on a second call, proving idempotency. Call this from the mobile app on every cold boot for a signed-in client (Task 10) and again right after role selection.

- [x] **Step 11 — `set_client_state(p_client_id UUID, p_state TEXT)` → VOID.** `SECURITY DEFINER`. `p_state` restricted to `('active', 'paused', 'deactivated')` — this RPC never creates or claims a client, only transitions an already-`accepted`-or-later one. Locks and authorizes the same way as Steps 8-9. Refuses if the client hasn't accepted yet (`state NOT IN ('accepted','active','paused','deactivated')`). Maps the target state to an audit action — `paused → client_pause`, `deactivated → client_deactivate`, `active → client_reactivate` (the only "into active" transition this RPC makes; there is no separate first-activation action in the CHECK list, and `client_reactivate` literally means "client is now active" regardless of what state it came from) — with `details = jsonb_build_object('from', <previous state>, 'to', p_state)` and `target_user_id` = `client_user_id`.

- [x] **Step 12 — `submit_intake(p_intake_id UUID, p_responses JSONB)` → VOID.** `SECURITY DEFINER`. Locks the row, authorizes `is_client_record_owner`, refuses unless `state IN ('pending', 'in_progress')`. Derives red flags itself — never trusts a client-supplied flag list — by looping the seven fixed PAR-Q keys and checking `(p_responses #>> ARRAY['parq', key])::BOOLEAN IS TRUE`:
  ```sql
  FOREACH v_key IN ARRAY ARRAY[
    'parq_heart', 'parq_chest_pain', 'parq_dizziness', 'parq_chronic_condition',
    'parq_medication', 'parq_musculoskeletal', 'parq_supervised'
  ]
  LOOP
    IF (p_responses #>> ARRAY['parq', v_key])::BOOLEAN IS TRUE THEN
      v_flags := v_flags || to_jsonb(v_key);
    END IF;
  END LOOP;
  ```
  Writes `responses = p_responses`, `red_flags = v_flags`, `submitted_at = NOW()`, and `state = CASE WHEN jsonb_array_length(v_flags) > 0 THEN 'red_flag_review' ELSE 'completed' END`. Audits `intake_submit` with `target_user_id` = the client's `pt_user_id` and `details = jsonb_build_object('flag_count', jsonb_array_length(v_flags))` — never the responses themselves, which stay out of the append-only audit trail.

- [x] **Step 13 — `intake_progress(p_client_id UUID)` → TABLE(state TEXT, answered_sections INTEGER, total_sections INTEGER, updated_at TIMESTAMPTZ).** `SECURITY DEFINER STABLE` (must bypass RLS to read a still-`in_progress` row that `intake_forms_pt_select` deliberately hides — the `is_pt_of_client(p_client_id)` check inside the function body is what actually authorizes it, replacing RLS rather than relying on it). `answered_sections` counts distinct top-level keys present in `responses` (`SELECT count(*) FROM jsonb_object_keys(f.responses)`), `total_sections` is `jsonb_array_length(f.sections)`. Returns zero rows (not an exception) for a caller who isn't the client's PT — read-shaped like RLS itself.

- [x] **Step 14 — `REVOKE EXECUTE ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;`** after each of the seven functions, matching `0004`'s exact pattern.

- [x] **Step 15 — Push:** `supabase db push`, then `supabase migration list` — local and remote must agree on `0005`.

- [x] **Step 16 — `pnpm types:gen`.** Confirm `clients.invite_name` and all seven function signatures appear in `packages/shared/src/database.types.ts`.

- [x] **Step 17 — Commit:** `feat(db): M2 client invites, intake state machine, and waiver storage`

## Task 2 · RLS assertions for M2

**Files:** modify `db/rls_assertions.sql`.

The harness already has `clients`/`intake_forms` fixtures and isolation cases at lines 67-132 (PT B denied on PT A's clients/intakes; Client B denied on Client A's intake; PT A and Client A each see what they own). Append in the same `pg_temp.expect` / `pg_temp.act_as` style — every negative paired with a positive control.

- [x] **Step 1 — Move the `intake_row` fixture's state to `in_progress`** (already is, per the existing fixture) and add: `pg_temp.expect('PT A cannot read an in-progress intake', 0, 'SELECT count(*) FROM public.intake_forms')` while acting as `pt_a`. This is the assertion that actually proves the spec's headline promise.
- [x] **Step 2 — Flip the fixture row to `state = 'completed'`** with a plain `UPDATE ... (SECURITY-bypassing, as the test superuser, not through RLS)` and re-run the same query as `pt_a`: `pg_temp.expect('PT A reads the completed intake', 1, ...)`.
- [x] **Step 3 — Client tamper check:** acting as `client_a`, attempt `UPDATE public.intake_forms SET state = 'completed' WHERE id = :'intake_row'` while the row is `in_progress`, wrapped so a raised RLS violation is caught rather than aborting the whole script (mirror however the file already handles an expected-to-fail statement — if it doesn't yet, use a `DO $$ BEGIN ... EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'pass — client blocked'; END $$;` block), then assert the row's `state` is still `in_progress` by a fresh `SELECT` as the fixture owner.
- [x] **Step 4 — Client self-state check:** acting as `client_a`, attempt `UPDATE public.clients SET state = 'active' WHERE id = :'client_row'`; assert it changes nothing (Step 4's tightened `clients_update` policy).
- [x] **Step 5 — `claim_client_invites()`:** insert one more `clients` row with `invite_email` set to `client_b`'s email and `state = 'invited'`, `invite_expires_at = NOW() + INTERVAL '1 day'`; act as `client_b` and call it — assert exactly one row now has `client_user_id = client_b` and `state = 'accepted'`. Call it a second time as `client_b` — assert it links zero more. Insert a third row with `invite_expires_at = NOW() - INTERVAL '1 day'` for a third client fixture; assert calling as that client links zero.
- [x] **Step 6 — `set_client_state()` authorization:** acting as `pt_b`, call `set_client_state(:'client_row', 'paused')` on PT A's client — assert it raises (wrap per Step 3's pattern) and that the row's `state` is unchanged. Acting as `pt_a`, call it for real and assert `state = 'paused'`.
- [x] **Step 7 — `submit_intake()` authorization:** acting as `client_b`, call `submit_intake(:'intake_row', '{}'::jsonb)` against Client A's intake — assert it raises. Acting as `client_a` with the row back at `in_progress`, submit a payload with `parq.parq_heart = true` and everything else `false`; assert the row's `state` becomes `red_flag_review` and `red_flags` is a one-element array containing `"parq_heart"`. Submit again — assert it raises (`state` no longer `pending`/`in_progress`).
- [x] **Step 8 — Run the full harness:** `"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -v ON_ERROR_STOP=1 -f db/rls_assertions.sql`. **Report the actual `NOTICE: pass ...` output for every M2 case** — an assertion that unexpectedly passes-as-permitted is a security hole, not a test nit (same standard M1 held itself to).
- [x] **Step 9 — Commit:** `feat(db): M2 RLS assertions`

## Task 3 · `packages/shared` — intake domain

**Files:** create `src/schemas/intake.ts`, `src/schemas/intake.test.ts`; modify `src/schemas/index.ts`.

Written test-first, same rationale as M1 Task 4: this is the one genuinely unit-testable piece of the milestone (D8: no integration harness), and PAR-Q flag derivation is a patient-safety calculation that must not silently drift.

- [x] **Step 1 — Failing tests first**, covering: `PARQ_QUESTIONS` has exactly 7 entries; `evaluateParq` flags every question independently when answered `true` and flags nothing when all are `false`; `intakeCompletion` reports 0/5 sections on an empty response object and 5/5 once all five top-level keys are present, regardless of how thoroughly each section was filled; `intakeSummary` converts `weight_kg`/`height_cm` to `lb`/`in` when `unitSystem = 'imperial'` and passes them through unchanged for `'metric'`; `inviteClientSchema` rejects an invalid email and accepts a valid one with `name` omitted.
- [x] **Step 2 — `PARQ_QUESTIONS`** — the seven stable ids used by both the SQL in Task 1 Step 12 and this file, so they can never drift independently:
  ```ts
  export const PARQ_QUESTIONS = [
    'parq_heart',
    'parq_chest_pain',
    'parq_dizziness',
    'parq_chronic_condition',
    'parq_medication',
    'parq_musculoskeletal',
    'parq_supervised',
  ] as const;
  export type ParqQuestionId = (typeof PARQ_QUESTIONS)[number];
  ```
- [x] **Step 3 — `INTAKE_TEMPLATE_V1`** — the literal five-section array, byte-identical in shape to the JSONB in Task 1 Step 7:
  ```ts
  export const INTAKE_TEMPLATE_V1 = [
    { id: 'parq', title: 'PAR-Q' },
    { id: 'goals', title: 'Goals' },
    { id: 'history', title: 'Training history' },
    { id: 'anthropometrics', title: 'Anthropometrics' },
    { id: 'dietary', title: 'Dietary restrictions' },
  ] as const;
  ```
  Comment noting this and the SQL literal are pinned together by `template_version = '1.0'` — a future template change is a new version, never an edit in place to this array.
- [x] **Step 4 — Per-section zod schemas.** Only `parq` is required, per the prototype annotation ("nothing is required except PAR-Q"):
  ```ts
  export const parqResponsesSchema = z.object(
    Object.fromEntries(PARQ_QUESTIONS.map((q) => [q, z.boolean()])) as Record<ParqQuestionId, z.ZodBoolean>,
  );
  export const goalsResponsesSchema = z.object({
    primary_goal: z.string().trim().min(1).max(200),
    target_date: z.string().optional(),
    motivation: z.string().max(500).optional(),
  }).partial();
  export const historyResponsesSchema = z.object({
    years_training: z.number().nonnegative().optional(),
    injuries: z.string().max(500).optional(),
    previous_programs: z.string().max(500).optional(),
  }).partial();
  export const anthropometricsResponsesSchema = z.object({
    date_of_birth: z.string().optional(),
    sex: z.enum(['male', 'female']).optional(),
    height_cm: z.number().positive().optional(),
    weight_kg: z.number().positive().optional(),
  }).partial();
  export const dietaryResponsesSchema = z.object({
    restrictions: z.array(z.enum(['vegetarian', 'vegan', 'halal', 'kosher', 'gluten_free', 'dairy_free', 'nut_allergy'])).optional(),
    notes: z.string().max(500).optional(),
  }).partial();

  export const intakeResponsesSchema = z.object({
    parq: parqResponsesSchema,
    goals: goalsResponsesSchema.optional(),
    history: historyResponsesSchema.optional(),
    anthropometrics: anthropometricsResponsesSchema.optional(),
    dietary: dietaryResponsesSchema.optional(),
  });
  export type IntakeResponses = z.infer<typeof intakeResponsesSchema>;
  ```
  The `dietary.restrictions` enum matches EP-08's dietary tags list from `Forge_Architecture.html` (veg, vegan, halal, kosher, GF, DF, nut-allergy) so M8's nutrition work reads the same values without a migration.
- [x] **Step 5 — `evaluateParq(parq: Partial<Record<ParqQuestionId, boolean>>): ParqQuestionId[]`** — pure function, the client-side twin of Task 1 Step 12's SQL loop, used for the inline flag treatment as the client taps Yes (must never be the source of truth for what the PT sees — that's always server-derived by `submit_intake`).
- [x] **Step 6 — `intakeSummary(responses: IntakeResponses, unitSystem: 'metric' | 'imperial')`** — returns `{ ageYears, sex, height, weight, primaryGoal, flagCount }` for the client-detail essentials card, converting `height_cm`/`weight_kg` to `in`/`lb` when `unitSystem === 'imperial'` (`cm / 2.54`, `kg * 2.20462`, both rounded to one decimal). `ageYears` derived from `date_of_birth` against the current date; all fields nullable when their source is missing.
- [x] **Step 7 — `intakeCompletion(responses: IntakeResponses)`** — returns `{ answered: number, total: number, stepStatus: Record<string, boolean> }` where `stepStatus` marks each of the five `INTAKE_TEMPLATE_V1` ids `true` once its top-level key exists in `responses` (regardless of how complete that section's own fields are) — the honest "step count is the signal" behavior the annotation calls for, same shape `intake_progress()`'s SQL returns.
- [x] **Step 8 — Verify:** `pnpm --filter @forge/shared test` green, all new cases included.
- [x] **Step 9 — Commit:** `feat(shared): intake schemas, PAR-Q derivation, and completion math`

## Task 4 · `packages/shared` — clients domain

**Files:** create `src/schemas/clients.ts`, `src/schemas/clients.test.ts`; modify `src/schemas/index.ts`.

- [x] **Step 1 — Failing tests first:** `clientStateSchema` accepts exactly `invited|accepted|active|paused|deactivated` and rejects anything else; `inviteClientSchema` trims/lowercases email, rejects an empty string name (but accepts `undefined`), caps `tags` items and count sanely.
- [x] **Step 2 — `clientStateSchema`** — `z.enum(['invited', 'accepted', 'active', 'paused', 'deactivated'])`, mirroring `chk_clients_state` (`db/schema.sql:359`) exactly, same convention as `localeSchema` in `profile.ts`.
- [x] **Step 3 — `inviteClientSchema`** — `{ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(1).max(120).optional(), tags: z.array(z.string().trim().min(1).max(30)).max(10).optional() }`. `.strict()`.
- [x] **Step 4 — `resendInviteSchema`** — `{ clientId: z.string().uuid(), email: z.string().trim().toLowerCase().email().optional() }`.
- [x] **Step 5 — Verify:** `pnpm --filter @forge/shared test` green.
- [x] **Step 6 — Commit:** `feat(shared): client invite and state schemas`

## Task 5 · `packages/shared` — i18n

**Files:** modify `src/i18n/en.json`, `src/i18n/ar.json`.

Add three top-level trees — `clients`, `intake`, `waiver` — following the existing flat-namespace convention (`profile.*`, `settings.*`). Every PAR-Q question needs real, medically careful copy in both languages (a plain "Yes/No" toggle beside the actual clinical question, not a leading question) — this is the one M2 i18n surface where "placeholder pending review" is not good enough even short-term, so write real Arabic text here rather than deferring it the way M1 could defer general UI copy; flag it for the native-speaker pass already scheduled at M10 regardless.

- [x] **Step 1 — `clients.*`** — list screen title/search placeholder/empty state/no-match copy/offline-error copy; invite sheet labels and expiry/single-use copy; client-detail section labels; state action labels (`Pause`, `Reactivate`, `Deactivate`) and their confirm-sheet copy.
- [x] **Step 2 — `intake.*`** — step titles (matching `INTAKE_TEMPLATE_V1`), the seven PAR-Q questions as `intake.parq.<id>` with real clinical wording (e.g. `parq_heart`: "Has a doctor ever said you have a heart condition and recommended only medically supervised physical activity?"), field labels for goals/history/anthropometrics/dietary, "Save & exit", the resume-checklist copy ("What you've saved so far" / "Your trainer can't see your answers until you submit"), and the red-flag review screen's labels.
- [x] **Step 3 — `waiver.*`** — the liability waiver body copy (13px/1.65 legal text per the annotation — copy itself, not styling, lives here), signature pad instructions, "Submit disabled until signed", and the signed-confirmation screen's copy.
- [x] **Step 4 — Commit:** `feat(shared): clients, intake, and waiver copy (en/ar)`

## Task 6 · Mobile primitives — the three DS gaps this milestone owns

**Files:** modify `apps/mobile/src/ui/StepProgress.tsx`; create `apps/mobile/src/ui/{YesNoCard,SignaturePad}.tsx`; modify `apps/mobile/src/ui/index.ts`.

Same contract as every other primitive in this file: every style from `useTheme()`, logical props only, real `accessibilityRole`.

- [ ] **Step 1 — `StepProgress` gains an optional `segments?: number`.** When given, render `segments` separate 4pt-tall, `radius: 2` bars in a `flexDirection: 'row'` with `gap: t.space[1]`, each filled `accent` up to `Math.round(progress * segments)` and `border` otherwise — matching the annotation's *"segment bars, not a percentage: step count is the honest signal of remaining work."* When omitted, render exactly the existing continuous bar (no behavior change for M1's callers in `pt-profile.tsx`).
- [ ] **Step 2 — `YesNoCard`** — question text (`variant="body"`), two `Button`-sized (44pt) Yes/No targets in a `Row`, `accessibilityRole="radiogroup"` on the container and `"radio"` + `accessibilityState={{ selected }}` on each option (same pattern as `ChoiceCard`). When `selected === 'yes'` **and** `flagged` is passed true, render an inline `Banner` (`variant="warn"`, not `"danger"`) directly beneath — matching the `client_detail` annotation's *"warn-colored, not danger: the flags need reading, not panic"* even though this specific banner lives on the intake screen, not client detail; the PT-facing `intake_review` screen is what escalates a flagged answer to the danger treatment (Task 12).
- [ ] **Step 3 — `SignaturePad`** — 150pt tall `View` (per the annotation: *"a finger has room"*) wrapping an `Svg` (`react-native-svg`, already a dependency) with a single `<Path>` built from a `PanResponder` (`react-native`, no new native module — this keeps Expo Go working). Tracks points in component state, converts them to an SVG path string (`M x y L x y L x y ...`), and exposes three states via a discriminated prop the parent reads (`empty` = no strokes yet, disables the parent's Submit; `inked` = at least one stroke; `cleared` = post-clear-tap, visually identical to `empty`). Props: `{ value: string; onChange: (svgPath: string) => void; onClear: () => void }` — fully controlled, so the parent screen (Task 13) owns whether Submit is enabled. Emits **raw SVG path data**, not a rasterized image — this is what lets `apps/web`'s `pdf-lib` render (Task 14) call `drawSvgPath` directly with zero image conversion anywhere in the pipeline.
- [ ] **Step 4 — Verify:** typecheck and lint green; render all three once on a scratch screen in both schemes and both directions (same discipline as M1 Task 5 Step 10) before wiring any real screen to them.
- [ ] **Step 5 — Commit:** `feat(mobile): segmented step-progress, yes/no question card, and signature pad`

## Task 7 · Mobile — client data layer

**Files:** create `apps/mobile/src/lib/clients/{useClientList,useClientDetail,clientActions}.ts`.

Mirror `apps/mobile/src/lib/profile/usePtProfileData.ts`'s shape (a hook returning `{ data, loading, error, refetch }`) and route every mutation through `useAsyncSubmit` at the call site, not inside these files.

- [ ] **Step 1 — `clientActions.ts`** — one thin wrapper per RPC from Task 1: `inviteClient(email, name?, tags?)`, `resendInvite(clientId, email?)`, `revokeInvite(clientId)`, `setClientState(clientId, state)`. Each just calls `supabase.rpc('<name>', {...})` and rethrows `error` if present — no business logic here, the database owns all of it.
- [ ] **Step 2 — `useClientList(ptUserId, { search, stateFilter })`** — queries `clients` joined to `users` (for `display_name`/`avatar_url` once `client_user_id` is set) ordered by `created_at DESC`, `ilike`-filtered on `COALESCE(invite_name, users.display_name)` when `search` is non-empty. Returns enough for all five list states: `loading` (initial fetch), `data: []` with `search: ''` (true empty state, offering the invite action), `data: []` with `search: '<term>'` (no-match state, same invite CTA per the annotation), `error` (offline — the screen renders the DS offline-error treatment on any network failure, not just a generic error), and populated.
- [ ] **Step 3 — `useClientDetail(clientId)`** — fetches the `clients` row, its linked `users` row (if `client_user_id` is set), the `intake_forms` row, and `intake_progress()` via RPC; combines the intake response with `intakeSummary()` (Task 3) for the essentials card.
- [ ] **Step 4 — Commit:** `feat(mobile): client roster data layer`

## Task 8 · Mobile — PT client list screen

**Files:** create `apps/mobile/src/app/(app)/clients/index.tsx`.

The prototype's `clients` screen is drawn as exactly five states behind one set of filter chips — build all five, not just the populated one.

- [ ] **Step 1 — Header + search** — `TextField` search box (no label chrome needed here — use a plain bordered input matching the design's search-bar treatment, or reuse `TextField` with `label` visually hidden per its own accessibility contract) plus a state-filter `SegmentedPill` (`All / Active / Paused / Invited`).
- [ ] **Step 2 — Loading** — three `Skeleton` rows at 68pt height inside a `SectionCard`-shaped container, matching the *"loading uses the DS skeleton"* annotation.
- [ ] **Step 3 — Empty (`search === ''`, zero clients)** — centered illustration-free message plus a primary `Button` "Invite your first client" routing to `clients/invite`.
- [ ] **Step 4 — No-match (`search !== ''`, zero results)** — *"the no-match state offers the invite action instead of a dead end"*: same CTA as Step 3, copy adjusted to reference the typed search term.
- [ ] **Step 5 — Offline/error** — `Banner variant="danger"` plus a `Button variant="ghost"` "Retry" calling `refetch()` — *"error assumes offline first, because that is the common cause on a gym floor."*
- [ ] **Step 6 — Populated** — `SectionCard` of `ListRow`s, 68pt each (`ListRow`'s existing `minHeight: 60` is close but the design calls for 68 here — pass an explicit style override or extend `ListRow` with an optional `minHeight` prop rather than forking the component), `title` = the client's display name (or `invite_name`, or the raw invite email as a last resort), `subtitle` = state label, `trailing` = a state-colored dot (accent for active, muted for invited/paused, danger for deactivated) — the whole row is the tap target per the annotation, routing to `clients/[id]`.
- [ ] **Step 7 — Floating/pinned "Invite" action** visible in every non-empty state, not just empty — a PT invites clients continuously, not only on first use.
- [ ] **Step 8 — Commit:** `feat(mobile): PT client list screen`

## Task 9 · Mobile — invite screen

**Files:** create `apps/mobile/src/app/(app)/clients/invite.tsx`.

- [ ] **Step 1 — Form** — name (optional) and email fields via `TextField`, validated with `inviteClientSchema` (Task 4) using the same blur-validation + `zodIssuesToFieldErrors` pattern as `sign-up.tsx`.
- [ ] **Step 2 — On submit**, call `inviteClient()` (Task 7), then show the resulting link/actions: **Copy link is the accent button, Send via email/WhatsApp share sheet is ghost** — *"link first, email second — the link is what PTs actually paste into WhatsApp"* and *"only one accent button per section."* The link is `https://<web host>/join?email=<urlencoded invite_email>` (Task 15's `/join` page); "Copy link" uses `expo-clipboard` if already a dependency, otherwise `Share.share()` as the fallback (do not add a new native dependency for this alone — check `apps/mobile/package.json` first).
- [ ] **Step 3 — State copy** — expiry ("Expires in 7 days") and single-use ("This link works once") stated directly in the sheet, per the annotation, not buried in a help link.
- [ ] **Step 4 — Success routes back to `clients/index`**, the new row visible in the `invited` state immediately (the list hook's `refetch`).
- [ ] **Step 5 — Commit:** `feat(mobile): invite-a-client screen`

## Task 10 · Mobile — role branching and `ClientHome`

**Files:** modify `apps/mobile/src/app/(app)/index.tsx`; create `apps/mobile/src/lib/intake/claimInvites.ts`.

Do **not** touch the gate in `apps/mobile/src/app/_layout.tsx` — it carries a long chain of deliberate carve-outs (documented in its own header comment) and both personas already reach `(app)` correctly once `onboarding_completed = true` (the client branch of `(onboarding)/role.tsx` already sets this). Branch on persona inside `(app)/index.tsx` instead.

- [ ] **Step 1 — `claimInvites.ts`** — `claimClientInvites(): Promise<number>` wrapping `supabase.rpc('claim_client_invites')`.
- [ ] **Step 2 — Split `(app)/index.tsx`** into the existing PT/diagnostic content (rename its function to `PtHome`, unchanged) and a new `ClientHome`, chosen by `auth.user?.role === 'client'`. Call `claimClientInvites()` once on mount for a client, before the first data fetch.
- [ ] **Step 3 — `ClientHome`, no matching client row (claim found nothing)** — show the caller's own `auth.user.email` with a copy action and copy along the lines of "Ask your trainer to invite this address" — the recovery path for the email-mismatch failure mode the spec names.
- [ ] **Step 4 — `ClientHome`, matching client row exists** — fetch it plus its `intake_forms` row and the linked PT's `users`/`pt_profiles` row (name, avatar). Render: PT name/avatar card; an intake status card that is itself the entry point — `pending`/`in_progress` → "Start"/"Resume" routing to `intake/[id]`, `completed`/`red_flag_review` → "Waiting for your trainer" plus a route into `intake/[id]/waiver` if unsigned, `waiver_signed` → a `ListRow` for the signed waiver (Task 17's signed-URL fetch) with two exits, matching `waiver_done`'s *"back to the client, or the list"* pattern adapted to having no PT-side list here — "Done" simply dismisses to this same home.
- [ ] **Step 5 — Commit:** `feat(mobile): client home and invite claiming`

## Task 11 · Mobile — intake data layer and the 5-step flow

**Files:** create `apps/mobile/src/lib/intake/useIntakeForm.ts`, `apps/mobile/src/app/(app)/intake/[id].tsx`.

- [ ] **Step 1 — `useIntakeForm(intakeId)`** — loads the `intake_forms` row (RLS already scopes it to the owning client via `intake_forms_client_select`), exposes `responses` (typed `IntakeResponses`, defaulting each section to `{}`), `state`, and two writers: `saveProgress(partial: Partial<IntakeResponses>)` — a plain `.update({ responses: {...current, ...partial}, state: 'in_progress' })` (allowed directly by `intake_forms_client_update`'s RLS, no RPC needed for progress) — and `submit()` which calls the `submit_intake` RPC with the full accumulated `responses`. **No local draft cache of any kind** — every "Save & exit" round-trips to the server immediately, which is what makes cross-device resume true rather than merely advertised.
- [ ] **Step 2 — Screen shell** — `FormScreen` with the segmented `StepProgress` (Task 6, `segments={5}`) in the header and a sticky Back/Continue/"Save & exit" footer, mirroring `pt-profile.tsx`'s `useState(step)` pattern exactly (1-indexed, `TOTAL_STEPS = 5`).
- [ ] **Step 3 — Step 1: PAR-Q** — the seven `YesNoCard`s (Task 6) driven by `intake.parq.<id>` copy (Task 5), each `flagged={evaluateParq(...).includes(id)}` for the inline warn treatment as the client taps Yes. Continue is disabled until all seven are answered (this is the one truly-required step).
- [ ] **Step 4 — Steps 2-5: Goals, Training history, Anthropometrics, Dietary** — plain `TextField`/`ChipRow`/segmented-sex-picker forms per Task 3's per-section schemas; every field optional, Continue never blocked, "Save & exit" always available and always routes back to `ClientHome`.
- [ ] **Step 5 — Step 5's Continue becomes "Submit"**, calling `submit()`, then routing to `intake/[id]/waiver` regardless of whether the submission came back `completed` or `red_flag_review` — per the spec's decision 5, the waiver is not gated on the PT clearing a flag.
- [ ] **Step 6 — Resume state** — when the screen is opened on a row already `in_progress`, render the `intake_resume` checklist first (five rows, checked per `intakeCompletion(responses).stepStatus`, Task 3) with a single "Continue" into whichever step is first incomplete, plus the reassurance copy from `intake.*` (Task 5) that the PT can't see answers yet.
- [ ] **Step 7 — Commit:** `feat(mobile): resumable 5-step intake flow`

## Task 12 · Mobile — PT client detail and intake review

**Files:** create `apps/mobile/src/app/(app)/clients/[id]/index.tsx`, `apps/mobile/src/app/(app)/clients/[id]/intake.tsx`.

- [ ] **Step 1 — `client_detail`** — red-flag banner (`Banner variant="warn"`) pinned **above** the stats block whenever `red_flags.length > 0`, per the annotation *"it is the reason the PT opened this screen … warn-colored, not danger."* Essentials card built from `intakeSummary()` (Task 3) via `useClientDetail` (Task 7). Intake status row: `pending`/`in_progress` shows only `intake_progress()`'s counts ("2 of 5 sections") and explicitly **never** renders any response content for those states — this is the UI-side half of the RLS guarantee Task 1 enforces server-side. `completed`/`red_flag_review`/`waiver_signed` shows a "Review intake" row into `clients/[id]/intake`. State actions (`Pause`/`Reactivate`/`Deactivate`) call `clientActions.ts` (Task 7) behind a confirm sheet. "Start session" pinned to the bottom third, per the annotation — disabled with an explanatory tooltip/subtitle until `intake_forms.state` is at least `completed` (this button is a stub in M2; the session screen itself is M4 — routing it to a "coming in M4" placeholder is acceptable here, but it must exist and must reflect the flag-gate, since that gate is EP-03's own acceptance criterion, not M4's).
- [ ] **Step 2 — `intake_review`** — single screen, no tabs. Flagged PAR-Q answers render with `dangerSurface` fill and a 4px leading `dangerAccent` bar using `insetInlineStart` (mirrors correctly under RTL — do not hardcode `left`, matching `TextField`'s existing `insetInlineEnd` precedent). Every other answer collapses to a plain label/value `ListRow`-rhythm list, grouped by the same five section titles as the client's own flow. This screen is reached only once RLS actually allows the read (`completed` or later) — no separate client-side gate needed, but render a clear "not submitted yet" state for the edge case of navigating here directly with a stale link.
- [ ] **Step 3 — Commit:** `feat(mobile): client detail and PT intake review`

## Task 13 · Mobile — waiver signing and confirmation

**Files:** create `apps/mobile/src/app/(app)/intake/[id]/waiver.tsx`, `apps/mobile/src/app/(app)/intake/done.tsx`.

- [ ] **Step 1 — `waiver`** — the `waiver.*` legal body copy (Task 5) at 13px line-height 1.65 (explicit style override, not the default `Text` `body` variant, to hit that exact spec — contrast still needs to clear 4.5:1 per the annotation, so keep `tone="secondary"` or better, verify against `tokens.test.ts`'s existing contrast check rather than assuming). `SignaturePad` (Task 6) below it; Submit (`Button`, `size="lg"`) stays `disabled` until the pad reports non-empty.
- [ ] **Step 2 — On Submit**, POST the SVG path plus `intakeId` to `apps/web`'s `/api/waiver` route (Task 14) with the user's current Supabase access token as a bearer header (`(await supabase.auth.getSession()).data.session?.access_token`). Show a submitting spinner; on success route to `intake/done`, on failure show a `Banner variant="danger"` and leave the signature intact so the client doesn't have to re-sign.
- [ ] **Step 3 — `waiver_done`** — success `Banner variant="success"` (or the success-circle treatment `verify-success.tsx` already uses — reuse that visual, don't invent a second success pattern), a `ListRow` for the signed document (title = "Liability waiver", subtitle = the signed date, `trailing` = a chevron that fetches the signed URL from `/api/waiver/[intakeId]` and opens it via `expo-web-browser`, already a dependency), and two exits: "Back to home" (`router.replace('/(app)')`) — there is no client-side "back to the list" analog to the PT's, so the second exit is the client's own home, matching the *"two exits because both are plausible next moves"* intent within the client's actual navigation structure.
- [ ] **Step 4 — Commit:** `feat(mobile): waiver signing and signed confirmation`

## Task 14 · Mobile — the `/join` deep link

**Files:** modify `apps/mobile/src/lib/deepLinks.ts`, `apps/mobile/src/app/(auth)/sign-up.tsx`.

- [ ] **Step 1 — `deepLinks.ts`**: add a branch for `queryParams.email` present with no `type` (or `type === 'join'` if the web page sends it explicitly — decide to match whatever Task 15's redirect actually emits, and keep both sides consistent) → `router.push({ pathname: '/(auth)/sign-up', params: { email } })`.
- [ ] **Step 2 — `sign-up.tsx`**: read `useLocalSearchParams<{ email?: string }>()` and seed the `email` state from it when present, still fully editable — this is a convenience prefill, not a lock, since the client might reasonably need to correct it.
- [ ] **Step 3 — Commit:** `feat(mobile): prefill sign-up from a /join deep link`

## Task 15 · `apps/web` — waiver rendering and Storage

**Files:** create `apps/web/lib/supabase/service.ts`, `apps/web/lib/waiver/{text,pdf}.ts`, `apps/web/app/api/waiver/route.ts`, `apps/web/app/api/waiver/[intakeId]/route.ts`; modify `apps/web/package.json`, `apps/web/.env.example`, `apps/web/README.md`.

This is the first business logic in `apps/web/app/api/*` (the only precedent is `api/health/route.ts`'s bare reachability check) and the first use of `SUPABASE_SERVICE_ROLE_KEY` anywhere in the repo — `apps/web/README.md` currently states it is unused; Step 8 corrects that.

- [ ] **Step 1 — Add `pdf-lib`** to `apps/web/package.json` dependencies (pure JS, runs fine on Vercel's Node runtime — no native binary, unlike `puppeteer`-based alternatives).
- [ ] **Step 2 — `lib/supabase/service.ts`** — a server-only client built with `createClient` from `@supabase/supabase-js` (not `@supabase/ssr` — there's no browser session to bridge here) using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, `auth: { persistSession: false }`. Comment prominently: **never import this from a Client Component; never send its key to the browser.**
- [ ] **Step 3 — `lib/waiver/text.ts`** — `WAIVER_VERSION = 'v1'` and the versioned English + Arabic waiver body text as exported constants, sourced from the same `waiver.*` copy Task 5 wrote into `packages/shared` (import it from there rather than re-typing — `@forge/shared` is already a dependency of `apps/web`).
- [ ] **Step 4 — `lib/waiver/pdf.ts`** — `renderWaiverPdf({ clientName, ptName, locale, signatureSvgPath, signedAt }): Promise<Uint8Array>` using `pdf-lib`: an A4 page, the waiver body text (wrapped, using `pdf-lib`'s built-in font metrics — no external font file needed for v1's Latin+Arabic-transliteration fallback; if Arabic glyph rendering turns out to need a real embedded font, that's a follow-up, not a blocker for M2's English-first rollout), client name and date stamped, `WAIVER_VERSION` in a footer, and the signature drawn via `page.drawSvgPath(signatureSvgPath, { x, y, scale, color: rgb(0,0,0) })` — the exact reason Task 6 Step 3 made `SignaturePad` emit path data instead of a bitmap.
- [ ] **Step 5 — `app/api/waiver/route.ts` (POST)`** — reads the `Authorization: Bearer <token>` header, constructs a request-scoped Supabase client with the **anon** key and that token (so the authorization check below runs under the real caller's RLS, not the service role), confirms the caller owns the named `intake_form_id` and it's in a submitted state (`completed`/`red_flag_review`) via a plain `SELECT` (RLS denies otherwise — the query returning zero rows **is** the authorization failure, returned as a 403). Renders the PDF, uploads it with the **service-role** client (Step 2) to `waivers/<client_id>/<intake_form_id>.pdf`, then — still with the service-role client, since `intake_forms_client_update`'s `WITH CHECK` from Task 1 forbids the client from setting these columns themselves even under their own session — updates `waiver_pdf_url`, `signed_at = NOW()`, `state = 'waiver_signed'`, and inserts the `waiver_sign` audit row with `actor_id` set explicitly to the token's user id (the service-role connection has no `auth.uid()` of its own to fall back on).
- [ ] **Step 6 — `app/api/waiver/[intakeId]/route.ts` (GET)`** — same bearer-token authorization pattern as Step 5 but permits **either** the client owner or their PT (`is_client_record_owner` or `is_pt_of_client`, checked via the anon-scoped client so RLS does the real work), then uses the service-role client to call `createSignedUrl` on the stored object with a short expiry (e.g. 5 minutes) and returns it as JSON.
- [ ] **Step 7 — `dynamic = 'force-dynamic'`** on both routes (same as `api/health/route.ts` — these depend on the caller's live token and must never be statically cached).
- [ ] **Step 8 — Update `apps/web/.env.example` and `README.md`** — the service-role key now has a real, documented consumer; remove the "not used by anything in this app" language and replace it with what actually reads it (this file, only).
- [ ] **Step 9 — Commit:** `feat(web): waiver PDF rendering and signed-URL delivery`

## Task 16 · `apps/web` — the `/join` landing page

**Files:** create `apps/web/app/join/page.tsx`.

- [ ] **Step 1 — Server Component**, no auth required (confirm `middleware.ts`'s matcher already excludes it by not matching `/admin/*` specifically — it currently matches everything except static assets, so verify this route doesn't get pulled into any session-refresh assumption that breaks for a signed-out visitor; if `updateSession` itself is a no-op for a request with no cookies, no change is needed there).
- [ ] **Step 2 — Reads `?email=`**, renders a client-side redirect to `forge://join?email=<email>` (a plain `<meta http-equiv="refresh">` or a tiny inline script — Next.js Server Components can still emit a client `<script>` for this one-shot redirect) and, beneath it, a static fallback: "Get the Forge app" copy plus the same email address shown in the page (for the case the redirect doesn't fire because the app isn't installed). No store badges yet — there is no store listing until M10 (spec risk #1) — so the fallback names Expo Go / TestFlight explicitly rather than linking to app stores that don't exist yet.
- [ ] **Step 3 — Commit:** `feat(web): /join deep-link landing page`

## Task 17 · `apps/web` — admin roster and intake view

**Files:** modify `apps/web/app/admin/users/[id]/page.tsx`.

- [ ] **Step 1 — When `target.role === 'pt'`**, add a read-only roster block: a table of that PT's `clients` rows (name/email, state, `created_at`) — admin already has full read via `is_admin()` in every relevant policy from Task 1, so this is a plain `SELECT`, no service-role key involved, matching the existing page's own stated convention (*"the admin surface never uses `SUPABASE_SERVICE_ROLE_KEY`"*).
- [ ] **Step 2 — When `target.role === 'client'`**, add an intake-state block: which PT they're linked to, their `intake_forms.state`, `red_flags` count (not the response content — support staff reading raw PAR-Q answers is a bigger privacy question than M2 needs to answer; state and flag count are enough for a support case), and `waiver_pdf_url` presence as a boolean "Waiver signed" row.
- [ ] **Step 3 — No mutations** — same posture as the rest of the admin surface today; quarantine/support actions remain M10.
- [ ] **Step 4 — Commit:** `feat(web): admin roster and intake visibility`

## Task 18 · Close-out

- [ ] **Step 1 — Tick this plan's checkboxes as work lands**, per M1's own stated lesson about reconstructing completion from commit messages after the fact.
- [ ] **Step 2 — `docs/DESIGN_SYSTEM_GAPS.md`** — move segmented step-progress, yes/no question card, and signature pad from "Outstanding" to a new "Built (M2)" section, matching the existing M1 entry's format exactly.
- [ ] **Step 3 — `CLAUDE.md`** — flip M2 to done, M3 to next; correct the Storage row in the tech-stack table (currently "not yet used before M4" — it's used from M2).
- [ ] **Step 4 — `db/schema.sql` header warning** — add `clients.invite_name` (0005) to the list of things the baseline predates, alongside the existing `pt_certifications` note.
- [ ] **Step 5 — Re-run the full verification block below and report real output**, not expectations — same standard M1 held itself to in its own close-out.
- [ ] **Step 6 — Commit:** `docs: M2 close-out — plan checkboxes, DS gaps, CLAUDE.md, schema header`

---

## Verification

Machine-checkable — run all of these and report actual output:

```bash
supabase db push
supabase migration list
pnpm types:gen
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -v ON_ERROR_STOP=1 -f db/rls_assertions.sql
pnpm turbo run typecheck lint test
pnpm --filter web build
```

Device/manual (the actual done-when — no automated UI tests exist anywhere in this repo, matching M0/M1's own precedent):

1. As a PT, invite an address you control with a name. Confirm the row shows `invited` with that name, and "Copy link" yields a `/join?email=…` URL.
2. Open that URL on a phone with Expo Go and the dev server reachable; confirm it lands on sign-up with the email prefilled. Sign up, pick **Client**. Confirm `claim_client_invites()` links it (`clients.client_user_id` set, `state = 'accepted'`) and `ClientHome` shows the PT.
3. Start intake; answer PAR-Q with at least one **Yes**; confirm the inline warn flag. "Save & exit" at step 3.
4. Reopen the account (different device/session if possible). Confirm the resume checklist shows steps 1-3 saved and states plainly that the PT can't see answers yet.
5. As the PT, open client detail. Confirm you see "2 of 5 sections" (or similar) and **no answer content**.
6. Finish and submit. Time the full client flow end to end — target ≤10 minutes (EP-03's acceptance criterion).
7. Sign the waiver. Confirm the PDF exists in the `waivers` bucket, opens from both the client's home and the PT's client detail via the signed-URL route, and carries the signature, name, timestamp, and `WAIVER_VERSION`.
8. As the PT, open intake review. Confirm flagged answers carry the danger/leading-bar treatment and the essentials card matches what the client entered.
9. Re-run steps 1-2 with a client who signs up under a **different** address than the one invited. Confirm they land on the "ask your trainer to invite this address" recovery screen, then confirm `resend_invite` re-pointing the invite links them on the next `claim_client_invites()` call.
10. Flip to Arabic and to dark mode; walk the intake and waiver flow again. RTL mirroring of the 4px leading flag bar and the signature pad are the two most likely things to be wrong.
11. Pause, deactivate, then reactivate a client from client detail. Confirm three distinct `audit_logs` rows with the right actions via a quick admin/db check.
12. As a client, attempt (via a REST client or curl with the client's own bearer token, not the app UI) a direct `PATCH` to `intake_forms` setting `state=completed` while still `in_progress`, and a direct `PATCH` to `clients` setting `state=active`. Both must fail with a `42501`/RLS-style rejection — this is Task 1's hardening actually holding under a client who bypasses the app entirely.

## Risks

- **No store build until M10.** Every client-side check above rides Expo Go or an internal build, same constraint M1 already accepted for its own device-testing steps.
- **Email matching is fragile by construction.** Google sign-in with a personal address is the realistic failure case. The `/join?email=` prefill and `resend_invite` re-point are the mitigations; verification step 9 is what actually proves they work, not just that they exist.
- **Storage, the service-role key, and signed URLs get their first real exercise a milestone early** (planned for M4). If a Storage-specific gap shows up here (bucket policy misconfiguration, signed-URL expiry too short/long for the waiver-review flow), it's cheaper to fix now with one bucket than after M4 builds three more on the same pattern.
- **Arabic PAR-Q wording is a medical-safety string, not UI copy.** Task 5 writes real Arabic text rather than deferring it, but it still needs the native-speaker review already scheduled at M10 — flag this specific tree for priority review over general UI strings.
- **Waiver legal enforceability is a legal question, not a technical one.** The PDF, timestamp, version stamp, and audit row are what the platform can provide; whether that constitutes a binding waiver in Lebanon or the UAE depends on the still-open legal-entity decision (implementation design doc §6, decision #1) and is out of scope here.
- **`pdf-lib`'s built-in fonts may not render Arabic glyphs correctly.** Flagged in Task 15 Step 4 as a known follow-up, not silently shipped — if the Arabic waiver renders as boxes/garbage, that's a real defect to catch in verification step 10, and the fix (an embedded Arabic-capable font) is additive.

## Deliberately out of scope

Master/Sub-PT assignment and gym rosters (M7 — `client_pt_assignments` policies untouched), progress photos and body metrics (M4), push/email notification of intake submission or PT review (M9 — this is why decision 5 makes the waiver not wait on it), PT-fills-intake-on-behalf-of-client, PT-visible in-progress answers, form-check video (M10), an intake template editor (`INTAKE_TEMPLATE_V1` is versioned code, not admin-editable data), the real "Start session" screen (M4 — client detail's button exists and is correctly gated, but it's a stub), and a redeemable-token invite mechanism (the additive fix if email-matching support load turns out to be high — not needed until it is).

# M3 · Programming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to work this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A PT can search a real exercise library, build a weeks → days → blocks → exercises program on a phone, copy a week, save it in under a second, apply a template without mutating it, assign it to clients, and draft four weeks with AI in under 12 seconds against a credit ledger that refunds on failure — and the client can see what they were assigned.

**Architecture:** RLS is the authorization boundary; every state transition is a `SECURITY DEFINER` RPC. The four program child tables carry a denormalised `program_id` guarded by composite FKs so each policy is one predicate call, not a four-level join. The AI broker is a blocking Next.js route holding the only secret (`ANTHROPIC_API_KEY`), authorizing under the caller's bearer token before it spends anything.

**Tech Stack:** pnpm + Turborepo; Expo/expo-router mobile; Next.js App Router on Vercel; Supabase Postgres (Frankfurt); `@anthropic-ai/sdk` with `claude-opus-5`.

**Spec:** `docs/superpowers/specs/2026-09-09-forge-v1-implementation-design.md` — read it first; this plan does not repeat the locked decisions, only implements them.

---

## Context

M0–M2 are done on `develop`. M2 shipped the invite → claim → intake → waiver pipeline, which means a client can now hold a session and reach a policy — that is what makes M3's client-side RLS real rather than theoretical.

**All six programming tables already exist** in `supabase/migrations/0001_baseline.sql` (mirrored at `db/schema.sql:527-714`), as do `ai_credit_wallets` (`db/schema.sql:1277`), `ai_credit_packs` (`:1298`) and `ai_generations` (`:1331`). Every one already has its `trg_*_updated_at` trigger from the baseline DO-loop, and `chk_audit_logs_action` already permits `program_create`, `program_assign`, `program_archive`, `ai_credit_consume`, `ai_credit_refund` and `ai_generation_create` (`0005_m2_clients_intake.sql:58-77`). **M3 adds no audit action and almost no tables.**

**The gap this milestone closes:** `0003_rls.sql:21-39` enabled RLS on every public table through a DO-loop but wrote policies for only seven of them. Grep confirms **zero policies on any programming, exercise or AI-credit table** — today they are total default-deny to `anon` and `authenticated`, reachable only by the service role. Writing those policies is the single biggest DB deliverable here.

**The structural problem.** `program_weeks` / `program_days` / `program_blocks` / `program_exercises` have no owner column at all; the only path to `programs.author_user_id` is a four-level FK chain, and every existing predicate (`is_pt_of_client`, `is_client_record_owner`, `is_master_of`) is keyed on a client or user id. A policy per child table would otherwise mean four joins per row on a 108-row read.

### Decisions

- **D1 · Denormalise `program_id` onto `program_days`, `program_blocks` and `program_exercises`, guarded by composite FKs.** Rejected: chained `EXISTS` predicates (four joins per row, on the hottest read in the app) and RPC-only child writes (every read still needs the joins, and it makes the builder's save path the only way to touch anything). The composite FK — `program_blocks (day_id, program_id) REFERENCES program_days (id, program_id)` — makes a drifted `program_id` **structurally impossible** rather than trigger-enforced. Each child policy then reduces to one `is_program_visible(program_id)` call, and PostgREST can count a program's exercises in one embed.
- **D2 · One `save_program(p_program_id, p_payload jsonb)` RPC, replace-children semantics.** ~160 rows for a 4-week × 3-day program. Per-row PostgREST writes would be ~160 round trips to Frankfurt; from Lebanon that is minutes, not the ≤1s acceptance. One JSONB payload expanded with `jsonb_to_recordset` is one round trip and one transaction.
- **D3 · Template instantiation and week-copy are set-based CTE deep copies** keyed on an id map, not row loops. Copy never touches the source — that is EP-04's "template application copies, never mutates" acceptance, enforced by the RPC reading the source and writing only new ids.
- **D4 · The credit is charged *after* a successful generation**, matching D23's sequence. This makes refund-on-failure narrow by construction: nothing is charged for an LLM error. `refund_ai_credit` still ships because EP-15 requires it explicitly and because failures *after* the charge (unparseable output discovered late, a crash between charge and response) are real. Both paths are exercised in the harness.
- **D5 · AI failure matrix** — every stage returns its own status and its own error key, and the copy for each states whether a credit was charged:

  | Stage | Failure | HTTP | Charged? |
  |---|---|---|---|
  | 1 Auth | no/invalid bearer | 401 | no |
  | 2 Authorize client | zero rows under RLS | 403 | no |
  | 3 Balance | `balance < 1` | 402 | no |
  | 4 LLM | API error, timeout, `stop_reason: 'refusal'`, `parsed_output === null` | 502 / 504 | **no** |
  | 5 Charge | `chk_acw_balance` raises (concurrent draft won) | 200 | no — draft returned with `balance: 0` |
  | 6 Post-charge | anything after a successful charge | 500 | yes, then **refunded** |

- **D6 · The exercise library is versioned data plus a generator, not hand-written SQL.** `db/exercises/forge_exercise_library_v1.json` → `node db/exercises/build_import_sql.mjs` → `supabase/migrations/0008_exercise_library_v1.sql`, idempotent via `ON CONFLICT (slug) DO UPDATE`. The full 2,000+ licensed import is then a data-only regeneration with no code change.
- **D7 · Introduce a tab bar.** The prototype's `Today / Clients / Programs / Library` is not cosmetic — Programs and Library are both top-level destinations a PT moves between mid-session, and a Stack makes that a back-button crawl. Do it once, before any M3 screen exists, against four known call sites.
- **D8 · The four-cell row fits 390pt with room to spare.** 390 − 32 (screen gutter) − 24 (block card padding) − 18 (three 6pt gaps) = 316 ÷ 4 = **79pt per cell** at a 44pt floor. No type shrinking, no wrapping. This arithmetic goes in the component header so nobody "optimises" the cells onto the name row later.

### Corrections this plan makes

- **`docs/Forge_Prototype.html` — "Search 1,240 exercises".** The count is read from the live table at render, never hardcoded.
- **`docs/Forge_Prototype.html` — "Usually under 20 seconds. You can leave this screen — we'll notify you."** Wrong on both counts: EP-15's acceptance is ≤12s and D5 justifies serverless on it, and notifications are M9. Corrected copy: **"Usually under 12 seconds. Keep this screen open."**
- **`docs/Forge_Prototype.html` — credits sheet "1 credit left".** Interpolated from the real balance with `_one`/`_other` plurals.
- **EP-04's "≥2,000 exercises" is not met at M3 and is recorded as a launch-gate item in `CLAUDE.md`'s M10 row** — not silently skipped.

---

## File structure

```
db/
  exercises/
    forge_exercise_library_v1.json      — ~250 curated exercises, the source of truth
    build_import_sql.mjs                — deterministic JSON -> SQL generator
  rls_assertions.sql                    (modified) — +16 M3 assertions
  schema.sql                            (modified) — header warning only
  README.md                             (modified)
supabase/migrations/
  0007_m3_programming.sql               — columns, predicates, policies, 15 RPCs
  0008_exercise_library_v1.sql          — GENERATED, do not hand-edit
packages/shared/src/
  schemas/programs.ts                   — program/builder payloads + pure helpers
  schemas/exercises.ts                  — library enums, search + custom-exercise payloads
  schemas/ai.ts                         — draft request/response, credit packs, creditState
  schemas/{programs,exercises,ai}.test.ts
  schemas/index.ts                      (modified)
  i18n/{en,ar}.json                     (modified) — +library, programs, builder, ai, credits
apps/mobile/src/
  ui/{BuilderBlock,BuilderRow}.tsx      — the DESIGN_SYSTEM_GAPS outstanding item
  ui/{NumericKeypad,index}.tsx          (modified) — extraKey
  lib/exercises/{useExerciseSearch,useExerciseDetail,exerciseActions}.ts
  lib/programs/{useProgramList,useProgramTree,programActions}.ts
  lib/ai/{useCreditBalance,requestProgramDraft}.ts
  app/(app)/(tabs)/_layout.tsx          — new tab group
  app/(app)/(tabs)/{index,clients}      (moved)
  app/(app)/(tabs)/programs/index.tsx
  app/(app)/(tabs)/library/index.tsx
  app/(app)/library/{[id],custom}.tsx
  app/(app)/programs/[id]/{builder,assign}.tsx
  app/(app)/programs/ai.tsx
  app/(app)/my-program.tsx              — client read-only view
apps/web/
  lib/ai/{model,catalog,prompt,scrub}.ts
  app/api/ai/program-draft/route.ts
  app/admin/programs/{page,[id]/page,program-filter}.tsx
  app/admin/ai-generations/page.tsx
  app/admin/{page,users/[id]/page}.tsx  (modified)
```

---

## Task 1 · Migration 0007 — columns, predicates, policies

**Files:** create `supabase/migrations/0007_m3_programming.sql`.

Follow `0005_m2_clients_intake.sql` exactly: banner box, numbered prose rationale explaining *why each change exists*, `BEGIN;`…`COMMIT;`, `-- ─────` section rules.

- [x] **Step 1 — `exercises.demo_video_url`.** `ALTER TABLE public.exercises ADD COLUMN demo_video_url TEXT;`. EP-04's acceptance says exercises carry a demo and there is no column for one. It stays null through M3 (the screen renders a placeholder), so the licensed import later is data-only.
- [x] **Step 2 — `programs.start_date`.** `ADD COLUMN start_date DATE;`. Assignment needs an anchor date — the assign sheet's "replaces it from Monday" and the client view's "which week is now" both derive from it. Null for templates and unassigned drafts.
- [x] **Step 3 — Denormalise `program_id` (D1).** Add `program_id UUID` to `program_days`, `program_blocks`, `program_exercises`; backfill through the existing chain; `SET NOT NULL`. Then make each parent FK-targetable and chain the composite FKs:

  ```sql
  ALTER TABLE public.program_weeks  ADD CONSTRAINT uq_pw_id_program  UNIQUE (id, program_id);
  ALTER TABLE public.program_days   ADD CONSTRAINT uq_pd_id_program  UNIQUE (id, program_id);
  ALTER TABLE public.program_blocks ADD CONSTRAINT uq_pb_id_program  UNIQUE (id, program_id);

  ALTER TABLE public.program_days ADD CONSTRAINT fk_pd_week_program
    FOREIGN KEY (week_id, program_id) REFERENCES public.program_weeks (id, program_id) ON DELETE CASCADE;
  ALTER TABLE public.program_blocks ADD CONSTRAINT fk_pb_day_program
    FOREIGN KEY (day_id, program_id) REFERENCES public.program_days (id, program_id) ON DELETE CASCADE;
  ALTER TABLE public.program_exercises ADD CONSTRAINT fk_pe_block_program
    FOREIGN KEY (block_id, program_id) REFERENCES public.program_blocks (id, program_id) ON DELETE CASCADE;
  ```

  Comment that these are what make a drifted `program_id` impossible rather than merely discouraged — the policies trust this column.
- [x] **Step 4 — Indexes and sort-order uniques.** `idx_pd_program`, `idx_pb_program`, `idx_pe_program` on the new columns (every policy filters on them). Plus `uq_pb_day_sort UNIQUE (day_id, sort_order) DEFERRABLE INITIALLY DEFERRED` and `uq_pe_block_sort UNIQUE (block_id, sort_order) DEFERRABLE INITIALLY DEFERRED` — deferrable because a reorder within one transaction legitimately passes through a duplicate state.
- [x] **Step 5 — Predicates.** Both `LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public`, matching `0003_rls.sql:66-121`. SECURITY DEFINER is load-bearing — an invoker-rights function here would recurse into the policy evaluating it.

  ```sql
  CREATE OR REPLACE FUNCTION public.is_program_editor(p_program_id UUID)
  RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.programs p
      WHERE p.id = p_program_id AND p.author_user_id = auth.uid()
    );
  $$;
  ```

  `is_program_visible(p_program_id)` is `is_program_editor(...)` **OR** the client owns the assigned client row and `state IN ('active','completed')` **OR** `public.is_master_of(p.author_user_id)` **OR** `public.is_admin()`. The state gate is the "AI never auto-publishes" guarantee expressed in SQL: a `draft` is invisible to the client even when `client_id` is already set. `is_master_of` was defined in 0003 and has never been used by a policy — this is its first consumer; it stays read-only until M7 has hierarchy fixtures.
- [x] **Step 6 — `programs` policies.** `programs_select` USING `is_program_visible(id)`; `programs_insert` WITH CHECK `author_user_id = auth.uid() OR is_admin()`; `programs_update` and `programs_delete` USING/WITH CHECK `is_program_editor(id) OR is_admin()`. Note in a comment that a client never gets UPDATE on a program at any state.
- [x] **Step 7 — Child-table policies, four tables, same shape.** `<table>_select` USING `public.is_program_visible(program_id)`; `<table>_write` FOR ALL USING and WITH CHECK `public.is_program_editor(program_id) OR public.is_admin()`. `program_weeks` uses its existing `program_id`; the other three use the D1 column.
- [x] **Step 8 — `exercises` policies.** `exercises_select` USING `is_active AND (is_custom = FALSE OR created_by_user_id = auth.uid()) OR public.is_admin()` — the global library is readable by everyone, a custom movement only by its author. `exercises_insert` WITH CHECK `is_custom = TRUE AND created_by_user_id = auth.uid()` so nobody can inject a row into the global library through PostgREST. `exercises_update`/`_delete` restricted to own custom rows (+ admin).
- [x] **Step 9 — AI table policies — reads only, deliberately.** `ai_credit_wallets_select` USING `user_id = auth.uid() OR public.is_admin()`; `ai_generations_select` the same; `ai_credit_packs_select` scoped through the wallet. **No write policy for `authenticated` on any of the three, ever** — every mutation is a `SECURITY DEFINER` RPC. Say so in a comment so a later reader doesn't file it as an oversight.
- [x] **Step 10 — Wallet auto-creation.** Extend `handle_new_user()` (from `0002_supabase_auth.sql`) — or add a paired trigger — to insert an `ai_credit_wallets` row with `balance = 10, total_purchased = 10` for a new user. Ten is roughly a month of drafting for a solo PT; it exists so the full ledger (low-warn at ≤3, upsell at 0, refund) is reachable on a fresh device before RevenueCat lands at M6.
- [x] **Step 11 — Commit:** `feat(db): M3 programming RLS, denormalised program_id, and AI credit policies`

## Task 2 · Migration 0007 — the 15 RPCs

**Files:** modify `supabase/migrations/0007_m3_programming.sql`.

All `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions` — the `, extensions` is mandatory because every one inserts a row whose id defaults to `uuid_v7()` and pgcrypto lives in `extensions` on this project (`0004:150-153`). Each is immediately followed by `REVOKE EXECUTE … FROM PUBLIC, anon;` + `GRANT EXECUTE … TO authenticated;` with the full signature repeated in both.

- [x] **Step 1 — `search_exercises(p_query TEXT, p_muscle TEXT, p_equipment TEXT, p_pattern TEXT, p_limit INT, p_offset INT)`.** `LANGUAGE sql STABLE` — read-only, so no plpgsql. Filters compose (each param null-tolerant); text match is `name ILIKE '%'||p_query||'%' OR name_ar ILIKE …` ranked by `similarity(name, p_query) DESC`, which is what the existing GIN trgm indexes on `name` and `name_ar` are for. Visibility is left to `exercises_select` rather than re-implemented here — the function is `STABLE` and invoker-rights precisely so RLS still applies.
- [x] **Step 2 — `create_custom_exercise(...)`.** Forces `is_custom = TRUE, created_by_user_id = auth.uid()` regardless of input; derives a collision-safe slug; returns the new id.
- [x] **Step 3 — `create_program(p_name, p_duration_weeks, p_client_id, p_is_template)`.** Authorize `p_client_id` with `public.is_pt_of_client()` when given. Creates the program plus its `duration_weeks` empty week rows. Audits `program_create`.
- [x] **Step 4 — `save_program(p_program_id UUID, p_payload JSONB)` (D2).** Authorize with `is_program_editor` (+ admin) or `RAISE EXCEPTION 'not authorized'`. Then, in one transaction: delete this program's weeks (the CASCADE chain clears days/blocks/exercises), and re-insert the whole tree with set-based `INSERT … SELECT … FROM jsonb_to_recordset(...)` at each level, carrying ids down through CTEs so `program_id` is written at every level. One round trip, ~160 rows.

  > **Landmine, comment it in the body:** `workout_sessions.program_day_id` is `ON DELETE SET NULL`. Replace-children therefore orphans any session row pointing at a rebuilt day. Inert at M3 (no sessions exist) and **loud at M4** — M4 must either diff-and-patch instead of replacing, or re-link. This is the biggest cross-milestone hazard in the plan.

- [x] **Step 5 — `program_tree(p_program_id UUID)`.** `LANGUAGE sql STABLE`, returns the whole nested structure as one JSONB document via nested `jsonb_agg`. Invoker-rights so `is_program_visible` governs it — which is exactly why the builder and the client's read-only view can share one hook.
- [x] **Step 6 — `copy_program_week(p_program_id, p_from_week, p_to_week)` (D3).** Deletes the target week's days (CASCADE clears below) then deep-copies the source week's subtree with a CTE id map. "Existing sessions in the target week are replaced" is literal: replace, never merge.
- [x] **Step 7 — `instantiate_template(p_template_id, p_client_id, p_start_date)` (D3).** Reads the template, writes a **new** program with `template_source_id = p_template_id`, `is_template = FALSE`, `state = 'active'`, deep-copies all four levels, and never issues a single UPDATE against the source. Audits `program_assign`.
- [x] **Step 8 — `assign_program(p_program_id, p_client_id, p_start_date)`.** Authorize both sides. **Archive-then-activate:** any existing `state = 'active'` program for that client moves to `archived` in the same transaction, then this one becomes `active` with the given `start_date`. That is the assign sheet's "replaces it from Monday" promise made transactional. Audits `program_assign` for the new and `program_archive` for the displaced.
- [x] **Step 9 — `copy_program` and `archive_program`.** Duplicate-as-template and state transition respectively; both audit.
- [x] **Step 10 — `consume_ai_credit(p_generation_type, p_prompt_hash, p_prompt_scrubbed, p_output_scrubbed, p_model_id, p_input_tokens, p_output_tokens, p_latency_ms)`.** The atomic heart. `SELECT … FROM ai_credit_wallets WHERE user_id = auth.uid() FOR UPDATE` to serialize concurrent drafts, then `UPDATE … SET balance = balance - 1, total_consumed = total_consumed + 1`. `chk_acw_balance CHECK (balance >= 0)` means an over-debit **raises** rather than clamping — the route catches that as D5 stage 5. Insert the `ai_generations` row, audit `ai_credit_consume` + `ai_generation_create`, return `(generation_id, new_balance)`.
- [x] **Step 11 — `refund_ai_credit(p_generation_id, p_reason)`.** Guards against double refund via `was_refunded`, increments `balance` and `total_refunded`, stamps `refund_reason`, audits `ai_credit_refund`.
- [x] **Step 12 — `create_program_from_draft(p_client_id, p_generation_id, p_payload)`.** Resolves the draft into a real `draft`-state program with `is_ai_generated = TRUE` and `ai_generation_id`, then stamps `ai_generations.result_entity_type/result_entity_id`. **This is the only function that ever persists an AI draft** — EP-15's "AI never auto-publishes" is enforced by there being no other path.
- [x] **Step 13 — `grant_ai_credits(p_user_id, p_credits, p_reason)`.** `IF NOT public.is_admin() THEN RAISE EXCEPTION 'not authorized'`. Support and testing top-ups until M6. Audits `ai_credit_purchase`.
- [x] **Step 14 — Apply and regenerate:** `supabase db push`, then `supabase migration list`, then `pnpm types:gen`. Confirm the diff carries the new columns and all 15 function signatures.
- [x] **Step 15 — Commit:** `feat(db): M3 program, template, and AI credit RPCs`

## Task 3 · RLS assertions for M3

**Files:** modify `db/rls_assertions.sql`.

Append an M3 section using the existing `pg_temp.expect` / `expect_rls_block` / `expect_raises` primitives and the `SET LOCAL ROLE authenticated; SELECT pg_temp.act_as(:'who'); …; RESET ROLE;` triad. Every negative needs a positive control — without them the suite passes when everything is locked shut.

- [x] **Step 1 — Fixtures.** A program authored by PT A, assigned to client A, with one week/day/block/exercise; a template owned by PT A; a custom exercise owned by PT B.
- [x] **Step 2 — Cross-tenant reads (PT B).** Zero programs, zero weeks, zero days, zero blocks, zero program_exercises, zero sight of PT A's custom exercise. Six `expect(…, 0, …)`.
- [x] **Step 3 — The composite-FK invariant.** `expect_raises` on an `INSERT INTO program_blocks` whose `program_id` disagrees with its `day_id`. **This is the assertion that fails loudly if someone later drops the composite FK "to simplify"** — the policies trust that column.
- [x] **Step 4 — Draft invisibility.** With the program at `state = 'draft'` and `client_id` set, client A sees **0** rows; flipped to `active`, client A sees **1**. This is EP-15's no-auto-publish guarantee tested at the row level.
- [x] **Step 5 — Client cannot write.** `expect_rls_block` on a client UPDATE of `program_exercises`, plus the count-affected-rows idiom for a `programs` UPDATE (a USING-filtered no-op reads as 0, not as an error).
- [x] **Step 6 — Global library is not writable.** `expect_rls_block` on an INSERT with `is_custom = FALSE`.
- [x] **Step 7 — Wallet isolation and immutability.** PT B sees 0 of PT A's wallet rows; a direct `UPDATE ai_credit_wallets SET balance = 9999` by the owner affects 0 rows.
- [x] **Step 8 — Ledger end-to-end.** As PT A: `consume_ai_credit` drops the balance by exactly 1; `refund_ai_credit` returns it and flips `was_refunded`; a second refund of the same generation raises; draining to 0 and consuming again raises on `chk_acw_balance`. `grant_ai_credits` as a non-admin raises; as admin, succeeds.
- [x] **Step 9 — Template immutability.** Capture a `target_reps_min` from the template, run `instantiate_template`, mutate the copy, re-read the template value, assert unchanged. This is EP-04's "copies, never mutates" as an assertion rather than a hope.
- [x] **Step 10 — Positive controls.** PT A sees their program, its 4 weeks, its exercises, their own custom exercise and the global library; client A sees the assigned active program and its tree.
- [x] **Step 11 — Run it:** `"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -v ON_ERROR_STOP=1 -f db/rls_assertions.sql`. **Report the actual `NOTICE: pass …` output for every M3 case plus all M0–M2 regressions** — an assertion that unexpectedly passes-as-permitted is a security hole, not a test nit.
- [x] **Step 12 — Commit:** `test(db): RLS assertions for M3 programming and AI credits`

## Task 4 · Exercise library — data, generator, migration 0008

**Files:** create `db/exercises/forge_exercise_library_v1.json`, `db/exercises/build_import_sql.mjs`, `supabase/migrations/0008_exercise_library_v1.sql`.

- [x] **Step 1 — The JSON source.** ~250 entries: `{ slug, name, name_ar?, muscle_group, equipment, movement_pattern, difficulty, instructions?, coaching_cues[] }`. Every value must satisfy the CHECK constraints at `db/schema.sql:555-573` — the generator validates this, it is not left to review. Coverage target: every `muscle_group`, every `equipment`, every `movement_pattern` represented, so the filter chips are genuinely exercisable rather than decorative. Absorb `db/seed.sql`'s 41 existing slugs verbatim so the two badge definitions keying off `barbell_bench_press` and `barbell_back_squat` keep working.
- [x] **Step 2 — `build_import_sql.mjs`.** Reads the JSON, validates against the CHECK value lists, sorts by slug (determinism — the output must be byte-stable), emits one multi-row `INSERT … ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, …` inside `BEGIN;`/`COMMIT;`, with a generated-file banner. Idempotent by construction: re-running updates rather than duplicating, which is what makes the later 2,000-row import data-only.
- [x] **Step 3 — Generate and apply.** `node db/exercises/build_import_sql.mjs > supabase/migrations/0008_exercise_library_v1.sql`, then `supabase db push`.
- [x] **Step 4 — Verify coverage with real numbers:** `SELECT muscle_group, count(*) FROM public.exercises WHERE is_custom = FALSE GROUP BY 1 ORDER BY 1;` plus the distinct `(muscle_group, equipment, movement_pattern)` count. Paste the output; do not assert coverage from the JSON alone.
- [x] **Step 5 — Commit:** `feat(db): curated exercise library v1 and its idempotent importer`

## Task 5 · `packages/shared` — schemas and pure helpers

**Files:** create `src/schemas/{programs,exercises,ai}.ts` and their `.test.ts` siblings; modify `src/schemas/index.ts`.

House style: `export const <camel>Schema` + `export type <Pascal>Input = z.infer<…>`; `.strict()` on every RPC payload so a stray key fails rather than being silently ignored; a doc comment naming the SQL object each mirrors; fixed lists as `as const` tuples with a derived union; pure domain helpers beside the schemas, as `intake.ts` does with `evaluateParq`.

- [x] **Step 1 — `exercises.ts`.** `MUSCLE_GROUPS`, `EQUIPMENT`, `MOVEMENT_PATTERNS`, `DIFFICULTIES` as `as const` tuples mirroring the four CHECK constraints exactly; `exerciseSearchSchema`; `createCustomExerciseSchema` (name/muscle/equipment required, pattern defaulting to `other`, cues capped).
- [x] **Step 2 — `programs.ts`.** `PROGRAM_STATES`, `BLOCK_TYPES`, `PERIODIZATIONS` mirroring their CHECKs. `saveProgramPayloadSchema` — the nested weeks → days → blocks → exercises payload `save_program` consumes — with `.superRefine` rules for **duplicate `sort_order` within a block**, **duplicate `week_number`/`day_number`**, and `target_reps_min <= target_reps_max` (mirroring `chk_pe_reps`). These refines exist to catch a malformed builder state *before* a 160-row round trip, not after.
- [x] **Step 3 — Pure helpers in `programs.ts`.** `programStats(tree)` → `{ weeks, daysPerWeek, exerciseCount }` for the list row meta; `weekCompletion(program, today)` → the week strip's filled/unfilled array; `formatSetSpec(pe)` → `"4 × 6 @ RPE 7"` for the AI result and the client view. All pure, all testable, none of them in the apps.
- [x] **Step 4 — `ai.ts`.** `aiProgramDraftRequestSchema` (clientId, goal, equipment[], experience, avoid?); `aiProgramDraftResponseSchema` (the nested draft with a per-exercise `why`, plus `generationId`, `balance`, `lowBalance`); `AI_CREDIT_PACKS` as an `as const` tuple (20/$5, 50/$10, 150/$25); `creditState(balance)` → `'ok' | 'low' | 'empty'` with the ≤3 / 0 thresholds from state machine **D36**. The response schema is shared deliberately: the route validates what it returns and the app validates what it receives, from one definition.
- [x] **Step 5 — Tests.** One `describe` per schema, test names restating the rule, in the established style (`import { describe, expect, it } from 'vitest'`, no globals): every enum accepts exactly its CHECK values and rejects one outside; `saveProgramPayloadSchema` rejects duplicate sort orders and inverted rep ranges; `.strict()` rejects an extra key; `creditState` returns `low` at 3 and `ok` at 4; `formatSetSpec` handles a rep range, a single rep count, and a missing RPE; `programStats` on an empty program.
- [x] **Step 6 — Verify:** `pnpm --filter @forge/shared test` — report the real pass count.
- [x] **Step 7 — Commit:** `feat(shared): program, exercise, and AI draft schemas with pure helpers`

## Task 6 · `packages/shared` — i18n copy

**Files:** modify `src/i18n/en.json`, `src/i18n/ar.json`.

Five new top-level namespaces: `library`, `programs`, `builder`, `ai`, `credits`. Both files stay key-for-key identical — that property is what makes a missing translation a diff rather than a runtime surprise.

- [x] **Step 1 — `library.*`** — search placeholder with `{{count}}`, the three filter-chip label maps keyed by the DB enum values, `empty`/`noMatch`/`offlineError` groups, detail and custom-exercise form copy.
- [x] **Step 2 — `programs.*`** — segmented pill labels, `meta` with `{{weeks}} · {{days}} · {{exercises}}`, `WEEK`/`DRAFT` tags, the five list states.
- [x] **Step 3 — `builder.*`** — cell labels (SETS/REPS/RPE/TEMPO), block tags, copy-week sheet, assign sheet including `replaceWarning` with `{{name}}`/`{{weeks}}`, unsaved-changes confirm.
- [x] **Step 4 — `ai.*`** — prompt sections, the four generating checklist steps, **the corrected generating body copy**, result warn banner, discard confirm naming the spent credit, and the D5 error keys (one per failure stage, each stating whether the credit was charged).
- [x] **Step 5 — `credits.*`** — balance label, `_one`/`_other` plurals for the remaining count, the "building by hand is always free" body, the three pack rows, and the inert-CTA "coming soon" label.
- [x] **Step 6 — Arabic.** Translate rather than transliterate; keep numerals Western (the mono numeric treatment assumes them).
- [x] **Step 7 — Commit:** `feat(shared): M3 programming and AI copy in English and Arabic`

## Task 7 · Mobile — the superset block and 4-cell builder row

**Files:** create `apps/mobile/src/ui/{BuilderBlock,BuilderRow}.tsx`; modify `apps/mobile/src/ui/{NumericKeypad.tsx,index.ts}`.

The one Outstanding item in `docs/DESIGN_SYSTEM_GAPS.md`. Built as a real shared component, not inlined in the builder screen.

- [x] **Step 1 — `BuilderBlock`.** Header row: a mono `tag` badge (`A`/`B`/`C`), `title`, and a right-aligned `rest` chip (`REST 3:00`). One `accessibilityLabel` combining tag + title + rest. Body is a `SectionCard`-shaped container with `children`.
- [x] **Step 2 — `BuilderRow`.** Two stacked rows. Top: a 26pt `slot` badge (`A1`, mono 11pt/700, `surfaceSunken`) + `name` at 15pt/600 `numberOfLines={1}`, the whole area `Pressable` for swap-exercise, with a trailing 44×44 `onRemove` when given. Bottom: the four-cell strip, `flexDirection: 'row'`, `gap: 6`, each cell `{ flex: 1, minWidth: 64, minHeight: 44 }`. **Put D8's 390pt arithmetic in the file header** so nobody later folds the cells onto the name row and breaks the 44pt floor.
- [x] **Step 3 — Cell internals.** `Pressable`, `accessibilityRole="button"`, `accessibilityLabel={`${label}, ${value || 'not set'}`}`, `accessibilityState={{ selected }}`. Label 9.5pt uppercase `tone="muted"`; value `<Text numeric>` 17pt/700, em dash when empty. Active: `accentSurfaceSoft` + 1.5pt `accent` border. Variant→token lookup tables `as const`, no inline conditionals in style objects.
- [x] **Step 4 — `NumericKeypad` gains `extraKey?: { label: string; onPress: () => void }`** rendered in the currently-empty bottom-left slot; omitted, the existing spacer stays. `target_rpe` is `NUMERIC(3,1)`, so `.` is a requirement, not decoration. Existing MFA callers stay untouched — typecheck proves it.
- [x] **Step 5 — Barrel:** add both components and their prop types to `ui/index.ts` in alphabetical position.
- [x] **Step 6 — Verify:** `pnpm --filter mobile typecheck` and `lint` clean. Visual checks belong to the device list.
- [x] **Step 7 — Commit:** `feat(mobile): superset block header and the 4-cell numeric builder row`

## Task 8 · Mobile — the PT tab bar (D7)

**Files:** create `apps/mobile/src/app/(app)/(tabs)/_layout.tsx`; move `(app)/index.tsx` and `(app)/clients/**` under `(tabs)/`; modify the four existing `router.push` call sites.

First navigation-structure change since M0. Lands **before** any M3 screen, so no new screen is ever written against the old tree.

- [x] **Step 1 — Create the group and prove the route type.** `git mv` `index.tsx` and `clients/` into `(tabs)/`, then run `pnpm --filter mobile typecheck`. Expo-router regenerates `.expo/types/router.d.ts` and **that output is the arbiter** of whether hrefs keep the group prefix, not this plan. Prefer the un-prefixed form if typecheck accepts it. Record which won in the layout's header comment so later screens copy the right shape.
- [x] **Step 2 — `(tabs)/_layout.tsx`.** `<Tabs>` with `headerShown: false`, active/inactive tints and bar background from theme tokens, and four `<Tabs.Screen>`: `index` (Today), `clients`, `programs`, `library`. Labels through `t()`. Icons as `<Text>` glyphs — no icon font is in the tree and M3 is not the milestone to add one; note it as an M4 cleanup.
- [x] **Step 3 — Client branch, one tree.** Read `useAuth()` in the layout; when `role === 'client'`, pass `tabBar={() => null}` and `options={{ href: null }}` on `clients`, `programs` and `library`, so a client can neither see nor deep-link a PT surface. No second layout, no duplicated hrefs.
- [x] **Step 4 — Update the four call sites** (Today's clients button, the three invite pushes, client detail). Typecheck is the proof.
- [x] **Step 5 — Commit:** `feat(mobile): PT tab bar for Today, Clients, Programs, and Library`

## Task 9 · Mobile — exercise library data layer and screens

**Files:** create `apps/mobile/src/lib/exercises/{useExerciseSearch,useExerciseDetail,exerciseActions}.ts`, `app/(app)/(tabs)/library/index.tsx`, `app/(app)/library/[id].tsx`, `app/(app)/library/custom.tsx`.

Data-layer shape is non-negotiable house style: a module-level `async function fetch…()`, a mount `useEffect` with the fetch **inlined via `.then()`** (never calling `refetch` — `react-hooks/set-state-in-effect` trips otherwise, documented in four existing files), `let cancelled = false` cleanup, a `useCallback refetch` for event handlers only. Mutations live in `exerciseActions.ts`, never in a hook.

- [x] **Step 1 — `exerciseActions.ts`.** One thin wrapper: `createCustomExercise(input)` → `supabase.rpc('create_custom_exercise', …)`, `if (error) throw error`. No business logic — the database owns it.
- [x] **Step 2 — `useExerciseSearch({ query, muscle, equipment, pattern })`.** Calls `search_exercises`. **This one re-fetches on filter change**, unlike `useClientList`'s client-side filtering — the library is 250 rows now and 2,000 later, so server-side is correct from day one. Debounce `query` 250ms inside the effect (a `setTimeout` cleared in cleanup, not a separate hook). Exposes `{ loading, error, items, total, isEmpty, isNoMatch, loadMore, refetch }`, with `isEmpty` vs `isNoMatch` split exactly as `useClientList` defines them.
- [x] **Step 3 — `useExerciseDetail(exerciseId, clientId?)`.** The exercise row plus, when `clientId` is given, that client's history for the movement. **M3 has no `sets` data** (M4 owns logging), so history returns empty and the screen renders its own state. Build the shape now so M4 fills it without touching the screen.
- [x] **Step 4 — `library/index.tsx`, all five states.** Search field with `t('library.searchPlaceholder', { count: total })` — **the real count**. Three horizontally-scrolling chip rows (muscle / equipment / pattern) — no dropdown, no modal, per the annotation. Loading → three 64pt `Skeleton`s. Error → `Banner variant="danger"` + Retry. Empty and no-match → CTA "Create custom exercise". Populated → `ListRow`s with a `MINE` badge when `is_custom`.
- [x] **Step 5 — `library/[id].tsx`.** 16:9 striped video placeholder (absolutely-positioned rotated `View`s — no asset, no dependency), rendered whenever `demo_video_url` is null, which at M3 is always. Numbered mono cue rows. History block at the bottom with its own empty state. "Add to program" pinned to the bottom third; it returns the exercise id when opened from the builder via `params.returnTo`, and is disabled otherwise with a subtitle saying where it comes from.
- [x] **Step 6 — `library/custom.tsx`.** `FormScreen` + sticky footer. `useState` per field + `createCustomExerciseSchema.safeParse` in `validate()` + `useAsyncSubmit()` + `zodIssuesToFieldErrors()` — the M2 form pattern exactly. Only name/muscle/equipment required, keeping it the 30-second job the annotation asks for. Cues reuse `CertificationsEditor`'s add/remove shape rather than inventing a second one.
- [x] **Step 7 — Commit:** `feat(mobile): exercise library, detail, and custom exercise creation`

## Task 10 · Mobile — program data layer and the program/template list

**Files:** create `apps/mobile/src/lib/programs/{useProgramList,useProgramTree,programActions}.ts`, `app/(app)/(tabs)/programs/index.tsx`.

- [x] **Step 1 — `programActions.ts`.** One wrapper per write RPC: `createProgram`, `saveProgram`, `copyProgram`, `copyProgramWeek`, `assignProgram`, `instantiateTemplate`, `archiveProgram`, `createProgramFromDraft`. Same header comment as `clientActions.ts`: no business logic here, the database owns all of it.
- [x] **Step 2 — `useProgramList(ptUserId, { tab })`.** `programs` filtered by `author_user_id`, ordered `created_at DESC`, with child counts via PostgREST's embedded count on the denormalised `program_id` — **possible only because of D1**; counting 108 rows client-side would be wrong. Merge client display names with the same two-query approach `useClientList` documents (and for the same reason — two FKs into `users`). `tab` filters `is_template` client-side; that list is small.
- [x] **Step 3 — `useProgramTree(programId)`.** One `program_tree` RPC call returning nested JSONB, parsed through the read-side sibling of `saveProgramPayloadSchema` so a shape drift between SQL and TypeScript surfaces as a typed error at the boundary rather than `undefined` three screens later.
- [x] **Step 4 — `programs/index.tsx`.** `SegmentedPill` for Assigned | Templates — **one route, not two**, per the annotation. Rows: name, `programStats()` meta, and the `WEEK 3` / `DRAFT` tag. Under each assigned row, `weekCompletion()`'s strip as small mono bars — **no percentages**. The unassigned AI draft row reads `DRAFT` in warn tones. All five list states. "New program" visible in every non-empty state.
- [x] **Step 5 — Templates tab.** Same rows plus a one-line description and an inline Assign — **the only thing PTs do from this list**. Assign opens the client picker and calls `instantiateTemplate`.
- [x] **Step 6 — Commit:** `feat(mobile): program and template lists`

## Task 11 · Mobile — the builder

**Files:** create `apps/mobile/src/app/(app)/programs/[id]/builder.tsx`.

The dense screen. Local-draft editor: load the tree once, edit in `useState`, save with one RPC.

- [x] **Step 1 — Header.** `‹ Programs · {client} · {program}` with `Save` at the end, disabled while `!dirty`, spinner while submitting via `useAsyncSubmit`.
- [x] **Step 2 — Week row + copy button.** Horizontal week pills (mono) and a **40pt `⧉`** button with an `accessibilityLabel` opening the copy-week sheet.
- [x] **Step 3 — Day chip row.** Horizontal day chips at `minHeight: 38` plus a `+` chip. Selecting a day swaps the block list; nothing navigates.
- [x] **Step 4 — Blocks.** Map the day's blocks to `BuilderBlock` → `BuilderRow`, `tag` from index and `slot` as `${tag}${i+1}` — **A1/A2 supersets are the block's rows, not a separate concept**, which is why the schema needs nothing beyond `block_type = 'superset'`. Dashed "+ Add exercise" routing to the library with `returnTo`; dashed "+ Add block" after the last.
- [x] **Step 5 — The keypad drawer.** `editing = { blockIdx, rowIdx, key } | null`. When set, a fixed-bottom panel above the footer: cell label, live value at 28pt mono, then `NumericKeypad` with `extraKey={{ label: '.' }}` for RPE, or the tempo `ChipRow` + Custom field for TEMPO. Done / Next-cell at 44pt. Scroll the active row above the drawer.
- [x] **Step 6 — Footer.** Left: mono credit count over `t('credits.balanceLabel')` from `useCreditBalance`. Right: the ember `✦ Draft with AI` button. When `creditState(balance) !== 'ok'`, it opens the credit sheet first — the cost is decided here, which is why the balance lives here.
- [x] **Step 7 — Save.** Serialize through `saveProgramPayloadSchema.parse()` (the refines catch duplicate sort orders before the round trip), call `saveProgram`, clear `dirty`. On failure, `Banner variant="danger"` and **leave local state intact** — a failed save must never lose an hour of programming.
- [x] **Step 8 — Unsaved-changes guard.** Intercept back when `dirty` with the established destructive-confirm sheet.
- [x] **Step 9 — Commit:** `feat(mobile): program builder with the 4-cell numeric row and keypad drawer`

## Task 12 · Mobile — copy-week and assign

**Files:** create `apps/mobile/src/app/(app)/programs/[id]/assign.tsx`; add the copy-week `Modal` inside `builder.tsx`.

- [x] **Step 1 — Copy-week sheet.** A `Modal` inside the builder, **not a route** — a confirmation does not belong in the back stack. Title names the source week; body carries the replacement warning **before** the tap; radio list of targets with proper `accessibilityRole`/`State`. Confirm calls `copyProgramWeek` then `refetch`.
- [x] **Step 2 — `assign.tsx`.** Multi-select list of `active`/`accepted` clients with radio marks, reusing `useClientList`, rows at 68pt.
- [x] **Step 3 — Start date in two taps.** Chips `Next Monday` (default) / `Today` / `Custom`; only Custom opens a date input. No calendar by default.
- [x] **Step 4 — The warn banner.** Before submit, check each selected client for an existing `active` program; when one exists, `Banner variant="warn"` with `t('builder.assign.replaceWarning', { name, weeks })` computed from `duration_weeks` and `start_date`. Warn, not danger — the PT needs to read it, not panic.
- [x] **Step 5 — Submit** calls `assignProgram` per client (a small serial loop; not a hot path), then routes back with the new `WEEK 1` row visible.
- [x] **Step 6 — Commit:** `feat(mobile): copy-week sheet and assign-to-client flow`

## Task 13 · Mobile — the AI draft flow and credit sheets

**Files:** create `apps/mobile/src/lib/ai/{useCreditBalance,requestProgramDraft}.ts`, `app/(app)/programs/ai.tsx`; add the credit `Modal` as a colocated component.

- [x] **Step 1 — `useCreditBalance()`.** A plain RLS-scoped select on `ai_credit_wallets` — no RPC needed, `ai_credit_wallets_select` already scopes it. Returns `{ balance, state: creditState(balance), loading, refetch }`.
- [x] **Step 2 — `requestProgramDraft(input)`.** Same shape as `lib/intake/openWaiver.ts`: get the session, `fetch(`${WEB_HOST}/api/ai/program-draft`, …)` with the bearer header, then branch on D5's statuses — **402 → open the upsell, 504 → timeout (credit not charged, say so), other non-2xx → generic failure, credit not charged unless the body says otherwise**. Parse success through `aiProgramDraftResponseSchema`. `AbortController` at 30s so a hung socket can't spin forever.
- [x] **Step 3 — Prompt state.** `✦ Draft with AI` header with the mono credit count; four sections — Goal (single-select), Equipment (multi-select `ChipRow`), Experience (three 44pt segments), Anything to avoid (multiline, placeholder "No overhead pressing — left shoulder."). CTA `Generate draft · 1 credit` at 52pt in the bottom third.
- [x] **Step 4 — Generating state.** Spinner, title, **the corrected copy** ("Usually under 12 seconds. Keep this screen open."), and the four-step checklist. Ticks advance on an `elapsed / 12s` estimate; the last never ticks until the response lands; an early response jumps to Result. **Comment in source that this is an elapsed-time estimate, not server progress** — otherwise someone later reads it as telemetry.
- [x] **Step 5 — Result state.** Summary from `draft.summary`; rows of name / `formatSetSpec()` / `why` with the rationale at 12.5pt secondary — **the per-exercise `why` is the entire point of the review moment** and is deliberately never persisted. `Banner variant="warn"`: "Draft only. Nothing is assigned until you save it." CTAs: "Review in builder", "Redraft", and "Discard" behind a confirm naming the credit as already spent.
- [x] **Step 6 — "Review in builder"** calls `createProgramFromDraft` then `router.replace` into the builder. **This tap is the only thing that persists anything**; until then the draft lives in this screen's `useState` and nowhere else.
- [x] **Step 7 — The credit sheet.** A plain RN `Modal` rendered from both the builder footer and this screen. Title interpolates the **real** balance with `_one`/`_other`. Body: "Credits only cover AI drafting. Building programs by hand is always free and unlimited." Three packs from `AI_CREDIT_PACKS` in mono, the `standard` pack carrying "Best value". **The purchase CTA is inert**, with the "coming soon" treatment. Never a hard block — dismissing returns to the builder, which still works.
- [x] **Step 8 — Commit:** `feat(mobile): AI program draft flow and the credit sheets`

## Task 14 · Mobile — the client's read-only program view

**Files:** create `apps/mobile/src/app/(app)/my-program.tsx`; modify `app/(app)/(tabs)/index.tsx`.

Not in the prototype — designed as a sibling of the existing client home. This is what makes Task 1's client RLS observable from a real session rather than only from the harness.

- [x] **Step 1 — Client home gains a program card.** Query `programs` for their client row — **RLS already returns only `active`/`completed`, so no client-side state filter is needed or wanted**; the absence of that filter is the point. Show name, `programStats()` meta, and the current week from `start_date`. No row → "Your trainer hasn't assigned a program yet."
- [x] **Step 2 — `my-program.tsx`.** `useProgramTree(programId)` — **the same hook the builder uses**, because RLS is doing the authorization, not a second code path. Week chips → day chips → read-only blocks via `BuilderBlock` plus a non-interactive cell strip (`onCellPress` omitted, cells render as plain `View`s at the same type scale, so the numbers read identically to what the PT typed).
- [x] **Step 3 — No write affordances at all.** No Save, no add, no keypad; a tap does nothing. Loading skeleton, empty state and offline error all present per the cross-cutting rule.
- [x] **Step 4 — Commit:** `feat(mobile): client read-only program view`

## Task 15 · `apps/web` — the AI broker route

**Files:** create `apps/web/lib/ai/{model,catalog,prompt,scrub}.ts`, `app/api/ai/program-draft/route.ts`; modify `apps/web/package.json`, `.env.example`, `README.md`.

The first LLM call anywhere in the repo. The two-client authorization rule from `app/api/waiver/route.ts` applies unchanged: authorize under the caller's bearer token first, and only then do anything privileged.

- [x] **Step 1 — Dependency and env.** Add `@anthropic-ai/sdk` to `apps/web/package.json`. Add `ANTHROPIC_API_KEY` to `.env.example` and document its single consumer in `README.md`, the way the service-role key was documented in M2.
- [x] **Step 2 — `lib/ai/model.ts`.** `export const AI_MODEL_ID = 'claude-opus-5';` plus `AI_EFFORT = 'medium'`, `AI_MAX_TOKENS = 16000`, `AI_TIMEOUT_MS = 25_000`, `AI_BUDGET_MS = 12_000`. One file, one edit — and `AI_MODEL_ID` is written into `ai_generations.model_id` on every row, so the choice stays measurable from data rather than memory.

  > **API notes, verified against the `claude-api` skill, not from memory:** on `claude-opus-5` thinking is **on by default** (adaptive) and `budget_tokens` returns a 400 — do not send it. Depth is controlled by `output_config.effort`, which defaults to `high`; start at `medium` for the 12s budget. `AI_MAX_TOKENS = 16000` is the non-streaming ceiling that keeps the request under the SDK's HTTP timeout.

- [x] **Step 3 — `lib/ai/catalog.ts`.** `buildCatalogue(bearer, equipment)` selects `slug, name, muscle_group, movement_pattern` from `exercises` where `is_active` and the equipment matches, formats one line per row, and returns the block plus a `Map<slug, id>` for resolution. Cap at 400 rows. The model picks **by slug from this list only** — that is what stops it inventing movements that don't exist in the library.
- [x] **Step 4 — `lib/ai/prompt.ts`.** `buildDraftPrompt(ctx)` → `{ system, user, hash }`. **Never interpolates a name, email, DOB, phone or UUID** — the client is "the client" and age is bucketed. Carries the catalogue, the rules (four weeks, 2–5 days, slugs only, one `why` per exercise, respect the avoid-text absolutely), and goal/equipment/experience. `hash` is `sha256(system + '\n' + user)` — 64 hex chars, exactly `VARCHAR(64)`.
- [x] **Step 5 — `lib/ai/scrub.ts`.** `scrubForLog(text, names)` replaces emails, UUIDs, digit runs ≥4 and known name tokens with `[redacted]`, truncating at 4000. Applied to prompt and output before either reaches `consume_ai_credit`. Header comment stating the two-layer design plainly: **layer 1 keeps identifiers off the wire, layer 2 keeps them out of the log, and neither substitutes for the other.**
- [x] **Step 6 — The route.** `export const dynamic = 'force-dynamic'`, module-scope schemas imported from `@forge/shared`. Order, matching **D23** exactly: bearer token → `bearer.auth.getUser()` → authorize `clientId` under RLS (**zero rows is the 403**) → read the wallet under RLS, 402 if `balance < 1` → build catalogue + prompt → call the model → guard `stop_reason === 'refusal'` and `parsed_output === null` → resolve every slug, failing at >20% unresolvable → `bearer.rpc('consume_ai_credit', …)` → return `{ generationId, balance, lowBalance, draft }`.

  Structured output is the `messages.parse` + `zodOutputFormat` path, with `maxRetries: 0` (retries would blow the 12s budget) and a per-request timeout:

  ```ts
  import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

  const response = await client.messages.parse(
    {
      model: AI_MODEL_ID,
      max_tokens: AI_MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort: AI_EFFORT, format: zodOutputFormat(aiProgramDraftSchema) },
    },
    { timeout: AI_TIMEOUT_MS, maxRetries: 0 },
  );
  // parsed_output is null when parsing failed — a real, handled path, not an assertion
  ```

- [x] **Step 7 — The failure matrix, implemented literally.** Each **D5** stage returns its own status and error key. Stage 5's race (the CHECK raising because a concurrent draft won) **returns the draft anyway with `balance: 0`** — never punish a user for our race. Stage 6 calls `refund_ai_credit` before returning 500.
- [x] **Step 8 — Commit:** `feat(web): blocking AI program-draft broker with credit ledger and refund path`

## Task 16 · `apps/web` — admin program and AI-generation inspector

**Files:** create `app/admin/programs/{page,[id]/page,program-filter}.tsx`, `app/admin/ai-generations/page.tsx`; modify `app/admin/page.tsx`, `app/admin/users/[id]/page.tsx`.

Async Server Components: `const supabase = await createClient(); await requireAdmin(supabase);`, `export const dynamic = 'force-dynamic'`, `import * as ui from '@/lib/ui/styles'`, interactive filters as colocated `'use client'` siblings under the admin's own anon session. **Never the service-role key** — the `OR public.is_admin()` hatches from Task 1 are what make every read here work.

- [x] **Step 1 — `admin/programs/page.tsx`.** Table of every program: name, author, client, state, weeks, AI?, created. `program-filter.tsx` is the client sibling, modelled on `admin/user-search.tsx`.
- [x] **Step 2 — `admin/programs/[id]/page.tsx`.** The full tree read-only via `program_tree`. When `is_ai_generated`, a linked generation block: id, model, tokens, latency, credits charged, `was_refunded`, `refund_reason`, and the scrubbed prompt/output in `<pre>`.
- [x] **Step 3 — `admin/ai-generations/page.tsx`.** Every generation newest-first, linking to its program when set and plainly showing "— (draft discarded)" when `result_entity_id` is null. **This page is EP-15's "unique ID logged per generation with PII-scrubbed prompt/output" made checkable by a human** — the only form in which that criterion can actually be verified.
- [x] **Step 4 — `admin/users/[id]/page.tsx`.** For a PT, an "AI credits" block (balance / consumed / refunded / last low-balance warning) and a program count linking to the filtered list. No mutations — `grant_ai_credits` exists for support to call directly; a UI for it is M10 tooling, the same posture as the rest of this surface.
- [x] **Step 5 — `admin/page.tsx`** gains links to both new sections.
- [x] **Step 6 — Commit:** `feat(web): admin program and AI-generation inspector`

## Task 17 · Close-out

- [x] **Step 1 — Tick this plan's checkboxes as work lands**, per M1's stated lesson about reconstructing completion from commit messages afterward.
- [x] **Step 2 — `docs/DESIGN_SYSTEM_GAPS.md`.** Add a `## Built (M3)` section in the M1/M2 format: the **Superset / 4-cell builder row** entry naming the D8 arithmetic it encodes and pointing at `apps/mobile/src/ui/BuilderRow.tsx`, plus the `NumericKeypad` `extraKey` extension. Remove the row from `## Outstanding`; since that empties it, replace the list with one line saying no prototype-flagged gaps remain.
- [x] **Step 3 — `CLAUDE.md`.** M3 → done, M4 → next. Status paragraph gains the programming/AI sentence and migration count 6 → 8. The AI row of the tech-stack table changes "from M3" to the concrete model id and route. **The M10 row gains "full 2,000+ exercise library import"** — that is where EP-04's unmet criterion is recorded, and it must not live only in this plan. Add a docs-table line noting that `Forge_Prototype.html`'s M3 copy is superseded by this plan's **Corrections** section where they disagree.
- [x] **Step 4 — `db/schema.sql` header warning.** Add the 0007 changes to the existing list of what the baseline predates: `exercises.demo_video_url`, `programs.start_date`, `program_id` on days/blocks/exercises with their composite FKs, and the two deferrable sort-order uniques.
- [x] **Step 5 — `db/README.md`.** Add Files rows for the library JSON and generator; correct the `seed.sql` row (its 41 exercises are absorbed into 0008 via `ON CONFLICT (slug)`); note the denormalised `program_id` on the Programming domain row.
- [x] **Step 6 — Re-run the verification block below and report real output**, not expectations.
- [x] **Step 7 — Commit:** `docs: M3 close-out — plan checkboxes, DS gaps, CLAUDE.md, schema and db README`

---

## Verification

Run at close-out, and re-run checks 3 and 4 after any task that touches the DB or shared types.

| # | Check | Command | Who | Result |
|---|---|---|---|---|
| 1 | Migrations 0001–0009 applied, local/remote agree | `supabase migration list` | Claude | **PASS** — 0001…0009, local and remote agree on every row, nothing pending. (0009 was added during implementation; see As built.) |
| 2 | Types regenerated | `pnpm types:gen` | Claude | **PASS** — `demo_video_url`, `start_date`, the three `program_id` columns and all 14 RPCs plus `program_summaries` are present in `database.types.ts`. |
| 3 | **RLS holds** — every M3 case plus all M0–M2 regressions | `"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -v ON_ERROR_STOP=1 -f db/rls_assertions.sql` | Claude | **PASS** — exit 0, **85/85 `NOTICE: pass …`**, 0 failures, clean `ROLLBACK`. 48 M0–M2 regressions + 37 new M3 assertions. |
| 4 | Full pipeline | `pnpm turbo run typecheck lint test` | Claude | **PASS** — 6/6 tasks (`@forge/shared` typecheck+test, `mobile` typecheck+lint, `web` typecheck+lint). **197/197** shared tests (78 new: 70 schema/helper + 8 i18n parity). |
| 5 | Web builds, routes registered | `pnpm --filter web build` | Claude | **PASS** — compiles clean; `/api/ai/program-draft`, `/admin/programs`, `/admin/programs/[id]` and `/admin/ai-generations` all present in the route table alongside the M2 routes. |
| 6 | Import is idempotent | re-run 0008's body inside a transaction | Claude | **PASS** — 205 rows before, `INSERT 0 205` on re-run, 205 rows after. `ON CONFLICT (slug) DO UPDATE` updates in place rather than duplicating. |
| 7 | Curated set covers the filter matrix | `SELECT count(DISTINCT (muscle_group, equipment, movement_pattern)) …` | Claude | **PASS** — **205 exercises**, **145 distinct (muscle, equipment, pattern) combinations**, and **20/20 muscle groups, 16/16 equipment values, 12/12 movement patterns** each represented. Per-group range 7 (abductors, adductors, hip_flexors, traps, other) to 16 (chest, back). |
| 8 | **`save_program` ≤1s** | `\timing on` + three runs against a 160-row payload | Claude | **PASS, with ~9x headroom** — **116 / 108 / 112 ms** wall clock from this machine to Frankfurt, of which ~65 ms is the round-trip baseline (a bare `SET LOCAL ROLE` on the same connection measured 66 ms). Row counts confirmed exactly 4 weeks / 12 days / 36 blocks / 108 exercises. `program_tree` on the same program: 215 ms for a 52 KB document. |
| 9 | **Draft latency ≤12s** | a one-off script against the deployed route | Claude | **NOT RUN** — there is no `ANTHROPIC_API_KEY` in this environment (`.env`, `apps/web/.env*` and the shell were all checked). The route is written and typechecks, but its latency against the 12s budget is **unverified**, and so is the `effort: 'medium'` choice in `lib/ai/model.ts`. This is the one acceptance figure M3 cannot claim. |
| 10 | Generator is deterministic | `node db/exercises/build_import_sql.mjs \| diff - supabase/migrations/0008_exercise_library_v1.sql` | Claude | **PASS** — empty diff, byte-identical. |
| 11 | Route types resolve after the tab move | `pnpm --filter mobile typecheck` | Claude | **PASS** — against a **freshly regenerated** `.expo/types/router.d.ts` (that file is gitignored and only the dev server writes it; it had to be regenerated with `--clear` after a stale cache). All ten M3 routes are registered, and the group-prefixed href form (`/(app)/(tabs)/library`, `/(app)/programs/[id]/builder`) is what typecheck accepted. |
| 12+ | The device list below | Expo Go + a deployed web app | **You** | **Pending** — no device or simulator in this environment, same as M1/M2. |

**Device/manual (the actual done-when** — there are no automated UI tests anywhere in this repo, matching M0–M2 precedent):

1. Library: search "press", tap Barbell, tap Push. The list narrows at each step and ranks sensibly (Barbell Bench Press above Leg Press).
2. Clear filters; the placeholder shows the **real** exercise count, not 1,240.
3. Create a custom exercise with only name/muscle/equipment. It carries a `MINE` tag, and a second PT account cannot find it.
4. Exercise detail: striped placeholder renders, cues are numbered, history shows its own empty state (not a crash).
5. Build a 4-week program — three days, three blocks, three exercises each. **Time the Save:** under 1s on wifi, ideally under 2s on 3G.
6. Tap a REPS cell: the drawer opens, the active row stays visible above it, Next-cell walks SETS → REPS → RPE → TEMPO.
7. Tap RPE: `.` is present, `7.5` saves and round-trips.
8. Tap TEMPO: preset chips appear instead of the keypad; Custom reveals a text field.
9. **Measure the cell strip on a 390pt phone.** Every cell ≥44pt tall, ≥64pt wide, four across without wrapping. Repeat on the smallest device available.
10. Copy week 2 onto week 4: the sheet names week 2, warns before the tap, and week 4 afterwards matches week 2 exactly — not merged, not doubled.
11. Apply a template to a client, then open the template and check a value you deliberately altered in the copy: **unchanged**.
12. Assign to a client who already has an active program: the warn banner names them and the weeks remaining, and the old program shows archived afterwards.
13. Sign in as that client: `my-program` shows it read-only, tapping a cell does nothing, the numbers match what the PT typed.
14. As the PT, put a program in `draft` with `client_id` set. The client **cannot** see it — the no-auto-publish guarantee at session level, not just in the harness.
15. Draft with AI. **Time it end to end** against the 12s budget. The generating copy says "Keep this screen open" and never promises a notification.
16. Result: each exercise carries a rationale; the warn banner says nothing is assigned. Discard → the confirm says the credit is spent, and no program was created.
17. Draft again, "Review in builder": a `draft` program exists with `is_ai_generated`, `ai_generations.result_entity_id` is now set, and the balance dropped by exactly 1.
18. Drain to 3: the low-credit sheet appears, dismisses, and hand-building still works.
19. Drain to 0: the upsell appears, its purchase CTA is visibly inert, and the draft button never hard-blocks the builder.
20. Force a failure (unset `ANTHROPIC_API_KEY` on a preview deployment): the copy says the credit was **not** charged, and the balance is genuinely unchanged.
21. Fire two drafts from two devices at balance 1: one succeeds, the other succeeds with `balance: 0` or fails cleanly, and the balance never goes negative.
22. `/admin/ai-generations`: every row has id, model, latency and tokens; the scrubbed prompt contains **no client name, email, DOB or UUID**; a discarded draft shows no result entity.
23. Arabic + dark mode: walk library → builder → AI → assign. The four-cell strip's RTL mirroring and the horizontal filter chips are the two most likely things to be wrong.
24. Search the library in Arabic: `name_ar` matches return, and note honestly how thin Arabic coverage is at 250 rows.

---

## Risks

- **The 12s budget vs. `claude-opus-5` with adaptive thinking.** Drafting is a judgment task and Opus 5 thinks by default. Lever order is `effort: 'medium'` → `'low'` → and only then a model change, **which is your decision, not this plan's**. Check 9 turns this from a guess into a number, and `AI_MODEL_ID` is one constant in one file either way.
- **EP-04's "≥2,000 exercises" is deliberately not met at M3.** ~250 curated rows cover every filter combination so the screens are genuinely exercisable, and D6 makes the real import data-only. Recorded as a launch-gate item in `CLAUDE.md`'s M10 row — not a silent shortfall, and not something to discover during store review.
- **No demo videos exist at M3.** Every exercise shows the placeholder. The column exists so the licensed import is data-only; licensing itself is a spec §6 parallel-track item with no dev time and the ability to block launch if late.
- **`workout_sessions.program_day_id` is `ON DELETE SET NULL`, and both `save_program` and `copy_program_week` destroy and recreate day rows.** Inert at M3 (no sessions), **loud at M4**. M4 must diff-and-patch instead of replacing children, or re-link orphans. Commented in the migration, in the RPC body, and here.
- **The AI draft lives only in React state between Result and "Review in builder."** If the OS kills the app in that window, a paid credit is gone. The Result copy and the Discard confirm are the mitigation. A persisted draft cache is deliberately out of scope — it would be a second, lossy source of truth for something acted on within seconds.
- **Denormalised `program_id`.** Composite FKs make drift structurally impossible today, but any future write path (a bulk import, a migration, an M4 sync job) must set it. Task 3 Step 3 is the assertion that fails loudly if someone removes the composite FK "to simplify."
- **Credit race.** Two concurrent drafts at balance 1 yield at most one generation we cannot charge for; it is logged with `credits_charged = 0` and the draft is still returned. A deliberate choice in the user's favour, not an oversight.
- **`similarity()` ranking on Arabic is unverified.** pg_trgm is byte-oriented and works, but ranking *quality* on Arabic is untested, the `name_ar` index is partial, and the curated set ships Arabic names for only part of the library. Flag for the native-speaker QA already scheduled at M10.
- **Structured outputs is the newest API surface in this repo,** and zod v4 with `zodOutputFormat` is unexercised here. `parsed_output === null` is a real handled path, and `.describe()` strings are prompt surface rather than comments — both easy to get wrong on the first change after this milestone.
- **The tab bar is the first navigation change since M0** and touches every existing PT href. Task 8 lands first precisely so the churn happens once, against four known call sites, with typecheck as the arbiter.

---

## Deliberately out of scope

**Drag-and-drop reordering** — never, per spec §7; the list picker, copy-week and AI draft replace it. **Credit purchase / RevenueCat** (**M6**) — the upsell renders priced packs with an inert CTA, and `ai_credit_packs` has no writer in M3. **Notification when a draft is ready** (**M9**) — exactly why the call is synchronous and why the prototype's "we'll notify you" copy is corrected rather than implemented. **Executing a program — sessions, sets, rest timer, live mirror** (**M4**); `workout_sessions.program_day_id` is the seam and stays untouched. **Exercise demo video upload, hosting and transcoding** (**M10** + the licensing track). **Master/Sub program sharing UI** (**M7**) — `is_master_of` is wired into `is_program_visible` read-only and stays untested until M7 has hierarchy fixtures. **Program sharing or a template marketplace between PTs** (**v2**). **An admin exercise editor** (**M10**) — the library is code plus versioned data, not admin-editable content, for the same reason `INTAKE_TEMPLATE_V1` is versioned code. **Meal plans and monthly recaps through the same broker** (**M8**/**M9**) — `ai_generations.generation_type` already allows both and `consume_ai_credit` takes the type as a parameter, so neither needs a schema change. **Program versioning or per-client program history** — assignment archives the previous program, which is the v1 answer. **A separate rate limiter on the AI route** — the credit wallet is the rate limit. **Write policies on `ai_credit_wallets` / `ai_generations` for `authenticated`** — there will never be any; every mutation is an RPC, and that is the design, not a gap.

---

## As built — deviations from this plan

Recorded here rather than silently absorbed, because each one changes
something a future reader would otherwise expect to find.

1. **Migration `0009_program_summaries.sql` was added.** Task 10 assumed the
   program list could get its days/week and exercise counts through a
   PostgREST embedded count. It cannot: D1 put `program_id` on
   `program_exercises` as half of a *composite* FK to `program_blocks`, so
   PostgREST infers no direct `programs → program_exercises` relationship to
   embed through. The alternatives were dragging every program's full
   skeleton down to count its leaves, or an N+1. Instead the counts are
   computed where the data is, as two indexed scans on the denormalised
   column — which is precisely what that denormalisation was for. Invoker
   rights, so `programs_select` still decides which rows come back.

2. **The AI route's concurrent-charge race returns 402, not a draft.**
   Task 15 Step 7 called for returning the draft anyway with `balance: 0` on
   the principle of never punishing a user for our own race. That turns out
   to be unimplementable rather than merely awkward: every path that persists
   a draft runs through `create_program_from_draft`, which requires an
   `ai_generations` row that only a successful charge creates. A draft with
   no generation id is one the PT can read and never save. The route returns
   402 with `charged: false`, which keeps the part that matters — nothing was
   billed — and the app's copy says so.

3. **The client-write RLS assertion uses the 0-affected-rows idiom, not
   `expect_rls_block`.** Task 3 Step 5 specified the latter, but
   `program_exercises_write`'s `USING` clause excludes a client outright, so
   the UPDATE matches zero rows rather than raising `insufficient_privilege`.
   `expect_rls_block` is for a `WITH CHECK` failure on a row `USING` admits —
   which is why M2's intake tests use it and this one must not.

4. **Only the four tab roots moved into `(app)/(tabs)`.** Task 8 said to move
   `clients/**`; in practice the roster moved and its detail/invite screens
   stayed in `(app)`, so they push over the tab bar as full screens instead
   of registering as tab routes that would each need `href: null`. Smaller
   diff, exhaustive `<Tabs.Screen>` list.

5. **`CreditSheet` lives in `lib/ai/`, not colocated with one screen.** Both
   the builder footer and the AI screen render it, and `lib/<feature>/` is
   where this codebase already keeps shared feature components
   (`lib/profile/Avatar.tsx`, `CertificationsEditor.tsx`).

6. **The library → builder handoff is a module singleton
   (`lib/programs/exercisePicker.ts`), not route params.** `router.back()`
   followed by `router.setParams()` races the focus change, and a params
   change risks remounting the builder over an unsaved draft.

7. **`i18n.test.ts` was added** (not in the plan). It holds the key-parity
   invariant Task 6 depends on: a missing translation should be a failing
   test, not a raw key on a client's screen.

8. **The REPS cell takes a range through the keypad's new `-` key.** The plan
   left rep ranges unspecified; typing `6-8` yields min 6 / max 8 and `6`
   yields a fixed target, round-tripped by `parseRepsCell`/`formatRepsCell`
   rather than by adding a second input to a cell that has to stay 79pt wide.

### What is genuinely unverified

- **The ≤12s draft latency, and with it the `effort: 'medium'` choice.** No
  API key in this environment. Everything around the model call — auth, the
  balance gate, the catalogue, slug resolution, the charge, the refund path,
  the failure matrix — is written and typechecked, but the one number EP-15
  states has not been measured.
- **Every device/manual item below.** No simulator here, as in M1 and M2.
  The 390pt cell measurement, RTL mirroring and the Arabic library search are
  the three most likely to need adjustment.

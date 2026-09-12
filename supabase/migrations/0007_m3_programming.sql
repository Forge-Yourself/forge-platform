-- =============================================================================
-- 0007 · M3 programming — RLS, denormalised program_id, and the program/AI RPCs
-- =============================================================================
-- Turns the six programming tables and the three AI-credit tables (present
-- since M0, RLS-enabled with zero policies since 0003 — total default-deny to
-- anon and authenticated) into a working exercise library, program builder,
-- template/assign pipeline, and AI-credit-metered draft flow:
--   1. exercises.demo_video_url and programs.start_date — two columns EP-04
--      and the assign flow need that the baseline never had.
--   2. Denormalised program_id on program_days/program_blocks/program_exercises,
--      guarded by composite FKs against program_weeks/program_days/
--      program_blocks respectively. Without this, every child-table policy
--      needs a 3-4 join chain up to programs on every row read — at 100+ rows
--      per program that is the difference between a fast builder and a slow
--      one. The composite FK makes a drifted program_id structurally
--      impossible, not merely discouraged.
--   3. is_program_editor / is_program_visible — the two predicates every
--      programming-table policy below is built from. Visible = authored by
--      the caller, OR assigned to a client of the caller's who owns the
--      session (only once state is 'active'/'completed' — a 'draft' program
--      is invisible to its own client even with client_id already set, which
--      is EP-15's "AI never auto-publishes" enforced at the row level), OR
--      the caller Masters the author (is_master_of, first consumer of a
--      predicate 0003 defined but never used — stays read-only until M7).
--   4. Policies on all six programming tables plus exercises. AI credit
--      tables get SELECT-only policies — every mutation is one of the
--      SECURITY DEFINER RPCs below, and there will never be a write policy
--      for `authenticated` on any of the three.
--   5. A starting AI credit balance (10) the moment a PT identity exists,
--      whichever of the two paths creates it — set_initial_role() for the
--      onboarding picker, or a paired trigger for a signup whose metadata
--      already names the role. Exercises the full ledger — decrement,
--      low-warn, zero upsell, refund — before RevenueCat lands at M6.
--   6. Fourteen SECURITY DEFINER RPCs: search/create for the exercise
--      library; create/save/copy-week/copy/archive/assign/instantiate for
--      programs; consume/refund/grant for the AI credit ledger; and
--      create_program_from_draft, the one function that ever turns an AI
--      draft into a persisted row.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- New columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.exercises ADD COLUMN demo_video_url TEXT;
ALTER TABLE public.programs ADD COLUMN start_date DATE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Denormalise program_id onto the three lower child tables (D1). The table is
-- empty in practice — no policy has ever permitted a write to it — but the
-- backfill runs anyway so this migration is correct even if that changes.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.program_days ADD COLUMN program_id UUID;
UPDATE public.program_days d SET program_id = w.program_id
  FROM public.program_weeks w WHERE w.id = d.week_id AND d.program_id IS NULL;
ALTER TABLE public.program_days ALTER COLUMN program_id SET NOT NULL;

ALTER TABLE public.program_blocks ADD COLUMN program_id UUID;
UPDATE public.program_blocks b SET program_id = d.program_id
  FROM public.program_days d WHERE d.id = b.day_id AND b.program_id IS NULL;
ALTER TABLE public.program_blocks ALTER COLUMN program_id SET NOT NULL;

ALTER TABLE public.program_exercises ADD COLUMN program_id UUID;
UPDATE public.program_exercises pe SET program_id = b.program_id
  FROM public.program_blocks b WHERE b.id = pe.block_id AND pe.program_id IS NULL;
ALTER TABLE public.program_exercises ALTER COLUMN program_id SET NOT NULL;

-- Composite-FK chain: each parent becomes targetable by (id, program_id), and
-- each child's own (fk_column, program_id) must match it. This is what makes
-- a drifted program_id structurally impossible rather than trigger-enforced —
-- db/rls_assertions.sql asserts a mismatched insert raises.
ALTER TABLE public.program_weeks  ADD CONSTRAINT uq_pw_id_program UNIQUE (id, program_id);
ALTER TABLE public.program_days   ADD CONSTRAINT uq_pd_id_program UNIQUE (id, program_id);
ALTER TABLE public.program_blocks ADD CONSTRAINT uq_pb_id_program UNIQUE (id, program_id);

ALTER TABLE public.program_days ADD CONSTRAINT fk_pd_week_program
  FOREIGN KEY (week_id, program_id) REFERENCES public.program_weeks (id, program_id) ON DELETE CASCADE;
ALTER TABLE public.program_blocks ADD CONSTRAINT fk_pb_day_program
  FOREIGN KEY (day_id, program_id) REFERENCES public.program_days (id, program_id) ON DELETE CASCADE;
ALTER TABLE public.program_exercises ADD CONSTRAINT fk_pe_block_program
  FOREIGN KEY (block_id, program_id) REFERENCES public.program_blocks (id, program_id) ON DELETE CASCADE;

-- Every policy below filters child tables directly on program_id — index it.
CREATE INDEX idx_pd_program ON public.program_days (program_id);
CREATE INDEX idx_pb_program ON public.program_blocks (program_id);
CREATE INDEX idx_pe_program ON public.program_exercises (program_id);

-- Sort-order uniqueness, deferrable so a reorder within one transaction can
-- legitimately pass through a duplicate state. Replaces the old plain
-- (day_id, sort_order) / (block_id, sort_order) indexes rather than
-- duplicating them — the unique constraint's own index serves ordered reads
-- exactly as the old one did.
DROP INDEX IF EXISTS idx_pb_day;
ALTER TABLE public.program_blocks
  ADD CONSTRAINT uq_pb_day_sort UNIQUE (day_id, sort_order) DEFERRABLE INITIALLY DEFERRED;

DROP INDEX IF EXISTS idx_pe_block;
ALTER TABLE public.program_exercises
  ADD CONSTRAINT uq_pe_block_sort UNIQUE (block_id, sort_order) DEFERRABLE INITIALLY DEFERRED;

-- ─────────────────────────────────────────────────────────────────────────────
-- Predicates. SECURITY DEFINER is load-bearing, as in 0003: these read the
-- same tables the policies protect, and invoker rights would recurse.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_program_editor(p_program_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.programs p
     WHERE p.id = p_program_id AND p.author_user_id = auth.uid()
  );
$$;

-- True when the caller may READ this program: its author, the client it is
-- actively/completed-assigned to (never while 'draft' — this is EP-15's "AI
-- never auto-publishes" enforced at the row level, independent of whether
-- client_id has already been set), or the author's Master PT (read-only;
-- is_master_of has no writer using it until M7's hierarchy UI). Admin is
-- appended at each call site, matching every other predicate in this file.
CREATE OR REPLACE FUNCTION public.is_program_visible(p_program_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.programs p
     WHERE p.id = p_program_id
       AND (
         p.author_user_id = auth.uid()
         OR (
           p.client_id IS NOT NULL
           AND p.state IN ('active', 'completed')
           AND public.is_client_record_owner(p.client_id)
         )
         OR public.is_master_of(p.author_user_id)
       )
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- programs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY programs_select ON public.programs
  FOR SELECT TO authenticated
  USING (public.is_program_visible(id) OR public.is_admin());

CREATE POLICY programs_insert ON public.programs
  FOR INSERT TO authenticated
  WITH CHECK (author_user_id = auth.uid() OR public.is_admin());

CREATE POLICY programs_update ON public.programs
  FOR UPDATE TO authenticated
  USING (public.is_program_editor(id) OR public.is_admin())
  WITH CHECK (public.is_program_editor(id) OR public.is_admin());

CREATE POLICY programs_delete ON public.programs
  FOR DELETE TO authenticated
  USING (public.is_program_editor(id) OR public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- program_weeks / program_days / program_blocks / program_exercises — same
-- shape on all four: broad SELECT via is_program_visible, narrow FOR ALL via
-- is_program_editor. The FOR ALL policy also covers SELECT (permissive
-- policies OR together), which is harmless — it is a strict subset of the
-- _select policy's own USING clause.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY program_weeks_select ON public.program_weeks
  FOR SELECT TO authenticated
  USING (public.is_program_visible(program_id) OR public.is_admin());
CREATE POLICY program_weeks_write ON public.program_weeks
  FOR ALL TO authenticated
  USING (public.is_program_editor(program_id) OR public.is_admin())
  WITH CHECK (public.is_program_editor(program_id) OR public.is_admin());

CREATE POLICY program_days_select ON public.program_days
  FOR SELECT TO authenticated
  USING (public.is_program_visible(program_id) OR public.is_admin());
CREATE POLICY program_days_write ON public.program_days
  FOR ALL TO authenticated
  USING (public.is_program_editor(program_id) OR public.is_admin())
  WITH CHECK (public.is_program_editor(program_id) OR public.is_admin());

CREATE POLICY program_blocks_select ON public.program_blocks
  FOR SELECT TO authenticated
  USING (public.is_program_visible(program_id) OR public.is_admin());
CREATE POLICY program_blocks_write ON public.program_blocks
  FOR ALL TO authenticated
  USING (public.is_program_editor(program_id) OR public.is_admin())
  WITH CHECK (public.is_program_editor(program_id) OR public.is_admin());

CREATE POLICY program_exercises_select ON public.program_exercises
  FOR SELECT TO authenticated
  USING (public.is_program_visible(program_id) OR public.is_admin());
CREATE POLICY program_exercises_write ON public.program_exercises
  FOR ALL TO authenticated
  USING (public.is_program_editor(program_id) OR public.is_admin())
  WITH CHECK (public.is_program_editor(program_id) OR public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- exercises — the global library is readable by everyone; a custom movement
-- only by its author. Insert/update/delete are restricted to own custom rows
-- so nobody can inject or alter a row in the shared library through
-- PostgREST directly (create_custom_exercise below is the sanctioned path,
-- and it forces is_custom/created_by_user_id itself regardless).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY exercises_select ON public.exercises
  FOR SELECT TO authenticated
  USING (
    (is_active = TRUE AND (is_custom = FALSE OR created_by_user_id = auth.uid()))
    OR public.is_admin()
  );

CREATE POLICY exercises_insert ON public.exercises
  FOR INSERT TO authenticated
  WITH CHECK ((is_custom = TRUE AND created_by_user_id = auth.uid()) OR public.is_admin());

CREATE POLICY exercises_update ON public.exercises
  FOR UPDATE TO authenticated
  USING ((is_custom = TRUE AND created_by_user_id = auth.uid()) OR public.is_admin())
  WITH CHECK ((is_custom = TRUE AND created_by_user_id = auth.uid()) OR public.is_admin());

CREATE POLICY exercises_delete ON public.exercises
  FOR DELETE TO authenticated
  USING ((is_custom = TRUE AND created_by_user_id = auth.uid()) OR public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- AI credit tables — SELECT only, ever. Every mutation is one of the
-- SECURITY DEFINER RPCs below (consume_ai_credit, refund_ai_credit,
-- grant_ai_credits). There is deliberately no write policy for `authenticated`
-- on any of the three — that is the design, not a gap.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY ai_credit_wallets_select ON public.ai_credit_wallets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY ai_generations_select ON public.ai_generations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY ai_credit_packs_select ON public.ai_credit_packs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_credit_wallets w
       WHERE w.id = ai_credit_packs.wallet_id AND w.user_id = auth.uid()
    )
    OR public.is_admin()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- ensure_ai_credit_wallet — idempotent wallet creation with the M3 starting
-- balance (10 credits — roughly a month of drafting for a solo PT; exercises
-- the full ledger before RevenueCat lands at M6). Internal only: called from
-- set_initial_role() and the trigger below, never exposed as its own RPC.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_ai_credit_wallet(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO public.ai_credit_wallets (user_id, balance, total_purchased)
  VALUES (p_user_id, 10, 10)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_ai_credit_wallet(UUID) FROM PUBLIC, anon, authenticated;

-- A PT identity can be established two ways: metadata already says 'pt' at
-- signup (this trigger), or the onboarding role picker sets it afterward
-- (set_initial_role, redefined below to call the same helper). Both must
-- grant the wallet — neither alone covers every signup path.
CREATE OR REPLACE FUNCTION public.handle_new_user_ai_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.role = 'pt' THEN
    PERFORM public.ensure_ai_credit_wallet(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_public_user_created_ai_wallet ON public.users;
CREATE TRIGGER on_public_user_created_ai_wallet
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_ai_wallet();

REVOKE EXECUTE ON FUNCTION public.handle_new_user_ai_wallet() FROM PUBLIC, anon, authenticated;

-- Redefine 0004's set_initial_role to also grant the wallet the moment the
-- picker sets 'pt' — the common path, since M1's onboarding asks after
-- signup rather than at it. Body is otherwise unchanged from 0004.
CREATE OR REPLACE FUNCTION public.set_initial_role(p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_role NOT IN ('pt', 'client', 'gym_account') THEN
    RAISE EXCEPTION 'invalid initial role: %', p_role;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND onboarding_completed = TRUE
  ) THEN
    RETURN;
  END IF;

  UPDATE public.users SET role = p_role WHERE id = auth.uid();

  IF p_role = 'pt' THEN
    PERFORM public.ensure_ai_credit_wallet(auth.uid());
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_initial_role(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_initial_role(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- search_exercises — invoker rights, deliberately NOT SECURITY DEFINER: it
-- must run as the caller so exercises_select actually filters (global
-- library + own custom rows), rather than re-implementing that filter here.
-- Ranked by pg_trgm similarity on name/name_ar, which is what
-- idx_exercises_name_trgm / idx_exercises_name_ar_trgm exist for.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_exercises(
  p_query     TEXT DEFAULT NULL,
  p_muscle    TEXT DEFAULT NULL,
  p_equipment TEXT DEFAULT NULL,
  p_pattern   TEXT DEFAULT NULL,
  p_limit     INTEGER DEFAULT 50,
  p_offset    INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID, name VARCHAR, name_ar VARCHAR, slug VARCHAR, muscle_group VARCHAR,
  equipment VARCHAR, movement_pattern VARCHAR, difficulty VARCHAR,
  instructions TEXT, coaching_cues TEXT[], is_custom BOOLEAN,
  created_by_user_id UUID, demo_video_url TEXT, total_count BIGINT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    e.id, e.name, e.name_ar, e.slug, e.muscle_group, e.equipment,
    e.movement_pattern, e.difficulty, e.instructions, e.coaching_cues,
    e.is_custom, e.created_by_user_id, e.demo_video_url,
    count(*) OVER ()::BIGINT AS total_count
  FROM public.exercises e
  WHERE (p_muscle IS NULL OR e.muscle_group = p_muscle)
    AND (p_equipment IS NULL OR e.equipment = p_equipment)
    AND (p_pattern IS NULL OR e.movement_pattern = p_pattern)
    AND (
      p_query IS NULL OR p_query = ''
      OR e.name ILIKE '%' || p_query || '%'
      OR e.name_ar ILIKE '%' || p_query || '%'
    )
  ORDER BY
    CASE WHEN p_query IS NULL OR p_query = '' THEN 0
         ELSE GREATEST(similarity(e.name, p_query), similarity(COALESCE(e.name_ar, ''), p_query))
    END DESC,
    e.name ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE EXECUTE ON FUNCTION public.search_exercises(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_exercises(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- create_custom_exercise — forces is_custom/created_by_user_id regardless of
-- caller input; a collision-safe slug is generated, never accepted as input.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_custom_exercise(
  p_name             VARCHAR,
  p_muscle_group     VARCHAR,
  p_equipment        VARCHAR,
  p_movement_pattern VARCHAR DEFAULT 'other',
  p_difficulty       VARCHAR DEFAULT NULL,
  p_instructions     TEXT DEFAULT NULL,
  p_coaching_cues    TEXT[] DEFAULT '{}',
  p_demo_video_url   TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id   UUID;
  v_base VARCHAR;
  v_slug VARCHAR;
  v_n    INTEGER := 0;
BEGIN
  v_base := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '_', 'g'));
  v_base := trim(both '_' from v_base) || '-' || substr(auth.uid()::TEXT, 1, 8);
  v_slug := v_base;

  WHILE EXISTS (SELECT 1 FROM public.exercises WHERE slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;

  INSERT INTO public.exercises (
    name, muscle_group, equipment, movement_pattern, difficulty,
    instructions, coaching_cues, demo_video_url, slug, is_custom, created_by_user_id
  )
  VALUES (
    p_name, p_muscle_group, p_equipment, COALESCE(p_movement_pattern, 'other'), p_difficulty,
    p_instructions, COALESCE(p_coaching_cues, '{}'), p_demo_video_url, v_slug, TRUE, auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_custom_exercise(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, TEXT[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_custom_exercise(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, TEXT[], TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- create_program — a PT-only empty shell: the program row plus its
-- duration_weeks empty week rows, ready for the builder to fill in.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_program(
  p_name           VARCHAR,
  p_duration_weeks SMALLINT,
  p_client_id      UUID DEFAULT NULL,
  p_is_template    BOOLEAN DEFAULT FALSE,
  p_periodization  VARCHAR DEFAULT NULL,
  p_description    TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_program_id UUID;
  v_week       SMALLINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'pt') THEN
    RAISE EXCEPTION 'only a pt can create a program';
  END IF;
  IF p_client_id IS NOT NULL AND NOT public.is_pt_of_client(p_client_id) THEN
    RAISE EXCEPTION 'not authorized for this client';
  END IF;
  IF p_duration_weeks < 1 OR p_duration_weeks > 52 THEN
    RAISE EXCEPTION 'invalid duration_weeks: %', p_duration_weeks;
  END IF;

  INSERT INTO public.programs (
    author_user_id, client_id, name, description, duration_weeks, periodization, is_template, state
  )
  VALUES (
    auth.uid(), p_client_id, p_name, p_description, p_duration_weeks,
    p_periodization, COALESCE(p_is_template, FALSE), 'draft'
  )
  RETURNING id INTO v_program_id;

  FOR v_week IN 1..p_duration_weeks LOOP
    INSERT INTO public.program_weeks (program_id, week_number) VALUES (v_program_id, v_week);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'program_create', 'program', v_program_id,
          jsonb_build_object('name', p_name, 'duration_weeks', p_duration_weeks));

  RETURN v_program_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_program(VARCHAR, SMALLINT, UUID, BOOLEAN, VARCHAR, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_program(VARCHAR, SMALLINT, UUID, BOOLEAN, VARCHAR, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- save_program — replace-children over the whole tree in one call (D2): a
-- 4-week × 3-day program is ~160 rows; one round trip is what makes the ≤1s
-- acceptance possible from Lebanon to Frankfurt. No new audit action exists
-- for "saved" (M3 adds none), so this does not write to audit_logs — the
-- programs.updated_at bump is the only trace of a save.
--
-- LANDMINE for M4: workout_sessions.program_day_id is ON DELETE SET NULL.
-- Deleting and recreating program_weeks (which cascades to days) orphans any
-- session pointing at a rebuilt day. Inert now — no sessions exist — but M4
-- must diff-and-patch instead of replacing children, or re-link orphans.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_program(p_program_id UUID, p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_week     JSONB;
  v_day      JSONB;
  v_block    JSONB;
  v_ex       JSONB;
  v_week_id  UUID;
  v_day_id   UUID;
  v_block_id UUID;
BEGIN
  IF NOT (public.is_program_editor(p_program_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  DELETE FROM public.program_weeks WHERE program_id = p_program_id;

  FOR v_week IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'weeks', '[]'::JSONB))
  LOOP
    INSERT INTO public.program_weeks (program_id, week_number, label)
    VALUES (p_program_id, (v_week->>'week_number')::SMALLINT, v_week->>'label')
    RETURNING id INTO v_week_id;

    FOR v_day IN SELECT * FROM jsonb_array_elements(COALESCE(v_week->'days', '[]'::JSONB))
    LOOP
      INSERT INTO public.program_days (week_id, program_id, day_number, label, notes)
      VALUES (v_week_id, p_program_id, (v_day->>'day_number')::SMALLINT, v_day->>'label', v_day->>'notes')
      RETURNING id INTO v_day_id;

      FOR v_block IN SELECT * FROM jsonb_array_elements(COALESCE(v_day->'blocks', '[]'::JSONB))
      LOOP
        INSERT INTO public.program_blocks (day_id, program_id, sort_order, block_type, label, rest_between_sec)
        VALUES (
          v_day_id, p_program_id,
          COALESCE((v_block->>'sort_order')::SMALLINT, 0),
          COALESCE(v_block->>'block_type', 'working'),
          v_block->>'label',
          (v_block->>'rest_between_sec')::SMALLINT
        )
        RETURNING id INTO v_block_id;

        FOR v_ex IN SELECT * FROM jsonb_array_elements(COALESCE(v_block->'exercises', '[]'::JSONB))
        LOOP
          INSERT INTO public.program_exercises (
            block_id, program_id, exercise_id, sort_order,
            target_sets, target_reps_min, target_reps_max, target_weight_kg,
            target_rpe, rest_sec, tempo_prescribed,
            prescribed_duration_sec, prescribed_distance_m, notes
          )
          VALUES (
            v_block_id, p_program_id, (v_ex->>'exercise_id')::UUID,
            COALESCE((v_ex->>'sort_order')::SMALLINT, 0),
            (v_ex->>'target_sets')::SMALLINT,
            (v_ex->>'target_reps_min')::SMALLINT,
            (v_ex->>'target_reps_max')::SMALLINT,
            (v_ex->>'target_weight_kg')::NUMERIC(7,2),
            (v_ex->>'target_rpe')::NUMERIC(3,1),
            (v_ex->>'rest_sec')::SMALLINT,
            v_ex->>'tempo_prescribed',
            (v_ex->>'prescribed_duration_sec')::SMALLINT,
            (v_ex->>'prescribed_distance_m')::NUMERIC(8,2),
            v_ex->>'notes'
          );
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  UPDATE public.programs SET updated_at = NOW() WHERE id = p_program_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_program(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_program(UUID, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- program_tree — the whole nested structure as one JSONB document, invoker
-- rights so is_program_visible (via each table's own RLS policy) governs it
-- naturally. Shared by the builder and the client's read-only view — one
-- hook, one authorization path, no second code path to keep in sync.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.program_tree(p_program_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'description', p.description,
    'state', p.state,
    'duration_weeks', p.duration_weeks,
    'periodization', p.periodization,
    'is_template', p.is_template,
    'template_source_id', p.template_source_id,
    'is_ai_generated', p.is_ai_generated,
    'ai_generation_id', p.ai_generation_id,
    'client_id', p.client_id,
    'start_date', p.start_date,
    'weeks', COALESCE((
      SELECT jsonb_agg(week_obj ORDER BY (week_obj->>'week_number')::INT)
      FROM (
        SELECT jsonb_build_object(
          'id', w.id, 'week_number', w.week_number, 'label', w.label,
          'days', COALESCE((
            SELECT jsonb_agg(day_obj ORDER BY (day_obj->>'day_number')::INT)
            FROM (
              SELECT jsonb_build_object(
                'id', d.id, 'day_number', d.day_number, 'label', d.label, 'notes', d.notes,
                'blocks', COALESCE((
                  SELECT jsonb_agg(block_obj ORDER BY (block_obj->>'sort_order')::INT)
                  FROM (
                    SELECT jsonb_build_object(
                      'id', b.id, 'sort_order', b.sort_order, 'block_type', b.block_type,
                      'label', b.label, 'rest_between_sec', b.rest_between_sec,
                      'exercises', COALESCE((
                        SELECT jsonb_agg(ex_obj ORDER BY (ex_obj->>'sort_order')::INT)
                        FROM (
                          SELECT jsonb_build_object(
                            'id', pe.id, 'sort_order', pe.sort_order,
                            'exercise_id', pe.exercise_id,
                            'exercise_name', ex.name, 'exercise_name_ar', ex.name_ar,
                            'target_sets', pe.target_sets,
                            'target_reps_min', pe.target_reps_min,
                            'target_reps_max', pe.target_reps_max,
                            'target_weight_kg', pe.target_weight_kg,
                            'target_rpe', pe.target_rpe,
                            'rest_sec', pe.rest_sec,
                            'tempo_prescribed', pe.tempo_prescribed,
                            'prescribed_duration_sec', pe.prescribed_duration_sec,
                            'prescribed_distance_m', pe.prescribed_distance_m,
                            'notes', pe.notes
                          ) AS ex_obj
                          FROM public.program_exercises pe
                          JOIN public.exercises ex ON ex.id = pe.exercise_id
                          WHERE pe.block_id = b.id
                        ) sub_ex
                      ), '[]'::JSONB)
                    ) AS block_obj
                    FROM public.program_blocks b
                    WHERE b.day_id = d.id
                  ) sub_block
                ), '[]'::JSONB)
              ) AS day_obj
              FROM public.program_days d
              WHERE d.week_id = w.id
            ) sub_day
          ), '[]'::JSONB)
        ) AS week_obj
        FROM public.program_weeks w
        WHERE w.program_id = p.id
      ) sub_week
    ), '[]'::JSONB)
  )
  FROM public.programs p
  WHERE p.id = p_program_id;
$$;

REVOKE EXECUTE ON FUNCTION public.program_tree(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.program_tree(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- copy_program_week — deep-copies one week's subtree onto another week
-- already belonging to the same program. "Existing sessions in the target
-- week are replaced" is literal: replace, never merge.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.copy_program_week(
  p_program_id UUID,
  p_from_week  SMALLINT,
  p_to_week    SMALLINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_from_week_id UUID;
  v_to_week_id   UUID;
  v_day          RECORD;
  v_new_day_id   UUID;
  v_block        RECORD;
  v_new_block_id UUID;
  v_ex           RECORD;
BEGIN
  IF NOT (public.is_program_editor(p_program_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_from_week = p_to_week THEN
    RAISE EXCEPTION 'source and target week must differ';
  END IF;

  SELECT id INTO v_from_week_id FROM public.program_weeks
   WHERE program_id = p_program_id AND week_number = p_from_week;
  IF v_from_week_id IS NULL THEN
    RAISE EXCEPTION 'source week % not found', p_from_week;
  END IF;

  SELECT id INTO v_to_week_id FROM public.program_weeks
   WHERE program_id = p_program_id AND week_number = p_to_week
   FOR UPDATE;
  IF v_to_week_id IS NULL THEN
    RAISE EXCEPTION 'target week % not found', p_to_week;
  END IF;

  DELETE FROM public.program_days WHERE week_id = v_to_week_id;

  FOR v_day IN SELECT * FROM public.program_days WHERE week_id = v_from_week_id ORDER BY day_number
  LOOP
    INSERT INTO public.program_days (week_id, program_id, day_number, label, notes)
    VALUES (v_to_week_id, p_program_id, v_day.day_number, v_day.label, v_day.notes)
    RETURNING id INTO v_new_day_id;

    FOR v_block IN SELECT * FROM public.program_blocks WHERE day_id = v_day.id ORDER BY sort_order
    LOOP
      INSERT INTO public.program_blocks (day_id, program_id, sort_order, block_type, label, rest_between_sec)
      VALUES (v_new_day_id, p_program_id, v_block.sort_order, v_block.block_type, v_block.label, v_block.rest_between_sec)
      RETURNING id INTO v_new_block_id;

      FOR v_ex IN SELECT * FROM public.program_exercises WHERE block_id = v_block.id ORDER BY sort_order
      LOOP
        INSERT INTO public.program_exercises (
          block_id, program_id, exercise_id, sort_order, target_sets,
          target_reps_min, target_reps_max, target_weight_kg, target_rpe,
          rest_sec, tempo_prescribed, prescribed_duration_sec, prescribed_distance_m, notes
        )
        VALUES (
          v_new_block_id, p_program_id, v_ex.exercise_id, v_ex.sort_order, v_ex.target_sets,
          v_ex.target_reps_min, v_ex.target_reps_max, v_ex.target_weight_kg, v_ex.target_rpe,
          v_ex.rest_sec, v_ex.tempo_prescribed, v_ex.prescribed_duration_sec, v_ex.prescribed_distance_m, v_ex.notes
        );
      END LOOP;
    END LOOP;
  END LOOP;

  UPDATE public.programs SET updated_at = NOW() WHERE id = p_program_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.copy_program_week(UUID, SMALLINT, SMALLINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_program_week(UUID, SMALLINT, SMALLINT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- instantiate_template — deep-copies a template into a brand-new program for
-- a client. No statement here ever UPDATEs the template's own row — that is
-- what makes "template application copies, never mutates" true rather than
-- assumed. Archive-then-activate: any existing active program for the
-- client is displaced in the same transaction, never merged with the new one.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.instantiate_template(
  p_template_id UUID,
  p_client_id   UUID,
  p_start_date  DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_template       RECORD;
  v_new_program_id UUID;
  v_prev_program_id UUID;
  v_week           RECORD;
  v_new_week_id    UUID;
  v_day            RECORD;
  v_new_day_id     UUID;
  v_block          RECORD;
  v_new_block_id   UUID;
  v_ex             RECORD;
BEGIN
  SELECT * INTO v_template FROM public.programs WHERE id = p_template_id AND is_template = TRUE;
  IF v_template IS NULL THEN
    RAISE EXCEPTION 'template not found';
  END IF;
  IF v_template.author_user_id != auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF NOT public.is_pt_of_client(p_client_id) THEN
    RAISE EXCEPTION 'not authorized for this client';
  END IF;

  SELECT id INTO v_prev_program_id FROM public.programs
   WHERE client_id = p_client_id AND state = 'active'
   FOR UPDATE;
  IF v_prev_program_id IS NOT NULL THEN
    UPDATE public.programs SET state = 'archived', updated_at = NOW() WHERE id = v_prev_program_id;
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
    VALUES (auth.uid(), 'program_archive', 'program', v_prev_program_id, jsonb_build_object('reason', 'replaced_by_template'));
  END IF;

  INSERT INTO public.programs (
    author_user_id, client_id, state, name, description, duration_weeks,
    periodization, is_template, template_source_id, start_date
  )
  VALUES (
    auth.uid(), p_client_id, 'active', v_template.name, v_template.description,
    v_template.duration_weeks, v_template.periodization, FALSE, v_template.id,
    COALESCE(p_start_date, CURRENT_DATE)
  )
  RETURNING id INTO v_new_program_id;

  FOR v_week IN SELECT * FROM public.program_weeks WHERE program_id = p_template_id ORDER BY week_number
  LOOP
    INSERT INTO public.program_weeks (program_id, week_number, label)
    VALUES (v_new_program_id, v_week.week_number, v_week.label)
    RETURNING id INTO v_new_week_id;

    FOR v_day IN SELECT * FROM public.program_days WHERE week_id = v_week.id ORDER BY day_number
    LOOP
      INSERT INTO public.program_days (week_id, program_id, day_number, label, notes)
      VALUES (v_new_week_id, v_new_program_id, v_day.day_number, v_day.label, v_day.notes)
      RETURNING id INTO v_new_day_id;

      FOR v_block IN SELECT * FROM public.program_blocks WHERE day_id = v_day.id ORDER BY sort_order
      LOOP
        INSERT INTO public.program_blocks (day_id, program_id, sort_order, block_type, label, rest_between_sec)
        VALUES (v_new_day_id, v_new_program_id, v_block.sort_order, v_block.block_type, v_block.label, v_block.rest_between_sec)
        RETURNING id INTO v_new_block_id;

        FOR v_ex IN SELECT * FROM public.program_exercises WHERE block_id = v_block.id ORDER BY sort_order
        LOOP
          INSERT INTO public.program_exercises (
            block_id, program_id, exercise_id, sort_order, target_sets,
            target_reps_min, target_reps_max, target_weight_kg, target_rpe,
            rest_sec, tempo_prescribed, prescribed_duration_sec, prescribed_distance_m, notes
          )
          VALUES (
            v_new_block_id, v_new_program_id, v_ex.exercise_id, v_ex.sort_order, v_ex.target_sets,
            v_ex.target_reps_min, v_ex.target_reps_max, v_ex.target_weight_kg, v_ex.target_rpe,
            v_ex.rest_sec, v_ex.tempo_prescribed, v_ex.prescribed_duration_sec, v_ex.prescribed_distance_m, v_ex.notes
          );
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), c.client_user_id, 'program_assign', 'program', v_new_program_id,
         jsonb_build_object('template_source_id', p_template_id)
  FROM public.clients c WHERE c.id = p_client_id;

  RETURN v_new_program_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.instantiate_template(UUID, UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.instantiate_template(UUID, UUID, DATE) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- assign_program — publishes an existing (non-template) program to a client.
-- Archive-then-activate, same semantics as instantiate_template: this is the
-- assign sheet's "replaces it from Monday" warning made transactional.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_program(
  p_program_id UUID,
  p_client_id  UUID,
  p_start_date DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_prev_program_id UUID;
BEGIN
  IF NOT (public.is_program_editor(p_program_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF NOT public.is_pt_of_client(p_client_id) THEN
    RAISE EXCEPTION 'not authorized for this client';
  END IF;

  SELECT id INTO v_prev_program_id FROM public.programs
   WHERE client_id = p_client_id AND state = 'active' AND id != p_program_id
   FOR UPDATE;

  IF v_prev_program_id IS NOT NULL THEN
    UPDATE public.programs SET state = 'archived', updated_at = NOW() WHERE id = v_prev_program_id;
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
    VALUES (auth.uid(), 'program_archive', 'program', v_prev_program_id, jsonb_build_object('reason', 'replaced_by_assign'));
  END IF;

  UPDATE public.programs
     SET client_id = p_client_id, state = 'active',
         start_date = COALESCE(p_start_date, CURRENT_DATE), updated_at = NOW()
   WHERE id = p_program_id;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), c.client_user_id, 'program_assign', 'program', p_program_id,
         jsonb_build_object('start_date', COALESCE(p_start_date, CURRENT_DATE))
  FROM public.clients c WHERE c.id = p_client_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_program(UUID, UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_program(UUID, UUID, DATE) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- copy_program — duplicate-as-template (or a plain duplicate) of any program
-- the caller authored. Same deep-copy shape as the two functions above.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.copy_program(p_program_id UUID, p_as_template BOOLEAN DEFAULT TRUE)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_source         RECORD;
  v_new_program_id UUID;
  v_week           RECORD;
  v_new_week_id    UUID;
  v_day            RECORD;
  v_new_day_id     UUID;
  v_block          RECORD;
  v_new_block_id   UUID;
  v_ex             RECORD;
BEGIN
  SELECT * INTO v_source FROM public.programs WHERE id = p_program_id;
  IF v_source IS NULL THEN
    RAISE EXCEPTION 'program not found';
  END IF;
  IF v_source.author_user_id != auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO public.programs (
    author_user_id, client_id, state, name, description, duration_weeks,
    periodization, is_template, template_source_id
  )
  VALUES (
    auth.uid(),
    CASE WHEN COALESCE(p_as_template, TRUE) THEN NULL ELSE v_source.client_id END,
    'draft',
    CASE WHEN COALESCE(p_as_template, TRUE) THEN v_source.name || ' (copy)' ELSE v_source.name END,
    v_source.description, v_source.duration_weeks, v_source.periodization,
    COALESCE(p_as_template, TRUE), v_source.id
  )
  RETURNING id INTO v_new_program_id;

  FOR v_week IN SELECT * FROM public.program_weeks WHERE program_id = p_program_id ORDER BY week_number
  LOOP
    INSERT INTO public.program_weeks (program_id, week_number, label)
    VALUES (v_new_program_id, v_week.week_number, v_week.label)
    RETURNING id INTO v_new_week_id;

    FOR v_day IN SELECT * FROM public.program_days WHERE week_id = v_week.id ORDER BY day_number
    LOOP
      INSERT INTO public.program_days (week_id, program_id, day_number, label, notes)
      VALUES (v_new_week_id, v_new_program_id, v_day.day_number, v_day.label, v_day.notes)
      RETURNING id INTO v_new_day_id;

      FOR v_block IN SELECT * FROM public.program_blocks WHERE day_id = v_day.id ORDER BY sort_order
      LOOP
        INSERT INTO public.program_blocks (day_id, program_id, sort_order, block_type, label, rest_between_sec)
        VALUES (v_new_day_id, v_new_program_id, v_block.sort_order, v_block.block_type, v_block.label, v_block.rest_between_sec)
        RETURNING id INTO v_new_block_id;

        FOR v_ex IN SELECT * FROM public.program_exercises WHERE block_id = v_block.id ORDER BY sort_order
        LOOP
          INSERT INTO public.program_exercises (
            block_id, program_id, exercise_id, sort_order, target_sets,
            target_reps_min, target_reps_max, target_weight_kg, target_rpe,
            rest_sec, tempo_prescribed, prescribed_duration_sec, prescribed_distance_m, notes
          )
          VALUES (
            v_new_block_id, v_new_program_id, v_ex.exercise_id, v_ex.sort_order, v_ex.target_sets,
            v_ex.target_reps_min, v_ex.target_reps_max, v_ex.target_weight_kg, v_ex.target_rpe,
            v_ex.rest_sec, v_ex.tempo_prescribed, v_ex.prescribed_duration_sec, v_ex.prescribed_distance_m, v_ex.notes
          );
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN v_new_program_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.copy_program(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_program(UUID, BOOLEAN) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- archive_program
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.archive_program(p_program_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (public.is_program_editor(p_program_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE public.programs SET state = 'archived', updated_at = NOW() WHERE id = p_program_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id)
  VALUES (auth.uid(), 'program_archive', 'program', p_program_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.archive_program(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_program(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- consume_ai_credit — the atomic heart of the ledger. FOR UPDATE serializes
-- concurrent drafts from the same account; chk_acw_balance (balance >= 0)
-- raises if a concurrent request already spent the last credit — the caller
-- (apps/web's AI route) catches that as its D5 stage-5 case and returns the
-- draft anyway with balance: 0, never punishing the user for the race.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_ai_credit(
  p_generation_type TEXT,
  p_prompt_hash     VARCHAR(64),
  p_prompt_scrubbed TEXT,
  p_output_scrubbed TEXT,
  p_model_id        VARCHAR(100),
  p_input_tokens    INTEGER DEFAULT NULL,
  p_output_tokens   INTEGER DEFAULT NULL,
  p_latency_ms      INTEGER DEFAULT NULL
)
RETURNS TABLE (generation_id UUID, new_balance INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_wallet_id UUID;
  v_balance   INTEGER;
  v_gen_id    UUID;
BEGIN
  IF p_generation_type NOT IN ('program_draft', 'meal_plan', 'monthly_recap', 'workout_suggestion') THEN
    RAISE EXCEPTION 'invalid generation_type: %', p_generation_type;
  END IF;

  SELECT id, balance INTO v_wallet_id, v_balance
    FROM public.ai_credit_wallets WHERE user_id = auth.uid() FOR UPDATE;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'no ai credit wallet for this user';
  END IF;

  UPDATE public.ai_credit_wallets
     SET balance = balance - 1, total_consumed = total_consumed + 1, updated_at = NOW()
   WHERE id = v_wallet_id
   RETURNING balance INTO v_balance;

  INSERT INTO public.ai_generations (
    user_id, generation_type, prompt_hash, prompt_scrubbed, output_scrubbed,
    model_id, input_tokens, output_tokens, latency_ms, credits_charged
  )
  VALUES (
    auth.uid(), p_generation_type, p_prompt_hash, p_prompt_scrubbed, p_output_scrubbed,
    p_model_id, p_input_tokens, p_output_tokens, p_latency_ms, 1
  )
  RETURNING id INTO v_gen_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'ai_credit_consume', 'ai_credit_wallet', v_wallet_id, jsonb_build_object('generation_id', v_gen_id));
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'ai_generation_create', 'ai_generation', v_gen_id, jsonb_build_object('generation_type', p_generation_type));

  RETURN QUERY SELECT v_gen_id, v_balance;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_ai_credit(TEXT, VARCHAR, TEXT, TEXT, VARCHAR, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_ai_credit(TEXT, VARCHAR, TEXT, TEXT, VARCHAR, INTEGER, INTEGER, INTEGER) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- refund_ai_credit — guarded against double refund via was_refunded.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refund_ai_credit(p_generation_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id  UUID;
  v_refunded BOOLEAN;
  v_credits  SMALLINT;
BEGIN
  SELECT user_id, was_refunded, credits_charged INTO v_user_id, v_refunded, v_credits
    FROM public.ai_generations WHERE id = p_generation_id FOR UPDATE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'generation not found';
  END IF;
  IF v_user_id != auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF v_refunded THEN
    RAISE EXCEPTION 'generation already refunded';
  END IF;

  UPDATE public.ai_generations SET was_refunded = TRUE, refund_reason = p_reason WHERE id = p_generation_id;

  UPDATE public.ai_credit_wallets
     SET balance = balance + v_credits, total_refunded = total_refunded + v_credits, updated_at = NOW()
   WHERE user_id = v_user_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'ai_credit_refund', 'ai_generation', p_generation_id, jsonb_build_object('reason', p_reason));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refund_ai_credit(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_ai_credit(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- create_program_from_draft — the ONLY function that ever turns an AI draft
-- into a persisted row. state stays 'draft' with client_id set: is_program_
-- visible denies the client until assign_program later flips it to 'active'
-- — EP-15's "AI never auto-publishes" enforced by there being no other path.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_program_from_draft(
  p_client_id     UUID,
  p_generation_id UUID,
  p_payload       JSONB,
  p_name          VARCHAR DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_gen_user   UUID;
  v_program_id UUID;
  v_weeks      SMALLINT;
BEGIN
  SELECT user_id INTO v_gen_user FROM public.ai_generations WHERE id = p_generation_id;
  IF v_gen_user IS NULL THEN
    RAISE EXCEPTION 'generation not found';
  END IF;
  IF v_gen_user != auth.uid() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF NOT public.is_pt_of_client(p_client_id) THEN
    RAISE EXCEPTION 'not authorized for this client';
  END IF;

  v_weeks := COALESCE(jsonb_array_length(p_payload->'weeks'), 4)::SMALLINT;

  INSERT INTO public.programs (
    author_user_id, client_id, state, name, duration_weeks, is_ai_generated, ai_generation_id
  )
  VALUES (
    auth.uid(), p_client_id, 'draft', COALESCE(NULLIF(trim(p_name), ''), 'AI draft'), v_weeks,
    TRUE, p_generation_id
  )
  RETURNING id INTO v_program_id;

  PERFORM public.save_program(v_program_id, p_payload);

  UPDATE public.ai_generations SET result_entity_type = 'program', result_entity_id = v_program_id
   WHERE id = p_generation_id;

  RETURN v_program_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_program_from_draft(UUID, UUID, JSONB, VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_program_from_draft(UUID, UUID, JSONB, VARCHAR) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- grant_ai_credits — admin-only support/testing top-up until RevenueCat
-- purchase lands at M6.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_ai_credits(p_user_id UUID, p_credits INTEGER, p_reason TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'p_credits must be positive';
  END IF;

  PERFORM public.ensure_ai_credit_wallet(p_user_id);

  UPDATE public.ai_credit_wallets
     SET balance = balance + p_credits, total_purchased = total_purchased + p_credits, updated_at = NOW()
   WHERE user_id = p_user_id
   RETURNING balance INTO v_balance;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), p_user_id, 'ai_credit_purchase', 'ai_credit_wallet', w.id,
         jsonb_build_object('credits', p_credits, 'reason', p_reason, 'source', 'admin_grant')
  FROM public.ai_credit_wallets w WHERE w.user_id = p_user_id;

  RETURN v_balance;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_ai_credits(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_ai_credits(UUID, INTEGER, TEXT) TO authenticated;

COMMIT;

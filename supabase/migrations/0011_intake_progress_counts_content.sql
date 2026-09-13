-- =============================================================================
-- 0011 · intake_progress() counts answers, not keys
-- =============================================================================
-- intake_progress() reported answered_sections as
-- count(jsonb_object_keys(f.responses)). A key is written by the client's
-- Save & exit / Continue the moment they step through a section, whether or
-- not they typed anything into it, so a client who tapped Continue five times
-- and answered nothing showed the PT "5/5 sections answered" on the client
-- detail screen. The same key-presence rule was in intakeCompletion() in
-- packages/shared/src/schemas/intake.ts and made the client's own resume
-- checklist show five green ticks over an empty form; this migration is the
-- server-side half of that fix, and the two rules are deliberately identical.
--
-- The rule: a section counts when it holds at least one real answer. Real
-- excludes JSON null, the empty/whitespace string, and the empty array — but
-- NOT 0 (years_training: 0 is a beginner's honest answer) and NOT false
-- (a "No" to a PAR-Q question is the answer that matters most).
--
-- PAR-Q is stricter: it is a seven-question safety screen, and a partly
-- answered one has screened nothing. It counts only once all seven ids hold a
-- boolean — the same gate the wizard's Continue button applies client-side.
--
-- The ARRAY of PAR-Q ids below is the third copy of that list (submit_intake()
-- in 0005 and PARQ_QUESTIONS in schemas/intake.ts are the other two). There is
-- still no shared source between SQL and TypeScript for a fixed literal array,
-- so all three are kept in sync by hand, as 0005's header already notes.
--
-- No table, column, policy or grant changes. intake_progress() keeps its exact
-- signature, its SECURITY DEFINER authorization path (is_pt_of_client), and
-- its "state + counts only, never content" contract — the helper added here
-- returns an integer and is only ever called from inside it.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- intake_answered_sections — how many of the template's sections hold an answer.
--
-- IMMUTABLE: pure function of its two JSONB arguments. Not SECURITY DEFINER and
-- not granted to anyone — it reads no tables, so it needs neither; it exists
-- only to keep intake_progress() legible.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.intake_answered_sections(
  p_responses JSONB,
  p_sections  JSONB
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT count(*)::INTEGER
  FROM jsonb_array_elements(COALESCE(p_sections, '[]'::JSONB)) AS s(section)
  WHERE CASE
    WHEN s.section->>'id' = 'parq' THEN (
      SELECT coalesce(bool_and(
        jsonb_typeof(COALESCE(p_responses->'parq', '{}'::JSONB) -> q) = 'boolean'
      ), FALSE)
      FROM unnest(ARRAY[
        'parq_heart', 'parq_chest_pain', 'parq_dizziness', 'parq_chronic_condition',
        'parq_medication', 'parq_musculoskeletal', 'parq_supervised'
      ]) AS q
    )
    ELSE EXISTS (
      SELECT 1
      FROM jsonb_each(COALESCE(p_responses -> (s.section->>'id'), '{}'::JSONB)) AS kv(key, value)
      WHERE jsonb_typeof(kv.value) <> 'null'
        -- #>> '{}' unwraps a JSONB scalar to its text without the quotes that
        -- ::TEXT would leave on, so '""' and '"   "' both btrim to ''.
        AND NOT (jsonb_typeof(kv.value) = 'string' AND btrim(kv.value #>> '{}') = '')
        AND NOT (jsonb_typeof(kv.value) = 'array' AND jsonb_array_length(kv.value) = 0)
    )
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.intake_answered_sections(JSONB, JSONB) FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- intake_progress — unchanged except for how answered_sections is derived.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.intake_progress(p_client_id UUID)
RETURNS TABLE(state TEXT, answered_sections INTEGER, total_sections INTEGER, updated_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.state,
    public.intake_answered_sections(f.responses, f.sections),
    jsonb_array_length(f.sections),
    f.updated_at
  FROM public.intake_forms f
  WHERE f.client_id = p_client_id
    AND public.is_pt_of_client(p_client_id);
$$;

REVOKE EXECUTE ON FUNCTION public.intake_progress(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.intake_progress(UUID) TO authenticated;

COMMIT;

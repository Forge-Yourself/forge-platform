-- =============================================================================
-- 0012 · intake_answered_sections: one PAR-Q answer counted as all seven
-- =============================================================================
-- 0011 gave PAR-Q a stricter rule than the other sections — it counts only once
-- all seven questions hold a boolean — and expressed it as:
--
--   SELECT coalesce(bool_and(jsonb_typeof(responses->'parq' -> q) = 'boolean'), FALSE)
--   FROM unnest(ARRAY[...seven ids...]) AS q
--
-- For an id the client has not answered, `responses->'parq' -> q` is SQL NULL,
-- so `jsonb_typeof(NULL) = 'boolean'` is NULL rather than FALSE — and bool_and
-- IGNORES nulls. A PAR-Q with a single question answered therefore aggregated to
-- bool_and(TRUE) = TRUE, and the whole seven-question safety screen counted as
-- complete. The outer coalesce did not help: it only guards the empty-input case,
-- and the input was never empty.
--
-- Verified against the live function before this migration:
--   responses '{"parq":{"parq_heart":false}}'  ->  1 section answered (expected 0)
--
-- The fix is to collapse NULL to FALSE INSIDE the aggregate, where bool_and can
-- still see it. This matches the TypeScript twin in
-- packages/shared/src/schemas/intake.ts, which uses
-- `PARQ_QUESTIONS.every((q) => typeof parq[q] === 'boolean')` and was never
-- affected — `every` over a missing key is plainly false in JS.
--
-- Nothing else about 0011 changes: same signature, same IMMUTABLE/strictness,
-- same non-parq branch, same grants. intake_progress() is untouched and keeps
-- calling this helper.
-- =============================================================================

BEGIN;

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
      -- coalesce INSIDE bool_and: an unanswered id must aggregate as FALSE, not
      -- be skipped as NULL. This is the whole of 0012.
      SELECT coalesce(bool_and(
        coalesce(jsonb_typeof(COALESCE(p_responses->'parq', '{}'::JSONB) -> q) = 'boolean', FALSE)
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

COMMIT;

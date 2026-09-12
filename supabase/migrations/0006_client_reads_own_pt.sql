-- =============================================================================
-- 0006 · a client can read their own PT's user row
-- =============================================================================
-- Discovered building M2's ClientHome (Task 10): `users_select`
-- (0003_rls.sql:128-130) only lets a user read themself, the PT who trains
-- them (`is_pt_of_user`, the PT-reads-client direction), or an admin — there
-- was no reverse policy letting a CLIENT read their own PT's `users` row, so
-- ClientHome could never show the PT's name/avatar. Purely additive: a new
-- permissive SELECT policy, OR'd with the existing one, changes nothing about
-- who can read what beyond adding exactly this one direction.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.is_my_pt(p_pt_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.pt_user_id = p_pt_user_id AND c.client_user_id = auth.uid()
  );
$$;

CREATE POLICY users_select_own_pt ON public.users
  FOR SELECT TO authenticated
  USING (public.is_my_pt(id));

COMMIT;

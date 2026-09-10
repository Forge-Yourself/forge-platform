-- =============================================================================
-- 0003 · Row Level Security
-- =============================================================================
-- Two enforcement layers by design (implementation design §3):
--   1. RLS here — the backstop if a client key leaks. PostgREST exposes every
--      public table, so default-deny is the resting state.
--   2. TypeScript checks in API routes for rules too complex for SQL. Those use
--      the service-role key, which bypasses everything below.
--
-- Policies are added for the tables M1 and M2 touch. Every other table is
-- enabled with no policy, which denies it to anon and authenticated alike;
-- later milestones add their own policies alongside the code that needs them.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Enable RLS everywhere, including partitions. Extension-owned tables
-- (PostGIS spatial_ref_sys) are skipped — they are reference data we do not own.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl REGCLASS;
BEGIN
  FOR tbl IN
    SELECT c.oid::REGCLASS
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.objid = c.oid AND d.deptype = 'e'
       )
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Persona helpers.
-- SECURITY DEFINER is load-bearing: these read the same tables the policies
-- protect, and an invoker-rights function would recurse into its own policy.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = auth.uid() AND role = 'admin' AND is_deleted = FALSE
  );
$$;

-- True when the caller trains this client: either as the owning PT, or as a
-- Sub-PT the Master has actively assigned to them.
CREATE OR REPLACE FUNCTION public.is_pt_of_client(p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.id = p_client_id AND c.pt_user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.client_pt_assignments a
     WHERE a.client_id = p_client_id
       AND a.pt_user_id = auth.uid()
       AND a.is_active = TRUE
  );
$$;

-- True when the caller is the client behind this record.
CREATE OR REPLACE FUNCTION public.is_client_record_owner(p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.id = p_client_id AND c.client_user_id = auth.uid()
  );
$$;

-- True when the caller trains the person behind this user id — what a PT
-- client list needs in order to render names.
CREATE OR REPLACE FUNCTION public.is_pt_of_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.client_user_id = p_user_id
       AND (
         c.pt_user_id = auth.uid()
         OR EXISTS (
           SELECT 1 FROM public.client_pt_assignments a
            WHERE a.client_id = c.id AND a.pt_user_id = auth.uid() AND a.is_active = TRUE
         )
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_master_of(p_pt_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.master_sub_relations r
     WHERE r.master_pt_id = auth.uid()
       AND r.sub_pt_id = p_pt_user_id
       AND r.state IN ('accepted', 'active')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- users — self, plus the PT who trains them
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY users_select ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_pt_of_user(id) OR public.is_admin());

CREATE POLICY users_update_self ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

-- No insert policy: profile rows come from the signup trigger only.
-- Column grants stop a user editing their own role, quarantine or delete flags.
-- RLS gates rows, not columns, so escalation has to be blocked here.
REVOKE UPDATE ON public.users FROM anon, authenticated;
GRANT UPDATE (
  display_name, avatar_url, phone, locale, unit_system, timezone,
  consent_analytics, consent_marketing, consent_ai_training, onboarding_completed
) ON public.users TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- pt_profiles — own profile; published profiles are readable (directory, v2)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY pt_profiles_select ON public.pt_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_published = TRUE OR public.is_admin());

CREATE POLICY pt_profiles_write ON public.pt_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- pt_modes / device_tokens — strictly self-owned
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY pt_modes_all ON public.pt_modes
  FOR ALL TO authenticated
  USING (pt_user_id = auth.uid() OR public.is_admin())
  WITH CHECK (pt_user_id = auth.uid() OR public.is_admin());

CREATE POLICY device_tokens_all ON public.device_tokens
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- clients — the PT who owns the roster, an assigned Sub-PT, and the client
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY clients_select ON public.clients
  FOR SELECT TO authenticated
  USING (
    pt_user_id = auth.uid()
    OR client_user_id = auth.uid()
    OR public.is_pt_of_client(id)
    OR public.is_admin()
  );

CREATE POLICY clients_insert ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (pt_user_id = auth.uid() OR public.is_admin());

CREATE POLICY clients_update ON public.clients
  FOR UPDATE TO authenticated
  USING (pt_user_id = auth.uid() OR client_user_id = auth.uid() OR public.is_admin())
  WITH CHECK (pt_user_id = auth.uid() OR client_user_id = auth.uid() OR public.is_admin());

CREATE POLICY clients_delete ON public.clients
  FOR DELETE TO authenticated
  USING (pt_user_id = auth.uid() OR public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- client_pt_assignments — readable by both PTs, written by the Master (M7)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY cpa_select ON public.client_pt_assignments
  FOR SELECT TO authenticated
  USING (pt_user_id = auth.uid() OR master_user_id = auth.uid() OR public.is_admin());

CREATE POLICY cpa_write ON public.client_pt_assignments
  FOR ALL TO authenticated
  USING (master_user_id = auth.uid() OR public.is_admin())
  WITH CHECK (master_user_id = auth.uid() OR public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- intake_forms — the client fills it in, their PT reviews it
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY intake_forms_all ON public.intake_forms
  FOR ALL TO authenticated
  USING (
    public.is_pt_of_client(client_id)
    OR public.is_client_record_owner(client_id)
    OR public.is_admin()
  )
  WITH CHECK (
    public.is_pt_of_client(client_id)
    OR public.is_client_record_owner(client_id)
    OR public.is_admin()
  );

-- audit_logs stays policy-free on purpose: append-only, service-role only.

COMMIT;

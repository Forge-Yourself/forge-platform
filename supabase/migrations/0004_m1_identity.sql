-- =============================================================================
-- 0004 · M1 identity gaps
-- =============================================================================
-- Fills the gaps M1 (auth & identity) needs that M0 didn't yet cover:
--   1. Partition runway through 2027-06 for the four partitioned tables, so
--      the app doesn't start throwing "no partition of relation found" the
--      day after the M0 partitions run out.
--   2. A self-owned policy for notification_preferences (M0 enabled RLS on
--      every table but only wrote policies for the tables M0/M1 touch).
--   3. pt_certifications — structured certification rows for the PT profile
--      editor. pt_profiles.certifications TEXT[] is left untouched; this is
--      an additive, more structured sibling, not a replacement.
--   4. Two SECURITY DEFINER RPCs the M1 client calls directly:
--       - set_initial_role: the one-time role picker after signup.
--       - log_account_event: session-lifecycle audit entries the client can
--         write for itself (login/logout/MFA/password change), scoped so the
--         actor can never be forged and the action can never be arbitrary.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Partition runway — extend audit_logs, notifications, sets, food_logs
-- through 2027-06. Naming and range convention matches db/schema.sql exactly
-- (<table>_YYYY_MM, FOR VALUES FROM (month start) TO (next month start)).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl   TEXT;
  mstart DATE;
  mend   DATE;
  part_name TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['audit_logs', 'notifications', 'sets', 'food_logs']
  LOOP
    mstart := DATE '2026-11-01';
    WHILE mstart <= DATE '2027-06-01' LOOP
      mend := mstart + INTERVAL '1 month';
      part_name := format('%s_%s', tbl, to_char(mstart, 'YYYY_MM'));
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        part_name, tbl, mstart::TEXT, mend::TEXT
      );
      mstart := mend;
    END LOOP;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- notification_preferences — strictly self-owned, same shape as
-- device_tokens_all (0003_rls.sql).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY notification_preferences_all ON public.notification_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- pt_certifications — structured certification rows for the profile editor.
-- pt_profiles.certifications TEXT[] stays as-is; this is additive.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.pt_certifications (
  id            UUID         NOT NULL DEFAULT uuid_v7(),
  pt_user_id    UUID         NOT NULL,
  name          VARCHAR      NOT NULL,
  issuer        VARCHAR,
  expires_on    DATE,
  status        VARCHAR(20)  NOT NULL DEFAULT 'unverified',
  document_url  TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_pt_certifications PRIMARY KEY (id),
  CONSTRAINT fk_pt_certifications_user FOREIGN KEY (pt_user_id)
    REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT chk_pt_certifications_status CHECK (status IN (
    'unverified', 'in_review', 'verified', 'rejected'
  ))
);

CREATE INDEX idx_pt_certifications_pt_user ON public.pt_certifications (pt_user_id);

ALTER TABLE public.pt_certifications ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_pt_certifications_updated_at
  BEFORE UPDATE ON public.pt_certifications
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Owning PT has full read/write over their own certification rows.
CREATE POLICY pt_certifications_write ON public.pt_certifications
  FOR ALL TO authenticated
  USING (pt_user_id = auth.uid() OR public.is_admin())
  WITH CHECK (pt_user_id = auth.uid() OR public.is_admin());

-- Anyone authenticated can read a PT's certifications once that PT's profile
-- is published — mirrors pt_profiles_select's is_published = TRUE clause.
CREATE POLICY pt_certifications_select_published ON public.pt_certifications
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pt_profiles p
       WHERE p.user_id = pt_certifications.pt_user_id
         AND p.is_published = TRUE
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- set_initial_role — the one-time role picker after signup. SECURITY DEFINER
-- so it can update a column the RLS/column-grant layer otherwise locks
-- (0003_rls.sql revokes UPDATE on users from authenticated and grants back
-- only a safe column list that excludes role); this is the sole sanctioned
-- door through which a fresh signup becomes 'pt' / 'client' / 'gym_account'.
-- 'admin' is never accepted, even if passed explicitly — there is no path to
-- admin through self-service.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_initial_role(p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_role NOT IN ('pt', 'client', 'gym_account') THEN
    RAISE EXCEPTION 'invalid initial role: %', p_role;
  END IF;

  -- A UI double-tap replaying this after onboarding is already complete
  -- should not crash the client — silently do nothing past that point.
  IF EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND onboarding_completed = TRUE
  ) THEN
    RETURN;
  END IF;

  UPDATE public.users SET role = p_role WHERE id = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_initial_role(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_initial_role(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- log_account_event — session-lifecycle audit entries the client writes for
-- itself. The actor is always auth.uid(), never a parameter, so it cannot be
-- forged. The action allow-list is deliberately narrower than audit_logs'
-- own chk_audit_logs_action: user_register and user_login_failed are
-- excluded because no authenticated session exists at those moments —
-- Supabase records both in auth.audit_log_entries instead.
-- search_path includes extensions: audit_logs.id defaults to uuid_v7(),
-- which calls pgcrypto's gen_random_bytes() — pgcrypto lives in the
-- extensions schema on this project, not public.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_account_event(p_action TEXT, p_details JSONB DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_action NOT IN (
    'user_login', 'user_logout', 'user_mfa_enable',
    'user_mfa_disable', 'user_password_change'
  ) THEN
    RAISE EXCEPTION 'invalid account event action: %', p_action;
  END IF;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, details)
  VALUES (auth.uid(), auth.uid(), p_action, p_details);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_account_event(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_account_event(TEXT, JSONB) TO authenticated;

COMMIT;

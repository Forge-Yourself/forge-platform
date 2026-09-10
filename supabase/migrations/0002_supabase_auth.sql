-- =============================================================================
-- 0002 · Supabase Auth owns identity
-- =============================================================================
-- public.users becomes a profile table keyed to auth.users(id).
-- Credentials, MFA and lockout state are Supabase Auth's concern, so the
-- columns that duplicated them are dropped rather than left to drift.
-- =============================================================================

BEGIN;

-- Ids now originate in auth.users; a local default would mask a broken insert.
ALTER TABLE public.users ALTER COLUMN id DROP DEFAULT;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS password_hash,
  DROP COLUMN IF EXISTS mfa_enabled,
  DROP COLUMN IF EXISTS mfa_method,
  DROP COLUMN IF EXISTS mfa_key_id,
  DROP COLUMN IF EXISTS failed_login_count,
  DROP COLUMN IF EXISTS locked_until;

ALTER TABLE public.users
  ADD CONSTRAINT fk_users_auth_user FOREIGN KEY (id)
    REFERENCES auth.users(id) ON DELETE CASCADE;

-- user_sessions duplicated GoTrue's refresh-token rotation. Supabase Auth owns
-- sessions now, so the table is dropped rather than left as a decoy.
DROP TABLE IF EXISTS public.user_sessions;

-- ─────────────────────────────────────────────────────────────────────────────
-- Profile row is created by the signup trigger, not by the client.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta        JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::JSONB);
  chosen_role TEXT  := COALESCE(meta->>'role', 'client');
  chosen_locale TEXT := COALESCE(meta->>'locale', 'en');
BEGIN
  -- Role selection happens in the app (EP-01). Anything unexpected lands as a
  -- client, the least privileged persona, rather than failing the signup.
  IF chosen_role NOT IN ('pt', 'client', 'gym_account') THEN
    chosen_role := 'client';
  END IF;

  IF chosen_locale NOT IN ('en', 'ar', 'fr') THEN
    chosen_locale := 'en';
  END IF;

  INSERT INTO public.users (id, role, email, display_name, locale, auth_provider)
  VALUES (
    NEW.id,
    chosen_role,
    NEW.email,
    COALESCE(NULLIF(meta->>'display_name', ''), split_part(NEW.email, '@', 1)),
    chosen_locale,
    COALESCE(NEW.raw_app_meta_data->>'provider', 'email')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMIT;

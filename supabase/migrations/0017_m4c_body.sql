-- =============================================================================
-- 0017 · M4c body — metrics, progress photos, the progress-photos bucket
-- =============================================================================
-- 1. body_metrics gains recorded_by_user_id and note; circumferences is
--    constrained to six sites (10-300 cm); a check-in carries at least one value.
-- 2. progress_photos stores bucket paths, not URLs; drops encryption_key_id
--    (spec D1: private bucket + RLS + signed URLs + Supabase at-rest
--    encryption, superseding EP-06's E2E wording); gains taken_by_user_id;
--    pose_type is required.
-- 3. RLS: SELECT only. Client sees own; PT sees metrics always and photos only
--    when shared; admin sees rows. Every write is an RPC (the 0014/0015 rule).
-- 4. Bucket progress-photos, private, JPEG only, 10 MB. Objects live at
--    <client_id>/<photo_id>/{full,thumb}.jpg. storage.objects policies: INSERT
--    for the client or their PT on that client's folder; SELECT (signing) for
--    the client, or the PT when shared, never an admin; DELETE for the client
--    or the PT who took it. Objects are never deleted in SQL: the live project's
--    storage.protect_delete trigger forbids it, and a SQL delete would orphan
--    the blob. The device removes objects through the Storage API, and a Vercel
--    Cron route sweeps orphans through progress_photo_orphans().
-- 5. RPCs: record_body_metric, delete_body_metric, record_progress_photo,
--    set_photo_shared, delete_progress_photo, body_plateau.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- body_metrics
-- ─────────────────────────────────────────────────────────────────────────────
-- CASE, not AND: jsonb_each raises on a non-object, and SQL does not promise
-- to evaluate AND left to right. The inner CASE guards the numeric cast the
-- same way.
CREATE FUNCTION public.body_circumferences_valid(p JSONB)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p) <> 'object' OR p = '{}'::jsonb THEN FALSE
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_each(p) AS e(key, value)
       WHERE e.key NOT IN ('waist', 'hips', 'chest', 'arm', 'thigh', 'neck')
          OR CASE
               WHEN jsonb_typeof(e.value) <> 'number' THEN TRUE
               ELSE (e.value #>> '{}')::numeric NOT BETWEEN 10 AND 300
             END
    )
  END;
$$;

ALTER TABLE public.body_metrics
  ADD COLUMN recorded_by_user_id UUID NOT NULL REFERENCES public.users(id),
  ADD COLUMN note TEXT,
  ADD CONSTRAINT chk_bm_note CHECK (note IS NULL OR char_length(note) <= 500),
  ADD CONSTRAINT chk_bm_circumferences CHECK (circumferences IS NULL OR public.body_circumferences_valid(circumferences)),
  ADD CONSTRAINT chk_bm_any_value CHECK (weight_kg IS NOT NULL OR body_fat_pct IS NOT NULL OR circumferences IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- progress_photos
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.progress_photos RENAME COLUMN photo_url TO photo_path;
ALTER TABLE public.progress_photos RENAME COLUMN thumbnail_url TO thumbnail_path;
ALTER TABLE public.progress_photos
  ALTER COLUMN thumbnail_path SET NOT NULL,
  ALTER COLUMN pose_type SET NOT NULL,
  DROP COLUMN encryption_key_id,
  ADD COLUMN taken_by_user_id UUID NOT NULL REFERENCES public.users(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY body_metrics_select ON public.body_metrics
  FOR SELECT TO authenticated
  USING (public.is_client_record_owner(client_id) OR public.is_pt_of_client(client_id) OR public.is_admin());

CREATE POLICY progress_photos_select ON public.progress_photos
  FOR SELECT TO authenticated
  USING (
    public.is_client_record_owner(client_id)
    OR (is_shared_with_pt AND public.is_pt_of_client(client_id))
    OR public.is_admin()
  );

REVOKE INSERT, UPDATE, DELETE ON public.body_metrics    FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.progress_photos FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Bucket and object policies
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('progress-photos', 'progress-photos', FALSE, 10485760, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;

-- Segment 1 or 2 of an object name as a uuid, NULL when it is not one.
CREATE FUNCTION public.progress_photo_path_uuid(p_name TEXT, p_part INT)
RETURNS UUID
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN split_part(p_name, '/', p_part)::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

-- Written out rather than delegated to progress_photos' RLS: that policy
-- admits admins, and signing must not (spec D9).
CREATE FUNCTION public.can_view_progress_photo_object(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.progress_photos p
     WHERE p.id = public.progress_photo_path_uuid(p_name, 2)
       AND p.client_id = public.progress_photo_path_uuid(p_name, 1)
       AND (public.is_client_record_owner(p.client_id)
            OR (p.is_shared_with_pt AND public.is_pt_of_client(p.client_id)))
  );
$$;

CREATE FUNCTION public.can_delete_progress_photo_object(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.progress_photos p
     WHERE p.id = public.progress_photo_path_uuid(p_name, 2)
       AND p.client_id = public.progress_photo_path_uuid(p_name, 1)
       AND (public.is_client_record_owner(p.client_id)
            OR (p.taken_by_user_id = auth.uid() AND public.is_pt_of_client(p.client_id)))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_view_progress_photo_object(TEXT)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_delete_progress_photo_object(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_view_progress_photo_object(TEXT)   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.can_delete_progress_photo_object(TEXT) TO authenticated;

CREATE POLICY progress_photos_object_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'progress-photos'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(full|thumb)\.jpg$'
    AND (public.is_client_record_owner(public.progress_photo_path_uuid(name, 1))
         OR public.is_pt_of_client(public.progress_photo_path_uuid(name, 1)))
  );

CREATE POLICY progress_photos_object_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'progress-photos' AND public.can_view_progress_photo_object(name));

CREATE POLICY progress_photos_object_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'progress-photos' AND public.can_delete_progress_photo_object(name));

-- ─────────────────────────────────────────────────────────────────────────────
-- Metrics RPCs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.record_body_metric(
  p_id             UUID,
  p_client_id      UUID,
  p_measured_at    TIMESTAMPTZ DEFAULT NULL,
  p_weight_kg      NUMERIC     DEFAULT NULL,
  p_body_fat_pct   NUMERIC     DEFAULT NULL,
  p_circumferences JSONB       DEFAULT NULL,
  p_note           TEXT        DEFAULT NULL
)
RETURNS public.body_metrics
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.body_metrics;
BEGIN
  IF NOT (public.is_pt_of_client(p_client_id) OR public.is_client_record_owner(p_client_id)) THEN
    RAISE EXCEPTION 'not authorized for this client' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.body_metrics (
    id, client_id, recorded_by_user_id, weight_kg, body_fat_pct, circumferences, note, source, measured_at
  ) VALUES (
    p_id, p_client_id, auth.uid(), p_weight_kg, p_body_fat_pct,
    NULLIF(p_circumferences, '{}'::jsonb),
    NULLIF(btrim(p_note), ''),
    'manual',
    -- The device clock is trusted for 24 hours and no further, as in 0016.
    LEAST(NOW(), GREATEST(NOW() - interval '24 hours', COALESCE(p_measured_at, NOW())))
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO v_row FROM public.body_metrics WHERE id = p_id;
  IF v_row.client_id <> p_client_id THEN
    RAISE EXCEPTION 'metric id belongs to another client' USING ERRCODE = '42501';
  END IF;
  RETURN v_row;
END;
$$;

CREATE FUNCTION public.delete_body_metric(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.body_metrics;
BEGIN
  SELECT * INTO v_row FROM public.body_metrics WHERE id = p_id;
  IF v_row.id IS NULL THEN
    RETURN;
  END IF;
  IF NOT (public.is_client_record_owner(v_row.client_id)
          OR (v_row.recorded_by_user_id = auth.uid() AND public.is_pt_of_client(v_row.client_id))) THEN
    RAISE EXCEPTION 'not allowed to delete this metric' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.body_metrics WHERE id = p_id;
END;
$$;

-- Spec D8 as corrected in the plan: anchored on the latest weight's UTC week,
-- which must be this week or last; the four weeks ending there each need a
-- weight; the spread of weekly means is under 0.5 % of their mean.
-- Mirrored by plateau() in packages/shared/src/body/plateau.ts.
CREATE FUNCTION public.body_plateau(p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest TIMESTAMP;
  v_weeks  INT;
  v_spread NUMERIC;
BEGIN
  IF NOT (public.is_client_record_owner(p_client_id) OR public.is_pt_of_client(p_client_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this client' USING ERRCODE = '42501';
  END IF;

  SELECT max(date_trunc('week', measured_at AT TIME ZONE 'UTC')) INTO v_latest
    FROM public.body_metrics
   WHERE client_id = p_client_id AND weight_kg IS NOT NULL;
  IF v_latest IS NULL OR v_latest < date_trunc('week', NOW() AT TIME ZONE 'UTC') - interval '1 week' THEN
    RETURN FALSE;
  END IF;

  SELECT count(*), (max(m) - min(m)) / avg(m) INTO v_weeks, v_spread
    FROM (
      SELECT avg(weight_kg) AS m
        FROM public.body_metrics
       WHERE client_id = p_client_id
         AND weight_kg IS NOT NULL
         AND date_trunc('week', measured_at AT TIME ZONE 'UTC') > v_latest - interval '4 weeks'
       GROUP BY date_trunc('week', measured_at AT TIME ZONE 'UTC')
    ) w;
  RETURN v_weeks = 4 AND v_spread < 0.005;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Photo RPCs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.record_progress_photo(
  p_id        UUID,
  p_client_id UUID,
  p_pose_type TEXT,
  p_taken_at  TIMESTAMPTZ DEFAULT NULL,
  p_share     BOOLEAN     DEFAULT FALSE
)
RETURNS public.progress_photos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_client BOOLEAN;
  v_prefix    TEXT := p_client_id::text || '/' || p_id::text || '/';
  v_row       public.progress_photos;
BEGIN
  IF p_pose_type IS NULL OR p_pose_type NOT IN ('front', 'back', 'side_left', 'side_right', 'custom') THEN
    RAISE EXCEPTION 'unknown pose %', p_pose_type USING ERRCODE = '22023';
  END IF;

  v_is_client := public.is_client_record_owner(p_client_id);
  IF NOT (v_is_client OR public.is_pt_of_client(p_client_id)) THEN
    RAISE EXCEPTION 'not authorized for this client' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.progress_photos WHERE id = p_id;
  IF v_row.id IS NOT NULL THEN
    IF v_row.client_id <> p_client_id THEN
      RAISE EXCEPTION 'photo id belongs to another client' USING ERRCODE = '42501';
    END IF;
    RETURN v_row;
  END IF;

  IF (SELECT count(*) FROM storage.objects
       WHERE bucket_id = 'progress-photos'
         AND name IN (v_prefix || 'full.jpg', v_prefix || 'thumb.jpg')) <> 2 THEN
    RAISE EXCEPTION 'photo objects are not uploaded' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.progress_photos (
    id, client_id, photo_path, thumbnail_path, pose_type, is_shared_with_pt, taken_by_user_id, taken_at
  ) VALUES (
    p_id, p_client_id, v_prefix || 'full.jpg', v_prefix || 'thumb.jpg', p_pose_type,
    -- Spec D2: a PT's photo is shared by definition; only the client chooses.
    CASE WHEN v_is_client THEN COALESCE(p_share, FALSE) ELSE TRUE END,
    auth.uid(),
    LEAST(NOW(), GREATEST(NOW() - interval '24 hours', COALESCE(p_taken_at, NOW())))
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO v_row FROM public.progress_photos WHERE id = p_id;
  RETURN v_row;
END;
$$;

CREATE FUNCTION public.set_photo_shared(p_id UUID, p_shared BOOLEAN)
RETURNS public.progress_photos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.progress_photos;
BEGIN
  SELECT * INTO v_row FROM public.progress_photos WHERE id = p_id;
  IF v_row.id IS NULL OR NOT public.is_client_record_owner(v_row.client_id) THEN
    RAISE EXCEPTION 'only the client can change sharing' USING ERRCODE = '42501';
  END IF;
  UPDATE public.progress_photos
     SET is_shared_with_pt = p_shared, updated_at = NOW()
   WHERE id = p_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Deletes the row only. The caller removes both objects through the Storage
-- API FIRST, while this row still authorises the DELETE policy.
CREATE FUNCTION public.delete_progress_photo(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.progress_photos;
BEGIN
  SELECT * INTO v_row FROM public.progress_photos WHERE id = p_id;
  IF v_row.id IS NULL THEN
    RETURN;
  END IF;
  IF NOT (public.is_client_record_owner(v_row.client_id)
          OR (v_row.taken_by_user_id = auth.uid() AND public.is_pt_of_client(v_row.client_id))) THEN
    RAISE EXCEPTION 'not allowed to delete this photo' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.progress_photos WHERE id = p_id;
END;
$$;

-- Objects older than p_older_than with no row: uploads whose registration never
-- landed, and objects a device failed to remove after deleting the row. Read
-- by the Vercel Cron route under the service role, which then removes them
-- through the Storage API.
CREATE FUNCTION public.progress_photo_orphans(p_older_than INTERVAL DEFAULT interval '24 hours', p_limit INT DEFAULT 500)
RETURNS SETOF TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.name
    FROM storage.objects o
   WHERE o.bucket_id = 'progress-photos'
     AND o.created_at < NOW() - p_older_than
     AND NOT EXISTS (
       SELECT 1 FROM public.progress_photos p WHERE p.id = public.progress_photo_path_uuid(o.name, 2)
     )
   ORDER BY o.created_at
   LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.record_body_metric(UUID, UUID, TIMESTAMPTZ, NUMERIC, NUMERIC, JSONB, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_body_metric(UUID)                                                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.body_plateau(UUID)                                                        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_progress_photo(UUID, UUID, TEXT, TIMESTAMPTZ, BOOLEAN)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_photo_shared(UUID, BOOLEAN)                                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_progress_photo(UUID)                                               FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_body_metric(UUID, UUID, TIMESTAMPTZ, NUMERIC, NUMERIC, JSONB, TEXT) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_body_metric(UUID)                                                  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.body_plateau(UUID)                                                        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.record_progress_photo(UUID, UUID, TEXT, TIMESTAMPTZ, BOOLEAN)             TO authenticated;
GRANT  EXECUTE ON FUNCTION public.set_photo_shared(UUID, BOOLEAN)                                           TO authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_progress_photo(UUID)                                               TO authenticated;
REVOKE EXECUTE ON FUNCTION public.progress_photo_orphans(INTERVAL, INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.progress_photo_orphans(INTERVAL, INT) TO service_role;

COMMIT;

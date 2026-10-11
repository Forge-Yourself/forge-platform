-- =============================================================================
-- 0022 · M5c Google Calendar.
--
-- A PT connects Google: bookings are copied into a "Forge sessions" calendar,
-- and the busy times of the calendars they tick close those slots for booking.
-- Spec: docs/superpowers/specs/2026-10-11-m5c-calendar-design.md.
--
--   1. google_calendar_links — the connection a PT can read (email, status,
--      calendars, ticks, last sync). google_calendar_tokens and
--      google_oauth_states hold sealed tokens and one-time OAuth state; no app
--      role has any privilege on them (D4). apps/web reaches them as the
--      service role.
--   2. google_busy_blocks — events from the ticked calendars, PT-only. Replaced
--      wholesale per window by google_replace_busy(), which keeps each block's
--      id across refreshes and turns all-day dates into local midnights in the
--      PT's zone here, so time math stays in Postgres (D9).
--   3. google_sync_queue — bookings waiting to be copied. A trigger on
--      bookings fills it for connected PTs (D7); apps/web drains it.
--   4. open_slots skips busy blocks (D11). Same signature, so its grants and
--      every caller (create_booking, reschedule_booking) are unchanged.
--   5. calendar_overlaps() computes booking ↔ Google overlaps; keep_overlap()
--      records "Keep both" (D12).
--
-- Errors are bare tokens mapped to copy in the app.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) Tables
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.google_calendar_links (
  pt_user_id        UUID        NOT NULL,
  google_email      TEXT,
  status            VARCHAR(12) NOT NULL DEFAULT 'connected',
  forge_calendar_id TEXT,
  calendars         JSONB       NOT NULL DEFAULT '[]',
  busy_calendar_ids TEXT[]      NOT NULL DEFAULT '{}',
  connected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at    TIMESTAMPTZ,
  busy_refreshed_at TIMESTAMPTZ,
  error_at          TIMESTAMPTZ,

  CONSTRAINT pk_google_calendar_links PRIMARY KEY (pt_user_id),
  CONSTRAINT fk_gcl_pt FOREIGN KEY (pt_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT chk_gcl_status CHECK (status IN ('connected', 'error')),
  CONSTRAINT chk_gcl_calendars CHECK (jsonb_typeof(calendars) = 'array')
);

CREATE TABLE public.google_calendar_tokens (
  pt_user_id        UUID        NOT NULL,
  refresh_token     TEXT        NOT NULL,
  access_token      TEXT,
  access_expires_at TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_google_calendar_tokens PRIMARY KEY (pt_user_id),
  CONSTRAINT fk_gct_pt FOREIGN KEY (pt_user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE TABLE public.google_oauth_states (
  state         TEXT        NOT NULL,
  pt_user_id    UUID        NOT NULL,
  return_to     TEXT        NOT NULL,
  code_verifier TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_google_oauth_states PRIMARY KEY (state),
  CONSTRAINT fk_gos_pt FOREIGN KEY (pt_user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE TABLE public.google_busy_blocks (
  id          UUID        NOT NULL DEFAULT uuid_v7(),
  pt_user_id  UUID        NOT NULL,
  calendar_id TEXT        NOT NULL,
  event_id    TEXT        NOT NULL,
  title       TEXT,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_google_busy_blocks PRIMARY KEY (id),
  CONSTRAINT fk_gbb_pt FOREIGN KEY (pt_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT uq_gbb_event UNIQUE (pt_user_id, calendar_id, event_id, starts_at),
  CONSTRAINT chk_gbb_span CHECK (ends_at > starts_at)
);
CREATE INDEX idx_gbb_pt_time ON public.google_busy_blocks (pt_user_id, starts_at);

CREATE TABLE public.google_sync_queue (
  booking_id UUID        NOT NULL,
  pt_user_id UUID        NOT NULL,
  queued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts   SMALLINT    NOT NULL DEFAULT 0,
  last_error TEXT,

  CONSTRAINT pk_google_sync_queue PRIMARY KEY (booking_id),
  CONSTRAINT fk_gsq_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_gsq_pt FOREIGN KEY (pt_user_id) REFERENCES public.users(id) ON DELETE CASCADE
);
CREATE INDEX idx_gsq_pt ON public.google_sync_queue (pt_user_id, queued_at);

CREATE TABLE public.google_overlap_kept (
  booking_id UUID        NOT NULL,
  busy_id    UUID        NOT NULL,
  pt_user_id UUID        NOT NULL,
  kept_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_google_overlap_kept PRIMARY KEY (booking_id, busy_id),
  CONSTRAINT fk_gok_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_gok_busy FOREIGN KEY (busy_id) REFERENCES public.google_busy_blocks(id) ON DELETE CASCADE,
  CONSTRAINT fk_gok_pt FOREIGN KEY (pt_user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) RLS. Tokens and states: nothing for any app role. The rest: SELECT for
-- the owning PT (and admins for the connection line, D18). Writes are RPCs or
-- the service role.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.google_calendar_links  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_oauth_states    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_busy_blocks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_sync_queue      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_overlap_kept    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.google_calendar_tokens FROM anon, authenticated;
REVOKE ALL ON public.google_oauth_states    FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.google_calendar_links FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.google_busy_blocks    FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.google_sync_queue     FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.google_overlap_kept   FROM anon, authenticated;

CREATE POLICY google_calendar_links_select ON public.google_calendar_links
  FOR SELECT TO authenticated
  USING (pt_user_id = auth.uid() OR public.is_admin());

CREATE POLICY google_busy_blocks_select ON public.google_busy_blocks
  FOR SELECT TO authenticated
  USING (pt_user_id = auth.uid());

CREATE POLICY google_sync_queue_select ON public.google_sync_queue
  FOR SELECT TO authenticated
  USING (pt_user_id = auth.uid());

CREATE POLICY google_overlap_kept_select ON public.google_overlap_kept
  FOR SELECT TO authenticated
  USING (pt_user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- (3) The queue trigger (D7). Fires inside the booking RPCs, so a booking that
-- rolls back never queues.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.enqueue_google_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.google_calendar_links WHERE pt_user_id = NEW.pt_user_id) THEN
    INSERT INTO public.google_sync_queue (booking_id, pt_user_id)
    VALUES (NEW.id, NEW.pt_user_id)
    ON CONFLICT (booking_id) DO UPDATE
      SET queued_at = NOW(), attempts = 0, last_error = NULL;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_google_sync() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_bookings_google_sync
  AFTER INSERT OR UPDATE OF status, starts_at, ends_at, client_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_google_sync();

-- ─────────────────────────────────────────────────────────────────────────────
-- (4) open_slots, busy-aware (D11). 0020's body; the marked block is new.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.open_slots(p_pt UUID, p_from DATE, p_to DATE, p_length SMALLINT, p_ignore UUID DEFAULT NULL)
RETURNS TABLE (slot_date DATE, slot_start TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_is_pt  BOOLEAN := (p_pt = auth.uid());
  v_tz     TEXT;
  v_rules  public.booking_rules;
  v_len    INTERVAL := make_interval(mins => p_length);
  v_buf    INTERVAL;
  v_limit  TIMESTAMPTZ;
  v_day    DATE;
  v_win    RECORD;
  v_cursor TIMESTAMPTZ;
  v_block  TIMESTAMPTZ;
BEGIN
  IF NOT v_is_pt AND NOT EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.pt_user_id = p_pt AND c.client_user_id = auth.uid() AND c.state IN ('active', 'accepted')
  ) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_to < p_from OR p_to - p_from > 41 THEN
    RAISE EXCEPTION 'range_too_long';
  END IF;

  v_tz    := public.pt_tz(p_pt);
  v_rules := public.rules_for(p_pt);
  IF NOT (p_length = ANY (v_rules.lengths_min)) THEN
    RAISE EXCEPTION 'length_not_offered';
  END IF;
  v_buf   := make_interval(mins => v_rules.buffer_min);
  v_limit := CASE WHEN v_is_pt THEN 'infinity'::TIMESTAMPTZ
                  ELSE NOW() + make_interval(weeks => v_rules.window_weeks) END;

  v_day := p_from;
  WHILE v_day <= p_to LOOP
    FOR v_win IN SELECT w.w_start, w.w_end FROM public.day_windows(p_pt, v_day, v_tz) w ORDER BY w.w_start LOOP
      v_cursor := v_win.w_start;
      IF v_cursor < NOW() THEN
        v_cursor := v_win.w_start
          + make_interval(mins => (CEIL(EXTRACT(EPOCH FROM (NOW() - v_win.w_start)) / 900) * 15)::INT);
      END IF;
      LOOP
        EXIT WHEN v_cursor + v_len > v_win.w_end OR v_cursor > v_limit;
        SELECT MAX(b.ends_at) INTO v_block
          FROM public.bookings b
         WHERE b.pt_user_id = p_pt
           AND b.status <> 'cancelled'
           AND b.id IS DISTINCT FROM p_ignore
           AND b.starts_at < v_cursor + v_len + v_buf
           AND b.ends_at + v_buf > v_cursor;
        IF v_block IS NOT NULL THEN
          v_cursor := v_block + v_buf;
          CONTINUE;
        END IF;
        -- M5c: a Google busy block closes the slot; resume at its end, on the
        -- next quarter hour. No buffer: the PT's buffer is for their sessions.
        SELECT MAX(g.ends_at) INTO v_block
          FROM public.google_busy_blocks g
         WHERE g.pt_user_id = p_pt
           AND g.starts_at < v_cursor + v_len
           AND g.ends_at > v_cursor;
        IF v_block IS NOT NULL THEN
          v_cursor := to_timestamp(CEIL(EXTRACT(EPOCH FROM v_block) / 900) * 900);
          CONTINUE;
        END IF;
        slot_date  := v_day;
        slot_start := v_cursor;
        RETURN NEXT;
        v_cursor := v_cursor + v_len + v_buf;
      END LOOP;
    END LOOP;
    v_day := v_day + 1;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (5) PT RPCs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.set_busy_calendars(p_ids TEXT[])
RETURNS public.google_calendar_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_link public.google_calendar_links;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'pt') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_link FROM public.google_calendar_links WHERE pt_user_id = auth.uid() FOR UPDATE;
  IF v_link.pt_user_id IS NULL THEN
    RAISE EXCEPTION 'not_connected';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_ids, '{}')) i
     WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_link.calendars) c WHERE c->>'id' = i)
  ) THEN
    RAISE EXCEPTION 'unknown_calendar';
  END IF;

  UPDATE public.google_calendar_links
     SET busy_calendar_ids = ARRAY(SELECT DISTINCT unnest(COALESCE(p_ids, '{}'))),
         busy_refreshed_at = NULL
   WHERE pt_user_id = auth.uid()
   RETURNING * INTO v_link;
  RETURN v_link;
END;
$$;

CREATE FUNCTION public.calendar_overlaps(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (
  out_booking_id    UUID,
  out_busy_id       UUID,
  out_title         TEXT,
  out_busy_start    TIMESTAMPTZ,
  out_busy_end      TIMESTAMPTZ,
  out_booking_start TIMESTAMPTZ,
  out_booking_end   TIMESTAMPTZ,
  out_overlap_start TIMESTAMPTZ,
  out_overlap_end   TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'pt') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_to - p_from > interval '43 days' THEN
    RAISE EXCEPTION 'range_too_long';
  END IF;
  RETURN QUERY
  SELECT b.id, g.id, g.title, g.starts_at, g.ends_at, b.starts_at, b.ends_at,
         GREATEST(b.starts_at, g.starts_at), LEAST(b.ends_at, g.ends_at)
    FROM public.bookings b
    JOIN public.google_busy_blocks g
      ON g.pt_user_id = b.pt_user_id
     AND g.starts_at < b.ends_at
     AND g.ends_at > b.starts_at
   WHERE b.pt_user_id = auth.uid()
     AND b.status IN ('scheduled', 'checked_in')
     AND b.starts_at < p_to
     AND b.ends_at > p_from
     AND NOT EXISTS (SELECT 1 FROM public.google_overlap_kept k WHERE k.booking_id = b.id AND k.busy_id = g.id)
   ORDER BY b.starts_at, g.starts_at;
END;
$$;

CREATE FUNCTION public.keep_overlap(p_booking_id UUID, p_busy_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = p_booking_id AND pt_user_id = auth.uid())
     OR NOT EXISTS (SELECT 1 FROM public.google_busy_blocks WHERE id = p_busy_id AND pt_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.google_overlap_kept (booking_id, busy_id, pt_user_id)
  VALUES (p_booking_id, p_busy_id, auth.uid())
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_busy_calendars(TEXT[])                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.calendar_overlaps(TIMESTAMPTZ, TIMESTAMPTZ)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.keep_overlap(UUID, UUID)                      FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_busy_calendars(TEXT[])                    TO authenticated;
GRANT  EXECUTE ON FUNCTION public.calendar_overlaps(TIMESTAMPTZ, TIMESTAMPTZ)    TO authenticated;
GRANT  EXECUTE ON FUNCTION public.keep_overlap(UUID, UUID)                      TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (6) Service-role RPCs for apps/web's sync worker.
-- ─────────────────────────────────────────────────────────────────────────────

-- Replaces the PT's busy blocks that start in [p_from, p_to) with p_blocks.
-- Each block: {calendar_id, event_id, title, start, end} for a timed event or
-- {…, start_date, end_date} (end exclusive) for an all-day one. Returns how
-- many blocks the window now holds.
CREATE FUNCTION public.google_replace_busy(p_pt UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_blocks JSONB)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tz    TEXT := public.pt_tz(p_pt);
  v_count INT;
BEGIN
  -- One statement: the delete (rows no longer in Google) and the upsert
  -- (rows still there, ids kept) touch disjoint rows, so they can share it.
  WITH incoming AS (
    SELECT DISTINCT ON (calendar_id, event_id, starts_at) *
      FROM (
        SELECT b->>'calendar_id' AS calendar_id, b->>'event_id' AS event_id,
               NULLIF(left(b->>'title', 200), '') AS title,
               COALESCE((b->>'start')::TIMESTAMPTZ, ((b->>'start_date')::DATE)::TIMESTAMP AT TIME ZONE v_tz) AS starts_at,
               COALESCE((b->>'end')::TIMESTAMPTZ,   ((b->>'end_date')::DATE)::TIMESTAMP AT TIME ZONE v_tz) AS ends_at
          FROM jsonb_array_elements(COALESCE(p_blocks, '[]')) b
      ) x
     WHERE calendar_id IS NOT NULL AND event_id IS NOT NULL
       AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at
  ),
  gone AS (
    DELETE FROM public.google_busy_blocks g
     WHERE g.pt_user_id = p_pt
       AND g.starts_at >= p_from AND g.starts_at < p_to
       AND NOT EXISTS (
         SELECT 1 FROM incoming i
          WHERE i.calendar_id = g.calendar_id AND i.event_id = g.event_id AND i.starts_at = g.starts_at
       )
  )
  INSERT INTO public.google_busy_blocks (pt_user_id, calendar_id, event_id, title, starts_at, ends_at)
  SELECT p_pt, calendar_id, event_id, title, starts_at, ends_at FROM incoming
  ON CONFLICT (pt_user_id, calendar_id, event_id, starts_at) DO UPDATE
    SET title = EXCLUDED.title, ends_at = EXCLUDED.ends_at;

  SELECT count(*) INTO v_count FROM public.google_busy_blocks
   WHERE pt_user_id = p_pt AND starts_at >= p_from AND starts_at < p_to;
  RETURN v_count;
END;
$$;

-- On connect: queue every booking from a day ago to 12 weeks ahead.
CREATE FUNCTION public.google_enqueue_all(p_pt UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO public.google_sync_queue (booking_id, pt_user_id)
  SELECT b.id, b.pt_user_id FROM public.bookings b
   WHERE b.pt_user_id = p_pt
     AND b.starts_at >= NOW() - interval '1 day'
     AND b.starts_at <  NOW() + interval '12 weeks'
  ON CONFLICT (booking_id) DO UPDATE SET queued_at = NOW(), attempts = 0, last_error = NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- What the worker writes to Google (D6). The title rule is also in
-- packages/shared/src/calendar/title.ts (eventTitle) and both are tested.
CREATE FUNCTION public.google_queue_batch(p_pt UUID, p_limit INT)
RETURNS TABLE (
  out_booking_id UUID,
  out_status     TEXT,
  out_starts_at  TIMESTAMPTZ,
  out_ends_at    TIMESTAMPTZ,
  out_timezone   TEXT,
  out_title      TEXT,
  out_attempts   SMALLINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT b.id, b.status::TEXT, b.starts_at, b.ends_at, b.originating_timezone::TEXT,
         'Forge · ' || CASE
           WHEN c.client_user_id IS NOT NULL AND c.client_user_id = c.pt_user_id THEN 'Me'
           ELSE COALESCE(NULLIF(split_part(btrim(COALESCE(u.display_name, c.invite_name, '')), ' ', 1), ''), 'Session')
         END,
         q.attempts
    FROM public.google_sync_queue q
    JOIN public.bookings b ON b.id = q.booking_id
    LEFT JOIN public.clients c ON c.id = b.client_id
    LEFT JOIN public.users u ON u.id = c.client_user_id
   WHERE q.pt_user_id = p_pt AND q.attempts < 5
   ORDER BY q.queued_at
   LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.google_replace_busy(UUID, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.google_enqueue_all(UUID)                                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.google_queue_batch(UUID, INT)                             FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.google_replace_busy(UUID, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) TO service_role;
GRANT  EXECUTE ON FUNCTION public.google_enqueue_all(UUID)                                  TO service_role;
GRANT  EXECUTE ON FUNCTION public.google_queue_batch(UUID, INT)                             TO service_role;

COMMIT;

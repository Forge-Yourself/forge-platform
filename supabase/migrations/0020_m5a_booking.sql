-- =============================================================================
-- 0020 · M5a booking core.
--
-- A PT publishes hours; a PT or a client books; both read their schedule.
-- Spec: docs/superpowers/specs/2026-10-11-m5a-booking-core-design.md.
--
--   1. booking_rules, availability_exceptions — the two things schedules
--      (0001) has nowhere to hold. Weekly ranges stay in schedules, one row
--      per range, so a break is just the gap between two rows (spec D1).
--   2. bookings gains length_min, created_by_user_id and the late-cancel
--      columns, and an exclusion constraint: two live bookings for one PT can
--      never overlap, however the requests race (D7).
--   3. SELECT-only RLS on all four tables. Every write is an RPC below.
--   4. All time arithmetic lives here. Bookings store UTC plus the PT's zone;
--      local wall time is converted per occurrence, so a 10:30 weekly series
--      stays 10:30 across DST and its UTC shifts (D4, D5, D6). The app never
--      converts between zones.
--   5. start_workout_session links the booking a session fulfils, and
--      complete_workout_session completes it. Same signatures as 0016, so the
--      M4b outbox replays them unchanged (plan correction to D11).
--
-- Errors are raised as bare tokens (slot_taken, inside_cutoff, …) that
-- packages/shared/src/schedule/errors.ts maps to copy. 'not authorized' keeps
-- 0015's wording and ERRCODE.
--
-- Reschedules are audited as booking_create with details.rescheduled_from:
-- audit_logs is partitioned, and a new verb would rewrite the CHECK on every
-- partition.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) Tables
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.booking_rules (
  pt_user_id   UUID        NOT NULL,
  lengths_min  SMALLINT[]  NOT NULL DEFAULT '{45,60,90}',
  buffer_min   SMALLINT    NOT NULL DEFAULT 15,
  window_weeks SMALLINT    NOT NULL DEFAULT 4,
  cutoff_hours SMALLINT    NOT NULL DEFAULT 12,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_booking_rules PRIMARY KEY (pt_user_id),
  CONSTRAINT fk_booking_rules_pt FOREIGN KEY (pt_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT chk_br_lengths CHECK (cardinality(lengths_min) BETWEEN 1 AND 4 AND lengths_min <@ '{30,45,60,90}'::SMALLINT[]),
  CONSTRAINT chk_br_buffer  CHECK (buffer_min BETWEEN 0 AND 60),
  CONSTRAINT chk_br_window  CHECK (window_weeks BETWEEN 1 AND 12),
  CONSTRAINT chk_br_cutoff  CHECK (cutoff_hours BETWEEN 0 AND 48)
);

-- 'off' empties the day; 'extra' ADDS ranges to the day's weekly hours.
CREATE TABLE public.availability_exceptions (
  id          UUID        NOT NULL DEFAULT uuid_v7(),
  pt_user_id  UUID        NOT NULL,
  on_date     DATE        NOT NULL,
  kind        VARCHAR(10) NOT NULL,
  ranges      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_availability_exceptions PRIMARY KEY (id),
  CONSTRAINT fk_ax_pt FOREIGN KEY (pt_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT uq_ax_pt_date UNIQUE (pt_user_id, on_date),
  CONSTRAINT chk_ax_kind CHECK (kind IN ('off', 'extra')),
  CONSTRAINT chk_ax_ranges CHECK (
    (kind = 'off' AND ranges IS NULL)
    OR (kind = 'extra' AND jsonb_typeof(ranges) = 'array' AND jsonb_array_length(ranges) > 0)
  )
);

ALTER TABLE public.bookings
  ADD COLUMN length_min         SMALLINT,
  ADD COLUMN created_by_user_id UUID,
  ADD COLUMN cancel_late        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN cancel_counted     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN cancel_reason      TEXT,
  ADD CONSTRAINT fk_bookings_created_by FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT chk_bookings_length CHECK (length_min IS NULL OR length_min IN (30, 45, 60, 90)),
  ADD CONSTRAINT ex_bookings_pt_overlap EXCLUDE USING gist (
    pt_user_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status <> 'cancelled');

CREATE INDEX idx_bookings_parent ON public.bookings (parent_booking_id) WHERE parent_booking_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) RLS — SELECT only. Clients never read raw hours or rules; they see slots
-- through open_slots and the policy through booking_policy.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.booking_rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY schedules_select ON public.schedules
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY booking_rules_select ON public.booking_rules
  FOR SELECT TO authenticated
  USING (pt_user_id = auth.uid() OR public.is_admin());

CREATE POLICY availability_exceptions_select ON public.availability_exceptions
  FOR SELECT TO authenticated
  USING (pt_user_id = auth.uid() OR public.is_admin());

CREATE POLICY bookings_select ON public.bookings
  FOR SELECT TO authenticated
  USING (
    pt_user_id = auth.uid()
    OR (client_id IS NOT NULL AND public.is_client_record_owner(client_id))
    OR public.is_admin()
  );

REVOKE INSERT, UPDATE, DELETE ON public.schedules               FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.booking_rules           FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.availability_exceptions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.bookings                FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (3) Internal helpers. Called only from the SECURITY DEFINER RPCs below.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.rules_for(p_pt UUID)
RETURNS public.booking_rules
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    (SELECT r FROM public.booking_rules r WHERE r.pt_user_id = p_pt),
    ROW(p_pt, '{45,60,90}'::SMALLINT[], 15::SMALLINT, 4::SMALLINT, 12::SMALLINT, NOW())::public.booking_rules
  );
$$;

CREATE FUNCTION public.pt_tz(p_pt UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE((SELECT timezone FROM public.users WHERE id = p_pt), 'Asia/Beirut');
$$;

-- The day's bookable windows as instants: weekly ranges unless the day is off,
-- plus any extra ranges. date + time is a local timestamp; AT TIME ZONE turns
-- it into the instant that wall time names in p_tz.
CREATE FUNCTION public.day_windows(p_pt UUID, p_date DATE, p_tz TEXT)
RETURNS TABLE (w_start TIMESTAMPTZ, w_end TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT (p_date + s.start_time) AT TIME ZONE p_tz, (p_date + s.end_time) AT TIME ZONE p_tz
    FROM public.schedules s
   WHERE s.user_id = p_pt
     AND s.is_active
     AND s.day_of_week = EXTRACT(DOW FROM p_date)::INT
     AND NOT EXISTS (
       SELECT 1 FROM public.availability_exceptions x
        WHERE x.pt_user_id = p_pt AND x.on_date = p_date AND x.kind = 'off'
     )
  UNION ALL
  SELECT (p_date + (r->>'start')::TIME) AT TIME ZONE p_tz, (p_date + (r->>'end')::TIME) AT TIME ZONE p_tz
    FROM public.availability_exceptions x, jsonb_array_elements(x.ranges) r
   WHERE x.pt_user_id = p_pt AND x.on_date = p_date AND x.kind = 'extra';
$$;

-- Every occurrence of a series at the same LOCAL time. after_offset_change
-- marks the first occurrence after a UTC-offset change (DST), which is where
-- the create screen draws its warning.
CREATE FUNCTION public.series_occurrences(
  p_start       TIMESTAMPTZ,
  p_tz          TEXT,
  p_every_weeks SMALLINT,
  p_count       SMALLINT,
  p_until       DATE
)
RETURNS TABLE (n SMALLINT, occ_start TIMESTAMPTZ, after_offset_change BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_local  TIMESTAMP := p_start AT TIME ZONE p_tz;
  v_i      INT := 0;
  v_occ    TIMESTAMP;
  v_offset INTERVAL;
  v_prev   INTERVAL;
BEGIN
  IF p_every_weeks IS NULL THEN
    n := 1;
    occ_start := p_start;
    after_offset_change := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_every_weeks NOT IN (1, 2) OR (p_count IS NULL) = (p_until IS NULL) THEN
    RAISE EXCEPTION 'bad_repeat';
  END IF;
  IF p_count IS NOT NULL AND (p_count < 2 OR p_count > 26) THEN
    RAISE EXCEPTION 'series_too_long';
  END IF;
  IF p_until IS NOT NULL AND (p_until < v_local::DATE OR p_until > v_local::DATE + 181) THEN
    RAISE EXCEPTION 'series_too_long';
  END IF;

  LOOP
    v_occ := v_local + make_interval(weeks => v_i * p_every_weeks);
    EXIT WHEN v_i >= 26
      OR (p_count IS NOT NULL AND v_i >= p_count)
      OR (p_until IS NOT NULL AND v_occ::DATE > p_until);
    v_i := v_i + 1;
    n := v_i;
    occ_start := v_occ AT TIME ZONE p_tz;
    v_offset := v_occ - (occ_start AT TIME ZONE 'UTC');
    after_offset_change := v_prev IS NOT NULL AND v_offset <> v_prev;
    v_prev := v_offset;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rules_for(UUID)                                              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pt_tz(UUID)                                                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.day_windows(UUID, DATE, TEXT)                                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.series_occurrences(TIMESTAMPTZ, TEXT, SMALLINT, SMALLINT, DATE) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (4) save_availability — the design's "three tabs, one Save" (D1).
--
-- Replaces the caller's weekly ranges and every exception from today on (past
-- exceptions are history and stay), upserts the rules, and returns the future
-- scheduled bookings that now fall outside the hours. Those bookings are NOT
-- touched: the Exceptions tab flags them and the PT decides.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.save_availability(p_hours JSONB, p_exceptions JSONB, p_rules JSONB)
RETURNS TABLE (out_booking_id UUID, out_starts_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tz TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'pt') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  v_tz := public.pt_tz(auth.uid());

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_hours, '[]'::jsonb)) h
     WHERE (h->>'dow')::INT NOT BETWEEN 0 AND 6 OR (h->>'end')::TIME <= (h->>'start')::TIME
  ) THEN
    RAISE EXCEPTION 'bad_range';
  END IF;
  -- WITH ORDINALITY gives each range an identity, so two identical ranges on
  -- one day count as overlapping too (validateHours in rules.ts agrees).
  IF EXISTS (
    WITH r AS (
      SELECT t.i, (t.h->>'dow')::INT AS dow, (t.h->>'start')::TIME AS s, (t.h->>'end')::TIME AS e
        FROM jsonb_array_elements(COALESCE(p_hours, '[]'::jsonb)) WITH ORDINALITY AS t(h, i)
    )
    SELECT 1 FROM r a JOIN r b ON a.dow = b.dow AND a.i < b.i AND a.s < b.e AND b.s < a.e
  ) THEN
    RAISE EXCEPTION 'overlapping_hours';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_exceptions, '[]'::jsonb)) x,
                  jsonb_array_elements(COALESCE(x->'ranges', '[]'::jsonb)) r
     WHERE (r->>'end')::TIME <= (r->>'start')::TIME
  ) THEN
    RAISE EXCEPTION 'bad_range';
  END IF;

  DELETE FROM public.schedules WHERE user_id = auth.uid();
  INSERT INTO public.schedules (user_id, day_of_week, start_time, end_time, timezone)
  SELECT auth.uid(), (h->>'dow')::INT, (h->>'start')::TIME, (h->>'end')::TIME, v_tz
    FROM jsonb_array_elements(COALESCE(p_hours, '[]'::jsonb)) h;

  DELETE FROM public.availability_exceptions WHERE pt_user_id = auth.uid() AND on_date >= CURRENT_DATE;
  INSERT INTO public.availability_exceptions (pt_user_id, on_date, kind, ranges)
  SELECT auth.uid(), (x->>'date')::DATE, x->>'kind', CASE WHEN x->>'kind' = 'extra' THEN x->'ranges' END
    FROM jsonb_array_elements(COALESCE(p_exceptions, '[]'::jsonb)) x
   WHERE (x->>'date')::DATE >= CURRENT_DATE;

  INSERT INTO public.booking_rules (pt_user_id, lengths_min, buffer_min, window_weeks, cutoff_hours, updated_at)
  VALUES (
    auth.uid(),
    ARRAY(SELECT jsonb_array_elements_text(p_rules->'lengths')::SMALLINT ORDER BY 1),
    (p_rules->>'buffer')::SMALLINT,
    (p_rules->>'window')::SMALLINT,
    (p_rules->>'cutoff')::SMALLINT,
    NOW()
  )
  ON CONFLICT (pt_user_id) DO UPDATE
    SET lengths_min = EXCLUDED.lengths_min, buffer_min = EXCLUDED.buffer_min,
        window_weeks = EXCLUDED.window_weeks, cutoff_hours = EXCLUDED.cutoff_hours, updated_at = NOW();

  RETURN QUERY
  SELECT b.id, b.starts_at
    FROM public.bookings b
   WHERE b.pt_user_id = auth.uid() AND b.status = 'scheduled' AND b.starts_at > NOW()
     AND NOT EXISTS (
       SELECT 1 FROM public.day_windows(auth.uid(), (b.starts_at AT TIME ZONE v_tz)::DATE, v_tz) w
        WHERE w.w_start <= b.starts_at AND b.ends_at <= w.w_end
     )
   ORDER BY b.starts_at;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (5) Reads for the app.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.booking_policy(p_pt UUID)
RETURNS TABLE (lengths_min SMALLINT[], buffer_min SMALLINT, window_weeks SMALLINT, cutoff_hours SMALLINT, timezone TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_r public.booking_rules;
BEGIN
  IF NOT (
    p_pt = auth.uid()
    OR public.is_admin()
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.pt_user_id = p_pt AND c.client_user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  v_r := public.rules_for(p_pt);
  lengths_min := v_r.lengths_min;
  buffer_min := v_r.buffer_min;
  window_weeks := v_r.window_weeks;
  cutoff_hours := v_r.cutoff_hours;
  timezone := public.pt_tz(p_pt);
  RETURN NEXT;
END;
$$;

CREATE FUNCTION public.pt_day_windows(p_from DATE, p_to DATE)
RETURNS TABLE (win_date DATE, win_start TIMESTAMPTZ, win_end TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tz  TEXT;
  v_day DATE := p_from;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'pt') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_to < p_from OR p_to - p_from > 41 THEN
    RAISE EXCEPTION 'range_too_long';
  END IF;
  v_tz := public.pt_tz(auth.uid());
  WHILE v_day <= p_to LOOP
    RETURN QUERY SELECT v_day, w.w_start, w.w_end FROM public.day_windows(auth.uid(), v_day, v_tz) w ORDER BY w.w_start;
    v_day := v_day + 1;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (6) open_slots — the single authority on what can be booked (D2, D3).
--
-- Inside each window, candidates start at the window start (or the next
-- quarter-hour after now) and step by length + buffer; a candidate that would
-- overlap a live booking ± buffer jumps to that booking's end + buffer. That
-- packs the day the way the design's grid shows (08:15, 09:30 …) instead of
-- leaving 15-minute crumbs. p_ignore lets a reschedule look past the booking
-- being moved.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.open_slots(p_pt UUID, p_from DATE, p_to DATE, p_length SMALLINT, p_ignore UUID DEFAULT NULL)
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
-- (7) preview_series — the create screen's list of dates and DST flag (D6).
-- conflict = overlaps a live booking (no buffer: a PT booking only has to not
-- overlap, see plan Corrections).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.preview_series(
  p_start       TIMESTAMPTZ,
  p_length      SMALLINT,
  p_every_weeks SMALLINT,
  p_count       SMALLINT,
  p_until       DATE
)
RETURNS TABLE (n SMALLINT, occ_start TIMESTAMPTZ, after_offset_change BOOLEAN, conflict BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'pt') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT o.n, o.occ_start, o.after_offset_change,
         EXISTS (
           SELECT 1 FROM public.bookings b
            WHERE b.pt_user_id = auth.uid() AND b.status <> 'cancelled'
              AND b.starts_at < o.occ_start + make_interval(mins => p_length)
              AND b.ends_at > o.occ_start
         )
    FROM public.series_occurrences(p_start, public.pt_tz(auth.uid()), p_every_weeks, p_count, p_until) o
   ORDER BY o.n;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (8) create_booking — idempotent by the app's id (D12).
--
-- A PT books any active/accepted client of theirs, including their own self
-- row, one-off or as a series, inside or outside published hours (overlap is
-- the only hard rule). A client books themselves, one session, and only a
-- start open_slots returns. A series is all-or-nothing: the exclusion
-- violation of any occurrence rolls back the whole subtransaction.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.create_booking(
  p_id          UUID,
  p_client_id   UUID,
  p_starts_at   TIMESTAMPTZ,
  p_length      SMALLINT,
  p_every_weeks SMALLINT DEFAULT NULL,
  p_count       SMALLINT DEFAULT NULL,
  p_until       DATE     DEFAULT NULL
)
RETURNS SETOF public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_client public.clients;
  v_is_pt  BOOLEAN;
  v_tz     TEXT;
  v_rules  public.booking_rules;
  v_day    DATE;
  v_rule   TEXT;
  v_total  INT := 1;
  v_occ    RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = p_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = p_id AND created_by_user_id = auth.uid()) THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT * FROM public.bookings WHERE id = p_id OR parent_booking_id = p_id ORDER BY starts_at;
    RETURN;
  END IF;

  v_is_pt := public.is_pt_of_client(p_client_id);
  IF NOT (v_is_pt OR public.is_client_record_owner(p_client_id)) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
  IF v_client.state NOT IN ('active', 'accepted') THEN
    RAISE EXCEPTION 'client_not_bookable';
  END IF;

  v_tz    := public.pt_tz(v_client.pt_user_id);
  v_rules := public.rules_for(v_client.pt_user_id);

  IF p_starts_at <= NOW() THEN
    RAISE EXCEPTION 'in_past';
  END IF;
  IF NOT (p_length = ANY (v_rules.lengths_min)) THEN
    RAISE EXCEPTION 'length_not_offered';
  END IF;

  IF NOT v_is_pt THEN
    IF p_every_weeks IS NOT NULL THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    IF p_starts_at > NOW() + make_interval(weeks => v_rules.window_weeks) THEN
      RAISE EXCEPTION 'outside_window';
    END IF;
    v_day := (p_starts_at AT TIME ZONE v_tz)::DATE;
    IF NOT EXISTS (
      SELECT 1 FROM public.open_slots(v_client.pt_user_id, v_day, v_day, p_length) s WHERE s.slot_start = p_starts_at
    ) THEN
      IF EXISTS (
        SELECT 1 FROM public.bookings b
         WHERE b.pt_user_id = v_client.pt_user_id AND b.status <> 'cancelled'
           AND b.starts_at < p_starts_at + make_interval(mins => p_length + v_rules.buffer_min)
           AND b.ends_at + make_interval(mins => v_rules.buffer_min) > p_starts_at
      ) THEN
        RAISE EXCEPTION 'slot_taken';
      END IF;
      RAISE EXCEPTION 'outside_hours';
    END IF;
  END IF;

  IF p_every_weeks IS NOT NULL THEN
    SELECT count(*) INTO v_total FROM public.series_occurrences(p_starts_at, v_tz, p_every_weeks, p_count, p_until);
    v_rule := format('FREQ=WEEKLY;INTERVAL=%s;COUNT=%s', p_every_weeks, v_total);
  END IF;

  BEGIN
    FOR v_occ IN SELECT * FROM public.series_occurrences(p_starts_at, v_tz, p_every_weeks, p_count, p_until) LOOP
      INSERT INTO public.bookings (
        id, pt_user_id, client_id, status, starts_at, ends_at, originating_timezone,
        recurrence_rule, parent_booking_id, length_min, created_by_user_id
      )
      VALUES (
        CASE WHEN v_occ.n = 1 THEN p_id ELSE uuid_v7() END,
        v_client.pt_user_id, p_client_id, 'scheduled',
        v_occ.occ_start, v_occ.occ_start + make_interval(mins => p_length), v_tz,
        v_rule, CASE WHEN v_occ.n = 1 THEN NULL ELSE p_id END, p_length, auth.uid()
      );
    END LOOP;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_taken';
  END;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), v_client.client_user_id, 'booking_create', 'booking', p_id,
          jsonb_build_object('occurrences', v_total, 'length_min', p_length,
                             'by', CASE WHEN v_is_pt THEN 'pt' ELSE 'client' END));

  RETURN QUERY SELECT * FROM public.bookings WHERE id = p_id OR parent_booking_id = p_id ORDER BY starts_at;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (9) reschedule_booking — D10.
--
-- The change is a LOCAL-time delta, applied to each row in the PT's zone, so
-- "this and following" keeps a series on its wall-clock time across DST.
-- Rows are moved in the direction of travel (latest first when moving later)
-- so a shift larger than the series spacing never collides with a sibling
-- that hasn't moved yet.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.reschedule_booking(p_id UUID, p_new_start TIMESTAMPTZ, p_scope TEXT DEFAULT 'one')
RETURNS SETOF public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_b      public.bookings;
  v_is_pt  BOOLEAN;
  v_rules  public.booking_rules;
  v_tz     TEXT;
  v_delta  INTERVAL;
  v_series UUID;
  v_ids    UUID[];
  v_id     UUID;
  v_day    DATE;
BEGIN
  IF p_scope NOT IN ('one', 'following') THEN
    RAISE EXCEPTION 'bad_repeat';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = p_id FOR UPDATE;
  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  v_is_pt := v_b.pt_user_id = auth.uid();
  IF NOT v_is_pt AND NOT (v_b.client_id IS NOT NULL AND public.is_client_record_owner(v_b.client_id)) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_b.status <> 'scheduled' THEN
    RAISE EXCEPTION 'booking_closed';
  END IF;

  v_rules := public.rules_for(v_b.pt_user_id);
  v_tz    := v_b.originating_timezone;

  IF NOT v_is_pt THEN
    IF p_scope <> 'one' THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    IF v_b.starts_at - make_interval(hours => v_rules.cutoff_hours) <= NOW() THEN
      RAISE EXCEPTION 'inside_cutoff';
    END IF;
  END IF;
  IF p_new_start <= NOW() THEN
    RAISE EXCEPTION 'in_past';
  END IF;
  IF NOT v_is_pt THEN
    IF p_new_start > NOW() + make_interval(weeks => v_rules.window_weeks) THEN
      RAISE EXCEPTION 'outside_window';
    END IF;
    v_day := (p_new_start AT TIME ZONE v_tz)::DATE;
    IF NOT EXISTS (
      SELECT 1 FROM public.open_slots(v_b.pt_user_id, v_day, v_day, v_b.length_min, p_id) s WHERE s.slot_start = p_new_start
    ) THEN
      RAISE EXCEPTION 'slot_taken';
    END IF;
  END IF;

  v_delta  := (p_new_start AT TIME ZONE v_tz) - (v_b.starts_at AT TIME ZONE v_tz);
  v_series := COALESCE(v_b.parent_booking_id, v_b.id);

  SELECT array_agg(id ORDER BY CASE WHEN v_delta > interval '0' THEN starts_at END DESC NULLS LAST, starts_at ASC)
    INTO v_ids
    FROM public.bookings
   WHERE (p_scope = 'one' AND id = p_id)
      OR (p_scope = 'following' AND COALESCE(parent_booking_id, id) = v_series
          AND starts_at >= v_b.starts_at AND status = 'scheduled');

  BEGIN
    FOREACH v_id IN ARRAY v_ids LOOP
      UPDATE public.bookings
         SET starts_at  = ((starts_at AT TIME ZONE v_tz) + v_delta) AT TIME ZONE v_tz,
             ends_at    = (((starts_at AT TIME ZONE v_tz) + v_delta) AT TIME ZONE v_tz) + (ends_at - starts_at),
             updated_at = NOW()
       WHERE id = v_id;
    END LOOP;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_taken';
  END;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), c.client_user_id, 'booking_create', 'booking', p_id,
         jsonb_build_object('rescheduled_from', v_b.starts_at, 'scope', p_scope, 'count', cardinality(v_ids))
    FROM public.clients c WHERE c.id = v_b.client_id;

  RETURN QUERY SELECT * FROM public.bookings WHERE id = ANY (v_ids) ORDER BY starts_at;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (10) cancel_booking — D8. Late = the cutoff has been reached (<=), the same
-- instant the app's canClientChange() turns false. Only the row the caller
-- pressed can be late; "following" rows are ordinary cancellations.
-- Idempotent on an already-cancelled booking.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.cancel_booking(
  p_id      UUID,
  p_scope   TEXT    DEFAULT 'one',
  p_counted BOOLEAN DEFAULT NULL,
  p_reason  TEXT    DEFAULT NULL
)
RETURNS SETOF public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_b      public.bookings;
  v_is_pt  BOOLEAN;
  v_late   BOOLEAN;
  v_series UUID;
  v_ids    UUID[];
BEGIN
  IF p_scope NOT IN ('one', 'following') THEN
    RAISE EXCEPTION 'bad_repeat';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = p_id FOR UPDATE;
  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  v_is_pt := v_b.pt_user_id = auth.uid();
  IF NOT v_is_pt AND NOT (v_b.client_id IS NOT NULL AND public.is_client_record_owner(v_b.client_id)) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF v_b.status = 'cancelled' THEN
    RETURN QUERY SELECT * FROM public.bookings WHERE id = p_id;
    RETURN;
  END IF;
  IF v_b.status <> 'scheduled' THEN
    RAISE EXCEPTION 'booking_closed';
  END IF;

  v_late := v_b.starts_at - make_interval(hours => (public.rules_for(v_b.pt_user_id)).cutoff_hours) <= NOW();

  IF NOT v_is_pt THEN
    IF p_scope <> 'one' THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    IF v_late THEN
      RAISE EXCEPTION 'inside_cutoff';
    END IF;
  END IF;

  v_series := COALESCE(v_b.parent_booking_id, v_b.id);
  SELECT array_agg(id) INTO v_ids
    FROM public.bookings
   WHERE id = p_id
      OR (p_scope = 'following' AND COALESCE(parent_booking_id, id) = v_series
          AND starts_at > v_b.starts_at AND status = 'scheduled');

  UPDATE public.bookings
     SET status         = 'cancelled',
         cancelled_at   = NOW(),
         cancelled_by   = CASE WHEN v_is_pt THEN 'pt' ELSE 'client' END,
         cancel_late    = (id = p_id AND v_late),
         cancel_counted = (id = p_id AND v_late AND v_is_pt AND COALESCE(p_counted, TRUE)),
         cancel_reason  = NULLIF(btrim(p_reason), ''),
         updated_at     = NOW()
   WHERE id = ANY (v_ids);

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), c.client_user_id, 'booking_cancel', 'booking', p_id,
         jsonb_build_object('late', v_late, 'counted', v_late AND v_is_pt AND COALESCE(p_counted, TRUE),
                            'scope', p_scope, 'count', cardinality(v_ids))
    FROM public.clients c WHERE c.id = v_b.client_id;

  RETURN QUERY SELECT * FROM public.bookings WHERE id = ANY (v_ids) ORDER BY starts_at;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (11) mark_no_show — D9. PT only, from 15 minutes after the start, and never
-- once a session has been started against the booking.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.mark_no_show(p_id UUID)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_b public.bookings;
BEGIN
  SELECT * INTO v_b FROM public.bookings WHERE id = p_id FOR UPDATE;
  IF v_b.id IS NULL OR v_b.pt_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_b.status = 'no_show' THEN
    RETURN v_b;
  END IF;
  IF EXISTS (SELECT 1 FROM public.workout_sessions WHERE booking_id = p_id) THEN
    RAISE EXCEPTION 'session_started';
  END IF;
  IF v_b.status <> 'scheduled' THEN
    RAISE EXCEPTION 'booking_closed';
  END IF;
  IF NOW() < v_b.starts_at + interval '15 minutes' THEN
    RAISE EXCEPTION 'too_early_for_no_show';
  END IF;

  UPDATE public.bookings
     SET status = 'no_show', no_show_marked_at = NOW(), updated_at = NOW()
   WHERE id = p_id
   RETURNING * INTO v_b;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), c.client_user_id, 'booking_no_show', 'booking', p_id, '{}'::jsonb
    FROM public.clients c WHERE c.id = v_b.client_id;

  RETURN v_b;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (12) Sessions fulfil bookings. 0016's bodies, plus the marked blocks only.
-- Same signatures, so CREATE OR REPLACE keeps the grants and the M4b outbox
-- replays these exactly as before.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_workout_session(
  p_client_id      UUID,
  p_program_day_id UUID        DEFAULT NULL,
  p_id             UUID        DEFAULT NULL,
  p_started_at     TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.workout_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_is_pt       BOOLEAN;
  v_is_client   BOOLEAN;
  v_row         public.workout_sessions;
  v_day_label   TEXT;
  v_day_number  SMALLINT;
  v_week_number SMALLINT;
  v_started     TIMESTAMPTZ;
  v_booking     UUID;
BEGIN
  v_is_pt     := public.is_pt_of_client(p_client_id);
  v_is_client := public.is_client_record_owner(p_client_id);
  IF NOT (v_is_pt OR v_is_client) THEN
    RAISE EXCEPTION 'not authorized for this client';
  END IF;

  PERFORM 1 FROM public.clients WHERE id = p_client_id FOR UPDATE;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.workout_sessions WHERE id = p_id;
    IF v_row.id IS NOT NULL THEN
      IF v_row.client_id <> p_client_id THEN
        RAISE EXCEPTION 'session id belongs to another client' USING ERRCODE = '42501';
      END IF;
      RETURN v_row;
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.workout_sessions
   WHERE client_id = p_client_id AND status = 'in_progress'
   ORDER BY started_at DESC
   LIMIT 1
   FOR UPDATE;
  IF v_row.id IS NOT NULL THEN
    RETURN v_row;
  END IF;

  IF p_program_day_id IS NOT NULL THEN
    SELECT d.label, d.day_number, w.week_number
      INTO v_day_label, v_day_number, v_week_number
      FROM public.program_days d
      JOIN public.program_weeks w ON w.id = d.week_id
      JOIN public.programs p ON p.id = d.program_id
     WHERE d.id = p_program_day_id AND p.client_id = p_client_id
       AND p.state IN ('active', 'completed');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'program day does not belong to this client';
    END IF;
  END IF;

  v_started := LEAST(NOW(), GREATEST(NOW() - interval '24 hours', COALESCE(p_started_at, NOW())));

  -- M5a: the scheduled booking this session fulfils — the nearest whose
  -- [start − 30 min, end] contains the session's start and has no session yet.
  SELECT b.id INTO v_booking
    FROM public.bookings b
   WHERE b.client_id = p_client_id AND b.status = 'scheduled'
     AND v_started BETWEEN b.starts_at - interval '30 minutes' AND b.ends_at
     AND NOT EXISTS (SELECT 1 FROM public.workout_sessions o WHERE o.booking_id = b.id)
   ORDER BY abs(EXTRACT(EPOCH FROM (b.starts_at - v_started)))
   LIMIT 1;

  INSERT INTO public.workout_sessions (
    id, client_id, logged_by_user_id, program_day_id, status, scheduled_date, started_at, is_pt_led,
    day_label, day_number, week_number, booking_id
  )
  VALUES (
    COALESCE(p_id, uuid_v7()), p_client_id, auth.uid(), p_program_day_id, 'in_progress', v_started::DATE, v_started, v_is_pt,
    v_day_label, v_day_number, v_week_number, v_booking
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), c.client_user_id, 'workout_start', 'workout_session', v_row.id,
         jsonb_build_object('is_pt_led', v_is_pt, 'program_day_id', p_program_day_id,
                            'client_generated_id', p_id IS NOT NULL, 'booking_id', v_booking)
    FROM public.clients c WHERE c.id = p_client_id;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_workout_session(
  p_session_id   UUID,
  p_rating       INTEGER     DEFAULT NULL,
  p_notes        TEXT        DEFAULT NULL,
  p_completed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.workout_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row       public.workout_sessions;
  v_is_pt     BOOLEAN;
  v_started   TIMESTAMPTZ;
  v_completed TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_row FROM public.workout_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'session not found';
  END IF;

  v_is_pt := public.is_pt_of_client(v_row.client_id);
  IF NOT (v_is_pt OR (public.is_client_record_owner(v_row.client_id) AND v_row.is_pt_led = FALSE)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF v_row.status = 'completed' THEN
    RETURN v_row;
  END IF;

  v_started   := COALESCE(v_row.started_at, v_row.created_at);
  v_completed := LEAST(NOW(), GREATEST(v_started, NOW() - interval '24 hours', COALESCE(p_completed_at, NOW())));

  UPDATE public.workout_sessions
     SET status = 'completed',
         completed_at = v_completed,
         duration_min = LEAST(32767, GREATEST(1, ROUND(EXTRACT(EPOCH FROM (v_completed - v_started)) / 60)))::SMALLINT,
         rating = p_rating::SMALLINT,
         pt_notes = CASE WHEN v_is_pt THEN p_notes ELSE pt_notes END,
         session_notes = CASE WHEN v_is_pt THEN session_notes ELSE p_notes END,
         updated_at = NOW()
   WHERE id = p_session_id
   RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), c.client_user_id, 'workout_complete', 'workout_session', v_row.id,
         jsonb_build_object('duration_min', v_row.duration_min, 'rating', v_row.rating)
    FROM public.clients c WHERE c.id = v_row.client_id;

  -- M5a: completing the session completes the booking it fulfilled.
  IF v_row.booking_id IS NOT NULL THEN
    UPDATE public.bookings SET status = 'completed', updated_at = NOW()
     WHERE id = v_row.booking_id AND status = 'scheduled';
    IF FOUND THEN
      INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
      SELECT auth.uid(), c.client_user_id, 'booking_complete', 'booking', v_row.booking_id,
             jsonb_build_object('workout_session_id', v_row.id)
        FROM public.clients c WHERE c.id = v_row.client_id;
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (13) Grants
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.save_availability(JSONB, JSONB, JSONB)                                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.booking_policy(UUID)                                                        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pt_day_windows(DATE, DATE)                                                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.open_slots(UUID, DATE, DATE, SMALLINT, UUID)                                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.preview_series(TIMESTAMPTZ, SMALLINT, SMALLINT, SMALLINT, DATE)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_booking(UUID, UUID, TIMESTAMPTZ, SMALLINT, SMALLINT, SMALLINT, DATE) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reschedule_booking(UUID, TIMESTAMPTZ, TEXT)                                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT, BOOLEAN, TEXT)                                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_no_show(UUID)                                                          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.save_availability(JSONB, JSONB, JSONB)                                      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.booking_policy(UUID)                                                        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.pt_day_windows(DATE, DATE)                                                  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.open_slots(UUID, DATE, DATE, SMALLINT, UUID)                                TO authenticated;
GRANT  EXECUTE ON FUNCTION public.preview_series(TIMESTAMPTZ, SMALLINT, SMALLINT, SMALLINT, DATE)             TO authenticated;
GRANT  EXECUTE ON FUNCTION public.create_booking(UUID, UUID, TIMESTAMPTZ, SMALLINT, SMALLINT, SMALLINT, DATE) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.reschedule_booking(UUID, TIMESTAMPTZ, TEXT)                                 TO authenticated;
GRANT  EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT, BOOLEAN, TEXT)                                   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_no_show(UUID)                                                          TO authenticated;

COMMIT;

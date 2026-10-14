-- =============================================================================
-- 0021 · M5b check-in.
--
-- A PT shows a rotating code; the client scans or types it and is checked in;
-- a second scan, the PT, or completing the logged session checks them out.
-- The client rates the session; the booking carries the amount the PT
-- recorded and, once completed, a receipt number. Reminder choices are saved
-- but nothing is sent yet.
-- Spec: docs/superpowers/specs/2026-10-11-m5b-check-in-design.md.
--
--   1. booking_checkin_keys — one random secret per booking, readable by no
--      role but this file's functions. The PT's app fetches its own through
--      checkin_keys() and caches them, so the code renders with no signal (D2).
--   2. The code is HMAC-SHA256(secret, "<booking>:<minute>") truncated to six
--      digits RFC 4226-style (D1). packages/shared/src/checkin/code.ts computes
--      the same digits; both sides test one shared vector.
--   3. check_in() is the only way in: a client with a QR (booking + minute +
--      code) or typed digits, or the booking's PT by hand (D4). Device time is
--      trusted inside 24 h so an offline scan verifies on replay (D5).
--   4. scheduled → checked_in → completed (D6). checked_out is not used as a
--      booking status; check_ins.checked_out_at records the moment.
--   5. Rating, amount and receipt number live on bookings (D7, D8, D9).
--   6. rules_for() and save_availability() are re-created because
--      booking_rules gains price_cents: rules_for's ROW constructor names every
--      column and would fail on the new shape.
--   7. start/complete_workout_session also take checked_in bookings. Same
--      signatures, so the M4b outbox replays them unchanged.
--
-- Errors are bare tokens mapped to copy by packages/shared/src/checkin/errors.ts.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) Tables and columns
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.booking_checkin_keys (
  booking_id UUID        NOT NULL,
  secret     BYTEA       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_booking_checkin_keys PRIMARY KEY (booking_id),
  CONSTRAINT fk_bck_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE,
  CONSTRAINT chk_bck_secret CHECK (octet_length(secret) = 32)
);

CREATE TABLE public.reminder_settings (
  pt_user_id    UUID        NOT NULL,
  client_24h    BOOLEAN     NOT NULL DEFAULT TRUE,
  client_2h     BOOLEAN     NOT NULL DEFAULT FALSE,
  client_change BOOLEAN     NOT NULL DEFAULT TRUE,
  pt_agenda     BOOLEAN     NOT NULL DEFAULT TRUE,
  pt_book       BOOLEAN     NOT NULL DEFAULT TRUE,
  pt_late       BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_reminder_settings PRIMARY KEY (pt_user_id),
  CONSTRAINT fk_rs_pt FOREIGN KEY (pt_user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

ALTER TABLE public.booking_rules
  ADD COLUMN price_cents INTEGER,
  ADD CONSTRAINT chk_br_price CHECK (price_cents IS NULL OR price_cents BETWEEN 0 AND 10000000);

CREATE SEQUENCE public.receipt_no_seq;

ALTER TABLE public.bookings
  ADD COLUMN amount_cents   INTEGER,
  ADD COLUMN currency       CHAR(3)     NOT NULL DEFAULT 'USD',
  ADD COLUMN receipt_no     BIGINT,
  ADD COLUMN rating         SMALLINT,
  ADD COLUMN rating_comment TEXT,
  ADD COLUMN rated_at       TIMESTAMPTZ,
  ADD CONSTRAINT uq_bookings_receipt_no UNIQUE (receipt_no),
  ADD CONSTRAINT chk_bookings_amount CHECK (amount_cents IS NULL OR amount_cents BETWEEN 0 AND 10000000),
  ADD CONSTRAINT chk_bookings_currency CHECK (currency = 'USD'),
  ADD CONSTRAINT chk_bookings_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  ADD CONSTRAINT chk_bookings_rating_comment CHECK (rating_comment IS NULL OR char_length(rating_comment) <= 500);

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) Triggers. A new booking takes the PT's default price (never for the
-- PT's own training); a booking's first completion takes the next receipt
-- number (D8, D9). Both fire inside the SECURITY DEFINER RPCs that write.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.bookings_default_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.amount_cents IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients c WHERE c.id = NEW.client_id AND c.client_user_id = c.pt_user_id
  ) THEN
    NEW.amount_cents := (SELECT r.price_cents FROM public.booking_rules r WHERE r.pt_user_id = NEW.pt_user_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bookings_default_amount
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_default_amount();

CREATE FUNCTION public.bookings_receipt_no()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.receipt_no IS NULL THEN
    NEW.receipt_no := nextval('public.receipt_no_seq');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bookings_receipt_no
  BEFORE UPDATE OF status ON public.bookings
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION public.bookings_receipt_no();

REVOKE EXECUTE ON FUNCTION public.bookings_default_amount() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bookings_receipt_no()     FROM PUBLIC, anon, authenticated;

-- Bookings completed before this migration get numbers in session order.
DO $$
DECLARE
  v_id UUID;
BEGIN
  FOR v_id IN SELECT id FROM public.bookings WHERE status = 'completed' AND receipt_no IS NULL ORDER BY starts_at LOOP
    UPDATE public.bookings SET receipt_no = nextval('public.receipt_no_seq') WHERE id = v_id;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (3) RLS. Keys: no policy, no privilege — only the functions below read
-- them. check_ins: whoever can see the booking. reminder_settings: the PT.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.booking_checkin_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_settings    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_checkin_keys FROM anon, authenticated;

CREATE POLICY check_ins_select ON public.check_ins
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
       WHERE b.id = check_ins.booking_id
         AND (b.pt_user_id = auth.uid() OR (b.client_id IS NOT NULL AND public.is_client_record_owner(b.client_id)))
    )
    OR public.is_admin()
  );

CREATE POLICY reminder_settings_select ON public.reminder_settings
  FOR SELECT TO authenticated
  USING (pt_user_id = auth.uid() OR public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON public.check_ins         FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.reminder_settings FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (4) The code (D1). IMMUTABLE and internal; the harness and code.test.ts
-- both pin the same three outputs.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.checkin_code(p_secret BYTEA, p_booking UUID, p_window BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_mac BYTEA;
  v_off INT;
  v_bin BIGINT;
BEGIN
  v_mac := hmac(convert_to(lower(p_booking::TEXT) || ':' || p_window::TEXT, 'UTF8'), p_secret, 'sha256');
  v_off := get_byte(v_mac, 31) & 15;
  v_bin := ((get_byte(v_mac, v_off) & 127)::BIGINT << 24)
         | (get_byte(v_mac, v_off + 1)::BIGINT << 16)
         | (get_byte(v_mac, v_off + 2)::BIGINT << 8)
         |  get_byte(v_mac, v_off + 3)::BIGINT;
  RETURN lpad((v_bin % 1000000)::TEXT, 6, '0');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.checkin_code(BYTEA, UUID, BIGINT) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (5) checkin_keys — the PT's own live bookings in a range, minting any
-- missing secret (D2). At most 14 days per call.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.checkin_keys(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (out_booking_id UUID, out_secret_hex TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'pt') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_to < p_from OR p_to - p_from > interval '14 days' THEN
    RAISE EXCEPTION 'range_too_long';
  END IF;

  INSERT INTO public.booking_checkin_keys (booking_id, secret)
  SELECT b.id, gen_random_bytes(32)
    FROM public.bookings b
   WHERE b.pt_user_id = auth.uid() AND b.status IN ('scheduled', 'checked_in')
     AND b.starts_at >= p_from AND b.starts_at < p_to
  ON CONFLICT (booking_id) DO NOTHING;

  RETURN QUERY
  SELECT k.booking_id, encode(k.secret, 'hex')
    FROM public.booking_checkin_keys k
    JOIN public.bookings b ON b.id = k.booking_id
   WHERE b.pt_user_id = auth.uid() AND b.status IN ('scheduled', 'checked_in')
     AND b.starts_at >= p_from AND b.starts_at < p_to
   ORDER BY b.starts_at;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (6) check_in — D3, D4, D5.
--
-- Typed digits (no booking id) search the caller's own bookings whose check-in
-- window holds the scan time, against the current and three previous minutes.
-- A QR names its booking and minute; the minute must be within one of the scan
-- time's. A PT checks their own booking in by hand with no code.
--
-- Order of refusals matters to the copy: someone else's booking is
-- wrong_booking before anything about the code, so the screen never learns
-- whose it was; a stale minute is code_expired before the digits are compared.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.check_in(
  p_booking_id UUID        DEFAULT NULL,
  p_code       TEXT        DEFAULT NULL,
  p_window     BIGINT      DEFAULT NULL,
  p_at         TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (out_booking_id UUID, out_status TEXT, out_checked_in_at TIMESTAMPTZ, out_checked_out_at TIMESTAMPTZ, out_outcome TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_at       TIMESTAMPTZ := LEAST(NOW(), GREATEST(NOW() - interval '24 hours', COALESCE(p_at, NOW())));
  v_w        BIGINT;
  v_id       UUID := p_booking_id;
  v_verified BOOLEAN := FALSE;
  v_b        public.bookings;
  v_is_pt    BOOLEAN;
  v_secret   BYTEA;
  v_ci       public.check_ins;
  v_outcome  TEXT;
BEGIN
  v_w := floor(EXTRACT(EPOCH FROM v_at) / 60)::BIGINT;

  IF v_id IS NULL THEN
    IF p_code IS NULL OR p_code !~ '^[0-9]{6}$' THEN
      RAISE EXCEPTION 'bad_code';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.bookings b JOIN public.clients c ON c.id = b.client_id
       WHERE c.client_user_id = auth.uid() AND b.status IN ('scheduled', 'checked_in')
         AND v_at BETWEEN b.starts_at - interval '30 minutes' AND b.ends_at
    ) THEN
      RAISE EXCEPTION 'no_booking_now';
    END IF;
    SELECT b.id INTO v_id
      FROM public.bookings b
      JOIN public.clients c ON c.id = b.client_id
      JOIN public.booking_checkin_keys k ON k.booking_id = b.id
      CROSS JOIN generate_series(v_w - 3, v_w) g(w)
     WHERE c.client_user_id = auth.uid() AND b.status IN ('scheduled', 'checked_in')
       AND v_at BETWEEN b.starts_at - interval '30 minutes' AND b.ends_at
       AND public.checkin_code(k.secret, b.id, g.w) = p_code
     ORDER BY abs(EXTRACT(EPOCH FROM (b.starts_at - v_at)))
     LIMIT 1;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'bad_code';
    END IF;
    v_verified := TRUE;
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = v_id FOR UPDATE;
  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'wrong_booking';
  END IF;
  v_is_pt := v_b.pt_user_id = auth.uid();

  IF NOT v_is_pt THEN
    IF v_b.client_id IS NULL OR NOT public.is_client_record_owner(v_b.client_id) THEN
      RAISE EXCEPTION 'wrong_booking';
    END IF;
    IF NOT v_verified THEN
      IF p_code IS NULL OR p_window IS NULL THEN
        RAISE EXCEPTION 'bad_code';
      END IF;
      IF p_window NOT BETWEEN v_w - 1 AND v_w + 1 THEN
        RAISE EXCEPTION 'code_expired';
      END IF;
      SELECT secret INTO v_secret FROM public.booking_checkin_keys WHERE booking_id = v_b.id;
      IF v_secret IS NULL OR public.checkin_code(v_secret, v_b.id, p_window) <> p_code THEN
        RAISE EXCEPTION 'bad_code';
      END IF;
    END IF;
  END IF;

  IF v_b.status IN ('cancelled', 'no_show') THEN
    RAISE EXCEPTION 'booking_closed';
  END IF;

  SELECT * INTO v_ci FROM public.check_ins WHERE booking_id = v_b.id FOR UPDATE;

  IF v_b.status = 'completed' THEN
    v_outcome := 'already';
  ELSIF v_b.status = 'checked_in' THEN
    -- A client's scan at the end checks them out; one at the door twice doesn't.
    IF NOT v_is_pt AND v_ci.id IS NOT NULL AND v_ci.checked_out_at IS NULL
       AND v_at >= v_ci.checked_in_at + interval '10 minutes' THEN
      UPDATE public.check_ins SET checked_out_at = v_at, updated_at = NOW() WHERE id = v_ci.id;
      UPDATE public.bookings SET status = 'completed', updated_at = NOW() WHERE id = v_b.id;
      INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
      SELECT auth.uid(), c.client_user_id, 'check_out', 'booking', v_b.id, jsonb_build_object('by', 'scan')
        FROM public.clients c WHERE c.id = v_b.client_id;
      v_outcome := 'checked_out';
    ELSE
      v_outcome := 'already';
    END IF;
  ELSIF v_b.status = 'scheduled' THEN
    IF v_at NOT BETWEEN v_b.starts_at - interval '30 minutes' AND v_b.ends_at THEN
      RAISE EXCEPTION 'outside_check_in';
    END IF;
    INSERT INTO public.check_ins (booking_id, check_in_method, checked_in_at, checked_in_by_user_id)
    VALUES (v_b.id, CASE WHEN v_is_pt THEN 'manual' ELSE 'qr_scan' END, v_at, auth.uid())
    ON CONFLICT (booking_id) DO UPDATE
      SET check_in_method = EXCLUDED.check_in_method, checked_in_at = EXCLUDED.checked_in_at,
          checked_out_at = NULL, checked_in_by_user_id = EXCLUDED.checked_in_by_user_id, updated_at = NOW();
    UPDATE public.bookings SET status = 'checked_in', updated_at = NOW() WHERE id = v_b.id;
    INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
    SELECT auth.uid(), c.client_user_id, 'check_in', 'booking', v_b.id,
           jsonb_build_object('method', CASE WHEN v_is_pt THEN 'manual' ELSE 'qr_scan' END,
                              'typed', v_verified, 'device_time', p_at IS NOT NULL)
      FROM public.clients c WHERE c.id = v_b.client_id;
    v_outcome := 'checked_in';
  ELSE
    RAISE EXCEPTION 'booking_closed';
  END IF;

  RETURN QUERY
  SELECT b.id, b.status::TEXT, ci.checked_in_at, ci.checked_out_at, v_outcome
    FROM public.bookings b
    LEFT JOIN public.check_ins ci ON ci.booking_id = b.id
   WHERE b.id = v_b.id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (7) check_out — the PT closes a checked-in booking with no session (D6).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.check_out(p_booking_id UUID)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_b public.bookings;
BEGIN
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_b.id IS NULL OR v_b.pt_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_b.status = 'completed' THEN
    RETURN v_b;
  END IF;
  IF v_b.status <> 'checked_in' THEN
    RAISE EXCEPTION 'not_checked_in';
  END IF;

  UPDATE public.check_ins SET checked_out_at = NOW(), updated_at = NOW()
   WHERE booking_id = p_booking_id AND checked_out_at IS NULL;
  UPDATE public.bookings SET status = 'completed', updated_at = NOW()
   WHERE id = p_booking_id
   RETURNING * INTO v_b;

  INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
  SELECT auth.uid(), c.client_user_id, 'check_out', 'booking', p_booking_id, jsonb_build_object('by', 'pt')
    FROM public.clients c WHERE c.id = v_b.client_id;

  RETURN v_b;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (8) rate_booking — the booking's client, once it is completed (D7). Calling
-- again updates the rating; a missing comment keeps the one already left.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.rate_booking(p_id UUID, p_rating SMALLINT, p_comment TEXT DEFAULT NULL)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_b public.bookings;
BEGIN
  SELECT * INTO v_b FROM public.bookings WHERE id = p_id FOR UPDATE;
  IF v_b.id IS NULL OR v_b.client_id IS NULL OR v_b.pt_user_id = auth.uid()
     OR NOT public.is_client_record_owner(v_b.client_id) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_b.status <> 'completed' THEN
    RAISE EXCEPTION 'not_ratable';
  END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'bad_rating';
  END IF;

  UPDATE public.bookings
     SET rating         = p_rating,
         rating_comment = COALESCE(NULLIF(btrim(left(p_comment, 500)), ''), rating_comment),
         rated_at       = NOW(),
         updated_at     = NOW()
   WHERE id = p_id
   RETURNING * INTO v_b;
  RETURN v_b;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (9) set_booking_amount — the PT records what this session costs (D8).
-- NULL clears it. Not on a cancelled booking.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.set_booking_amount(p_id UUID, p_cents INTEGER)
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
  IF v_b.status = 'cancelled' THEN
    RAISE EXCEPTION 'booking_closed';
  END IF;
  IF p_cents IS NOT NULL AND p_cents NOT BETWEEN 0 AND 10000000 THEN
    RAISE EXCEPTION 'bad_amount';
  END IF;
  UPDATE public.bookings SET amount_cents = p_cents, updated_at = NOW() WHERE id = p_id RETURNING * INTO v_b;
  RETURN v_b;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (10) save_reminder_settings — a partial patch; absent keys keep their value
-- (or the default on first save). Saved, never sent, until M9 (D13).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.save_reminder_settings(p JSONB)
RETURNS public.reminder_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_r public.reminder_settings;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'pt') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.reminder_settings AS r (pt_user_id, client_24h, client_2h, client_change, pt_agenda, pt_book, pt_late)
  VALUES (
    auth.uid(),
    COALESCE((p->>'client_24h')::BOOLEAN, TRUE),
    COALESCE((p->>'client_2h')::BOOLEAN, FALSE),
    COALESCE((p->>'client_change')::BOOLEAN, TRUE),
    COALESCE((p->>'pt_agenda')::BOOLEAN, TRUE),
    COALESCE((p->>'pt_book')::BOOLEAN, TRUE),
    COALESCE((p->>'pt_late')::BOOLEAN, TRUE)
  )
  ON CONFLICT (pt_user_id) DO UPDATE
    SET client_24h    = COALESCE((p->>'client_24h')::BOOLEAN, r.client_24h),
        client_2h     = COALESCE((p->>'client_2h')::BOOLEAN, r.client_2h),
        client_change = COALESCE((p->>'client_change')::BOOLEAN, r.client_change),
        pt_agenda     = COALESCE((p->>'pt_agenda')::BOOLEAN, r.pt_agenda),
        pt_book       = COALESCE((p->>'pt_book')::BOOLEAN, r.pt_book),
        pt_late       = COALESCE((p->>'pt_late')::BOOLEAN, r.pt_late),
        updated_at    = NOW()
  RETURNING * INTO v_r;
  RETURN v_r;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (11) Re-created from 0020 for booking_rules.price_cents (header note 6).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rules_for(p_pt UUID)
RETURNS public.booking_rules
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    (SELECT r FROM public.booking_rules r WHERE r.pt_user_id = p_pt),
    ROW(p_pt, '{45,60,90}'::SMALLINT[], 15::SMALLINT, 4::SMALLINT, 12::SMALLINT, NOW(), NULL::INTEGER)::public.booking_rules
  );
$$;

CREATE OR REPLACE FUNCTION public.save_availability(p_hours JSONB, p_exceptions JSONB, p_rules JSONB)
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

  -- M5b: 'price' (cents or null) is optional, so an app build that predates it
  -- keeps the price already saved instead of clearing it.
  INSERT INTO public.booking_rules AS br (pt_user_id, lengths_min, buffer_min, window_weeks, cutoff_hours, updated_at, price_cents)
  VALUES (
    auth.uid(),
    ARRAY(SELECT jsonb_array_elements_text(p_rules->'lengths')::SMALLINT ORDER BY 1),
    (p_rules->>'buffer')::SMALLINT,
    (p_rules->>'window')::SMALLINT,
    (p_rules->>'cutoff')::SMALLINT,
    NOW(),
    (p_rules->>'price')::INTEGER
  )
  ON CONFLICT (pt_user_id) DO UPDATE
    SET lengths_min = EXCLUDED.lengths_min, buffer_min = EXCLUDED.buffer_min,
        window_weeks = EXCLUDED.window_weeks, cutoff_hours = EXCLUDED.cutoff_hours, updated_at = NOW(),
        price_cents = CASE WHEN p_rules ? 'price' THEN EXCLUDED.price_cents ELSE br.price_cents END;

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
-- (12) Sessions fulfil checked-in bookings too (header note 7). 0020's
-- bodies plus the marked blocks only.
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

  -- M5a: the booking this session fulfils — the nearest whose [start − 30 min,
  -- end] contains the session's start and has no session yet. M5b: a
  -- checked-in booking is fulfilled the same way.
  SELECT b.id INTO v_booking
    FROM public.bookings b
   WHERE b.client_id = p_client_id AND b.status IN ('scheduled', 'checked_in')
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
  -- M5b: including a checked-in one, which this also checks out.
  IF v_row.booking_id IS NOT NULL THEN
    UPDATE public.bookings SET status = 'completed', updated_at = NOW()
     WHERE id = v_row.booking_id AND status IN ('scheduled', 'checked_in');
    IF FOUND THEN
      INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
      SELECT auth.uid(), c.client_user_id, 'booking_complete', 'booking', v_row.booking_id,
             jsonb_build_object('workout_session_id', v_row.id)
        FROM public.clients c WHERE c.id = v_row.client_id;
      UPDATE public.check_ins SET checked_out_at = v_completed, updated_at = NOW()
       WHERE booking_id = v_row.booking_id AND checked_out_at IS NULL;
      IF FOUND THEN
        INSERT INTO public.audit_logs (actor_id, target_user_id, action, entity_type, entity_id, details)
        SELECT auth.uid(), c.client_user_id, 'check_out', 'booking', v_row.booking_id,
               jsonb_build_object('by', 'session', 'workout_session_id', v_row.id)
          FROM public.clients c WHERE c.id = v_row.client_id;
      END IF;
    END IF;
  END IF;

  RETURN v_row;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- (13) Grants
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.checkin_keys(TIMESTAMPTZ, TIMESTAMPTZ)               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_in(UUID, TEXT, BIGINT, TIMESTAMPTZ)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_out(UUID)                                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rate_booking(UUID, SMALLINT, TEXT)                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_booking_amount(UUID, INTEGER)                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_reminder_settings(JSONB)                        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.checkin_keys(TIMESTAMPTZ, TIMESTAMPTZ)               TO authenticated;
GRANT  EXECUTE ON FUNCTION public.check_in(UUID, TEXT, BIGINT, TIMESTAMPTZ)            TO authenticated;
GRANT  EXECUTE ON FUNCTION public.check_out(UUID)                                      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.rate_booking(UUID, SMALLINT, TEXT)                   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.set_booking_amount(UUID, INTEGER)                    TO authenticated;
GRANT  EXECUTE ON FUNCTION public.save_reminder_settings(JSONB)                        TO authenticated;

COMMIT;

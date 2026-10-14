-- 0023 · M5 review fixes
--
-- save_availability() replaced every exception "from CURRENT_DATE on" — but
-- CURRENT_DATE is the database's UTC date, not the PT's. A Beirut PT saving at
-- 01:30 local on the 12th still had the 11th as "today": yesterday's exception
-- was deleted and, because the app only sends exceptions from its own today,
-- never re-inserted. The cut-off is now the PT's local date (pt_tz). Same
-- signature, so the grants from 0020 stay in place.

BEGIN;

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

  DELETE FROM public.availability_exceptions WHERE pt_user_id = auth.uid() AND on_date >= (NOW() AT TIME ZONE v_tz)::DATE;
  INSERT INTO public.availability_exceptions (pt_user_id, on_date, kind, ranges)
  SELECT auth.uid(), (x->>'date')::DATE, x->>'kind', CASE WHEN x->>'kind' = 'extra' THEN x->'ranges' END
    FROM jsonb_array_elements(COALESCE(p_exceptions, '[]'::jsonb)) x
   WHERE (x->>'date')::DATE >= (NOW() AT TIME ZONE v_tz)::DATE;

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

COMMIT;

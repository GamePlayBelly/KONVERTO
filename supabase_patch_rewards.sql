-- ═══════════════════════════════════════════════════════════════════════════
-- ECOTRACK — Patch: rewards, scheduled trips, safe signup
-- Esegui UNA VOLTA in Supabase → SQL Editor
--
-- 1. Colonna is_scheduled per i viaggi programmati (accredito alla data)
-- 2. handle_new_user: niente profili mancanti su username duplicato
-- 3. process_expired_carpool_rides(): ricompense carpool server-side
--    (funziona per driver E passeggeri, idempotente)
-- 4. award_period_bonuses(): bonus classifica server-side, una volta per periodo
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Viaggi programmati ────────────────────────────────────────────────────
ALTER TABLE trips ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN DEFAULT FALSE;

-- ── 2. Creazione profilo sicura su registrazione ─────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_username  TEXT;
  v_full_name TEXT;
BEGIN
  v_username  := COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1));
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NULL);

  BEGIN
    INSERT INTO public.profiles (id, username, full_name)
    VALUES (NEW.id, v_username, v_full_name)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN unique_violation THEN
    -- Username già preso (race condition): aggiungi un suffisso invece di
    -- lasciare l'account senza profilo
    INSERT INTO public.profiles (id, username, full_name)
    VALUES (NEW.id, v_username || '_' || substr(NEW.id::text, 1, 4), v_full_name)
    ON CONFLICT (id) DO NOTHING;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── 3. Ricompense carpooling (server-side) ───────────────────────────────────
CREATE OR REPLACE FUNCTION process_expired_carpool_rides()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r             RECORD;
  b             RECORD;
  v_count       INTEGER := 0;
  v_dist        NUMERIC;
  v_co2         NUMERIC;
  v_pass        INTEGER;
  v_driver_pts  INTEGER;
  v_pass_pts    INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  FOR r IN
    SELECT id, driver_id, distance_km
    FROM carpooling_rides
    WHERE status = 'active' AND departure_time < NOW()
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Marca completato prima di accreditare (evita doppie elaborazioni)
    UPDATE carpooling_rides SET status = 'completed'
    WHERE id = r.id AND status = 'active';
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_dist := COALESCE(NULLIF(r.distance_km, 0), 15);
    SELECT COUNT(*) INTO v_pass FROM carpooling_bookings WHERE ride_id = r.id;
    v_co2       := v_dist * 0.05;
    v_driver_pts := ROUND(v_dist * 2 + v_pass * 10 + 20);
    v_pass_pts   := ROUND(v_dist * 1.5 + 15);

    -- Driver
    UPDATE profiles
      SET eco_score       = COALESCE(eco_score, 0) + v_driver_pts,
          total_co2_saved = COALESCE(total_co2_saved, 0) + v_co2 * (v_pass + 1)
      WHERE id = r.driver_id;

    INSERT INTO trips (user_id, transport_mode, distance_km, co2_saved_kg, eco_points, notes, recorded_at)
    VALUES (r.driver_id, 'carpooling', v_dist, v_co2 * (v_pass + 1), v_driver_pts,
            'Carpool completato — ' || v_pass ||
            CASE WHEN v_pass = 1 THEN ' passeggero' ELSE ' passeggeri' END,
            NOW());

    -- Passeggeri
    FOR b IN SELECT passenger_id FROM carpooling_bookings WHERE ride_id = r.id
    LOOP
      UPDATE profiles
        SET eco_score       = COALESCE(eco_score, 0) + v_pass_pts,
            total_co2_saved = COALESCE(total_co2_saved, 0) + v_co2
        WHERE id = b.passenger_id;

      INSERT INTO trips (user_id, transport_mode, distance_km, co2_saved_kg, eco_points, notes, recorded_at)
      VALUES (b.passenger_id, 'carpooling', v_dist, v_co2, v_pass_pts,
              'Carpool completato (passeggero)', NOW());
    END LOOP;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── 4. Bonus classifica periodo (idempotente) ────────────────────────────────
CREATE TABLE IF NOT EXISTS leaderboard_bonus_awards (
  period_start TIMESTAMPTZ PRIMARY KEY,
  awarded_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE leaderboard_bonus_awards ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION award_period_bonuses(
  p_period_start TIMESTAMPTZ,
  p_period_end   TIMESTAMPTZ
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_bonus   INTEGER;
  v_awarded INTEGER := 0;
  r         RECORD;
  v_bonuses INTEGER[] := ARRAY[500, 250, 100, 50, 50, 50, 50, 50, 50, 50];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO leaderboard_bonus_awards (period_start)
  VALUES (p_period_start)
  ON CONFLICT (period_start) DO NOTHING;

  IF NOT FOUND THEN
    RETURN 0;  -- periodo già premiato
  END IF;

  FOR r IN
    SELECT user_id, SUM(eco_points) AS pts
    FROM trips
    WHERE recorded_at >= p_period_start
      AND recorded_at <  p_period_end
    GROUP BY user_id
    ORDER BY pts DESC NULLS LAST
    LIMIT 10
  LOOP
    v_bonus := v_bonuses[v_awarded + 1];
    UPDATE profiles
      SET eco_score = COALESCE(eco_score, 0) + v_bonus
      WHERE id = r.user_id;
    v_awarded := v_awarded + 1;
  END LOOP;

  RETURN v_awarded;
END;
$$;

-- ── Permessi RPC (solo utenti autenticati) ───────────────────────────────────
REVOKE ALL ON FUNCTION process_expired_carpool_rides() FROM PUBLIC;
REVOKE ALL ON FUNCTION process_expired_carpool_rides() FROM anon;
GRANT EXECUTE ON FUNCTION process_expired_carpool_rides() TO authenticated;

REVOKE ALL ON FUNCTION award_period_bonuses(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION award_period_bonuses(TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION award_period_bonuses(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ECOTRACK — Patch: correzioni di sistema e sicurezza
-- Esegui UNA VOLTA in Supabase → SQL Editor (dopo gli altri patch).
--
-- Cosa corregge:
--  1. Punti/CO₂/streak modificabili solo dal server (niente cheat dal browser)
--  2. Viaggi: punteggi ricalcolati server-side, modifica/elimina atomici
--  3. Smart working una sola volta al giorno
--  4. Classifica: esclude viaggi programmati/futuri, bonus non più mintabili
--  5. Chat: nessuna auto-iscrizione alle conversazioni, impostazioni gruppo
--     modificabili solo da admin/creatore
--  6. Club: ruoli e rimozione membri gestiti da RPC con controllo admin
--  7. Sfide: solo lo sfidato può accettare/rifiutare
--  8. Carpooling: niente auto-prenotazione, niente overbooking
--  9. Premi club: riscatto atomico con controllo punti/stock/doppio riscatto
-- 10. Profili: colonne protette (eco_score & co. non più scrivibili dal client)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Colonne necessarie ───────────────────────────────────────────────────
ALTER TABLE public.trips    ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active_title TEXT;

ALTER TABLE public.conversation_members
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS muted    BOOLEAN DEFAULT FALSE;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS pinned_message_id  UUID,
  ADD COLUMN IF NOT EXISTS group_goal_km      NUMERIC,
  ADD COLUMN IF NOT EXISTS group_goal_deadline DATE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PROFILI: colonne protette + RPC punti sicura
-- ═══════════════════════════════════════════════════════════════════════════

-- Rimuove tutte le policy UPDATE esistenti (nomi diversi tra i vari schemi)
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'UPDATE'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', p.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
CREATE POLICY "profiles_self_update" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Il client può aggiornare solo i campi "anagrafici". Punti, CO₂, streak e
-- last_activity_date sono scrivibili solo dalle funzioni SECURITY DEFINER.
REVOKE UPDATE, INSERT, DELETE ON public.profiles FROM anon;
REVOKE UPDATE, INSERT, DELETE ON public.profiles FROM authenticated;

DO $$
DECLARE cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ')
    INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'profiles'
    AND column_name IN (
      'username', 'full_name', 'avatar_url', 'city', 'bio',
      'preferred_transport', 'weekly_goal_km', 'active_title', 'updated_at'
    );

  IF cols IS NOT NULL THEN
    EXECUTE format('GRANT UPDATE (%s) ON public.profiles TO authenticated', cols);
  END IF;
END $$;

-- RPC punti: solo per se stessi, aggiorna streak in modo atomico.
CREATE OR REPLACE FUNCTION public.increment_profile_stats(
  p_user_id UUID,
  p_points  INTEGER,
  p_co2     NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE profiles
  SET
    eco_score = GREATEST(0, COALESCE(eco_score, 0) + COALESCE(p_points, 0)),
    total_co2_saved = GREATEST(0, COALESCE(total_co2_saved, 0) + COALESCE(p_co2, 0)),
    streak_days = CASE
      WHEN last_activity_date = CURRENT_DATE     THEN COALESCE(streak_days, 0)
      WHEN last_activity_date = CURRENT_DATE - 1 THEN COALESCE(streak_days, 0) + 1
      ELSE 1
    END,
    last_activity_date = CURRENT_DATE,
    updated_at = NOW()
  WHERE id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_profile_stats(UUID, INTEGER, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_profile_stats(UUID, INTEGER, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.increment_profile_stats(UUID, INTEGER, NUMERIC) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. VIAGGI: punteggi server-side, update policy, RPC atomiche
-- ═══════════════════════════════════════════════════════════════════════════

-- Le modifiche ai viaggi passano SOLO dalle RPC (update_trip / delete_trip):
-- un UPDATE/DELETE diretto dal browser permetterebbe di cambiare i punti o di
-- cancellare un viaggio senza scalare i punti dal profilo.
DROP POLICY IF EXISTS "Aggiorna il tuo viaggio" ON public.trips;
REVOKE UPDATE, DELETE ON public.trips FROM anon;
REVOKE UPDATE, DELETE ON public.trips FROM authenticated;

-- Fattori di emissione identici a src/lib/utils.ts
CREATE OR REPLACE FUNCTION public.trip_co2_saved(p_mode TEXT, p_km NUMERIC)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE
AS $$
  SELECT ROUND(
    GREATEST(
      0,
      (0.171 - CASE p_mode
        WHEN 'walking'          THEN 0
        WHEN 'cycling'          THEN 0
        WHEN 'ebike'            THEN 0.011
        WHEN 'escooter'         THEN 0.022
        WHEN 'public_transport' THEN 0.021
        WHEN 'tram_metro'       THEN 0.029
        WHEN 'train'            THEN 0.041
        WHEN 'electric_vehicle' THEN 0.053
        WHEN 'motorcycle'       THEN 0.103
        WHEN 'carpooling'       THEN 0.043
        WHEN 'car'              THEN 0.171
        WHEN 'airplane'         THEN 0.255
        ELSE 0.171
      END) * LEAST(GREATEST(COALESCE(p_km, 0), 0), 1000)
    ),
    3
  );
$$;

CREATE OR REPLACE FUNCTION public.trip_eco_points(p_mode TEXT, p_km NUMERIC)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE
AS $$
  SELECT ROUND(
    GREATEST(
      0,
      (0.171 - CASE p_mode
        WHEN 'walking'          THEN 0
        WHEN 'cycling'          THEN 0
        WHEN 'ebike'            THEN 0.011
        WHEN 'escooter'         THEN 0.022
        WHEN 'public_transport' THEN 0.021
        WHEN 'tram_metro'       THEN 0.029
        WHEN 'train'            THEN 0.041
        WHEN 'electric_vehicle' THEN 0.053
        WHEN 'motorcycle'       THEN 0.103
        WHEN 'carpooling'       THEN 0.043
        WHEN 'car'              THEN 0.171
        WHEN 'airplane'         THEN 0.255
        ELSE 0.171
      END) * k
    ) * 100 + k * 2
  )::INTEGER
  FROM (
    SELECT LEAST(GREATEST(COALESCE(p_km, 0), 0), 1000) AS k
  ) s;
$$;

-- BEFORE INSERT: non si fidano mai dei valori inviati dal browser.
CREATE OR REPLACE FUNCTION public.normalize_trip_metrics()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_km  NUMERIC;
  v_day DATE;
BEGIN
  v_km := LEAST(GREATEST(COALESCE(NEW.distance_km, 0), 0), 1000);
  NEW.distance_km := v_km;

  IF NEW.recorded_at IS NULL THEN
    NEW.recorded_at := NOW();
  END IF;
  -- Un viaggio non programmato non può essere nel futuro.
  IF NOT COALESCE(NEW.is_scheduled, FALSE) AND NEW.recorded_at > NOW() THEN
    NEW.recorded_at := NOW();
  END IF;

  -- Smart working: 50 punti, una sola volta al giorno.
  IF v_km = 0 AND COALESCE(NEW.notes, '') ILIKE 'Smart Working%' THEN
    v_day := (NEW.recorded_at AT TIME ZONE 'Europe/Rome')::DATE;
    IF EXISTS (
      SELECT 1 FROM trips
      WHERE user_id = NEW.user_id
        AND notes ILIKE 'Smart Working%'
        AND (recorded_at AT TIME ZONE 'Europe/Rome')::DATE = v_day
    ) THEN
      RAISE EXCEPTION 'SMART_WORKING_ALREADY_LOGGED';
    END IF;
    NEW.co2_saved_kg := 0;
    NEW.eco_points   := 50;
    RETURN NEW;
  END IF;

  NEW.co2_saved_kg := public.trip_co2_saved(NEW.transport_mode, v_km);
  NEW.eco_points   := public.trip_eco_points(NEW.transport_mode, v_km);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_normalize_metrics ON public.trips;
CREATE TRIGGER trips_normalize_metrics
  BEFORE INSERT ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.normalize_trip_metrics();

-- Eliminazione atomica: scala i punti solo se il viaggio era già accreditato.
CREATE OR REPLACE FUNCTION public.delete_trip(p_trip_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  t     RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO t FROM trips WHERE id = p_trip_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viaggio non trovato';
  END IF;

  IF NOT COALESCE(t.is_scheduled, FALSE) AND t.recorded_at <= NOW() THEN
    UPDATE profiles
    SET
      eco_score = GREATEST(0, COALESCE(eco_score, 0) - COALESCE(t.eco_points, 0)),
      total_co2_saved = GREATEST(0, COALESCE(total_co2_saved, 0) - COALESCE(t.co2_saved_kg, 0)),
      updated_at = NOW()
    WHERE id = v_uid;
  END IF;

  DELETE FROM trips WHERE id = p_trip_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_trip(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_trip(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_trip(UUID) TO authenticated;

-- Modifica atomica (usata dal modale viaggi programmati).
CREATE OR REPLACE FUNCTION public.update_trip(
  p_trip_id        UUID,
  p_transport_mode TEXT        DEFAULT NULL,
  p_distance_km    NUMERIC     DEFAULT NULL,
  p_notes          TEXT        DEFAULT NULL,
  p_recorded_at    TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  t              RECORD;
  v_mode         TEXT;
  v_km           NUMERIC;
  v_recorded     TIMESTAMPTZ;
  v_co2          NUMERIC;
  v_pts          INTEGER;
  v_old_credited BOOLEAN;
  v_new_credited BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO t FROM trips WHERE id = p_trip_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viaggio non trovato';
  END IF;

  v_mode     := COALESCE(NULLIF(p_transport_mode, ''), t.transport_mode);
  v_km       := LEAST(GREATEST(COALESCE(p_distance_km, t.distance_km, 0), 0), 1000);
  v_recorded := COALESCE(p_recorded_at, t.recorded_at);

  IF v_km = 0 AND COALESCE(p_notes, '') ILIKE 'Smart Working%' THEN
    v_co2 := 0;
    v_pts := 50;
  ELSE
    v_co2 := public.trip_co2_saved(v_mode, v_km);
    v_pts := public.trip_eco_points(v_mode, v_km);
  END IF;

  v_old_credited := NOT COALESCE(t.is_scheduled, FALSE) AND t.recorded_at <= NOW();
  v_new_credited := v_recorded <= NOW();

  UPDATE trips
  SET
    transport_mode = v_mode,
    distance_km    = v_km,
    co2_saved_kg   = v_co2,
    eco_points     = v_pts,
    notes          = p_notes,
    recorded_at    = v_recorded,
    is_scheduled   = CASE WHEN v_new_credited THEN FALSE ELSE TRUE END
  WHERE id = p_trip_id;

  IF v_old_credited OR v_new_credited THEN
    UPDATE profiles
    SET
      eco_score = GREATEST(
        0,
        COALESCE(eco_score, 0)
        - CASE WHEN v_old_credited THEN COALESCE(t.eco_points, 0) ELSE 0 END
        + CASE WHEN v_new_credited THEN v_pts ELSE 0 END
      ),
      total_co2_saved = GREATEST(
        0,
        COALESCE(total_co2_saved, 0)
        - CASE WHEN v_old_credited THEN COALESCE(t.co2_saved_kg, 0) ELSE 0 END
        + CASE WHEN v_new_credited THEN v_co2 ELSE 0 END
      ),
      streak_days = CASE
        WHEN v_new_credited AND NOT v_old_credited THEN
          CASE
            WHEN last_activity_date = CURRENT_DATE     THEN COALESCE(streak_days, 0)
            WHEN last_activity_date = CURRENT_DATE - 1 THEN COALESCE(streak_days, 0) + 1
            ELSE 1
          END
        ELSE streak_days
      END,
      last_activity_date = CASE
        WHEN v_new_credited AND NOT v_old_credited THEN CURRENT_DATE
        ELSE last_activity_date
      END,
      updated_at = NOW()
    WHERE id = v_uid;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_trip(UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_trip(UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_trip(UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO authenticated;

-- Accredita i viaggi programmati scaduti: tutto in una transazione.
CREATE OR REPLACE FUNCTION public.process_scheduled_trips()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  r       RECORD;
  v_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  FOR r IN
    SELECT * FROM trips
    WHERE user_id = v_uid
      AND COALESCE(is_scheduled, FALSE) = TRUE
      AND recorded_at <= NOW()
    ORDER BY recorded_at
    FOR UPDATE
  LOOP
    UPDATE trips SET is_scheduled = FALSE WHERE id = r.id;

    UPDATE profiles
    SET
      eco_score = GREATEST(0, COALESCE(eco_score, 0) + COALESCE(r.eco_points, 0)),
      total_co2_saved = GREATEST(0, COALESCE(total_co2_saved, 0) + COALESCE(r.co2_saved_kg, 0)),
      streak_days = CASE
        WHEN last_activity_date = CURRENT_DATE     THEN COALESCE(streak_days, 0)
        WHEN last_activity_date = CURRENT_DATE - 1 THEN COALESCE(streak_days, 0) + 1
        ELSE 1
      END,
      last_activity_date = CURRENT_DATE,
      updated_at = NOW()
    WHERE id = v_uid;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.process_scheduled_trips() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_scheduled_trips() FROM anon;
GRANT EXECUTE ON FUNCTION public.process_scheduled_trips() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. CLASSIFICA
-- ═══════════════════════════════════════════════════════════════════════════

-- Aggregato senza viaggi futuri/programmati (non ancora guadagnati).
CREATE OR REPLACE FUNCTION public.get_period_leaderboard(
  p_period_start TIMESTAMPTZ,
  p_limit        INTEGER DEFAULT 200
)
RETURNS TABLE (
  user_id         UUID,
  total_points    INTEGER,
  total_co2_saved NUMERIC,
  username        TEXT,
  full_name       TEXT,
  avatar_url      TEXT,
  city            TEXT,
  eco_score       INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH period AS (
    SELECT
      t.user_id,
      COALESCE(SUM(t.eco_points), 0)::INTEGER   AS pts,
      COALESCE(SUM(t.co2_saved_kg), 0)::NUMERIC AS co2
    FROM trips t
    WHERE t.recorded_at >= p_period_start
      AND t.recorded_at <= NOW()
      AND COALESCE(t.is_scheduled, FALSE) = FALSE
    GROUP BY t.user_id
  )
  SELECT
    p.id                              AS user_id,
    COALESCE(period.pts, 0)           AS total_points,
    COALESCE(period.co2, 0)           AS total_co2_saved,
    p.username,
    p.full_name,
    p.avatar_url,
    p.city,
    COALESCE(p.eco_score, 0)          AS eco_score
  FROM profiles p
  LEFT JOIN period ON period.user_id = p.id
  ORDER BY COALESCE(period.pts, 0) DESC,
           COALESCE(p.eco_score, 0) DESC,
           p.username ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$$;

REVOKE ALL ON FUNCTION public.get_period_leaderboard(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_period_leaderboard(TIMESTAMPTZ, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_period_leaderboard(TIMESTAMPTZ, INTEGER) TO authenticated;

-- La tabella settimanale è solo in lettura per i client: la scrive il trigger.
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'leaderboard_weekly'
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.leaderboard_weekly', p.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Classifica visibile" ON public.leaderboard_weekly;
DROP POLICY IF EXISTS "Leaderboard public"  ON public.leaderboard_weekly;
DROP POLICY IF EXISTS "leaderboard_weekly_read" ON public.leaderboard_weekly;
CREATE POLICY "leaderboard_weekly_read" ON public.leaderboard_weekly
  FOR SELECT USING (TRUE);

-- Bonus solo per periodi di 30 giorni già conclusi e allineati all'epoca app.
CREATE OR REPLACE FUNCTION public.award_period_bonuses(
  p_period_start TIMESTAMPTZ,
  p_period_end   TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bonus   INTEGER;
  v_awarded INTEGER := 0;
  r         RECORD;
  v_bonuses INTEGER[] := ARRAY[500, 250, 100, 50, 50, 50, 50, 50, 50, 50];
  v_epoch   TIMESTAMPTZ := '2025-01-01T00:00:00Z';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_period_end > NOW() THEN
    RAISE EXCEPTION 'Il periodo non è ancora concluso';
  END IF;
  IF p_period_end <> p_period_start + INTERVAL '30 days' THEN
    RAISE EXCEPTION 'Periodo non valido';
  END IF;
  IF MOD(EXTRACT(EPOCH FROM (p_period_start - v_epoch))::BIGINT, 2592000) <> 0 THEN
    RAISE EXCEPTION 'Inizio periodo non valido';
  END IF;

  INSERT INTO leaderboard_bonus_awards (period_start)
  VALUES (p_period_start)
  ON CONFLICT (period_start) DO NOTHING;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT user_id, SUM(eco_points) AS pts
    FROM trips
    WHERE recorded_at >= p_period_start
      AND recorded_at <  p_period_end
      AND recorded_at <= NOW()
      AND COALESCE(is_scheduled, FALSE) = FALSE
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

REVOKE ALL ON FUNCTION public.award_period_bonuses(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_period_bonuses(TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.award_period_bonuses(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. CHAT: membership e impostazioni gruppo
-- ═══════════════════════════════════════════════════════════════════════════

-- Helper SECURITY DEFINER per evitare ricorsione nelle policy.
CREATE OR REPLACE FUNCTION public.is_conversation_member(p_conv_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = p_conv_id AND user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_conversation_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_conversation_member(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(UUID) TO authenticated;

-- Nessuna auto-iscrizione: i membri si aggiungono solo via RPC.
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'conversation_members'
      AND cmd IN ('SELECT', 'INSERT', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.conversation_members', p.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "conversation_members_read" ON public.conversation_members;
CREATE POLICY "conversation_members_read" ON public.conversation_members
  FOR SELECT USING (
    user_id = auth.uid() OR public.is_conversation_member(conversation_id)
  );

-- Le conversazioni si possono aggiornare solo per last_message/last_message_at
-- (le impostazioni passano dalla RPC con controllo admin).
REVOKE UPDATE ON public.conversations FROM anon;
REVOKE UPDATE ON public.conversations FROM authenticated;

DO $$
DECLARE cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ')
    INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'conversations'
    AND column_name IN ('last_message', 'last_message_at');

  IF cols IS NOT NULL THEN
    EXECUTE format('GRANT UPDATE (%s) ON public.conversations TO authenticated', cols);
  END IF;
END $$;

-- ── Gestione admin del gruppo (admin della chat O creatore) ──────────────────
CREATE OR REPLACE FUNCTION public.add_group_member(p_conv_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = p_conv_id AND user_id = auth.uid() AND is_admin = TRUE
  ) AND NOT EXISTS (
    SELECT 1 FROM conversations WHERE id = p_conv_id AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Solo gli admin possono aggiungere membri';
  END IF;
  INSERT INTO conversation_members (conversation_id, user_id)
  VALUES (p_conv_id, p_user_id)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_group_member(p_conv_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = p_conv_id AND user_id = auth.uid() AND is_admin = TRUE
  ) AND NOT EXISTS (
    SELECT 1 FROM conversations WHERE id = p_conv_id AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Solo gli admin possono rimuovere membri';
  END IF;
  DELETE FROM conversation_members
  WHERE conversation_id = p_conv_id AND user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_to_admin(p_conv_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = p_conv_id AND user_id = auth.uid() AND is_admin = TRUE
  ) AND NOT EXISTS (
    SELECT 1 FROM conversations WHERE id = p_conv_id AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Solo gli admin possono promuovere membri';
  END IF;
  UPDATE conversation_members SET is_admin = TRUE
  WHERE conversation_id = p_conv_id AND user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.demote_from_admin(p_conv_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_admins INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = p_conv_id AND user_id = auth.uid() AND is_admin = TRUE
  ) AND NOT EXISTS (
    SELECT 1 FROM conversations WHERE id = p_conv_id AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Solo gli admin possono declassare admin';
  END IF;
  SELECT COUNT(*) INTO n_admins
  FROM conversation_members
  WHERE conversation_id = p_conv_id AND is_admin = TRUE;
  IF n_admins <= 1 THEN
    RAISE EXCEPTION 'Non puoi declassare l''unico admin';
  END IF;
  UPDATE conversation_members SET is_admin = FALSE
  WHERE conversation_id = p_conv_id AND user_id = p_user_id;
END;
$$;

-- Uscita dal gruppo: gli ultimi admin devono promuoverne un altro.
CREATE OR REPLACE FUNCTION public.leave_group(p_conv_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_admins INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT COUNT(*) INTO n_admins
  FROM conversation_members
  WHERE conversation_id = p_conv_id AND is_admin = TRUE;
  IF n_admins <= 1 AND EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = p_conv_id AND user_id = auth.uid() AND is_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Promuovi un altro admin prima di uscire';
  END IF;
  DELETE FROM conversation_members
  WHERE conversation_id = p_conv_id AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.add_group_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_group_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_to_admin(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demote_from_admin(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leave_group(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_group_member(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.remove_group_member(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.promote_to_admin(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.demote_from_admin(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.leave_group(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_group_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_group_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_to_admin(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.demote_from_admin(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_group(UUID) TO authenticated;

-- Impostazioni gruppo: admin della chat O creatore della conversazione.
CREATE OR REPLACE FUNCTION public.update_group_settings(
  p_conv_id UUID,
  p_name TEXT,
  p_goal_km NUMERIC,
  p_goal_deadline DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = p_conv_id AND user_id = auth.uid() AND is_admin = TRUE
  ) AND NOT EXISTS (
    SELECT 1 FROM conversations
    WHERE id = p_conv_id AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Solo gli admin possono modificare le impostazioni';
  END IF;

  IF p_goal_km IS NOT NULL AND p_goal_km < 0 THEN
    RAISE EXCEPTION 'Obiettivo non valido';
  END IF;

  UPDATE conversations
  SET
    name = COALESCE(NULLIF(TRIM(p_name), ''), name),
    group_goal_km = p_goal_km,
    group_goal_deadline = p_goal_deadline
  WHERE id = p_conv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_group_settings(UUID, TEXT, NUMERIC, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_group_settings(UUID, TEXT, NUMERIC, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_group_settings(UUID, TEXT, NUMERIC, DATE) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. CLUB: ruoli e rimozione membri
-- ═══════════════════════════════════════════════════════════════════════════

-- Iscriversi liberamente solo ai club pubblici: ai club privati si accede
-- tramite richiesta/invito approvato (RPC SECURITY DEFINER).
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'club_members' AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.club_members', p.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "club_members_self_join" ON public.club_members;
CREATE POLICY "club_members_self_join" ON public.club_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM clubs
      WHERE id = club_id
        AND (is_public = TRUE OR created_by = auth.uid())
    )
  );

-- Il creatore del club può eliminarlo (mancava in uno degli schemi).
DROP POLICY IF EXISTS "club_creator_delete" ON public.clubs;
CREATE POLICY "club_creator_delete" ON public.clubs
  FOR DELETE USING (created_by = auth.uid());

-- Un utente non può auto-promuoversi ad admin inserendo/modificando la riga.
CREATE OR REPLACE FUNCTION public.enforce_club_member_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS NULL OR NEW.role NOT IN ('admin', 'member') THEN
    NEW.role := 'member';
  END IF;

  IF auth.uid() IS NOT NULL
     AND NEW.role = 'admin'
     AND NOT EXISTS (
       SELECT 1 FROM clubs WHERE id = NEW.club_id AND created_by = auth.uid()
     ) THEN
    NEW.role := 'member';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS club_members_enforce_role ON public.club_members;
CREATE TRIGGER club_members_enforce_role
  BEFORE INSERT OR UPDATE ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_club_member_role();

CREATE OR REPLACE FUNCTION public.set_club_member_role(
  p_club_id UUID,
  p_user_id UUID,
  p_role    TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'Ruolo non valido';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM clubs WHERE id = p_club_id AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Solo il creatore del club può cambiare i ruoli';
  END IF;
  IF EXISTS (
    SELECT 1 FROM clubs WHERE id = p_club_id AND created_by = p_user_id
  ) THEN
    RAISE EXCEPTION 'Non puoi cambiare il ruolo del creatore';
  END IF;

  UPDATE club_members SET role = p_role
  WHERE club_id = p_club_id AND user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_club_member(
  p_club_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM clubs WHERE id = p_club_id AND created_by = auth.uid()
  ) AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo il creatore del club può rimuovere altri membri';
  END IF;

  IF EXISTS (
    SELECT 1 FROM clubs WHERE id = p_club_id AND created_by = p_user_id
  ) THEN
    RAISE EXCEPTION 'Il creatore non può essere rimosso';
  END IF;

  DELETE FROM club_members WHERE club_id = p_club_id AND user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_club_member_role(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_club_member_role(UUID, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_club_member_role(UUID, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.remove_club_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_club_member(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_club_member(UUID, UUID) TO authenticated;

-- Richieste/inviti club: nessuno può auto-invitarsi e accettare.
DROP POLICY IF EXISTS "Authenticated can insert club request" ON public.club_join_requests;
DROP POLICY IF EXISTS "User or admin can update club request" ON public.club_join_requests;
DROP POLICY IF EXISTS "club_join_requests_insert" ON public.club_join_requests;

CREATE POLICY "club_join_requests_insert" ON public.club_join_requests
  FOR INSERT WITH CHECK (
    (direction = 'join_request' AND user_id = auth.uid())
    OR (
      direction = 'invite'
      AND EXISTS (
        SELECT 1 FROM clubs WHERE id = club_id AND created_by = auth.uid()
      )
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. SFIDE: solo lo sfidato può rispondere
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'challenges' AND cmd = 'UPDATE'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.challenges', p.policyname);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.respond_to_challenge(
  p_challenge_id UUID,
  p_accept       BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO c FROM challenges WHERE id = p_challenge_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sfida non trovata';
  END IF;
  IF c.challenged_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo lo sfidato può rispondere';
  END IF;
  IF c.status <> 'pending' THEN
    RAISE EXCEPTION 'Sfida già risposta';
  END IF;

  IF p_accept THEN
    UPDATE challenges
    SET status = 'active',
        start_date = CURRENT_DATE,
        end_date = CURRENT_DATE + c.duration_days
    WHERE id = p_challenge_id;
  ELSE
    UPDATE challenges SET status = 'rejected' WHERE id = p_challenge_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_challenge(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_to_challenge(UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.respond_to_challenge(UUID, BOOLEAN) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6b. AMICIZIE: solo chi riceve la richiesta può accettarla/rifiutarla
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE p RECORD;
BEGIN
  IF to_regclass('public.friend_requests') IS NULL THEN
    RETURN;
  END IF;

  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'friend_requests' AND cmd = 'UPDATE'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.friend_requests', p.policyname);
  END LOOP;

  EXECUTE 'CREATE POLICY "friend_requests_receiver_update" ON public.friend_requests
    FOR UPDATE USING (receiver_id = auth.uid()) WITH CHECK (receiver_id = auth.uid())';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. CARPOOLING: capienza e auto-prenotazione
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sanitize_carpooling_ride()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.distance_km := LEAST(GREATEST(COALESCE(NEW.distance_km, 0), 0), 1000);
  NEW.available_seats := LEAST(GREATEST(COALESCE(NEW.available_seats, 1), 1), 8);
  NEW.price_per_seat := GREATEST(COALESCE(NEW.price_per_seat, 0), 0);

  IF NEW.departure_time IS NULL THEN
    RAISE EXCEPTION 'Data di partenza obbligatoria';
  END IF;
  IF NEW.departure_time < NOW() - INTERVAL '1 hour' THEN
    RAISE EXCEPTION 'La partenza non può essere nel passato';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS carpooling_sanitize_ride ON public.carpooling_rides;
CREATE TRIGGER carpooling_sanitize_ride
  BEFORE INSERT ON public.carpooling_rides
  FOR EACH ROW EXECUTE FUNCTION public.sanitize_carpooling_ride();

CREATE OR REPLACE FUNCTION public.validate_carpooling_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  SELECT driver_id, available_seats, booked_seats, status
    INTO r
  FROM carpooling_rides
  WHERE id = NEW.ride_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Passaggio non trovato';
  END IF;
  IF r.driver_id = NEW.passenger_id THEN
    RAISE EXCEPTION 'Non puoi prenotare il tuo passaggio';
  END IF;
  IF r.status <> 'active' THEN
    RAISE EXCEPTION 'Passaggio non disponibile';
  END IF;
  IF COALESCE(r.booked_seats, 0) >= COALESCE(r.available_seats, 0) THEN
    RAISE EXCEPTION 'Passaggio completo';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS carpooling_validate_booking ON public.carpooling_bookings;
CREATE TRIGGER carpooling_validate_booking
  BEFORE INSERT ON public.carpooling_bookings
  FOR EACH ROW EXECUTE FUNCTION public.validate_carpooling_booking();

-- Premiazione carpooling coerente con il resto dell'app: stessi punti/CO₂
-- calcolati dal server, niente premi per passaggi senza passeggeri e solo i
-- partecipanti possono chiudere il passaggio.
CREATE OR REPLACE FUNCTION public.process_expired_carpool_rides()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        RECORD;
  b        RECORD;
  v_count  INTEGER := 0;
  v_dist   NUMERIC;
  v_co2    NUMERIC;
  v_pts    INTEGER;
  v_pass   INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  FOR r IN
    SELECT *
    FROM carpooling_rides
    WHERE status = 'active'
      AND departure_time < NOW()
      AND (
        driver_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM carpooling_bookings cb
          WHERE cb.ride_id = carpooling_rides.id AND cb.passenger_id = auth.uid()
        )
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE carpooling_rides
    SET status = 'completed'
    WHERE id = r.id AND status = 'active';
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_dist := LEAST(GREATEST(COALESCE(r.distance_km, 0), 0), 1000);
    SELECT COUNT(*) INTO v_pass
    FROM carpooling_bookings
    WHERE ride_id = r.id AND passenger_id <> r.driver_id;

    v_co2 := public.trip_co2_saved('carpooling', v_dist);
    v_pts := public.trip_eco_points('carpooling', v_dist);

    -- Senza passeggeri non c'è nessun risparmio reale: nessun punto.
    IF v_pass > 0 AND v_pts > 0 THEN
      UPDATE profiles
      SET eco_score       = COALESCE(eco_score, 0) + v_pts,
          total_co2_saved = COALESCE(total_co2_saved, 0) + v_co2,
          last_activity_date = CURRENT_DATE,
          updated_at = NOW()
      WHERE id = r.driver_id;

      INSERT INTO trips (user_id, transport_mode, distance_km, co2_saved_kg, eco_points, notes, recorded_at)
      VALUES (
        r.driver_id, 'carpooling', v_dist, v_co2, v_pts,
        'Carpool completato — ' || v_pass ||
          CASE WHEN v_pass = 1 THEN ' passeggero' ELSE ' passeggeri' END,
        NOW()
      );
    END IF;

    FOR b IN
      SELECT passenger_id
      FROM carpooling_bookings
      WHERE ride_id = r.id AND passenger_id <> r.driver_id
    LOOP
      IF v_pts > 0 THEN
        UPDATE profiles
        SET eco_score       = COALESCE(eco_score, 0) + v_pts,
            total_co2_saved = COALESCE(total_co2_saved, 0) + v_co2,
            last_activity_date = CURRENT_DATE,
            updated_at = NOW()
        WHERE id = b.passenger_id;

        INSERT INTO trips (user_id, transport_mode, distance_km, co2_saved_kg, eco_points, notes, recorded_at)
        VALUES (
          b.passenger_id, 'carpooling', v_dist, v_co2, v_pts,
          'Carpool completato (passeggero)', NOW()
        );
      END IF;
    END LOOP;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.process_expired_carpool_rides() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_expired_carpool_rides() FROM anon;
GRANT EXECUTE ON FUNCTION public.process_expired_carpool_rides() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. PREMI CLUB: riscatto atomico (se le tabelle esistono)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.club_prizes') IS NOT NULL THEN
    -- Un costo <= 0 permetterebbe di guadagnare punti riscattando il premio.
    UPDATE public.club_prizes SET points_cost = 100 WHERE points_cost <= 0;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'club_prizes_points_cost_positive'
    ) THEN
      ALTER TABLE public.club_prizes
        ADD CONSTRAINT club_prizes_points_cost_positive CHECK (points_cost > 0);
    END IF;

    DROP POLICY IF EXISTS "prizes_insert" ON public.club_prizes;
    DROP POLICY IF EXISTS "prizes_update" ON public.club_prizes;
    CREATE POLICY "prizes_insert" ON public.club_prizes
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM clubs WHERE id = club_id AND created_by = auth.uid()
        )
      );
    CREATE POLICY "prizes_update" ON public.club_prizes
      FOR UPDATE USING (
        EXISTS (
          SELECT 1 FROM clubs WHERE id = club_id AND created_by = auth.uid()
        )
      );
  END IF;

  IF to_regclass('public.club_prize_redemptions') IS NOT NULL THEN
    DROP POLICY IF EXISTS "redemptions_insert" ON public.club_prize_redemptions;

    -- Su alcuni database la colonna status non esiste ancora: serve sia qui sotto
    -- sia in redeem_club_prize().
    ALTER TABLE public.club_prize_redemptions
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'confirmed';
    UPDATE public.club_prize_redemptions SET status = 'confirmed' WHERE status IS NULL;

    -- Normalizza eventuali doppi riscatti storici prima dell'indice unico.
    UPDATE public.club_prize_redemptions r
    SET status = 'cancelled'
    FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY prize_id, user_id ORDER BY redeemed_at, id
      ) AS rn
      FROM public.club_prize_redemptions
      WHERE status = 'confirmed'
    ) d
    WHERE r.id = d.id AND d.rn > 1;

    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'club_prize_redemptions'
        AND indexname = 'club_prize_redemptions_once_idx'
    ) THEN
      CREATE UNIQUE INDEX club_prize_redemptions_once_idx
        ON public.club_prize_redemptions (prize_id, user_id)
        WHERE status = 'confirmed';
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.redeem_club_prize(
  p_prize_id UUID,
  p_club_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_prize RECORD;
  v_score INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_members WHERE club_id = p_club_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Non sei membro di questo club';
  END IF;

  SELECT * INTO v_prize FROM club_prizes WHERE id = p_prize_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Premio non trovato';
  END IF;
  IF v_prize.club_id <> p_club_id OR NOT COALESCE(v_prize.is_active, FALSE) THEN
    RAISE EXCEPTION 'Premio non disponibile';
  END IF;
  IF v_prize.expires_at IS NOT NULL AND v_prize.expires_at < NOW() THEN
    RAISE EXCEPTION 'Premio scaduto';
  END IF;
  IF COALESCE(v_prize.points_cost, 0) <= 0 THEN
    RAISE EXCEPTION 'Costo del premio non valido';
  END IF;
  IF EXISTS (
    SELECT 1 FROM club_prize_redemptions
    WHERE prize_id = p_prize_id AND user_id = v_uid AND status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'Premio già riscattato';
  END IF;

  SELECT eco_score INTO v_score FROM profiles WHERE id = v_uid FOR UPDATE;
  IF COALESCE(v_score, 0) < v_prize.points_cost THEN
    RAISE EXCEPTION 'Punti insufficienti';
  END IF;
  IF v_prize.stock IS NOT NULL AND v_prize.stock <= 0 THEN
    RAISE EXCEPTION 'Premio esaurito';
  END IF;

  UPDATE profiles
    SET eco_score = eco_score - v_prize.points_cost, updated_at = NOW()
    WHERE id = v_uid;

  IF v_prize.stock IS NOT NULL THEN
    UPDATE club_prizes SET stock = stock - 1 WHERE id = p_prize_id;
  END IF;

  INSERT INTO club_prize_redemptions (prize_id, user_id, club_id, status)
  VALUES (p_prize_id, v_uid, p_club_id, 'confirmed');
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_club_prize(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_club_prize(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.redeem_club_prize(UUID, UUID) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. RICARICA SCHEMA POSTGREST
-- ═══════════════════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

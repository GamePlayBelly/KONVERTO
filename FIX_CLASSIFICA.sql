-- ═══════════════════════════════════════════════════════════════════════════
-- FIX CLASSIFICA "30 GIORNI"  —  Supabase Dashboard → SQL Editor → Run
--
-- Perché serve: i viaggi degli altri utenti sono protetti da RLS, quindi il
-- browser NON può sommarli. Senza la funzione qui sotto la classifica mostra 0
-- a tutti (o solo i punti di chi sta guardando). Questo script è idempotente:
-- puoi rieseguirlo quante volte vuoi. Durata: pochi secondi.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0. Colonne/indici necessari ────────────────────────────────────────────────
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS trips_recorded_at_user_idx
  ON public.trips (recorded_at, user_id);

-- 1. Aggregato di periodo per TUTTI i giocatori (server-side) ────────────────
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
    FROM public.trips t
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
  FROM public.profiles p
  LEFT JOIN period ON period.user_id = p.id
  ORDER BY COALESCE(period.pts, 0) DESC,
           COALESCE(p.eco_score, 0) DESC,
           p.username ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$$;

REVOKE ALL ON FUNCTION public.get_period_leaderboard(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_period_leaderboard(TIMESTAMPTZ, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_period_leaderboard(TIMESTAMPTZ, INTEGER) TO authenticated;

-- 2. Tabella settimanale: trigger corretto (settimana da lunedì) ─────────────
CREATE OR REPLACE FUNCTION public.update_weekly_leaderboard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.leaderboard_weekly
    (user_id, week_start, total_points, total_co2_saved, total_distance_km)
  VALUES (
    NEW.user_id,
    date_trunc('week', NEW.recorded_at)::date,   -- lunedì
    COALESCE(NEW.eco_points, 0),
    COALESCE(NEW.co2_saved_kg, 0),
    COALESCE(NEW.distance_km, 0)
  )
  ON CONFLICT (user_id, week_start) DO UPDATE SET
    total_points      = public.leaderboard_weekly.total_points      + EXCLUDED.total_points,
    total_co2_saved   = public.leaderboard_weekly.total_co2_saved   + EXCLUDED.total_co2_saved,
    total_distance_km = public.leaderboard_weekly.total_distance_km + EXCLUDED.total_distance_km;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_update_leaderboard ON public.trips;
CREATE TRIGGER trip_update_leaderboard
  AFTER INSERT ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.update_weekly_leaderboard();

-- Lettura pubblica, scrittura solo dal trigger (i client non devono scrivere)
ALTER TABLE public.leaderboard_weekly ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Classifica visibile"      ON public.leaderboard_weekly;
DROP POLICY IF EXISTS "Sistema aggiorna classifica" ON public.leaderboard_weekly;
DROP POLICY IF EXISTS "Leaderboard public"       ON public.leaderboard_weekly;
DROP POLICY IF EXISTS "Update own weekly"        ON public.leaderboard_weekly;
DROP POLICY IF EXISTS "leaderboard_weekly_read"  ON public.leaderboard_weekly;
CREATE POLICY "leaderboard_weekly_read" ON public.leaderboard_weekly
  FOR SELECT USING (TRUE);

-- 3. Ricostruisci la tabella settimanale dai viaggi già registrati ──────────
DELETE FROM public.leaderboard_weekly;

INSERT INTO public.leaderboard_weekly
  (user_id, week_start, total_points, total_co2_saved, total_distance_km)
SELECT
  t.user_id,
  date_trunc('week', t.recorded_at)::date,
  COALESCE(SUM(t.eco_points), 0)::INTEGER,
  COALESCE(SUM(t.co2_saved_kg), 0)::NUMERIC,
  COALESCE(SUM(t.distance_km), 0)::NUMERIC
FROM public.trips t
WHERE COALESCE(t.is_scheduled, FALSE) = FALSE
  AND t.recorded_at <= NOW()
GROUP BY 1, 2;

-- 4. Realtime: la classifica si aggiorna dal vivo (facoltativo) ─────────────
DO $$
DECLARE
  tbl TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'Publication supabase_realtime assente: salto il realtime';
    RETURN;
  END IF;
  FOREACH tbl IN ARRAY ARRAY['profiles', 'leaderboard_weekly'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;

-- Forza PostgREST a vedere subito la nuova funzione
NOTIFY pgrst, 'reload schema';

-- 5. DIAGNOSTICA — incolla qui il risultato se qualcosa non torna ───────────
SELECT
  (SELECT count(*) FROM public.trips)                                              AS viaggi_totali,
  (SELECT count(*) FROM public.trips
    WHERE recorded_at >= NOW() - INTERVAL '30 days')                               AS viaggi_ultimi_30gg,
  (SELECT max(recorded_at) FROM public.trips)                                      AS ultimo_viaggio,
  (SELECT count(*) FROM public.profiles)                                           AS profili,
  (SELECT count(*) FROM public.leaderboard_weekly)                                 AS righe_weekly;

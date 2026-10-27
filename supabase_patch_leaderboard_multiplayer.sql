-- ═══════════════════════════════════════════════════════════════════════════
-- ECOTRACK — Patch: classifica "multiplayer" (punteggi di tutti + realtime)
-- Esegui UNA VOLTA in Supabase → SQL Editor
--
-- PROBLEMA RISOLTO
-- La classifica a 30 giorni sommava i punti leggendo la tabella `trips` dal
-- browser. La RLS di `trips` però espone solo i viaggi dell'utente loggato
-- (`auth.uid() = user_id`), quindi tutti gli altri giocatori risultavano a 0:
-- si vedeva il punteggio reale solo della persona collegata in quel momento.
--
-- SOLUZIONE
--  1. RPC `get_period_leaderboard()`: aggrega i viaggi di TUTTI gli utenti
--     lato server (SECURITY DEFINER) e restituisce solo i totali aggregati
--     (nessun dato sensibile dei singoli viaggi).
--  2. Realtime su `profiles` e `leaderboard_weekly`: la classifica si aggiorna
--     dal vivo quando un giocatore guadagna punti.
--  3. Indice su `trips(recorded_at, user_id)` per rendere veloce l'aggregato.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Aggregato di periodo per TUTTI i giocatori ────────────────────────────
CREATE OR REPLACE FUNCTION get_period_leaderboard(
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

-- Solo utenti autenticati possono chiamarla
REVOKE ALL ON FUNCTION get_period_leaderboard(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_period_leaderboard(TIMESTAMPTZ, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION get_period_leaderboard(TIMESTAMPTZ, INTEGER) TO authenticated;

-- ── 2. Indice per l'aggregato di periodo ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS trips_recorded_at_user_idx
  ON trips (recorded_at, user_id);

-- ── 3. Realtime "multiplayer" ────────────────────────────────────────────────
-- profiles: eco_score cambia quando un giocatore guadagna punti (SELECT pubblica
--   → gli eventi UPDATE arrivano a tutti)
-- leaderboard_weekly: scritta dal trigger dei viaggi (SELECT pubblica → evento
--   broadcast anche per i viaggi degli altri utenti)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'Publication supabase_realtime non trovata: salto il setup realtime';
    RETURN;
  END IF;

  FOREACH tbl IN ARRAY ARRAY['profiles', 'leaderboard_weekly'] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname    = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename  = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;

-- Forza PostgREST a ricaricare lo schema (RPC subito disponibile)
NOTIFY pgrst, 'reload schema';

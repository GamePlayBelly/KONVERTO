-- ═══════════════════════════════════════════════════════════════════════════
-- ECOTRACK — Patch: classifica a 30 giorni
-- Esegui UNA VOLTA in Supabase → SQL Editor
--
-- Problema: la RLS della tabella "trips" fa vedere a ogni utente solo i PROPRI
-- viaggi. La classifica a 30 giorni sommava i viaggi nel browser, quindi contava
-- solo i punti dell'utente loggato e mostrava 0 per tutti gli altri.
--
-- Soluzione: funzione SECURITY DEFINER che somma i viaggi di tutti nel periodo e
-- restituisce SOLO i totali per utente (mai il dettaglio dei viaggi: posizioni,
-- note, ecc. restano privati).
-- Sono esclusi i viaggi programmati non ancora accreditati (is_scheduled).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_period_leaderboard(
  p_start TIMESTAMPTZ,
  p_end   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (user_id UUID, period_points BIGINT, period_co2 NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.user_id,
         COALESCE(SUM(t.eco_points), 0)::BIGINT,
         COALESCE(SUM(t.co2_saved_kg), 0)::NUMERIC
  FROM trips t
  WHERE auth.uid() IS NOT NULL                       -- solo utenti loggati
    AND t.recorded_at >= p_start
    AND (p_end IS NULL OR t.recorded_at < p_end)
    AND COALESCE(t.is_scheduled, FALSE) = FALSE
  GROUP BY t.user_id
$$;

-- ── Permessi RPC (solo utenti autenticati) ───────────────────────────────────
REVOKE ALL ON FUNCTION get_period_leaderboard(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_period_leaderboard(TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION get_period_leaderboard(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

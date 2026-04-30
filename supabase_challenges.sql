-- ── Profile extra columns ─────────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferred_transport text CHECK (preferred_transport IN ('walking','cycling','public_transport','electric_vehicle','carpooling'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS weekly_goal_km numeric DEFAULT 0;

-- ── Challenges table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenges (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  challenger_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  challenged_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  metric        text NOT NULL CHECK (metric IN ('eco_points', 'co2_saved', 'distance_km')),
  duration_days integer NOT NULL DEFAULT 7,
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  challenger_score numeric NOT NULL DEFAULT 0,
  challenged_score numeric NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','completed','rejected')),
  winner_id     uuid REFERENCES profiles(id),
  created_at    timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Challenges visible to participants" ON challenges;
CREATE POLICY "Challenges visible to participants" ON challenges
  FOR SELECT USING (auth.uid() = challenger_id OR auth.uid() = challenged_id);

DROP POLICY IF EXISTS "Challengers can create" ON challenges;
CREATE POLICY "Challengers can create" ON challenges
  FOR INSERT WITH CHECK (auth.uid() = challenger_id);

DROP POLICY IF EXISTS "Participants can update" ON challenges;
CREATE POLICY "Participants can update" ON challenges
  FOR UPDATE USING (auth.uid() = challenger_id OR auth.uid() = challenged_id);

-- ── Update challenge scores on trip INSERT ────────────────────────────────────
CREATE OR REPLACE FUNCTION update_challenge_scores()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trip_date date := (NEW.recorded_at AT TIME ZONE 'UTC')::date;
BEGIN
  -- Update challenger score for active challenges where this user is challenger
  UPDATE challenges
  SET challenger_score = challenger_score + CASE
    WHEN metric = 'eco_points' THEN NEW.eco_points
    WHEN metric = 'co2_saved'  THEN NEW.co2_saved_kg
    WHEN metric = 'distance_km' THEN NEW.distance_km
    ELSE 0
  END
  WHERE status = 'active'
    AND challenger_id = NEW.user_id
    AND v_trip_date BETWEEN start_date AND end_date;

  -- Update challenged score for active challenges where this user is challenged
  UPDATE challenges
  SET challenged_score = challenged_score + CASE
    WHEN metric = 'eco_points' THEN NEW.eco_points
    WHEN metric = 'co2_saved'  THEN NEW.co2_saved_kg
    WHEN metric = 'distance_km' THEN NEW.distance_km
    ELSE 0
  END
  WHERE status = 'active'
    AND challenged_id = NEW.user_id
    AND v_trip_date BETWEEN start_date AND end_date;

  -- Complete challenges that have passed end_date
  UPDATE challenges
  SET
    status = 'completed',
    winner_id = CASE
      WHEN challenger_score > challenged_score THEN challenger_id
      WHEN challenged_score > challenger_score THEN challenged_id
      ELSE NULL -- draw
    END
  WHERE status = 'active' AND end_date < CURRENT_DATE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_update_challenges ON trips;
CREATE TRIGGER trip_update_challenges
  AFTER INSERT ON trips
  FOR EACH ROW EXECUTE FUNCTION update_challenge_scores();

-- Auto-activate challenges on start_date
CREATE OR REPLACE FUNCTION activate_pending_challenges()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE challenges SET status = 'active'
  WHERE status = 'pending' AND start_date <= CURRENT_DATE;
END;
$$;

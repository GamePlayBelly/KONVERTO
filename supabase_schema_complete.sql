-- ═══════════════════════════════════════════════════════════════════════════
-- EcoTrack — Schema completo (eseguire nel SQL Editor di Supabase)
-- Include: tabelle, RLS, trigger, funzioni, seed dati
-- ═══════════════════════════════════════════════════════════════════════════

-- ── PROFILES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  city TEXT,
  eco_score INTEGER DEFAULT 0,
  total_co2_saved DECIMAL(10,3) DEFAULT 0,
  streak_days INTEGER DEFAULT 0,
  last_activity_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Profili visibili" ON profiles;
DROP POLICY IF EXISTS "Aggiorna profilo" ON profiles;
CREATE POLICY "Profili visibili" ON profiles FOR SELECT USING (TRUE);
CREATE POLICY "Aggiorna profilo" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Trigger: crea profilo su registrazione
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'full_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── TRIPS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  transport_mode TEXT NOT NULL CHECK (transport_mode IN ('walking','cycling','public_transport','electric_vehicle','carpooling')),
  distance_km DECIMAL(8,2) NOT NULL,
  duration_minutes INTEGER,
  co2_saved_kg DECIMAL(8,4) NOT NULL DEFAULT 0,
  eco_points INTEGER NOT NULL DEFAULT 0,
  start_location JSONB,
  end_location JSONB,
  notes TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Vedi i tuoi viaggi" ON trips;
DROP POLICY IF EXISTS "Inserisci il tuo viaggio" ON trips;
DROP POLICY IF EXISTS "Elimina il tuo viaggio" ON trips;
CREATE POLICY "Vedi i tuoi viaggi" ON trips FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Inserisci il tuo viaggio" ON trips FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Elimina il tuo viaggio" ON trips FOR DELETE USING (auth.uid() = user_id);

-- ── BADGES ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS badges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon_name TEXT,
  category TEXT CHECK (category IN ('distance','streak','co2','social','special')),
  threshold_value DECIMAL,
  points_reward INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_badges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  badge_id UUID REFERENCES badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, badge_id)
);

ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Badge visibili" ON badges;
DROP POLICY IF EXISTS "I miei badge" ON user_badges;
DROP POLICY IF EXISTS "Assegna badge sistema" ON user_badges;
CREATE POLICY "Badge visibili" ON badges FOR SELECT USING (TRUE);
CREATE POLICY "I miei badge" ON user_badges FOR SELECT USING (TRUE);
CREATE POLICY "Assegna badge sistema" ON user_badges FOR INSERT WITH CHECK (TRUE);

-- ── LEADERBOARD WEEKLY ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leaderboard_weekly (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  total_points INTEGER DEFAULT 0,
  total_co2_saved DECIMAL(10,3) DEFAULT 0,
  total_distance_km DECIMAL(10,2) DEFAULT 0,
  UNIQUE(user_id, week_start)
);

ALTER TABLE leaderboard_weekly ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Classifica visibile" ON leaderboard_weekly;
DROP POLICY IF EXISTS "Sistema aggiorna classifica" ON leaderboard_weekly;
CREATE POLICY "Classifica visibile" ON leaderboard_weekly FOR SELECT USING (TRUE);
CREATE POLICY "Sistema aggiorna classifica" ON leaderboard_weekly FOR ALL USING (TRUE);

-- ── CLUBS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clubs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  cover_url TEXT,
  city TEXT,
  company TEXT,
  is_public BOOLEAN DEFAULT TRUE,
  eco_score_total INTEGER DEFAULT 0,
  member_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS club_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin','moderator','member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(club_id, user_id)
);

ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Club pubblici visibili" ON clubs;
DROP POLICY IF EXISTS "Crea club" ON clubs;
DROP POLICY IF EXISTS "Admin aggiorna club" ON clubs;
DROP POLICY IF EXISTS "Membri visibili" ON club_members;
DROP POLICY IF EXISTS "Unisciti club" ON club_members;
DROP POLICY IF EXISTS "Lascia club" ON club_members;
CREATE POLICY "Club pubblici visibili" ON clubs FOR SELECT USING (TRUE);
CREATE POLICY "Crea club" ON clubs FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Admin aggiorna club" ON clubs FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY "Membri visibili" ON club_members FOR SELECT USING (TRUE);
CREATE POLICY "Unisciti club" ON club_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Lascia club" ON club_members FOR DELETE USING (auth.uid() = user_id);

-- ── CHAT ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT DEFAULT 'private' CHECK (type IN ('private','group','club')),
  name TEXT,
  avatar_url TEXT,
  club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  last_message TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text','image','trip_share')),
  trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at DESC);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Vedi conversazioni" ON conversations;
DROP POLICY IF EXISTS "Crea conversazione" ON conversations;
DROP POLICY IF EXISTS "Aggiorna conversazione" ON conversations;
DROP POLICY IF EXISTS "Vedi membri conv" ON conversation_members;
DROP POLICY IF EXISTS "Aggiungi membro conv" ON conversation_members;
DROP POLICY IF EXISTS "Vedi messaggi" ON messages;
DROP POLICY IF EXISTS "Invia messaggio" ON messages;
CREATE POLICY "Vedi conversazioni" ON conversations FOR SELECT
  USING (EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = id AND user_id = auth.uid()));
CREATE POLICY "Crea conversazione" ON conversations FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Aggiorna conversazione" ON conversations FOR UPDATE
  USING (EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = id AND user_id = auth.uid()));
CREATE POLICY "Vedi membri conv" ON conversation_members FOR SELECT USING (TRUE);
CREATE POLICY "Aggiungi membro conv" ON conversation_members FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "Vedi messaggi" ON messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()));
CREATE POLICY "Invia messaggio" ON messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id AND EXISTS (
    SELECT 1 FROM conversation_members WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()
  ));

-- ── SHOP ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shop_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  category TEXT CHECK (category IN ('voucher','gadget','experience','donation','badge_special')),
  points_cost INTEGER NOT NULL,
  stock INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  partner_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shop_purchases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  item_id UUID REFERENCES shop_items(id),
  points_spent INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','delivered','cancelled')),
  purchased_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE shop_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Shop visibile" ON shop_items;
DROP POLICY IF EXISTS "I miei acquisti" ON shop_purchases;
DROP POLICY IF EXISTS "Acquista" ON shop_purchases;
CREATE POLICY "Shop visibile" ON shop_items FOR SELECT USING (is_active = TRUE);
CREATE POLICY "I miei acquisti" ON shop_purchases FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Acquista" ON shop_purchases FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── CARPOOLING ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carpooling_rides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  origin_label TEXT NOT NULL,
  origin_lat DECIMAL(10,6),
  origin_lng DECIMAL(10,6),
  destination_label TEXT NOT NULL,
  destination_lat DECIMAL(10,6),
  destination_lng DECIMAL(10,6),
  departure_time TIMESTAMPTZ NOT NULL,
  available_seats INTEGER DEFAULT 3,
  booked_seats INTEGER DEFAULT 0,
  distance_km DECIMAL(8,2),
  price_per_seat DECIMAL(6,2) DEFAULT 0,
  notes TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','full','completed','cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carpooling_bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ride_id UUID REFERENCES carpooling_rides(id) ON DELETE CASCADE,
  passenger_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  booked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ride_id, passenger_id)
);

ALTER TABLE carpooling_rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpooling_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Vedi passaggi" ON carpooling_rides;
DROP POLICY IF EXISTS "Pubblica passaggio" ON carpooling_rides;
DROP POLICY IF EXISTS "Aggiorna passaggio" ON carpooling_rides;
DROP POLICY IF EXISTS "Cancella passaggio" ON carpooling_rides;
DROP POLICY IF EXISTS "Vedi prenotazioni" ON carpooling_bookings;
DROP POLICY IF EXISTS "Prenota" ON carpooling_bookings;
DROP POLICY IF EXISTS "Cancella prenotazione" ON carpooling_bookings;
CREATE POLICY "Vedi passaggi" ON carpooling_rides FOR SELECT USING (TRUE);
CREATE POLICY "Pubblica passaggio" ON carpooling_rides FOR INSERT WITH CHECK (auth.uid() = driver_id);
CREATE POLICY "Aggiorna passaggio" ON carpooling_rides FOR UPDATE USING (auth.uid() = driver_id);
CREATE POLICY "Cancella passaggio" ON carpooling_rides FOR DELETE USING (auth.uid() = driver_id);
CREATE POLICY "Vedi prenotazioni" ON carpooling_bookings FOR SELECT USING (TRUE);
CREATE POLICY "Prenota" ON carpooling_bookings FOR INSERT WITH CHECK (auth.uid() = passenger_id);
CREATE POLICY "Cancella prenotazione" ON carpooling_bookings FOR DELETE USING (auth.uid() = passenger_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNZIONI E TRIGGER
-- ═══════════════════════════════════════════════════════════════════════════

-- increment_profile_stats (RPC chiamato dal frontend)
CREATE OR REPLACE FUNCTION increment_profile_stats(
  p_user_id UUID,
  p_points INTEGER,
  p_co2 DECIMAL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE profiles SET
    eco_score = eco_score + p_points,
    total_co2_saved = total_co2_saved + p_co2,
    last_activity_date = CURRENT_DATE,
    updated_at = NOW()
  WHERE id = p_user_id;
END;
$$;

-- Aggiorna leaderboard settimanale su inserimento viaggio
CREATE OR REPLACE FUNCTION update_weekly_leaderboard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_week_start DATE;
BEGIN
  v_week_start := (DATE_TRUNC('week', NEW.recorded_at) + INTERVAL '1 day')::DATE;
  -- Supabase weeks start on Monday
  IF EXTRACT(DOW FROM NEW.recorded_at) = 0 THEN
    v_week_start := (DATE_TRUNC('week', NEW.recorded_at) - INTERVAL '6 days')::DATE;
  ELSE
    v_week_start := (DATE_TRUNC('week', NEW.recorded_at) + INTERVAL '1 day')::DATE;
  END IF;

  INSERT INTO leaderboard_weekly (user_id, week_start, total_points, total_co2_saved, total_distance_km)
  VALUES (NEW.user_id, v_week_start, NEW.eco_points, NEW.co2_saved_kg, NEW.distance_km)
  ON CONFLICT (user_id, week_start) DO UPDATE SET
    total_points = leaderboard_weekly.total_points + EXCLUDED.total_points,
    total_co2_saved = leaderboard_weekly.total_co2_saved + EXCLUDED.total_co2_saved,
    total_distance_km = leaderboard_weekly.total_distance_km + EXCLUDED.total_distance_km;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_update_leaderboard ON trips;
CREATE TRIGGER trip_update_leaderboard
  AFTER INSERT ON trips
  FOR EACH ROW EXECUTE FUNCTION update_weekly_leaderboard();

-- Aggiorna streak su inserimento viaggio
CREATE OR REPLACE FUNCTION update_streak()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_last_date DATE;
BEGIN
  SELECT last_activity_date INTO v_last_date FROM profiles WHERE id = NEW.user_id;
  IF v_last_date IS NULL THEN
    UPDATE profiles SET streak_days = 1 WHERE id = NEW.user_id;
  ELSIF v_last_date = CURRENT_DATE THEN
    NULL; -- stesso giorno, non cambia streak
  ELSIF v_last_date = CURRENT_DATE - INTERVAL '1 day' THEN
    UPDATE profiles SET streak_days = streak_days + 1 WHERE id = NEW.user_id;
  ELSE
    UPDATE profiles SET streak_days = 1 WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_update_streak ON trips;
CREATE TRIGGER trip_update_streak
  AFTER INSERT ON trips
  FOR EACH ROW EXECUTE FUNCTION update_streak();

-- Auto-assegna badge
CREATE OR REPLACE FUNCTION check_and_award_badges(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total_km DECIMAL;
  v_total_co2 DECIMAL;
  v_streak INTEGER;
  v_eco_score INTEGER;
  v_trip_count INTEGER;
  v_cycling_km DECIMAL;
  v_transit_count INTEGER;
  v_carpooling_count INTEGER;
  v_badge RECORD;
  v_earned BOOLEAN;
BEGIN
  SELECT
    COALESCE(SUM(distance_km), 0),
    COALESCE(SUM(co2_saved_kg), 0),
    COUNT(*)
  INTO v_total_km, v_total_co2, v_trip_count
  FROM trips WHERE user_id = p_user_id;

  SELECT eco_score, streak_days INTO v_eco_score, v_streak FROM profiles WHERE id = p_user_id;
  SELECT COALESCE(SUM(distance_km), 0) INTO v_cycling_km FROM trips WHERE user_id = p_user_id AND transport_mode = 'cycling';
  SELECT COUNT(*) INTO v_transit_count FROM trips WHERE user_id = p_user_id AND transport_mode = 'public_transport';
  SELECT COUNT(*) INTO v_carpooling_count FROM trips WHERE user_id = p_user_id AND transport_mode = 'carpooling';

  FOR v_badge IN SELECT * FROM badges LOOP
    IF EXISTS (SELECT 1 FROM user_badges WHERE user_id = p_user_id AND badge_id = v_badge.id) THEN
      CONTINUE;
    END IF;

    v_earned := FALSE;

    CASE v_badge.category
      WHEN 'distance' THEN
        IF v_badge.name ILIKE '%primo%' OR v_badge.name ILIKE '%passo%' THEN
          v_earned := v_trip_count >= COALESCE(v_badge.threshold_value, 1);
        ELSIF v_badge.name ILIKE '%cicl%' OR v_badge.name ILIKE '%bici%' THEN
          v_earned := v_cycling_km >= COALESCE(v_badge.threshold_value, 0);
        ELSIF v_badge.name ILIKE '%cammin%' THEN
          v_earned := v_total_km >= COALESCE(v_badge.threshold_value, 0);
        ELSE
          v_earned := v_total_km >= COALESCE(v_badge.threshold_value, 0);
        END IF;
      WHEN 'co2' THEN
        v_earned := v_total_co2 >= COALESCE(v_badge.threshold_value, 0);
      WHEN 'streak' THEN
        v_earned := v_streak >= COALESCE(v_badge.threshold_value, 0);
      WHEN 'social' THEN
        IF v_badge.name ILIKE '%pendol%' OR v_badge.name ILIKE '%pubbl%' THEN
          v_earned := v_transit_count >= COALESCE(v_badge.threshold_value, 0);
        ELSIF v_badge.name ILIKE '%carpooler%' OR v_badge.name ILIKE '%carpooling%' THEN
          v_earned := v_carpooling_count >= COALESCE(v_badge.threshold_value, 0);
        END IF;
      WHEN 'special' THEN
        v_earned := v_eco_score >= COALESCE(v_badge.threshold_value, 0);
      ELSE
        v_earned := FALSE;
    END CASE;

    IF v_earned THEN
      INSERT INTO user_badges (user_id, badge_id) VALUES (p_user_id, v_badge.id) ON CONFLICT DO NOTHING;
      UPDATE profiles SET eco_score = eco_score + COALESCE(v_badge.points_reward, 0) WHERE id = p_user_id;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION trip_check_badges()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM check_and_award_badges(NEW.user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_badge_check ON trips;
CREATE TRIGGER trip_badge_check
  AFTER INSERT ON trips
  FOR EACH ROW EXECUTE FUNCTION trip_check_badges();

-- Aggiorna contatore membri club
CREATE OR REPLACE FUNCTION update_club_member_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE clubs SET member_count = member_count + 1 WHERE id = NEW.club_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE clubs SET member_count = GREATEST(0, member_count - 1) WHERE id = OLD.club_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS club_member_count_trigger ON club_members;
CREATE TRIGGER club_member_count_trigger
  AFTER INSERT OR DELETE ON club_members
  FOR EACH ROW EXECUTE FUNCTION update_club_member_count();

-- Aggiorna posti prenotati carpooling
CREATE OR REPLACE FUNCTION update_carpooling_booked_seats()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE carpooling_rides
    SET booked_seats = booked_seats + 1,
        status = CASE WHEN booked_seats + 1 >= available_seats THEN 'full' ELSE 'active' END
    WHERE id = NEW.ride_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE carpooling_rides
    SET booked_seats = GREATEST(0, booked_seats - 1),
        status = 'active'
    WHERE id = OLD.ride_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS carpooling_seats_trigger ON carpooling_bookings;
CREATE TRIGGER carpooling_seats_trigger
  AFTER INSERT OR DELETE ON carpooling_bookings
  FOR EACH ROW EXECUTE FUNCTION update_carpooling_booked_seats();

-- ═══════════════════════════════════════════════════════════════════════════
-- SEED DATI
-- ═══════════════════════════════════════════════════════════════════════════

-- Shop items (ignora se già esistono)
INSERT INTO shop_items (name, description, category, points_cost, partner_name, stock)
SELECT * FROM (VALUES
  ('Voucher caffè bio', '1 caffè gratuito in un bar partner sostenibile', 'voucher', 150, 'GreenCafé', 100),
  ('Borraccia EcoTrack', 'Borraccia in acciaio inox 750ml brandizzata EcoTrack', 'gadget', 500, 'EcoTrack', 50),
  ('Abbonamento mensile bus', 'Un mese di trasporto pubblico gratuito', 'voucher', 2000, 'ATM Milano', 20),
  ('Pianta un albero', 'Piantiamo un albero a tuo nome in Italia', 'donation', 300, 'TreeItaly', NULL),
  ('Tour e-bike guidato', 'Tour di 2 ore in e-bike nella tua città', 'experience', 800, 'BikeCity', 30),
  ('Sconto 20% negozio bio', 'Coupon 20% su un negozio biologico partner', 'voucher', 200, 'BioShop', 200),
  ('Zaino sostenibile', 'Zaino in materiale riciclato 25L', 'gadget', 1200, 'EcoGear', 25),
  ('Donazione foresta amazzonica', 'Proteggi 100m² di foresta amazzonica', 'donation', 400, 'RainForest', NULL),
  ('Badge Eco Legend', 'Badge esclusivo per i top performer', 'badge_special', 3000, 'EcoTrack', NULL),
  ('Lezione yoga outdoor', 'Una lezione di yoga all''aperto in un parco urbano', 'experience', 600, 'ZenCity', 40)
) AS t(name, description, category, points_cost, partner_name, stock)
WHERE NOT EXISTS (SELECT 1 FROM shop_items LIMIT 1);

-- Badges (ignora se già esistono)
INSERT INTO badges (name, description, icon_name, category, threshold_value, points_reward)
SELECT * FROM (VALUES
  ('Primo passo', 'Registra il tuo primo viaggio', '👣', 'distance', 1, 50),
  ('Camminatore', 'Percorri 10 km a piedi', '🚶', 'distance', 10, 100),
  ('Ciclista urbano', 'Percorri 50 km in bici', '🚴', 'distance', 50, 200),
  ('Ciclista esperto', 'Percorri 200 km in bici', '🚵', 'distance', 200, 400),
  ('Pendolare verde', 'Usa i mezzi pubblici 10 volte', '🚌', 'social', 10, 150),
  ('Risparmio CO₂ 10kg', 'Risparmia 10 kg di CO₂', '🌿', 'co2', 10, 200),
  ('Risparmio CO₂ 50kg', 'Risparmia 50 kg di CO₂', '🌳', 'co2', 50, 500),
  ('Risparmio CO₂ 100kg', 'Risparmia 100 kg di CO₂', '🌍', 'co2', 100, 800),
  ('Streak 7 giorni', '7 giorni consecutivi di viaggi green', '🔥', 'streak', 7, 300),
  ('Streak 30 giorni', '30 giorni consecutivi di viaggi green', '⚡', 'streak', 30, 1000),
  ('Carpooler', 'Condividi 5 passaggi in carpooling', '🚗', 'social', 5, 250),
  ('Eco Champion', 'Raggiungi 5000 punti eco', '🏆', 'special', 5000, 1000),
  ('Eco Legend', 'Raggiungi 15000 punti eco', '👑', 'special', 15000, 2000),
  ('Club Founder', 'Crea il tuo primo club aziendale', '🏢', 'special', 1, 500),
  ('Maratoneta verde', 'Percorri 500 km totali', '🏃', 'distance', 500, 600)
) AS t(name, description, icon_name, category, threshold_value, points_reward)
WHERE NOT EXISTS (SELECT 1 FROM badges LIMIT 1);

-- ═══════════════════════════════════════════════════════════════════════════
-- STORAGE: bucket avatars (eseguire separatamente se non esiste)
-- ═══════════════════════════════════════════════════════════════════════════
-- INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)
-- ON CONFLICT DO NOTHING;
-- CREATE POLICY "Avatar pubblici" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
-- CREATE POLICY "Upload avatar" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "Aggiorna avatar" ON storage.objects FOR UPDATE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

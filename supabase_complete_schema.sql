-- ═══════════════════════════════════════════════════════════════════════════
-- ECOTRACK — Schema completo (run this once in Supabase SQL Editor)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── PROFILES ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  city TEXT,
  bio TEXT,
  preferred_transport TEXT,
  weekly_goal_km NUMERIC(8,2),
  eco_score INTEGER DEFAULT 0,
  total_co2_saved NUMERIC(10,3) DEFAULT 0,
  streak_days INTEGER DEFAULT 0,
  last_activity_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add new columns (safe to run multiple times)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_title TEXT DEFAULT NULL;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public profiles viewable" ON profiles;
DROP POLICY IF EXISTS "Own profile update" ON profiles;
CREATE POLICY "Public profiles viewable" ON profiles FOR SELECT USING (TRUE);
CREATE POLICY "Own profile update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- ── TRIPS ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  transport_mode TEXT NOT NULL,
  distance_km NUMERIC(8,2) NOT NULL,
  duration_minutes INTEGER,
  co2_saved_kg NUMERIC(8,3) DEFAULT 0,
  eco_points INTEGER DEFAULT 0,
  start_location JSONB,
  end_location JSONB,
  notes TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Drop old constraint and add new one with expanded modes
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_transport_mode_check;
ALTER TABLE trips ADD CONSTRAINT trips_transport_mode_check CHECK (
  transport_mode IN (
    'walking','cycling','ebike','escooter',
    'public_transport','tram_metro','train',
    'electric_vehicle','motorcycle','carpooling'
  )
);

CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id, recorded_at DESC);

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own trips" ON trips FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Read own trips" ON trips FOR SELECT USING (auth.uid() = user_id);

-- ── BADGES ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS badges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon_name TEXT,
  category TEXT CHECK (category IN ('distance','streak','co2','social','special')),
  threshold_value NUMERIC,
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
CREATE POLICY "Badges public" ON badges FOR SELECT USING (TRUE);
CREATE POLICY "User badges" ON user_badges FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Earn badge" ON user_badges FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── LEADERBOARD WEEKLY ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leaderboard_weekly (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  total_points INTEGER DEFAULT 0,
  total_co2_saved NUMERIC(10,3) DEFAULT 0,
  total_distance_km NUMERIC(10,2) DEFAULT 0,
  rank INTEGER,
  UNIQUE(user_id, week_start)
);

ALTER TABLE leaderboard_weekly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Leaderboard public" ON leaderboard_weekly FOR SELECT USING (TRUE);
CREATE POLICY "Update own weekly" ON leaderboard_weekly FOR ALL USING (auth.uid() = user_id);

-- ── CLUBS ─────────────────────────────────────────────────────────────────────
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
CREATE POLICY "Clubs visible" ON clubs FOR SELECT USING (TRUE);
CREATE POLICY "Create club" ON clubs FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Admin update club" ON clubs FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY "Admin delete club" ON clubs FOR DELETE USING (auth.uid() = created_by);
CREATE POLICY "Members visible" ON club_members FOR SELECT USING (TRUE);
CREATE POLICY "Join club" ON club_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Leave club" ON club_members FOR DELETE USING (auth.uid() = user_id);

-- ── CONVERSATIONS & CHAT ──────────────────────────────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at DESC);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "See conversations" ON conversations FOR SELECT
  USING (EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = id AND user_id = auth.uid()));
CREATE POLICY "Create conversation" ON conversations FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Update conversation" ON conversations FOR UPDATE
  USING (EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = id AND user_id = auth.uid()));
CREATE POLICY "See conv members" ON conversation_members FOR SELECT USING (TRUE);
CREATE POLICY "Add member" ON conversation_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "See messages" ON messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()));
CREATE POLICY "Send message" ON messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id AND EXISTS (
    SELECT 1 FROM conversation_members WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()
  ));

-- ── SHOP ──────────────────────────────────────────────────────────────────────
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
CREATE POLICY "Shop visible" ON shop_items FOR SELECT USING (is_active = TRUE);
CREATE POLICY "My purchases" ON shop_purchases FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Buy item" ON shop_purchases FOR INSERT WITH CHECK (auth.uid() = user_id);

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
CREATE POLICY "See rides" ON carpooling_rides FOR SELECT USING (TRUE);
CREATE POLICY "Post ride" ON carpooling_rides FOR INSERT WITH CHECK (auth.uid() = driver_id);
CREATE POLICY "Update own ride" ON carpooling_rides FOR UPDATE USING (auth.uid() = driver_id);
CREATE POLICY "Delete own ride" ON carpooling_rides FOR DELETE USING (auth.uid() = driver_id);
CREATE POLICY "See bookings" ON carpooling_bookings FOR SELECT USING (TRUE);
CREATE POLICY "Book ride" ON carpooling_bookings FOR INSERT WITH CHECK (auth.uid() = passenger_id);
CREATE POLICY "Cancel booking" ON carpooling_bookings FOR DELETE USING (auth.uid() = passenger_id);

-- ── CHALLENGES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  challenger_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  challenged_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  metric TEXT CHECK (metric IN ('eco_points','co2_saved','distance_km')),
  duration_days INTEGER DEFAULT 7,
  start_date DATE,
  end_date DATE,
  challenger_score NUMERIC(10,2) DEFAULT 0,
  challenged_score NUMERIC(10,2) DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','active','completed','rejected')),
  winner_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "See challenges" ON challenges FOR SELECT
  USING (auth.uid() = challenger_id OR auth.uid() = challenged_id);
CREATE POLICY "Create challenge" ON challenges FOR INSERT WITH CHECK (auth.uid() = challenger_id);
CREATE POLICY "Update challenge" ON challenges FOR UPDATE
  USING (auth.uid() = challenger_id OR auth.uid() = challenged_id);

-- ── RPC: increment_profile_stats ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_profile_stats(
  p_user_id UUID,
  p_points INTEGER,
  p_co2 NUMERIC
) RETURNS VOID AS $$
BEGIN
  UPDATE profiles SET
    eco_score = eco_score + p_points,
    total_co2_saved = total_co2_saved + p_co2,
    last_activity_date = CURRENT_DATE,
    updated_at = NOW()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── TRIGGER: auto-create profile on signup ───────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NULL)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── SEED: SHOP ITEMS ─────────────────────────────────────────────────────────
INSERT INTO shop_items (name, description, category, points_cost, partner_name, stock) VALUES
  ('Voucher caffè bio', '1 caffè gratuito in un bar partner sostenibile', 'voucher', 150, 'GreenCafé', 100),
  ('Borraccia EcoTrack', 'Borraccia in acciaio inox 750ml brandizzata EcoTrack', 'gadget', 500, 'EcoTrack', 50),
  ('Abbonamento mensile bus', 'Un mese di trasporto pubblico gratuito', 'voucher', 2000, 'ATM Milano', 20),
  ('Pianta un albero', 'Piantiamo un albero a tuo nome in Italia', 'donation', 300, 'TreeItaly', NULL),
  ('Tour e-bike guidato', 'Tour di 2 ore in e-bike nella tua città', 'experience', 800, 'BikeCity', 30),
  ('Sconto 20% negozio bio', 'Coupon 20% su un negozio biologico partner', 'voucher', 200, 'BioShop', 200),
  ('Zaino sostenibile', 'Zaino in materiale riciclato 25L', 'gadget', 1200, 'EcoGear', 25),
  ('Donazione foresta amazzonica', 'Proteggi 100m² di foresta amazzonica', 'donation', 400, 'RainForest', NULL),
  -- Titoli (mostrati nel profilo utente)
  ('🌱 Eco Novizio', 'Il primo passo verso la mobilità sostenibile.', 'title', 100, NULL, NULL),
  ('🚴 Ciclista Urbano', 'Per chi percorre almeno 50 km in bici in città.', 'title', 300, NULL, NULL),
  ('⚡ Guerriero Verde', 'Titolo per i campioni della mobilità a zero emissioni.', 'title', 600, NULL, NULL),
  ('🌍 Custode del Pianeta', 'Hai risparmiato oltre 50 kg di CO₂. Il pianeta ti ringrazia.', 'title', 1000, NULL, NULL),
  ('🏆 Eco Leggenda', 'Il titolo più prestigioso. Solo per i più dedicati.', 'title', 2500, NULL, NULL),
  ('🚂 Pendolare Sostenibile', 'Per chi usa quotidianamente treni e trasporti pubblici.', 'title', 450, NULL, NULL)
ON CONFLICT DO NOTHING;

-- ── SEED: BADGES ─────────────────────────────────────────────────────────────
INSERT INTO badges (name, description, icon_name, category, threshold_value, points_reward) VALUES
  ('Primo passo', 'Registra il tuo primo viaggio', '👣', 'distance', 1, 50),
  ('Camminatore', 'Percorri 10 km a piedi', '🚶', 'distance', 10, 100),
  ('Ciclista urbano', 'Percorri 50 km in bici', '🚴', 'distance', 50, 200),
  ('Pendolare verde', 'Usa i mezzi pubblici 10 volte', '🚌', 'social', 10, 150),
  ('Risparmio CO₂ 10kg', 'Risparmia 10 kg di CO₂', '🌿', 'co2', 10, 200),
  ('Risparmio CO₂ 50kg', 'Risparmia 50 kg di CO₂', '🌳', 'co2', 50, 500),
  ('Streak 7 giorni', '7 giorni consecutivi di viaggi green', '🔥', 'streak', 7, 300),
  ('Streak 30 giorni', '30 giorni consecutivi di viaggi green', '⚡', 'streak', 30, 1000),
  ('Carpooler', 'Condividi 5 passaggi in carpooling', '🚗', 'social', 5, 250),
  ('Eco Champion', 'Raggiungi 5000 punti eco', '🏆', 'special', 5000, 1000),
  ('Club Founder', 'Crea il tuo primo club aziendale', '🏢', 'special', 1, 500),
  ('Treno Verde', 'Percorri 100 km in treno', '🚂', 'distance', 100, 300),
  ('E-Biker', 'Percorri 30 km in E-Bike', '⚡🚲', 'distance', 30, 150),
  ('Social Butterfly', 'Invia 50 messaggi in chat', '💬', 'social', 50, 200)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE — Refresh your app (Ctrl+Shift+R) after running this script
-- ═══════════════════════════════════════════════════════════════════════════

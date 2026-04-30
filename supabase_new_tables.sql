-- ── CLUBS (club aziendali) ────────────────────────────────────────────────────
CREATE TABLE clubs (
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

CREATE TABLE club_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin','moderator','member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(club_id, user_id)
);

ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Club pubblici visibili" ON clubs FOR SELECT USING (TRUE);
CREATE POLICY "Crea club" ON clubs FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Admin aggiorna club" ON clubs FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY "Membri visibili" ON club_members FOR SELECT USING (TRUE);
CREATE POLICY "Unisciti club" ON club_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Lascia club" ON club_members FOR DELETE USING (auth.uid() = user_id);

-- ── CHAT ─────────────────────────────────────────────────────────────────────
CREATE TABLE conversations (
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

CREATE TABLE conversation_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversation_id, user_id)
);

CREATE TABLE messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text','image','trip_share')),
  trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vedi conversazioni" ON conversations FOR SELECT
  USING (EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = id AND user_id = auth.uid()));
CREATE POLICY "Crea conversazione" ON conversations FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Vedi membri" ON conversation_members FOR SELECT USING (TRUE);
CREATE POLICY "Aggiungi membro" ON conversation_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Vedi messaggi" ON messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()));
CREATE POLICY "Invia messaggio" ON messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id AND EXISTS (
    SELECT 1 FROM conversation_members WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()
  ));

-- ── SHOP ─────────────────────────────────────────────────────────────────────
CREATE TABLE shop_items (
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

CREATE TABLE shop_purchases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  item_id UUID REFERENCES shop_items(id),
  points_spent INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','delivered','cancelled')),
  purchased_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE shop_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Shop visibile" ON shop_items FOR SELECT USING (is_active = TRUE);
CREATE POLICY "I miei acquisti" ON shop_purchases FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Acquista" ON shop_purchases FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── CARPOOLING ────────────────────────────────────────────────────────────────
CREATE TABLE carpooling_rides (
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

CREATE TABLE carpooling_bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ride_id UUID REFERENCES carpooling_rides(id) ON DELETE CASCADE,
  passenger_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  booked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ride_id, passenger_id)
);

ALTER TABLE carpooling_rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpooling_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vedi passaggi" ON carpooling_rides FOR SELECT USING (TRUE);
CREATE POLICY "Pubblica passaggio" ON carpooling_rides FOR INSERT WITH CHECK (auth.uid() = driver_id);
CREATE POLICY "Aggiorna il tuo passaggio" ON carpooling_rides FOR UPDATE USING (auth.uid() = driver_id);
CREATE POLICY "Vedi prenotazioni" ON carpooling_bookings FOR SELECT USING (TRUE);
CREATE POLICY "Prenota" ON carpooling_bookings FOR INSERT WITH CHECK (auth.uid() = passenger_id);
CREATE POLICY "Cancella prenotazione" ON carpooling_bookings FOR DELETE USING (auth.uid() = passenger_id);

-- ── SEED SHOP ITEMS ───────────────────────────────────────────────────────────
INSERT INTO shop_items (name, description, category, points_cost, partner_name, stock) VALUES
('Voucher caffè bio', '1 caffè gratuito in un bar partner sostenibile', 'voucher', 150, 'GreenCafé', 100),
('Borraccia EcoTrack', 'Borraccia in acciaio inox 750ml brandizzata EcoTrack', 'gadget', 500, 'EcoTrack', 50),
('Abbonamento mensile bus', 'Un mese di trasporto pubblico gratuito', 'voucher', 2000, 'ATM Milano', 20),
('Pianta un albero', 'Piantiamo un albero a tuo nome in Italia', 'donation', 300, 'TreeItaly', NULL),
('Tour e-bike guidato', 'Tour di 2 ore in e-bike nella tua città', 'experience', 800, 'BikeCity', 30),
('Sconto 20% negozio bio', 'Coupon 20% su un negozio biologico partner', 'voucher', 200, 'BioShop', 200),
('Zaino sostenibile', 'Zaino in materiale riciclato 25L', 'gadget', 1200, 'EcoGear', 25),
('Donazione foresta amazzonica', 'Proteggi 100m² di foresta amazzonica', 'donation', 400, 'RainForest', NULL);

-- ── SEED BADGES ──────────────────────────────────────────────────────────────
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
('Social Butterfly', 'Invia 50 messaggi in chat', '💬', 'social', 50, 200);

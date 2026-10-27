-- ══════════════════════════════════════════════════════════════════════════════
-- EcoTrack — Shop titles patch
-- Run this in Supabase SQL Editor if you already ran supabase_complete_schema.sql
-- and titles don't appear in the Shop page.
-- ══════════════════════════════════════════════════════════════════════════════

-- Add active_title column to profiles (safe if already exists)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_title TEXT DEFAULT NULL;

-- La categoria 'title' non era ammessa dal CHECK originale: senza questo
-- passaggio l'INSERT qui sotto falliva e i titoli non apparivano mai.
ALTER TABLE shop_items DROP CONSTRAINT IF EXISTS shop_items_category_check;
ALTER TABLE shop_items
  ADD CONSTRAINT shop_items_category_check
  CHECK (category IN ('voucher','gadget','experience','donation','badge_special','title'));

-- Insert the 6 title items into shop_items.
-- Gli id sono UUID generati: gli id testuali ('t1'...) non sono validi per la
-- colonna UUID e facevano fallire tutto il blocco.
-- Skip delle righe già presenti (per nome) → sicuro da rieseguire.
INSERT INTO shop_items (name, description, category, points_cost, stock, is_active, partner_name)
SELECT v.name, v.description, 'title', v.points_cost, NULL, TRUE, NULL
FROM (VALUES
  ('🌱 Eco Novizio',         'Il primo passo verso la mobilità sostenibile. Si sblocca da subito.',  100),
  ('🚴 Ciclista Urbano',      'Per chi percorre almeno 50 km in bici in città.',                       300),
  ('⚡ Guerriero Verde',       'Titolo per i campioni della mobilità a zero emissioni.',                600),
  ('🌍 Custode del Pianeta',   'Hai risparmiato oltre 50 kg di CO₂. Il pianeta ti ringrazia.',         1000),
  ('🏆 Eco Leggenda',          'Il titolo più prestigioso. Solo per i più dedicati.',                  2500),
  ('🚂 Pendolare Sostenibile', 'Per chi usa quotidianamente treni e trasporti pubblici.',              450)
) AS v(name, description, points_cost)
WHERE NOT EXISTS (
  SELECT 1 FROM shop_items s WHERE s.name = v.name
);

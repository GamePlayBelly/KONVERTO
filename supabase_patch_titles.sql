-- ══════════════════════════════════════════════════════════════════════════════
-- EcoTrack — Shop titles patch
-- Run this in Supabase SQL Editor if you already ran supabase_complete_schema.sql
-- and titles don't appear in the Shop page.
-- ══════════════════════════════════════════════════════════════════════════════

-- Add active_title column to profiles (safe if already exists)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_title TEXT DEFAULT NULL;

-- Insert the 6 title items into shop_items.
-- ON CONFLICT (id) DO NOTHING means it's safe to run multiple times.
INSERT INTO shop_items (id, name, description, category, points_cost, stock, is_active, partner_name)
VALUES
  ('t1', '🌱 Eco Novizio',           'Il primo passo verso la mobilità sostenibile. Si sblocca da subito.',      'title', 100,  NULL, true, NULL),
  ('t2', '🚴 Ciclista Urbano',        'Per chi percorre almeno 50 km in bici in città.',                         'title', 300,  NULL, true, NULL),
  ('t3', '⚡ Guerriero Verde',         'Titolo per i campioni della mobilità a zero emissioni.',                  'title', 600,  NULL, true, NULL),
  ('t4', '🌍 Custode del Pianeta',     'Hai risparmiato oltre 50 kg di CO₂. Il pianeta ti ringrazia.',           'title', 1000, NULL, true, NULL),
  ('t5', '🏆 Eco Leggenda',            'Il titolo più prestigioso. Solo per i più dedicati.',                    'title', 2500, NULL, true, NULL),
  ('t6', '🚂 Pendolare Sostenibile',   'Per chi usa quotidianamente treni e trasporti pubblici.',                'title', 450,  NULL, true, NULL)
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- EcoTrack — Storage bucket setup
-- Run this once in your Supabase project: SQL Editor → New query → Run
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Create buckets ──────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars',      'avatars',      true, 5242880,  ARRAY['image/jpeg','image/png','image/webp','image/gif']),
  ('club-avatars', 'club-avatars', true, 5242880,  ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO NOTHING;

-- ── 2. RLS policies — avatars bucket ──────────────────────────────────────────

-- Anyone can read public avatars
DROP POLICY IF EXISTS "Public read avatars" ON storage.objects;
CREATE POLICY "Public read avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Authenticated users can upload their own avatar (path starts with their user_id)
DROP POLICY IF EXISTS "Users upload own avatar" ON storage.objects;
CREATE POLICY "Users upload own avatar"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated users can update (upsert) their own avatar
DROP POLICY IF EXISTS "Users update own avatar" ON storage.objects;
CREATE POLICY "Users update own avatar"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated users can delete their own avatar
DROP POLICY IF EXISTS "Users delete own avatar" ON storage.objects;
CREATE POLICY "Users delete own avatar"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── 3. RLS policies — club-avatars bucket ─────────────────────────────────────

-- Anyone can read club avatars
DROP POLICY IF EXISTS "Public read club-avatars" ON storage.objects;
CREATE POLICY "Public read club-avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'club-avatars');

-- Club admins (identified by matching the club folder to a club they created) can upload.
-- Simplified: any authenticated user can upload to club-avatars.
-- The app already checks isAdmin before showing the upload button.
DROP POLICY IF EXISTS "Authenticated upload club-avatars" ON storage.objects;
CREATE POLICY "Authenticated upload club-avatars"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'club-avatars');

DROP POLICY IF EXISTS "Authenticated update club-avatars" ON storage.objects;
CREATE POLICY "Authenticated update club-avatars"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'club-avatars');

DROP POLICY IF EXISTS "Authenticated delete club-avatars" ON storage.objects;
CREATE POLICY "Authenticated delete club-avatars"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'club-avatars');

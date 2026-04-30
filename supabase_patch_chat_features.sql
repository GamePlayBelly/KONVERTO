-- ──────────────────────────────────────────────────────────────
-- Patch: Chat features completo
-- Esegui in Supabase → SQL Editor
-- ──────────────────────────────────────────────────────────────

-- ── Storage bucket per immagini in chat ──────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', true)
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "Chat media public read"   ON storage.objects;
DROP POLICY IF EXISTS "Auth users upload chat"   ON storage.objects;
DROP POLICY IF EXISTS "Users delete own chat"    ON storage.objects;

CREATE POLICY "Chat media public read"
  ON storage.objects FOR SELECT USING (bucket_id = 'chat-media');
CREATE POLICY "Auth users upload chat"
  ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'chat-media' AND auth.role() = 'authenticated');
CREATE POLICY "Users delete own chat"
  ON storage.objects FOR DELETE USING (bucket_id = 'chat-media' AND auth.uid()::text = (storage.foldername(name))[1]);


-- ── message_reactions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_reactions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id      UUID REFERENCES messages(id)      ON DELETE CASCADE NOT NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  user_id         UUID REFERENCES profiles(id)       ON DELETE CASCADE NOT NULL,
  emoji           TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_reactions_msg  ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_conv ON message_reactions(conversation_id);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members see reactions"       ON message_reactions;
DROP POLICY IF EXISTS "Auth users react"            ON message_reactions;
DROP POLICY IF EXISTS "Users remove own reaction"   ON message_reactions;
CREATE POLICY "Members see reactions"     ON message_reactions FOR SELECT USING (TRUE);
CREATE POLICY "Auth users react"          ON message_reactions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users remove own reaction" ON message_reactions FOR DELETE USING (user_id = auth.uid());


-- ── Estendi messages ─────────────────────────────────────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at   TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted  BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_url   TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL;


-- ── Estendi conversations ────────────────────────────────────
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_goal_km     NUMERIC;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_goal_deadline DATE;


-- ── Estendi conversation_members ─────────────────────────────
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS muted    BOOLEAN DEFAULT FALSE;


-- ── Realtime su reactions ────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;


-- ── FUNZIONI ─────────────────────────────────────────────────

-- Modifica messaggio (solo mittente)
CREATE OR REPLACE FUNCTION edit_message(p_message_id UUID, p_content TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE messages
  SET    content = p_content, edited_at = NOW()
  WHERE  id = p_message_id AND sender_id = auth.uid() AND is_deleted = FALSE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Messaggio non trovato o non autorizzato'; END IF;
END;
$$;

-- Elimina messaggio (mittente o admin gruppo)
CREATE OR REPLACE FUNCTION delete_message(p_message_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_conv UUID; v_sender UUID;
BEGIN
  SELECT conversation_id, sender_id INTO v_conv, v_sender FROM messages WHERE id = p_message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Messaggio non trovato'; END IF;
  IF v_sender IS DISTINCT FROM auth.uid() AND NOT EXISTS (
    SELECT 1 FROM conversation_members WHERE conversation_id = v_conv AND user_id = auth.uid() AND is_admin = TRUE
  ) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
  UPDATE messages SET is_deleted = TRUE, content = '', image_url = NULL WHERE id = p_message_id;
END;
$$;

-- Fissa / rimuovi pin (solo admin)
CREATE OR REPLACE FUNCTION pin_message(p_conv_id UUID, p_message_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = p_conv_id AND user_id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Solo gli admin possono fissare messaggi';
  END IF;
  UPDATE conversations SET pinned_message_id = p_message_id WHERE id = p_conv_id;
END;
$$;

-- Toggle reazione
CREATE OR REPLACE FUNCTION toggle_reaction(p_message_id UUID, p_conv_id UUID, p_emoji TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM message_reactions WHERE message_id = p_message_id AND user_id = auth.uid() AND emoji = p_emoji) THEN
    DELETE FROM message_reactions WHERE message_id = p_message_id AND user_id = auth.uid() AND emoji = p_emoji;
  ELSE
    INSERT INTO message_reactions (message_id, conversation_id, user_id, emoji)
    VALUES (p_message_id, p_conv_id, auth.uid(), p_emoji)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

-- Aggiorna impostazioni gruppo (solo admin)
CREATE OR REPLACE FUNCTION update_group_settings(
  p_conv_id UUID, p_name TEXT, p_goal_km NUMERIC, p_goal_deadline DATE
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = p_conv_id AND user_id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Solo gli admin possono modificare le impostazioni';
  END IF;
  UPDATE conversations
  SET    name = COALESCE(NULLIF(p_name,''), name),
         group_goal_km       = p_goal_km,
         group_goal_deadline = p_goal_deadline
  WHERE  id = p_conv_id;
END;
$$;

-- Aggiungi membro (solo admin)
CREATE OR REPLACE FUNCTION add_group_member(p_conv_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = p_conv_id AND user_id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Solo gli admin possono aggiungere membri';
  END IF;
  INSERT INTO conversation_members (conversation_id, user_id) VALUES (p_conv_id, p_user_id) ON CONFLICT DO NOTHING;
END;
$$;

-- Rimuovi membro (solo admin)
CREATE OR REPLACE FUNCTION remove_group_member(p_conv_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = p_conv_id AND user_id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Solo gli admin possono rimuovere membri';
  END IF;
  DELETE FROM conversation_members WHERE conversation_id = p_conv_id AND user_id = p_user_id;
END;
$$;

-- Promuovi ad admin
CREATE OR REPLACE FUNCTION promote_to_admin(p_conv_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = p_conv_id AND user_id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Solo gli admin possono promuovere membri';
  END IF;
  UPDATE conversation_members SET is_admin = TRUE WHERE conversation_id = p_conv_id AND user_id = p_user_id;
END;
$$;

-- Declassa da admin
CREATE OR REPLACE FUNCTION demote_from_admin(p_conv_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n_admins INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = p_conv_id AND user_id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Solo gli admin possono declassare admin';
  END IF;
  SELECT COUNT(*) INTO n_admins FROM conversation_members WHERE conversation_id = p_conv_id AND is_admin = TRUE;
  IF n_admins <= 1 THEN RAISE EXCEPTION 'Non puoi declassare l''unico admin'; END IF;
  UPDATE conversation_members SET is_admin = FALSE WHERE conversation_id = p_conv_id AND user_id = p_user_id;
END;
$$;

-- Esci dal gruppo (qualsiasi membro)
CREATE OR REPLACE FUNCTION leave_group(p_conv_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n_admins INT;
BEGIN
  SELECT COUNT(*) INTO n_admins FROM conversation_members WHERE conversation_id = p_conv_id AND is_admin = TRUE;
  IF n_admins <= 1 AND EXISTS (
    SELECT 1 FROM conversation_members WHERE conversation_id = p_conv_id AND user_id = auth.uid() AND is_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Promuovi un altro admin prima di uscire';
  END IF;
  DELETE FROM conversation_members WHERE conversation_id = p_conv_id AND user_id = auth.uid();
END;
$$;

-- Silenzia / riattiva
CREATE OR REPLACE FUNCTION toggle_mute(p_conv_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_muted BOOLEAN;
BEGIN
  SELECT muted INTO v_muted FROM conversation_members WHERE conversation_id = p_conv_id AND user_id = auth.uid();
  UPDATE conversation_members SET muted = NOT COALESCE(v_muted, FALSE) WHERE conversation_id = p_conv_id AND user_id = auth.uid();
  RETURN NOT COALESCE(v_muted, FALSE);
END;
$$;

-- Crea gruppo (creatore = admin) — sostituisce la precedente
CREATE OR REPLACE FUNCTION create_group_conversation(p_name TEXT, p_member_ids UUID[])
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_conv_id   UUID;
  v_my_id     UUID := auth.uid();
  v_member_id UUID;
BEGIN
  IF v_my_id IS NULL THEN RAISE EXCEPTION 'Non autenticato'; END IF;
  INSERT INTO conversations (type, name, created_by) VALUES ('group', p_name, v_my_id) RETURNING id INTO v_conv_id;
  INSERT INTO conversation_members (conversation_id, user_id, is_admin) VALUES (v_conv_id, v_my_id, TRUE) ON CONFLICT DO NOTHING;
  FOREACH v_member_id IN ARRAY p_member_ids LOOP
    INSERT INTO conversation_members (conversation_id, user_id, is_admin) VALUES (v_conv_id, v_member_id, FALSE) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN v_conv_id;
END;
$$;

-- Crea chat club (admin = creatore)
CREATE OR REPLACE FUNCTION create_club_conversation(p_club_id UUID, p_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_conv_id UUID;
  v_my_id   UUID := auth.uid();
  v_member  RECORD;
BEGIN
  IF v_my_id IS NULL THEN RAISE EXCEPTION 'Non autenticato'; END IF;
  IF NOT EXISTS (SELECT 1 FROM clubs WHERE id = p_club_id AND created_by = v_my_id) THEN
    RAISE EXCEPTION 'Solo l''admin del club può creare la chat';
  END IF;
  SELECT id INTO v_conv_id FROM conversations WHERE club_id = p_club_id AND type = 'club' LIMIT 1;
  IF FOUND THEN RETURN v_conv_id; END IF;
  INSERT INTO conversations (type, name, club_id, created_by) VALUES ('club', p_name, p_club_id, v_my_id) RETURNING id INTO v_conv_id;
  FOR v_member IN SELECT user_id FROM club_members WHERE club_id = p_club_id LOOP
    INSERT INTO conversation_members (conversation_id, user_id, is_admin)
    VALUES (v_conv_id, v_member.user_id, v_member.user_id = v_my_id) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN v_conv_id;
END;
$$;

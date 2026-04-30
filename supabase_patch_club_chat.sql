-- ──────────────────────────────────────────────────────────────
-- Patch: SECURITY DEFINER functions per chat privata e chat club
-- Run this in Supabase → SQL Editor
-- ──────────────────────────────────────────────────────────────

-- 1. Crea o recupera una conversazione privata tra due utenti
--    (SECURITY DEFINER bypassa RLS su conversation_members)
CREATE OR REPLACE FUNCTION create_or_get_private_conversation(other_user_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_conv_id UUID;
  v_my_id   UUID := auth.uid();
BEGIN
  IF v_my_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Cerca una conv privata già esistente tra i due utenti
  SELECT c.id INTO v_conv_id
  FROM   conversations c
  JOIN   conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = v_my_id
  JOIN   conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = other_user_id
  WHERE  c.type = 'private'
  LIMIT  1;

  IF FOUND THEN
    RETURN v_conv_id;
  END IF;

  -- Crea una nuova conversazione privata
  INSERT INTO conversations (type, created_by)
  VALUES ('private', v_my_id)
  RETURNING id INTO v_conv_id;

  -- Aggiungi entrambi i membri
  INSERT INTO conversation_members (conversation_id, user_id)
  VALUES (v_conv_id, v_my_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO conversation_members (conversation_id, user_id)
  VALUES (v_conv_id, other_user_id)
  ON CONFLICT DO NOTHING;

  RETURN v_conv_id;
END;
$$;


-- 2. Crea una chat di gruppo personalizzata (chiunque può farlo, aggiunge i membri scelti)
CREATE OR REPLACE FUNCTION create_group_conversation(p_name TEXT, p_member_ids UUID[])
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_conv_id    UUID;
  v_my_id      UUID := auth.uid();
  v_member_id  UUID;
BEGIN
  IF v_my_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO conversations (type, name, created_by)
  VALUES ('group', p_name, v_my_id)
  RETURNING id INTO v_conv_id;

  -- Aggiungi il creatore
  INSERT INTO conversation_members (conversation_id, user_id)
  VALUES (v_conv_id, v_my_id)
  ON CONFLICT DO NOTHING;

  -- Aggiungi gli altri membri
  FOREACH v_member_id IN ARRAY p_member_ids LOOP
    INSERT INTO conversation_members (conversation_id, user_id)
    VALUES (v_conv_id, v_member_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN v_conv_id;
END;
$$;


-- 3. Crea una chat di gruppo per un club (solo l'admin può farlo)
CREATE OR REPLACE FUNCTION create_club_conversation(p_club_id UUID, p_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_conv_id UUID;
  v_my_id   UUID := auth.uid();
  v_member  RECORD;
BEGIN
  IF v_my_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Solo l'admin del club può creare la chat
  IF NOT EXISTS (SELECT 1 FROM clubs WHERE id = p_club_id AND created_by = v_my_id) THEN
    RAISE EXCEPTION 'Solo l''admin del club può creare la chat';
  END IF;

  -- Se la chat esiste già, restituiscila
  SELECT id INTO v_conv_id
  FROM   conversations
  WHERE  club_id = p_club_id AND type = 'club'
  LIMIT  1;

  IF FOUND THEN
    RETURN v_conv_id;
  END IF;

  -- Crea la conversazione
  INSERT INTO conversations (type, name, club_id, created_by)
  VALUES ('club', p_name, p_club_id, v_my_id)
  RETURNING id INTO v_conv_id;

  -- Aggiungi tutti i membri attuali del club
  FOR v_member IN SELECT user_id FROM club_members WHERE club_id = p_club_id LOOP
    INSERT INTO conversation_members (conversation_id, user_id)
    VALUES (v_conv_id, v_member.user_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN v_conv_id;
END;
$$;


-- 3. Aggiorna accept_club_join_request:
--    quando un utente viene accettato, aggiungilo anche alla chat del club (se esiste)
CREATE OR REPLACE FUNCTION accept_club_join_request(p_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_club_id    UUID;
  v_user_id    UUID;
  v_direction  TEXT;
  v_club_admin UUID;
  v_conv_id    UUID;
BEGIN
  SELECT club_id, user_id, direction
  INTO   v_club_id, v_user_id, v_direction
  FROM   club_join_requests
  WHERE  id = p_request_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Richiesta non trovata o già elaborata';
  END IF;

  SELECT created_by INTO v_club_admin FROM clubs WHERE id = v_club_id;

  IF v_direction = 'join_request' AND v_club_admin != auth.uid() THEN
    RAISE EXCEPTION 'Solo l''admin del club può accettare le richieste';
  END IF;

  IF v_direction = 'invite' AND v_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Solo l''utente invitato può accettare l''invito';
  END IF;

  -- Aggiungi al club
  INSERT INTO club_members (club_id, user_id, role)
  VALUES (v_club_id, v_user_id, 'member')
  ON CONFLICT (club_id, user_id) DO NOTHING;

  UPDATE club_join_requests SET status = 'accepted' WHERE id = p_request_id;

  -- Aggiungi anche alla chat del club (se esiste)
  SELECT id INTO v_conv_id
  FROM   conversations
  WHERE  club_id = v_club_id AND type = 'club'
  LIMIT  1;

  IF FOUND THEN
    INSERT INTO conversation_members (conversation_id, user_id)
    VALUES (v_conv_id, v_user_id)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

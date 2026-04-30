-- ──────────────────────────────────────────────────────────────
-- Patch: Notification system + Club requests + RLS fix
-- Run this in Supabase → SQL Editor
-- ──────────────────────────────────────────────────────────────

-- 1. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type       TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}',
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id);
CREATE INDEX IF NOT EXISTS notifications_read_idx    ON notifications(user_id, read);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own notifications"    ON notifications;
DROP POLICY IF EXISTS "Authenticated can insert"       ON notifications;
DROP POLICY IF EXISTS "Users update own notifications" ON notifications;
DROP POLICY IF EXISTS "Users delete own notifications" ON notifications;

CREATE POLICY "Users see own notifications"    ON notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Authenticated can insert"       ON notifications FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users update own notifications" ON notifications FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users delete own notifications" ON notifications FOR DELETE USING (user_id = auth.uid());


-- 2. FRIEND REQUESTS TABLE
CREATE TABLE IF NOT EXISTS friend_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  receiver_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'accepted' | 'rejected'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(sender_id, receiver_id)
);

ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sender or receiver can see friend requests" ON friend_requests;
DROP POLICY IF EXISTS "Sender can create friend request"           ON friend_requests;
DROP POLICY IF EXISTS "Parties can update friend request"          ON friend_requests;
DROP POLICY IF EXISTS "Parties can delete friend request"          ON friend_requests;

CREATE POLICY "Sender or receiver can see friend requests" ON friend_requests
  FOR SELECT USING (sender_id = auth.uid() OR receiver_id = auth.uid());
CREATE POLICY "Sender can create friend request" ON friend_requests
  FOR INSERT WITH CHECK (sender_id = auth.uid());
CREATE POLICY "Parties can update friend request" ON friend_requests
  FOR UPDATE USING (sender_id = auth.uid() OR receiver_id = auth.uid());
CREATE POLICY "Parties can delete friend request" ON friend_requests
  FOR DELETE USING (sender_id = auth.uid() OR receiver_id = auth.uid());


-- 3. CLUB JOIN REQUESTS TABLE  (also used for admin invites)
CREATE TABLE IF NOT EXISTS club_join_requests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    UUID REFERENCES clubs(id) ON DELETE CASCADE NOT NULL,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  direction  TEXT NOT NULL DEFAULT 'join_request',  -- 'join_request' | 'invite'
  status     TEXT NOT NULL DEFAULT 'pending',        -- 'pending' | 'accepted' | 'rejected'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(club_id, user_id)
);

CREATE INDEX IF NOT EXISTS club_join_requests_club_idx   ON club_join_requests(club_id);
CREATE INDEX IF NOT EXISTS club_join_requests_user_idx   ON club_join_requests(user_id);

ALTER TABLE club_join_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User or admin can see club requests"    ON club_join_requests;
DROP POLICY IF EXISTS "Authenticated can insert club request"  ON club_join_requests;
DROP POLICY IF EXISTS "User or admin can update club request"  ON club_join_requests;
DROP POLICY IF EXISTS "User or admin can delete club request"  ON club_join_requests;

CREATE POLICY "User or admin can see club requests" ON club_join_requests
  FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM clubs WHERE id = club_id AND created_by = auth.uid())
  );
CREATE POLICY "Authenticated can insert club request" ON club_join_requests
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "User or admin can update club request" ON club_join_requests
  FOR UPDATE USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM clubs WHERE id = club_id AND created_by = auth.uid())
  );
CREATE POLICY "User or admin can delete club request" ON club_join_requests
  FOR DELETE USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM clubs WHERE id = club_id AND created_by = auth.uid())
  );


-- 4. SECURITY DEFINER: accept a join request or club invite
CREATE OR REPLACE FUNCTION accept_club_join_request(p_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_club_id    UUID;
  v_user_id    UUID;
  v_direction  TEXT;
  v_club_admin UUID;
BEGIN
  SELECT club_id, user_id, direction
  INTO   v_club_id, v_user_id, v_direction
  FROM   club_join_requests
  WHERE  id = p_request_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or already processed';
  END IF;

  SELECT created_by INTO v_club_admin FROM clubs WHERE id = v_club_id;

  -- join_request: only the club admin can accept
  IF v_direction = 'join_request' AND v_club_admin != auth.uid() THEN
    RAISE EXCEPTION 'Only the club admin can accept join requests';
  END IF;

  -- invite: only the invited user can accept
  IF v_direction = 'invite' AND v_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the invited user can accept this invite';
  END IF;

  INSERT INTO club_members (club_id, user_id, role)
  VALUES (v_club_id, v_user_id, 'member')
  ON CONFLICT (club_id, user_id) DO NOTHING;

  UPDATE club_join_requests SET status = 'accepted' WHERE id = p_request_id;
END;
$$;


-- 5. SECURITY DEFINER: reject a join request or club invite
CREATE OR REPLACE FUNCTION reject_club_join_request(p_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_club_id    UUID;
  v_user_id    UUID;
  v_direction  TEXT;
  v_club_admin UUID;
BEGIN
  SELECT club_id, user_id, direction
  INTO   v_club_id, v_user_id, v_direction
  FROM   club_join_requests
  WHERE  id = p_request_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or already processed';
  END IF;

  SELECT created_by INTO v_club_admin FROM clubs WHERE id = v_club_id;

  IF v_direction = 'join_request' AND v_club_admin != auth.uid() THEN
    RAISE EXCEPTION 'Only the club admin can reject join requests';
  END IF;

  IF v_direction = 'invite' AND v_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the invited user can reject this invite';
  END IF;

  UPDATE club_join_requests SET status = 'rejected' WHERE id = p_request_id;
END;
$$;


-- 6. Enable realtime on notifications (for live bell updates)
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

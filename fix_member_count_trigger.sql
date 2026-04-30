-- ── Fix club member_count ────────────────────────────────────────────────────
-- Esegui questo nel Supabase SQL Editor per correggere i contatori e aggiungere
-- un trigger che li mantiene aggiornati automaticamente.

-- 1. Ricalcola i conteggi attuali
UPDATE clubs c
SET member_count = (
  SELECT COUNT(*) FROM club_members WHERE club_id = c.id
);

-- 2. Crea/aggiorna la funzione trigger
CREATE OR REPLACE FUNCTION update_club_member_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE clubs SET member_count = member_count + 1 WHERE id = NEW.club_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE clubs SET member_count = GREATEST(0, member_count - 1) WHERE id = OLD.club_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- 3. Crea il trigger
DROP TRIGGER IF EXISTS club_member_count_trigger ON club_members;
CREATE TRIGGER club_member_count_trigger
AFTER INSERT OR DELETE ON club_members
FOR EACH ROW EXECUTE FUNCTION update_club_member_count();

-- 4. Verifica
SELECT c.name, c.member_count, COUNT(cm.user_id) as real_count
FROM clubs c
LEFT JOIN club_members cm ON cm.club_id = c.id
GROUP BY c.id, c.name, c.member_count;

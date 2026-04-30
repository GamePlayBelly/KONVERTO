-- Fix: permetti agli utenti di leggere le conversazioni di cui sono membri
-- Esegui questo nel Supabase SQL Editor

-- 1. Abilita RLS sulla tabella se non è già abilitata
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- 2. Rimuovi policy esistente se presente (evita duplicati)
DROP POLICY IF EXISTS "members can view their conversations" ON conversations;
DROP POLICY IF EXISTS "Users can view conversations they are members of" ON conversations;
DROP POLICY IF EXISTS "users can view conversations" ON conversations;

-- 3. Crea la policy corretta: l'utente può vedere SOLO le conversazioni
--    in cui è presente nella tabella conversation_members
CREATE POLICY "members can view their conversations"
ON conversations FOR SELECT
USING (
  id IN (
    SELECT conversation_id
    FROM conversation_members
    WHERE user_id = auth.uid()
  )
);

-- 4. Policy per INSERT (creator può creare)
DROP POLICY IF EXISTS "users can create conversations" ON conversations;
CREATE POLICY "users can create conversations"
ON conversations FOR INSERT
WITH CHECK (true);

-- 5. Policy per UPDATE (solo membri)
DROP POLICY IF EXISTS "members can update their conversations" ON conversations;
CREATE POLICY "members can update their conversations"
ON conversations FOR UPDATE
USING (
  id IN (
    SELECT conversation_id
    FROM conversation_members
    WHERE user_id = auth.uid()
  )
);

-- Verifica che le policy siano attive
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'conversations';

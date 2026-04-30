-- ──────────────────────────────────────────────────────────────
-- Patch: Abilita Realtime su tutte le tabelle di chat
-- Run this in Supabase → SQL Editor
-- ──────────────────────────────────────────────────────────────

-- Messaggi in tempo reale
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Lista conversazioni in tempo reale (nuovi gruppi, ultima modifica)
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;

-- Quando vieni aggiunto a un gruppo appare subito nella lista
ALTER PUBLICATION supabase_realtime ADD TABLE conversation_members;

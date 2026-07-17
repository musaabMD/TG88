ALTER TABLE targets ADD COLUMN moderation_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE targets ADD COLUMN moderation_rules TEXT NOT NULL DEFAULT '';

UPDATE targets SET moderation_enabled = 1 WHERE type = 'group';

CREATE TABLE IF NOT EXISTS moderation_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id INTEGER REFERENCES targets(id) ON DELETE SET NULL,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT,
  message_id INTEGER,
  reason TEXT NOT NULL,
  excerpt TEXT,
  delete_ok INTEGER NOT NULL DEFAULT 0,
  ban_ok INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_target ON moderation_actions(target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_user ON moderation_actions(chat_id, user_id, created_at);

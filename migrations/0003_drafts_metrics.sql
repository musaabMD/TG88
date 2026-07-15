CREATE TABLE messages_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'posting', 'posted', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  posted_at TEXT,
  telegram_message_id INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  view_count INTEGER,
  batch_id TEXT
);

INSERT INTO messages_next (
  id,
  target_id,
  body,
  scheduled_at,
  status,
  attempts,
  posted_at,
  telegram_message_id,
  error,
  created_at,
  updated_at,
  view_count,
  batch_id
)
SELECT
  id,
  target_id,
  body,
  scheduled_at,
  status,
  attempts,
  posted_at,
  telegram_message_id,
  error,
  created_at,
  updated_at,
  view_count,
  batch_id
FROM messages;

DROP TABLE messages;
ALTER TABLE messages_next RENAME TO messages;

CREATE INDEX IF NOT EXISTS idx_messages_due ON messages(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_messages_target ON messages(target_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_messages_drafts ON messages(target_id, status, updated_at);

CREATE TABLE IF NOT EXISTS target_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  member_count INTEGER,
  view_count INTEGER,
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_target_metrics_target_time ON target_metrics(target_id, captured_at);

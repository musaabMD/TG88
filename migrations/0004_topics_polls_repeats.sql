PRAGMA foreign_keys = off;

CREATE TABLE targets_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('channel', 'group')),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rules TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  last_seen_at TEXT,
  thread_id INTEGER NOT NULL DEFAULT 0,
  topic_name TEXT,
  UNIQUE(chat_id, thread_id)
);

INSERT OR IGNORE INTO targets_next (
  id,
  title,
  chat_id,
  type,
  enabled,
  created_at,
  rules,
  source,
  last_seen_at,
  thread_id,
  topic_name
)
SELECT
  id,
  title,
  chat_id,
  type,
  enabled,
  created_at,
  rules,
  source,
  last_seen_at,
  0,
  NULL
FROM targets;

DROP TABLE targets;
ALTER TABLE targets_next RENAME TO targets;

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
  batch_id TEXT,
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'poll')),
  poll_options TEXT,
  link_preview_enabled INTEGER NOT NULL DEFAULT 1,
  repeat_group_id TEXT,
  repeat_index INTEGER NOT NULL DEFAULT 0
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

CREATE INDEX IF NOT EXISTS idx_targets_chat_thread ON targets(chat_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_due ON messages(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_messages_target ON messages(target_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_messages_drafts ON messages(target_id, status, updated_at);

PRAGMA foreign_keys = on;

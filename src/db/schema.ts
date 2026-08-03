export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  date TEXT NOT NULL,
  original_date TEXT,
  moved_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other'
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(user_id, date);

CREATE TABLE IF NOT EXISTS daily_states (
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  morning_input_raw TEXT,
  evening_input_raw TEXT,
  morning_processed INTEGER NOT NULL DEFAULT 0,
  evening_processed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS conversation_state (
  user_id INTEGER PRIMARY KEY,
  current_date TEXT NOT NULL,
  phase TEXT NOT NULL,
  evening_checkin_time TEXT NOT NULL DEFAULT '20:00'
);

CREATE TABLE IF NOT EXISTS recurring_tasks (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  schedule TEXT NOT NULL,
  time TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recurring_tasks_user ON recurring_tasks(user_id);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  fire_at TEXT NOT NULL,
  fired INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminders_fire_at ON reminders(fire_at, fired);

CREATE TABLE IF NOT EXISTS backlog_items (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backlog_items_user ON backlog_items(user_id);
`;

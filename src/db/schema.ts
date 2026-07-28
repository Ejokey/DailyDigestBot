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
`;

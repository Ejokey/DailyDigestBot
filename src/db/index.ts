import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SCHEMA_SQL } from './schema';
import { ConversationState, DailyState, RecurringTask, Task, TaskCategory, TaskSource, TaskStatus } from '../types';

let db: DatabaseSync | null = null;

function runMigrations(conn: DatabaseSync): void {
  const columns = conn.prepare('PRAGMA table_info(tasks)').all() as unknown as { name: string }[];
  const hasCategory = columns.some((c) => c.name === 'category');
  if (!hasCategory) {
    conn.exec(`ALTER TABLE tasks ADD COLUMN category TEXT NOT NULL DEFAULT 'other'`);
  }
}

export function openDb(dbPath: string): DatabaseSync {
  if (db) return db;
  const dir = path.dirname(dbPath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  return db;
}

function requireDb(): DatabaseSync {
  if (!db) throw new Error('DB not initialized — call openDb() first');
  return db;
}

interface TaskRow {
  id: string;
  user_id: number;
  text: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  date: string;
  original_date: string | null;
  moved_count: number;
  source: TaskSource;
  category: TaskCategory;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    text: row.text,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    date: row.date,
    originalDate: row.original_date ?? undefined,
    movedCount: row.moved_count,
    source: row.source,
    category: row.category,
  };
}

export function insertTask(task: Task): void {
  const conn = requireDb();
  conn
    .prepare(
      `INSERT INTO tasks (id, user_id, text, status, created_at, updated_at, date, original_date, moved_count, source, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      task.id,
      task.userId,
      task.text,
      task.status,
      task.createdAt,
      task.updatedAt,
      task.date,
      task.originalDate ?? null,
      task.movedCount,
      task.source,
      task.category
    );
}

export function updateTask(id: string, fields: Partial<Pick<Task, 'text' | 'status' | 'movedCount' | 'date' | 'originalDate' | 'category'>>): void {
  const conn = requireDb();
  const existing = getTaskById(id);
  if (!existing) throw new Error(`Task not found: ${id}`);
  const merged: Task = { ...existing, ...fields, updatedAt: new Date().toISOString() };
  conn
    .prepare(
      `UPDATE tasks SET text = ?, status = ?, updated_at = ?, date = ?, original_date = ?, moved_count = ?, category = ?
       WHERE id = ?`
    )
    .run(
      merged.text,
      merged.status,
      merged.updatedAt,
      merged.date,
      merged.originalDate ?? null,
      merged.movedCount,
      merged.category,
      merged.id
    );
}

/**
 * Clears today's still-open plan so it can be replaced, keeping carried-over tasks
 * (they were earned on a previous day) and anything already resolved (done/moved/dropped).
 */
export function deleteOpenPlanForDate(userId: number, date: string): number {
  const conn = requireDb();
  const result = conn
    .prepare(`DELETE FROM tasks WHERE user_id = ? AND date = ? AND status = 'planned' AND source != 'carried_over'`)
    .run(userId, date);
  return Number(result.changes);
}

export function getTaskById(id: string): Task | null {
  const conn = requireDb();
  const row = conn.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

export function getTasksForDate(userId: number, date: string): Task[] {
  const conn = requireDb();
  const rows = conn
    .prepare('SELECT * FROM tasks WHERE user_id = ? AND date = ? ORDER BY created_at ASC')
    .all(userId, date) as unknown as TaskRow[];
  return rows.map(rowToTask);
}

export function getTasksInRange(userId: number, fromDate: string, toDate: string): Task[] {
  const conn = requireDb();
  const rows = conn
    .prepare('SELECT * FROM tasks WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date ASC, created_at ASC')
    .all(userId, fromDate, toDate) as unknown as TaskRow[];
  return rows.map(rowToTask);
}

export function upsertDailyState(state: DailyState): void {
  const conn = requireDb();
  conn
    .prepare(
      `INSERT INTO daily_states (user_id, date, morning_input_raw, evening_input_raw, morning_processed, evening_processed)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET
         morning_input_raw = excluded.morning_input_raw,
         evening_input_raw = excluded.evening_input_raw,
         morning_processed = excluded.morning_processed,
         evening_processed = excluded.evening_processed`
    )
    .run(
      state.userId,
      state.date,
      state.morningInputRaw,
      state.eveningInputRaw,
      state.morningProcessed ? 1 : 0,
      state.eveningProcessed ? 1 : 0
    );
}

export function getDailyState(userId: number, date: string): DailyState | null {
  const conn = requireDb();
  const row = conn.prepare('SELECT * FROM daily_states WHERE user_id = ? AND date = ?').get(userId, date) as
    | {
        user_id: number;
        date: string;
        morning_input_raw: string | null;
        evening_input_raw: string | null;
        morning_processed: number;
        evening_processed: number;
      }
    | undefined;
  if (!row) return null;
  return {
    userId: row.user_id,
    date: row.date,
    morningInputRaw: row.morning_input_raw,
    eveningInputRaw: row.evening_input_raw,
    morningProcessed: !!row.morning_processed,
    eveningProcessed: !!row.evening_processed,
  };
}

export function upsertConversationState(state: ConversationState): void {
  const conn = requireDb();
  conn
    .prepare(
      `INSERT INTO conversation_state (user_id, current_date, phase, evening_checkin_time)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         current_date = excluded.current_date,
         phase = excluded.phase,
         evening_checkin_time = excluded.evening_checkin_time`
    )
    .run(state.userId, state.currentDate, state.phase, state.eveningCheckinTime);
}

export function getConversationState(userId: number): ConversationState | null {
  const conn = requireDb();
  const row = conn.prepare('SELECT * FROM conversation_state WHERE user_id = ?').get(userId) as
    | { user_id: number; current_date: string; phase: string; evening_checkin_time: string }
    | undefined;
  if (!row) return null;
  return {
    userId: row.user_id,
    currentDate: row.current_date,
    phase: row.phase as ConversationState['phase'],
    eveningCheckinTime: row.evening_checkin_time,
  };
}

interface RecurringTaskRow {
  id: string;
  user_id: number;
  text: string;
  category: TaskCategory;
  schedule: string;
  time: string;
  created_at: string;
}

function rowToRecurringTask(row: RecurringTaskRow): RecurringTask {
  return {
    id: row.id,
    userId: row.user_id,
    text: row.text,
    category: row.category,
    schedule: row.schedule,
    time: row.time,
    createdAt: row.created_at,
  };
}

export function insertRecurringTask(task: RecurringTask): void {
  const conn = requireDb();
  conn
    .prepare(
      `INSERT INTO recurring_tasks (id, user_id, text, category, schedule, time, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(task.id, task.userId, task.text, task.category, task.schedule, task.time, task.createdAt);
}

export function getRecurringTasksForUser(userId: number): RecurringTask[] {
  const conn = requireDb();
  const rows = conn
    .prepare('SELECT * FROM recurring_tasks WHERE user_id = ? ORDER BY created_at ASC')
    .all(userId) as unknown as RecurringTaskRow[];
  return rows.map(rowToRecurringTask);
}

export function getAllRecurringTasks(): RecurringTask[] {
  const conn = requireDb();
  const rows = conn.prepare('SELECT * FROM recurring_tasks').all() as unknown as RecurringTaskRow[];
  return rows.map(rowToRecurringTask);
}

export function deleteRecurringTask(id: string): void {
  const conn = requireDb();
  conn.prepare('DELETE FROM recurring_tasks WHERE id = ?').run(id);
}

export function getAllConversationStates(): ConversationState[] {
  const conn = requireDb();
  const rows = conn.prepare('SELECT * FROM conversation_state').all() as unknown as {
    user_id: number;
    current_date: string;
    phase: string;
    evening_checkin_time: string;
  }[];
  return rows.map((row) => ({
    userId: row.user_id,
    currentDate: row.current_date,
    phase: row.phase as ConversationState['phase'],
    eveningCheckinTime: row.evening_checkin_time,
  }));
}

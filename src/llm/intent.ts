import { getLlmComplete, extractJson } from './client';
import { SYSTEM_PROMPT, INTENT_INSTRUCTIONS } from './prompts';
import { TaskCategory, TaskStatus } from '../types';

export type IntentType =
  | 'add_tasks'
  | 'replan'
  | 'update_status'
  | 'edit_task'
  | 'evening_report'
  | 'show_list'
  | 'show_week'
  | 'set_reminder'
  | 'set_recurring'
  | 'add_backlog'
  | 'chat';

export interface IntentTaskRef {
  id: string;
  text: string;
}

export interface IntentTask {
  text: string;
  category: TaskCategory;
}

export interface IntentUpdate {
  taskId: string;
  status: TaskStatus;
}

export interface IntentEdit {
  taskId: string;
  newText: string;
}

export interface IntentResult {
  type: IntentType;
  tasks?: IntentTask[];
  updates?: IntentUpdate[];
  edits?: IntentEdit[];
  reply?: string;
  reminderText?: string;
  reminderTime?: string;
  recurringText?: string;
  recurringTime?: string;
  recurringSchedule?: string;
  backlogText?: string;
}

export type DetectIntentFn = (currentTasks: IntentTaskRef[], message: string) => Promise<IntentResult>;

const VALID_TYPES: IntentType[] = [
  'add_tasks',
  'replan',
  'update_status',
  'edit_task',
  'evening_report',
  'show_list',
  'show_week',
  'set_reminder',
  'set_recurring',
  'add_backlog',
  'chat',
];

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
const VALID_CATEGORIES: TaskCategory[] = ['work', 'personal', 'other'];
const VALID_STATUSES: TaskStatus[] = ['planned', 'done', 'partial', 'moved', 'dropped'];

function normalizeTasks(value: unknown): IntentTask[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is { text: string; category?: unknown } => typeof t === 'object' && t !== null && typeof (t as { text?: unknown }).text === 'string')
    .map((t) => ({
      text: t.text.trim(),
      category: VALID_CATEGORIES.includes(t.category as TaskCategory) ? (t.category as TaskCategory) : 'other',
    }))
    .filter((t) => t.text.length > 0);
}

function normalizeUpdates(value: unknown): IntentUpdate[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (u): u is IntentUpdate =>
      typeof u === 'object' &&
      u !== null &&
      typeof (u as IntentUpdate).taskId === 'string' &&
      VALID_STATUSES.includes((u as IntentUpdate).status)
  );
}

function normalizeEdits(value: unknown): IntentEdit[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (e): e is { taskId: string; newText: string } =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as { taskId?: unknown }).taskId === 'string' &&
        typeof (e as { newText?: unknown }).newText === 'string'
    )
    .map((e) => ({ taskId: e.taskId, newText: e.newText.trim() }))
    .filter((e) => e.newText.length > 0);
}

export async function detectIntent(currentTasks: IntentTaskRef[], message: string): Promise<IntentResult> {
  const complete = getLlmComplete();
  const userPayload = JSON.stringify({ currentTasks, message });
  const text = await complete({
    system: `${SYSTEM_PROMPT}\n\n${INTENT_INSTRUCTIONS}`,
    user: userPayload,
  });

  const parsed = extractJson(text) as Record<string, unknown>;
  const type = parsed?.type;
  if (typeof type !== 'string' || !VALID_TYPES.includes(type as IntentType)) {
    return { type: 'chat', reply: undefined };
  }

  return {
    type: type as IntentType,
    tasks: normalizeTasks(parsed.tasks),
    updates: normalizeUpdates(parsed.updates),
    edits: normalizeEdits(parsed.edits),
    reply: str(parsed.reply),
    reminderText: str(parsed.reminderText),
    reminderTime: str(parsed.reminderTime),
    recurringText: str(parsed.recurringText),
    recurringTime: str(parsed.recurringTime),
    recurringSchedule: str(parsed.recurringSchedule),
    backlogText: str(parsed.backlogText),
  };
}

import { getLlmComplete, extractJson } from './client';
import { SYSTEM_PROMPT, INTENT_INSTRUCTIONS } from './prompts';
import { TaskCategory, TaskStatus } from '../types';

export type IntentType =
  | 'add_tasks'
  | 'replan'
  | 'update_status'
  | 'evening_report'
  | 'show_list'
  | 'show_week'
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

export interface IntentResult {
  type: IntentType;
  tasks?: IntentTask[];
  updates?: IntentUpdate[];
  reply?: string;
}

export type DetectIntentFn = (currentTasks: IntentTaskRef[], message: string) => Promise<IntentResult>;

const VALID_TYPES: IntentType[] = [
  'add_tasks',
  'replan',
  'update_status',
  'evening_report',
  'show_list',
  'show_week',
  'chat',
];
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
    reply: typeof parsed.reply === 'string' ? parsed.reply : undefined,
  };
}

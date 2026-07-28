import { getLlmComplete, extractJson } from './client';
import { SYSTEM_PROMPT, EVENING_RECONCILE_INSTRUCTIONS } from './prompts';
import { TaskCategory, TaskStatus } from '../types';

export interface ReconcileTaskInput {
  id: string;
  text: string;
}

export interface ReconcileResultItem {
  taskId: string;
  status: TaskStatus;
  note?: string;
}

export interface ReconcileNewTask {
  text: string;
  status: TaskStatus;
  category: TaskCategory;
}

export interface ReconcileOutput {
  results: ReconcileResultItem[];
  newTasks: ReconcileNewTask[];
  summary: string;
}

export type EveningReconcileFn = (
  morningPlan: ReconcileTaskInput[],
  eveningAnswer: string
) => Promise<ReconcileOutput>;

const VALID_STATUSES: TaskStatus[] = ['planned', 'done', 'partial', 'moved', 'dropped'];
const VALID_CATEGORIES: TaskCategory[] = ['work', 'personal', 'other'];

function isReconcileOutput(value: unknown): value is ReconcileOutput {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<ReconcileOutput>;
  if (!Array.isArray(v.results) || !Array.isArray(v.newTasks) || typeof v.summary !== 'string') {
    return false;
  }
  const resultsOk = v.results.every(
    (r) => typeof r === 'object' && r !== null && typeof (r as ReconcileResultItem).taskId === 'string' &&
      VALID_STATUSES.includes((r as ReconcileResultItem).status)
  );
  const newTasksOk = v.newTasks.every(
    (t) =>
      typeof t === 'object' &&
      t !== null &&
      typeof (t as ReconcileNewTask).text === 'string' &&
      VALID_STATUSES.includes((t as ReconcileNewTask).status) &&
      VALID_CATEGORIES.includes((t as ReconcileNewTask).category)
  );
  return resultsOk && newTasksOk;
}

export async function reconcileEvening(
  morningPlan: ReconcileTaskInput[],
  eveningAnswer: string
): Promise<ReconcileOutput> {
  const complete = getLlmComplete();
  const userPayload = JSON.stringify({ morningPlan, eveningAnswer });
  const text = await complete({
    system: `${SYSTEM_PROMPT}\n\n${EVENING_RECONCILE_INSTRUCTIONS}`,
    user: userPayload,
  });

  const parsed = extractJson(text);
  if (!isReconcileOutput(parsed)) {
    throw new Error('LLM response did not match expected ReconcileOutput shape');
  }
  return parsed;
}

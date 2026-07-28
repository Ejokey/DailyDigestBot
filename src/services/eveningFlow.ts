import { v4 as uuidv4 } from 'uuid';
import {
  getTasksForDate,
  updateTask,
  insertTask,
  upsertDailyState,
  upsertConversationState,
  getConversationState,
  getDailyState,
} from '../db';
import { Task, TaskStatus } from '../types';
import { EveningReconcileFn, ReconcileOutput } from '../llm/evening';

export interface EveningFlowResult {
  message: string;
  movedCount: number;
}

const STATUS_ICON: Record<TaskStatus, string> = {
  planned: '⬜',
  done: '✅',
  partial: '🔶',
  moved: '⏳',
  dropped: '❌',
};

function nowIso(): string {
  return new Date().toISOString();
}

function buildReport(updated: Task[], newTasks: Task[], moved: Task[], summary: string): string {
  const lines: string[] = ['Итог дня:'];
  for (const task of updated) {
    const suffix = task.status === 'moved' ? ' — moved to tomorrow' : ` — ${task.status}`;
    lines.push(`${STATUS_ICON[task.status]} ${task.text}${suffix}`);
  }
  for (const task of newTasks) {
    lines.push(`➕ Новое: ${task.text} — ${task.status}`);
  }
  lines.push('');
  if (moved.length > 0) {
    const names = moved.map((t) => t.text).join(', ');
    lines.push(`На завтра переносится: ${moved.length} задача (${names})`);
  } else {
    lines.push('На завтра ничего не переносится.');
  }
  if (summary) {
    lines.push('');
    lines.push(summary);
  }
  return lines.join('\n');
}

export async function handleEveningInput(
  userId: number,
  date: string,
  rawText: string,
  reconcileEvening: EveningReconcileFn
): Promise<EveningFlowResult> {
  const morningTasks = getTasksForDate(userId, date).filter((t) => t.status === 'planned');
  const morningPlanInput = morningTasks.map((t) => ({ id: t.id, text: t.text }));

  const output: ReconcileOutput = await reconcileEvening(morningPlanInput, rawText);

  const updated: Task[] = [];
  for (const result of output.results) {
    const task = morningTasks.find((t) => t.id === result.taskId);
    if (!task) continue;
    const movedCount = result.status === 'moved' ? task.movedCount + 1 : task.movedCount;
    updateTask(task.id, { status: result.status, movedCount });
    updated.push({ ...task, status: result.status, movedCount });
  }

  const newTasks: Task[] = output.newTasks.map((nt) => {
    const now = nowIso();
    const task: Task = {
      id: uuidv4(),
      userId,
      text: nt.text,
      status: nt.status,
      createdAt: now,
      updatedAt: now,
      date,
      movedCount: 0,
      source: 'new_during_review',
      category: nt.category,
    };
    insertTask(task);
    return task;
  });

  const moved = updated.filter((t) => t.status === 'moved');

  const existingDailyState = getDailyState(userId, date);
  upsertDailyState({
    userId,
    date,
    morningInputRaw: existingDailyState?.morningInputRaw ?? null,
    eveningInputRaw: rawText,
    morningProcessed: existingDailyState?.morningProcessed ?? true,
    eveningProcessed: true,
  });

  const existingConvState = getConversationState(userId);
  upsertConversationState({
    userId,
    currentDate: date,
    phase: 'evening_done',
    eveningCheckinTime: existingConvState?.eveningCheckinTime ?? '20:00',
  });

  return {
    message: buildReport(updated, newTasks, moved, output.summary),
    movedCount: moved.length,
  };
}

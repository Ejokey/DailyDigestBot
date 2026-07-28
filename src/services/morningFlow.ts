import { v4 as uuidv4 } from 'uuid';
import { insertTask, getTasksForDate, upsertDailyState, upsertConversationState, getConversationState } from '../db';
import { Task, TaskCategory, TaskSource } from '../types';
import { MorningParseFn, ParsedMorningTask } from '../llm/morning';
import { getCarriedOverTasks, toCarriedOverItems, CarriedOverItem } from './carryOver';
import { groupTasksByCategory } from './categoryDisplay';

export interface MorningFlowResult {
  tasks: Task[];
  message: string;
}

function todayIso(): string {
  return new Date().toISOString();
}

function buildConfirmation(tasks: Task[]): string {
  const groups = groupTasksByCategory(tasks);
  const lines: string[] = [`План на сегодня (${tasks.length} задачи):`];
  let counter = 0;
  for (const group of groups) {
    if (group.tasks.length === 0) continue;
    lines.push('', group.label);
    for (const t of group.tasks) {
      counter += 1;
      lines.push(`${counter}. ${t.text}`);
    }
  }
  return lines.join('\n');
}

/**
 * Carried-over tasks (status moved/partial from a previous day) are re-dated
 * into today's plan alongside whatever the morning text adds.
 */
export async function handleMorningInput(
  userId: number,
  date: string,
  rawText: string,
  parseMorningPlan: MorningParseFn,
  carriedOverItems?: CarriedOverItem[]
): Promise<MorningFlowResult> {
  const carryItems = carriedOverItems ?? toCarriedOverItems(getCarriedOverTasks(userId, date));
  const parsedItems: ParsedMorningTask[] = await parseMorningPlan(rawText);
  const allItems: { text: string; category: TaskCategory }[] = [...carryItems, ...parsedItems];

  const tasks: Task[] = allItems.map((item, index) => {
    const source: TaskSource = index < carryItems.length ? 'carried_over' : 'morning_plan';
    const now = todayIso();
    return {
      id: uuidv4(),
      userId,
      text: item.text,
      status: 'planned',
      createdAt: now,
      updatedAt: now,
      date,
      movedCount: 0,
      source,
      category: item.category,
    };
  });

  for (const task of tasks) {
    insertTask(task);
  }

  upsertDailyState({
    userId,
    date,
    morningInputRaw: rawText,
    eveningInputRaw: null,
    morningProcessed: true,
    eveningProcessed: false,
  });

  const existingConvState = getConversationState(userId);
  upsertConversationState({
    userId,
    currentDate: date,
    phase: 'day_active',
    eveningCheckinTime: existingConvState?.eveningCheckinTime ?? '20:00',
  });

  // Excludes 'dropped' — previously-deleted rows from earlier replans of the same day
  // must not resurface in the confirmation (they stay in DB for history/weekly digest).
  const stored = getTasksForDate(userId, date).filter((t) => t.status !== 'dropped');
  return { tasks: stored, message: buildConfirmation(stored) };
}

import { v4 as uuidv4 } from 'uuid';
import {
  getTasksForDate,
  updateTask,
  insertTask,
  getConversationState,
  upsertConversationState,
  getDailyState,
  deleteOpenPlanForDate,
} from '../db';
import { Task, TaskCategory, TaskStatus } from '../types';
import { MorningParseFn } from '../llm/morning';
import { EveningReconcileFn } from '../llm/evening';
import { DetectIntentFn, IntentTask } from '../llm/intent';
import { classifyCategory } from '../llm/category';
import { handleMorningInput } from '../services/morningFlow';
import { handleEveningInput } from '../services/eveningFlow';
import { buildWeeklyDigestForUser } from '../services/weeklyDigest';
import { groupTasksByCategory } from '../services/categoryDisplay';

const STATUS_ICON: Record<TaskStatus, string> = {
  planned: '⬜',
  done: '✅',
  partial: '🔶',
  moved: '⏳',
  dropped: '❌',
};

export const START_MESSAGE =
  'Привет! Я бот для ежедневного планирования задач.\n' +
  'Утром напиши план на день свободным текстом — я его структурирую.\n' +
  'В течение дня можешь писать обновления или использовать команды: /add /done /move /drop /list /week /time /edit.\n' +
  'Вечером спрошу, что реально сделано.';

function renderGroupedTasks(tasks: Task[]): string[] {
  const lines: string[] = [];
  let counter = 0;
  for (const group of groupTasksByCategory(tasks)) {
    if (group.tasks.length === 0) continue;
    lines.push('', group.label);
    for (const t of group.tasks) {
      counter += 1;
      lines.push(`${counter}. ${STATUS_ICON[t.status]} ${t.text}`);
    }
  }
  return lines;
}

export function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) return 'На сегодня задач нет.';
  return ['План на сегодня:', ...renderGroupedTasks(tasks)].join('\n');
}

/** Dropped tasks are excluded — from the user's perspective, "dropped" means "deleted". */
function getVisibleTasks(userId: number, date: string): Task[] {
  return getTasksForDate(userId, date).filter((t) => t.status !== 'dropped');
}

export function handleListCommand(userId: number, date: string): string {
  return formatTaskList(getVisibleTasks(userId, date));
}

export function buildEveningPingMessage(tasks: Task[]): string {
  const lines = [
    'Вечерний чек-ин! Вот твой план на сегодня:',
    ...renderGroupedTasks(tasks),
    '',
    'Что реально сделал? Напиши в любом формате.',
  ];
  return lines.join('\n');
}

export async function handleAddCommand(userId: number, date: string, text: string): Promise<string> {
  const category = await classifyCategory(text);
  const now = new Date().toISOString();
  const task: Task = {
    id: uuidv4(),
    userId,
    text,
    status: 'planned',
    createdAt: now,
    updatedAt: now,
    date,
    movedCount: 0,
    source: 'added_during_day',
    category,
  };
  insertTask(task);
  return `Добавлено (${category === 'work' ? 'работа' : category === 'personal' ? 'личное' : 'прочее'}): ${text}`;
}

function getTaskByIndex(userId: number, date: string, index: number): Task | null {
  const tasks = getVisibleTasks(userId, date);
  return tasks[index - 1] ?? null;
}

export function handleDoneCommand(userId: number, date: string, index: number): string {
  const task = getTaskByIndex(userId, date, index);
  if (!task) return `Задача №${index} не найдена.`;
  updateTask(task.id, { status: 'done' });
  return `✅ Отмечено выполненным: ${task.text}`;
}

export function handleMoveCommand(userId: number, date: string, index: number): string {
  const task = getTaskByIndex(userId, date, index);
  if (!task) return `Задача №${index} не найдена.`;
  updateTask(task.id, { status: 'moved', movedCount: task.movedCount + 1 });
  return `⏳ Перенесено на завтра: ${task.text}`;
}

export function handleDropCommand(userId: number, date: string, index: number): string {
  const task = getTaskByIndex(userId, date, index);
  if (!task) return `Задача №${index} не найдена.`;
  updateTask(task.id, { status: 'dropped' });
  return `❌ Убрано: ${task.text}`;
}

export function handleTimeCommand(userId: number, date: string, hhmm: string): string {
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm);
  if (!valid) return 'Формат времени: HH:MM, например 20:00';
  const existing = getConversationState(userId);
  upsertConversationState({
    userId,
    currentDate: existing?.currentDate ?? date,
    phase: existing?.phase ?? 'day_active',
    eveningCheckinTime: hhmm,
  });
  return `Время вечернего чек-ина установлено: ${hhmm}`;
}

export function handleWeekCommand(userId: number, date: string): string {
  return buildWeeklyDigestForUser(userId, date);
}

export async function handleMorningText(
  userId: number,
  date: string,
  rawText: string,
  parseMorningPlan: MorningParseFn
): Promise<string> {
  const result = await handleMorningInput(userId, date, rawText, parseMorningPlan);
  return result.message;
}

export async function handleEveningText(
  userId: number,
  date: string,
  rawText: string,
  reconcileEvening: EveningReconcileFn
): Promise<string> {
  const result = await handleEveningInput(userId, date, rawText, reconcileEvening);
  return result.message;
}

const CATEGORY_WORD: Record<TaskCategory, string> = {
  work: 'работа',
  personal: 'личное',
  other: 'прочее',
};

const STATUS_WORD: Record<TaskStatus, string> = {
  planned: 'в плане',
  done: 'выполнено',
  partial: 'частично',
  moved: 'перенесено на завтра',
  dropped: 'убрано',
};

function insertIntentTasks(userId: number, date: string, items: IntentTask[]): Task[] {
  return items.map((item) => {
    const now = new Date().toISOString();
    const task: Task = {
      id: uuidv4(),
      userId,
      text: item.text,
      status: 'planned',
      createdAt: now,
      updatedAt: now,
      date,
      movedCount: 0,
      source: 'added_during_day',
      category: item.category,
    };
    insertTask(task);
    return task;
  });
}

const CHAT_FALLBACK =
  'Могу принять план на день, добавить задачи, отметить прогресс и показать итоги. ' +
  'Напиши, что нужно, или используй /list, /add, /done, /move, /drop, /week.';

/**
 * Routes free text sent during an active day. The LLM picks from a wide intent
 * vocabulary (add / replan / status updates / reports / queries / plain chat) so
 * ordinary phrasing doesn't dead-end in a "не понял" reply.
 */
const STATUS_ICON_CHARS = Object.values(STATUS_ICON);

// The bot's own /list and evening-summary output is the only source of these icons —
// a message containing several of them is almost certainly the user pasting that output
// back (e.g. forwarding "the current state"), not a real planning instruction. Treating
// it as replan/add_tasks caused mass duplicate re-insertion of already-tracked tasks.
function looksLikeBotOutputEcho(text: string): boolean {
  const count = STATUS_ICON_CHARS.reduce((sum, icon) => sum + text.split(icon).length - 1, 0);
  return count >= 2;
}

export async function handleDayActiveText(
  userId: number,
  date: string,
  rawText: string,
  detectIntent: DetectIntentFn,
  parseMorningPlan: MorningParseFn,
  reconcileEvening: EveningReconcileFn
): Promise<string> {
  // Candidate pool for "which task do you mean" includes done/moved/partial too —
  // e.g. "удали X" or "верни X в план" should work even after X is no longer 'planned'.
  // Only 'dropped' (already deleted from the user's perspective) is excluded.
  const visibleTasks = getTasksForDate(userId, date).filter((t) => t.status !== 'dropped');

  if (looksLikeBotOutputEcho(rawText)) {
    return handleListCommand(userId, date);
  }

  const intent = await detectIntent(
    visibleTasks.map((t) => ({ id: t.id, text: t.text })),
    rawText
  );

  switch (intent.type) {
    case 'show_list':
      return handleListCommand(userId, date);

    case 'show_week':
      return handleWeekCommand(userId, date);

    case 'evening_report':
      return handleEveningText(userId, date, rawText, reconcileEvening);

    case 'replan': {
      const removed = deleteOpenPlanForDate(userId, date);
      const result = await handleMorningInput(userId, date, rawText, parseMorningPlan, []);
      const prefix = removed > 0 ? `Обновил план (заменил ${removed}).\n\n` : '';
      return prefix + result.message;
    }

    case 'add_tasks': {
      const items = intent.tasks?.length
        ? intent.tasks
        : [{ text: rawText.trim(), category: await classifyCategory(rawText) }];
      const added = insertIntentTasks(userId, date, items);
      if (added.length === 1) {
        return `Добавлено (${CATEGORY_WORD[added[0].category]}): ${added[0].text}`;
      }
      const lines = added.map((t) => `+ ${t.text} (${CATEGORY_WORD[t.category]})`);
      return `Добавлено задач: ${added.length}\n${lines.join('\n')}`;
    }

    case 'update_status': {
      // The LLM occasionally emits the same taskId twice (e.g. one message describing
      // one task in two different phrasings) — applying both printed a duplicate
      // confirmation line for a single status change. Keep only the last per taskId.
      const dedupedUpdates = Array.from(
        new Map((intent.updates ?? []).map((u) => [u.taskId, u])).values()
      );
      const applied: string[] = [];
      for (const update of dedupedUpdates) {
        const task = visibleTasks.find((t) => t.id === update.taskId);
        if (!task) continue;
        const movedCount = update.status === 'moved' ? task.movedCount + 1 : task.movedCount;
        updateTask(task.id, { status: update.status, movedCount });
        applied.push(`${STATUS_ICON[update.status]} ${task.text} — ${STATUS_WORD[update.status]}`);
      }
      if (applied.length === 0) {
        return 'Не понял, о какой задаче речь. Посмотреть текущие — /list.';
      }
      return applied.join('\n');
    }

    case 'chat':
    default:
      return intent.reply?.trim() || CHAT_FALLBACK;
  }
}

/**
 * Top-level free-text router: decides whether the message is a morning plan,
 * an evening check-in reply, or a day-active update, based on ConversationState/DailyState.
 */
export async function routeFreeText(
  userId: number,
  date: string,
  rawText: string,
  parseMorningPlan: MorningParseFn,
  reconcileEvening: EveningReconcileFn,
  detectIntent: DetectIntentFn
): Promise<string> {
  const dailyState = getDailyState(userId, date);
  const convState = getConversationState(userId);

  if (!dailyState || !dailyState.morningProcessed) {
    return handleMorningText(userId, date, rawText, parseMorningPlan);
  }
  if (convState?.phase === 'awaiting_evening' && !dailyState.eveningProcessed) {
    return handleEveningText(userId, date, rawText, reconcileEvening);
  }
  return handleDayActiveText(userId, date, rawText, detectIntent, parseMorningPlan, reconcileEvening);
}

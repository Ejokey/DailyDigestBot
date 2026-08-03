import { v4 as uuidv4 } from 'uuid';
import {
  getTasksForDate,
  updateTask,
  insertTask,
  getConversationState,
  upsertConversationState,
  getDailyState,
  deleteOpenPlanForDate,
  insertRecurringTask,
  getRecurringTasksForUser,
  deleteRecurringTask,
  insertReminder,
  getPendingRemindersForUser,
  deleteReminder,
  insertBacklogItem,
  getBacklogForUser,
  deleteBacklogItem,
} from '../db';
import { Task, TaskCategory, TaskStatus, RecurringTask, Reminder, BacklogItem } from '../types';
import { MorningParseFn } from '../llm/morning';
import { EveningReconcileFn } from '../llm/evening';
import { DetectIntentFn, IntentTask } from '../llm/intent';
import { classifyCategory } from '../llm/category';
import { handleMorningInput } from '../services/morningFlow';
import { handleEveningInput } from '../services/eveningFlow';
import { buildWeeklyDigestForUser } from '../services/weeklyDigest';
import { groupTasksByCategory } from '../services/categoryDisplay';
import { parseScheduleWord, scheduleLabel } from '../services/recurringTasks';
import { parseReminderTime, formatMskDateTime } from '../util/date';

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
  'В течение дня можешь писать обновления или использовать команды: /add /done /move /drop /list /week /time /recur /remind /backlog /edit.\n' +
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

/**
 * Same tasks /list renders, flattened in the exact category-grouped order the
 * numbered text uses — so inline button row N lines up with printed line N.
 * (Returning insertion order instead was the earlier bug: buttons and numbers
 * only matched by coincidence whenever a user had a single category.)
 */
export function getTasksForListView(userId: number, date: string): Task[] {
  return groupTasksByCategory(getVisibleTasks(userId, date)).flatMap((group) => group.tasks);
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
  const trimmed = text.trim();
  if (!trimmed) return 'Использование: /add <текст задачи>';
  const category = await classifyCategory(trimmed);
  const now = new Date().toISOString();
  const task: Task = {
    id: uuidv4(),
    userId,
    text: trimmed,
    status: 'planned',
    createdAt: now,
    updatedAt: now,
    date,
    movedCount: 0,
    source: 'added_during_day',
    category,
  };
  insertTask(task);
  return `Добавлено (${category === 'work' ? 'работа' : category === 'personal' ? 'личное' : 'прочее'}): ${trimmed}`;
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

export function handleEditCommand(userId: number, date: string, argsText: string): string {
  const match = argsText.trim().match(/^(\d+)\s+([\s\S]+)$/);
  if (!match) {
    return 'Использование: /edit <номер> <новый текст>\nИли просто напиши, что изменить (например: "переименуй ревью ТЗ в финальное ревью ТЗ") — я разберу и применю.';
  }
  const index = parseInt(match[1], 10);
  const newText = match[2].trim();
  const task = getTaskByIndex(userId, date, index);
  if (!task) return `Задача №${index} не найдена.`;
  updateTask(task.id, { text: newText });
  return `✏️ ${task.text} → ${newText}`;
}

/**
 * Used by inline keyboard button taps (/list), which reference a task by id
 * rather than by its position — positions shift as other tasks change status,
 * so an id-based lookup avoids acting on the wrong task after a stale tap.
 */
export function handleTaskActionById(userId: number, date: string, taskId: string, action: 'done' | 'moved' | 'dropped'): string {
  const task = getVisibleTasks(userId, date).find((t) => t.id === taskId);
  if (!task) return 'Задача не найдена (возможно, уже изменена).';
  const movedCount = action === 'moved' ? task.movedCount + 1 : task.movedCount;
  updateTask(task.id, { status: action, movedCount });
  return `${STATUS_ICON[action]} ${task.text} — ${STATUS_WORD[action]}`;
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

const RECUR_USAGE =
  'Использование: /recur add HH:MM daily|<день недели> <текст>\n' +
  'Например: /recur add 09:00 daily Проверить почту\n' +
  'Или: /recur add 18:00 понедельник Еженедельный отчёт\n' +
  '/recur list — показать список\n' +
  '/recur remove <номер> — удалить';

export async function handleRecurCommand(userId: number, argsText: string): Promise<string> {
  const trimmed = argsText.trim();
  const [sub, ...rest] = trimmed.split(/\s+/);

  if (sub === 'list') {
    const items = getRecurringTasksForUser(userId);
    if (items.length === 0) return 'Повторяющихся задач пока нет. ' + RECUR_USAGE;
    return items
      .map((rt, i) => `${i + 1}. [${rt.time}, ${scheduleLabel(rt.schedule)}] ${rt.text}`)
      .join('\n');
  }

  if (sub === 'remove') {
    const index = parseInt(rest[0], 10);
    const items = getRecurringTasksForUser(userId);
    if (!index || index < 1 || index > items.length) return `Нет повторяющейся задачи под номером ${rest[0]}.`;
    deleteRecurringTask(items[index - 1].id);
    return `Удалено: ${items[index - 1].text}`;
  }

  if (sub === 'add') {
    const timeMatch = rest[0];
    const scheduleWord = rest[1];
    const text = rest.slice(2).join(' ').trim();
    const validTime = timeMatch && /^([01]\d|2[0-3]):[0-5]\d$/.test(timeMatch);
    const schedule = scheduleWord ? parseScheduleWord(scheduleWord) : null;
    if (!validTime || !schedule || !text) return RECUR_USAGE;

    const recurringTask: RecurringTask = {
      id: uuidv4(),
      userId,
      text,
      category: await classifyCategory(text),
      schedule,
      time: timeMatch,
      createdAt: new Date().toISOString(),
    };
    insertRecurringTask(recurringTask);
    return `Добавлено в расписание: "${text}" (${timeMatch}, ${scheduleLabel(schedule)})`;
  }

  return RECUR_USAGE;
}

const REMIND_USAGE =
  'Использование: /remind add HH:MM <текст> или /remind add +30m <текст> (можно +2h, +1d)\n' +
  'Например: /remind add 18:00 позвонить клиенту\n' +
  '/remind list — показать активные напоминания\n' +
  '/remind cancel <номер> — отменить';

export function handleRemindCommand(userId: number, argsText: string): string {
  const trimmed = argsText.trim();
  const [sub, ...rest] = trimmed.split(/\s+/);

  if (sub === 'list') {
    const items = getPendingRemindersForUser(userId);
    if (items.length === 0) return 'Активных напоминаний нет. ' + REMIND_USAGE;
    return items.map((r, i) => `${i + 1}. [${formatMskDateTime(r.fireAt)}] ${r.text}`).join('\n');
  }

  if (sub === 'cancel') {
    const index = parseInt(rest[0], 10);
    const items = getPendingRemindersForUser(userId);
    if (!index || index < 1 || index > items.length) return `Нет напоминания под номером ${rest[0]}.`;
    deleteReminder(items[index - 1].id);
    return `Отменено: ${items[index - 1].text}`;
  }

  if (sub === 'add') {
    const timeToken = rest[0];
    const text = rest.slice(1).join(' ').trim();
    const fireAt = timeToken ? parseReminderTime(timeToken) : null;
    if (!fireAt || !text) return REMIND_USAGE;

    const reminder: Reminder = {
      id: uuidv4(),
      userId,
      text,
      fireAt,
      fired: false,
      createdAt: new Date().toISOString(),
    };
    insertReminder(reminder);
    return `Напомню: "${text}" — ${formatMskDateTime(fireAt)}`;
  }

  return REMIND_USAGE;
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
  return items
    .filter((item) => item.text.trim().length > 0)
    .map((item) => {
      const now = new Date().toISOString();
      const task: Task = {
        id: uuidv4(),
        userId,
        text: item.text.trim(),
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
      if (added.length === 0) {
        return 'Не понял, что добавить. Опиши задачу текстом.';
      }
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

    case 'edit_task': {
      const dedupedEdits = Array.from(
        new Map((intent.edits ?? []).map((e) => [e.taskId, e])).values()
      );
      const applied: string[] = [];
      for (const edit of dedupedEdits) {
        const task = visibleTasks.find((t) => t.id === edit.taskId);
        if (!task) continue;
        const newText = edit.newText.trim();
        if (!newText) continue;
        updateTask(task.id, { text: newText });
        applied.push(`✏️ ${task.text} → ${newText}`);
      }
      if (applied.length === 0) {
        return 'Не понял, какую задачу и на что переименовать. Посмотреть текущие — /list.';
      }
      return applied.join('\n');
    }

    case 'set_reminder': {
      const text = intent.reminderText?.trim();
      const fireAt = intent.reminderTime ? parseReminderTime(intent.reminderTime) : null;
      if (!text || !fireAt) {
        return 'Не понял, когда и о чём напомнить. Можно так: /remind add 18:00 позвонить клиенту';
      }
      const reminder: Reminder = { id: uuidv4(), userId, text, fireAt, fired: false, createdAt: new Date().toISOString() };
      insertReminder(reminder);
      return `Напомню: "${text}" — ${formatMskDateTime(fireAt)}`;
    }

    case 'set_recurring': {
      const text = intent.recurringText?.trim();
      const schedule = intent.recurringSchedule ? parseScheduleWord(intent.recurringSchedule) : null;
      const time = intent.recurringTime;
      const validTime = time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
      if (!text || !schedule || !validTime) {
        return 'Не понял расписание. Можно так: /recur add 09:00 daily текст';
      }
      const recurringTask: RecurringTask = {
        id: uuidv4(),
        userId,
        text,
        category: await classifyCategory(text),
        schedule,
        time,
        createdAt: new Date().toISOString(),
      };
      insertRecurringTask(recurringTask);
      return `Добавлено в расписание: "${text}" (${time}, ${scheduleLabel(schedule)})`;
    }

    case 'add_backlog': {
      const text = intent.backlogText?.trim();
      if (!text) {
        return 'Не понял, что добавить в бэклог. Можно так: /backlog add текст';
      }
      const item: BacklogItem = { id: uuidv4(), userId, text, category: await classifyCategory(text), createdAt: new Date().toISOString() };
      insertBacklogItem(item);
      return `Добавлено в бэклог (${CATEGORY_WORD[item.category]}): ${item.text}`;
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

const BACKLOG_USAGE =
  'Использование: /backlog add <текст> — добавить в бэклог\n' +
  '/backlog list — показать бэклог\n' +
  '/backlog pull <номер> — перенести в план на сегодня\n' +
  '/backlog remove <номер> — удалить из бэклога';

export async function handleBacklogCommand(userId: number, date: string, argsText: string): Promise<string> {
  const trimmed = argsText.trim();
  const [sub, ...rest] = trimmed.split(/\s+/);

  if (sub === 'list') {
    const items = getBacklogForUser(userId);
    if (items.length === 0) return 'Бэклог пуст. ' + BACKLOG_USAGE;
    return items.map((item, i) => `${i + 1}. ${item.text} (${CATEGORY_WORD[item.category]})`).join('\n');
  }

  if (sub === 'remove') {
    const index = parseInt(rest[0], 10);
    const items = getBacklogForUser(userId);
    if (!index || index < 1 || index > items.length) return `Нет пункта бэклога под номером ${rest[0]}.`;
    deleteBacklogItem(items[index - 1].id);
    return `Удалено из бэклога: ${items[index - 1].text}`;
  }

  if (sub === 'pull') {
    const index = parseInt(rest[0], 10);
    const items = getBacklogForUser(userId);
    if (!index || index < 1 || index > items.length) return `Нет пункта бэклога под номером ${rest[0]}.`;
    const item = items[index - 1];
    const [added] = insertIntentTasks(userId, date, [{ text: item.text, category: item.category }]);
    deleteBacklogItem(item.id);
    return `Перенесено в план на сегодня (${CATEGORY_WORD[added.category]}): ${added.text}`;
  }

  if (sub === 'add') {
    const text = rest.join(' ').trim();
    if (!text) return BACKLOG_USAGE;
    const item: BacklogItem = {
      id: uuidv4(),
      userId,
      text,
      category: await classifyCategory(text),
      createdAt: new Date().toISOString(),
    };
    insertBacklogItem(item);
    return `Добавлено в бэклог (${CATEGORY_WORD[item.category]}): ${item.text}`;
  }

  return BACKLOG_USAGE;
}

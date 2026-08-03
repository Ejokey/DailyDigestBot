import { v4 as uuidv4 } from 'uuid';
import { Telegraf } from 'telegraf';
import { getAllRecurringTasks, getTasksForDate, insertTask } from '../db';
import { RecurringTask, Task, TaskCategory } from '../types';
import { currentHHMM, currentWeekday, todayDate } from '../util/date';

const WEEKDAY_WORDS: Record<string, number> = {
  воскресенье: 0,
  понедельник: 1,
  вторник: 2,
  среда: 3,
  среду: 3,
  четверг: 4,
  пятница: 5,
  пятницу: 5,
  суббота: 6,
  субботу: 6,
};

const WEEKDAY_LABELS: Record<number, string> = {
  0: 'по воскресеньям',
  1: 'по понедельникам',
  2: 'по вторникам',
  3: 'по средам',
  4: 'по четвергам',
  5: 'по пятницам',
  6: 'по субботам',
};

/** Returns 'daily' or a UTC weekday index as a string ('0'-'6'), or null if unrecognized. */
export function parseScheduleWord(word: string): string | null {
  const normalized = word.trim().toLowerCase();
  if (normalized === 'daily' || normalized === 'ежедневно' || normalized === 'каждый день') return 'daily';
  const weekday = WEEKDAY_WORDS[normalized];
  return weekday !== undefined ? String(weekday) : null;
}

export function scheduleLabel(schedule: string): string {
  if (schedule === 'daily') return 'ежедневно';
  const weekday = Number(schedule);
  return WEEKDAY_LABELS[weekday] ?? schedule;
}

function isDueToday(schedule: string): boolean {
  return schedule === 'daily' || Number(schedule) === currentWeekday();
}

/**
 * Every minute, inserts any recurring task whose schedule+time matches right now into
 * the user's plan for today — guarded against re-insertion by checking for an existing
 * 'recurring' task with the same text on the same date (covers accidental double cron
 * ticks or a restart landing on the same minute).
 */
export async function applyDueRecurringTasks(bot: Telegraf): Promise<void> {
  const nowHHMM = currentHHMM();
  const recurringTasks = getAllRecurringTasks();
  const dueByUser = new Map<number, RecurringTask[]>();

  for (const rt of recurringTasks) {
    if (rt.time !== nowHHMM || !isDueToday(rt.schedule)) continue;
    const list = dueByUser.get(rt.userId) ?? [];
    list.push(rt);
    dueByUser.set(rt.userId, list);
  }

  for (const [userId, dueTasks] of dueByUser) {
    const date = todayDate();
    const existing = getTasksForDate(userId, date);
    const added: Task[] = [];

    for (const rt of dueTasks) {
      const alreadyInserted = existing.some((t) => t.source === 'recurring' && t.text === rt.text);
      if (alreadyInserted) continue;
      const now = new Date().toISOString();
      const task: Task = {
        id: uuidv4(),
        userId,
        text: rt.text,
        status: 'planned',
        createdAt: now,
        updatedAt: now,
        date,
        movedCount: 0,
        source: 'recurring',
        category: rt.category as TaskCategory,
      };
      insertTask(task);
      added.push(task);
    }

    if (added.length === 0) continue;

    const lines = added.map((t) => `+ ${t.text}`);
    try {
      await bot.telegram.sendMessage(userId, `По расписанию добавлено в план:\n${lines.join('\n')}`);
    } catch (err) {
      console.error(`Failed to notify user ${userId} about recurring tasks:`, err);
    }
  }
}

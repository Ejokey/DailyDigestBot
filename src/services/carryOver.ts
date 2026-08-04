import { v4 as uuidv4 } from 'uuid';
import { getTasksForDate, getTasksInRange, insertTask } from '../db';
import { Task, TaskCategory } from '../types';
import { groupTasksByCategory } from './categoryDisplay';

export interface CarriedOverItem {
  text: string;
  category: TaskCategory;
}

export function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Tasks left unfinished ('moved' or 'partial') on the day before `date`. */
export function getCarriedOverTasks(userId: number, date: string): Task[] {
  const prevDate = previousDate(date);
  return getTasksInRange(userId, prevDate, prevDate).filter(
    (t) => t.status === 'moved' || t.status === 'partial'
  );
}

export function toCarriedOverItems(tasks: Task[]): CarriedOverItem[] {
  return tasks.map((t) => ({ text: t.text, category: t.category }));
}

/**
 * Materializes yesterday's unfinished tasks into today's plan the first time
 * anything looks at today — not just when the user types a morning message.
 * Previously /list on a fresh day queried an empty date bucket directly and
 * showed "На сегодня задач нет" even though carried-over tasks existed,
 * because carry-over only ran inside the morning-text flow. No-ops once
 * today already has any rows, so calling this from multiple entry points
 * (list, morning flow) never inserts duplicates.
 */
export function ensureCarriedOverForToday(userId: number, date: string): Task[] {
  const existing = getTasksForDate(userId, date);
  if (existing.length > 0) return existing;

  const carried = getCarriedOverTasks(userId, date);
  const now = new Date().toISOString();
  for (const t of carried) {
    insertTask({
      id: uuidv4(),
      userId,
      text: t.text,
      status: 'planned',
      createdAt: now,
      updatedAt: now,
      date,
      originalDate: t.originalDate ?? t.date,
      movedCount: t.movedCount,
      source: 'carried_over',
      category: t.category,
    });
  }
  return getTasksForDate(userId, date);
}

/** Proactive morning ping shown before the user submits today's plan. */
export function buildCarryOverPrompt(tasks: Task[]): string {
  if (tasks.length === 0) {
    return 'Доброе утро! Добавь новые задачи на сегодня или напиши план.';
  }
  const groups = groupTasksByCategory(tasks);
  const lines: string[] = ['Доброе утро! Перенесённые задачи:'];
  for (const group of groups) {
    if (group.tasks.length === 0) continue;
    lines.push('', group.label);
    for (const t of group.tasks) lines.push(`- ${t.text}`);
  }
  lines.push('', 'Добавь новые задачи на сегодня или напиши план.');
  return lines.join('\n');
}

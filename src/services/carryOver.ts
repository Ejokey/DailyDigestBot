import { getTasksInRange } from '../db';
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

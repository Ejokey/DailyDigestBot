import { getTasksInRange } from '../db';
import { Task } from '../types';

export interface WeekRange {
  from: string;
  to: string;
}

/** Monday-to-Sunday range (UTC) for the week containing `date` (YYYY-MM-DD). */
export function getWeekRange(date: string): WeekRange {
  const d = new Date(`${date}T00:00:00Z`);
  const dayOfWeek = d.getUTCDay(); // 0 = Sunday
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

function pluralizeTimes(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'раз';
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'раза';
  return 'раз';
}

export interface WeeklyDigestStats {
  doneCount: number;
  totalCount: number;
  completionPct: number;
  mostMovedText: string | null;
  mostMovedCount: number;
  newTasksCount: number;
  avgTasksPerDay: number;
  daysInRange: number;
}

export function computeWeeklyStats(tasks: Task[], daysInRange = 7): WeeklyDigestStats {
  const nonDropped = tasks.filter((t) => t.status !== 'dropped');
  const doneCount = nonDropped.filter((t) => t.status === 'done').length;
  const totalCount = nonDropped.length;
  const completionPct = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);

  const movesByText = new Map<string, number>();
  for (const t of tasks) {
    if (t.status === 'moved') {
      movesByText.set(t.text, (movesByText.get(t.text) ?? 0) + 1);
    }
  }
  let mostMovedText: string | null = null;
  let mostMovedCount = 0;
  for (const [text, count] of movesByText) {
    if (count > mostMovedCount) {
      mostMovedText = text;
      mostMovedCount = count;
    }
  }

  const newTasksCount = tasks.filter(
    (t) => t.source === 'new_during_review' || t.source === 'added_during_day'
  ).length;

  const avgTasksPerDay = daysInRange === 0 ? 0 : Math.round((totalCount / daysInRange) * 10) / 10;

  return { doneCount, totalCount, completionPct, mostMovedText, mostMovedCount, newTasksCount, avgTasksPerDay, daysInRange };
}

export function buildWeeklyDigest(tasks: Task[], daysInRange = 7): string {
  const stats = computeWeeklyStats(tasks, daysInRange);
  const lines: string[] = ['📊 Недельный итог:'];
  lines.push(`- Выполнено: ${stats.doneCount} из ${stats.totalCount} задач (${stats.completionPct}%)`);
  if (stats.mostMovedText) {
    lines.push(`- Перенесено чаще всего: ${stats.mostMovedText} (${stats.mostMovedCount} ${pluralizeTimes(stats.mostMovedCount)})`);
  }
  lines.push(`- Новых задач за неделю: ${stats.newTasksCount}`);
  lines.push(`- Среднее задач в день: ${stats.avgTasksPerDay}`);

  if (stats.mostMovedText && stats.mostMovedCount >= 3) {
    lines.push('');
    lines.push(
      `⚠️ "${stats.mostMovedText}" переносились ${stats.mostMovedCount} ${pluralizeTimes(stats.mostMovedCount)} — возможно стоит переоценить объём.`
    );
  }

  return lines.join('\n');
}

export function buildWeeklyDigestForUser(userId: number, anyDateInWeek: string): string {
  const { from, to } = getWeekRange(anyDateInWeek);
  const tasks = getTasksInRange(userId, from, to);
  return buildWeeklyDigest(tasks);
}

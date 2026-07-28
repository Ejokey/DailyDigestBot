import { Task, TaskCategory } from '../types';

const CATEGORY_ORDER: TaskCategory[] = ['work', 'personal', 'other'];
const CATEGORY_LABELS: Record<TaskCategory, string> = {
  work: 'Работа:',
  personal: 'Личное:',
  other: 'Прочее:',
};

export interface TaskCategoryGroup {
  category: TaskCategory;
  label: string;
  tasks: Task[];
}

/** Groups tasks by category in a fixed display order (work, personal, other). */
export function groupTasksByCategory(tasks: Task[]): TaskCategoryGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    tasks: tasks.filter((t) => t.category === category),
  }));
}

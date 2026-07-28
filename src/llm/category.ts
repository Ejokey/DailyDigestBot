import { getLlmComplete, extractJson } from './client';
import { SYSTEM_PROMPT, CATEGORIZE_INSTRUCTIONS } from './prompts';
import { TaskCategory } from '../types';

const VALID_CATEGORIES: TaskCategory[] = ['work', 'personal', 'other'];

export async function classifyCategory(text: string): Promise<TaskCategory> {
  const complete = getLlmComplete();
  const response = await complete({
    system: `${SYSTEM_PROMPT}\n\n${CATEGORIZE_INSTRUCTIONS}`,
    user: text,
  });

  const parsed = extractJson(response) as { category?: unknown };
  const category = parsed.category;
  if (typeof category === 'string' && VALID_CATEGORIES.includes(category as TaskCategory)) {
    return category as TaskCategory;
  }
  return 'other';
}

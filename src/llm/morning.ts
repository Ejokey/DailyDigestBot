import { getLlmComplete, extractJson } from './client';
import { SYSTEM_PROMPT, MORNING_PARSE_INSTRUCTIONS } from './prompts';
import { TaskCategory } from '../types';

export interface ParsedMorningTask {
  text: string;
  category: TaskCategory;
}

export type MorningParseFn = (rawText: string) => Promise<ParsedMorningTask[]>;

interface MorningParseResult {
  tasks: ParsedMorningTask[];
}

const VALID_CATEGORIES: TaskCategory[] = ['work', 'personal', 'other'];

function isMorningParseResult(value: unknown): value is MorningParseResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { tasks?: unknown };
  if (!Array.isArray(v.tasks)) return false;
  return v.tasks.every(
    (t) =>
      typeof t === 'object' &&
      t !== null &&
      typeof (t as ParsedMorningTask).text === 'string' &&
      VALID_CATEGORIES.includes((t as ParsedMorningTask).category)
  );
}

export async function parseMorningPlan(rawText: string): Promise<ParsedMorningTask[]> {
  const complete = getLlmComplete();
  const text = await complete({
    system: `${SYSTEM_PROMPT}\n\n${MORNING_PARSE_INSTRUCTIONS}`,
    user: rawText,
  });

  const parsed = extractJson(text);
  if (!isMorningParseResult(parsed)) {
    throw new Error('LLM response did not match expected {"tasks": {text, category}[]} shape');
  }
  return parsed.tasks;
}

import { LlmComplete } from './provider';
import { ollamaComplete } from './providers/ollama';
import { anthropicComplete } from './providers/anthropic';
import { groqComplete } from './providers/groq';

/**
 * LLM_PROVIDER selects the backend: 'groq' (cloud, free tier, needs GROQ_API_KEY),
 * 'ollama' (local, free, model set via OLLAMA_MODEL), or 'anthropic' (cloud, needs
 * ANTHROPIC_API_KEY). Defaults to 'ollama' unless overridden.
 */
export function getLlmComplete(): LlmComplete {
  const provider = process.env.LLM_PROVIDER || 'ollama';
  if (provider === 'anthropic') return anthropicComplete;
  if (provider === 'ollama') return ollamaComplete;
  if (provider === 'groq') return groqComplete;
  throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(jsonText);
}

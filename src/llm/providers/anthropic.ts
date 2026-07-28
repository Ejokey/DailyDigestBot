import Anthropic from '@anthropic-ai/sdk';
import { LlmComplete } from '../provider';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  client = new Anthropic({ apiKey });
  return client;
}

export const anthropicComplete: LlmComplete = async ({ system, user }) => {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('LLM response contained no text block');
  }
  return textBlock.text;
};

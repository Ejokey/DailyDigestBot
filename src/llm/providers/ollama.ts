import { LlmComplete } from '../provider';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';

interface OllamaChatResponse {
  message?: { role: string; content: string };
}

export const ollamaComplete: LlmComplete = async ({ system, user }) => {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      format: 'json',
      stream: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama request failed: ${res.status} ${res.statusText} ${body}`);
  }

  const data = (await res.json()) as OllamaChatResponse;
  const content = data.message?.content;
  if (!content) {
    throw new Error('Ollama response contained no message content');
  }
  return content;
};

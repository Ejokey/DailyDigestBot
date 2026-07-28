export interface LlmCompleteParams {
  system: string;
  user: string;
}

/** A provider takes a system+user prompt and returns raw text (expected to contain JSON per our prompts). */
export type LlmComplete = (params: LlmCompleteParams) => Promise<string>;

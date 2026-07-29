import type { LLMMessage, LLMTool, LLMResponse, LLMConfig } from '../types';

export interface LLMProvider {
  id: string;
  name: string;
  supportsTools: boolean;
  call(messages: LLMMessage[], tools: LLMTool[], config: LLMConfig, signal?: AbortSignal): Promise<LLMResponse>;
}

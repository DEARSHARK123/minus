export type { LLMMessage, LLMTool, LLMToolCall, LLMResponse, LLMConfig } from './types';
import type { LLMMessage, LLMTool, LLMResponse, LLMConfig } from './types';
import { getProvider } from './providers';

export async function callLLM(
  messages: LLMMessage[],
  tools: LLMTool[],
  config: LLMConfig & { providerId?: string },
  signal?: AbortSignal
): Promise<LLMResponse> {
  try {
    const provider = getProvider(config.providerId || 'openai');
    return await provider.call(messages, tools, config, signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new Error(`LLM调用失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

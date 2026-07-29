import { z } from 'zod';
import { callLLM } from '@/lib/llm/client';
import type { LLMConfig, LLMMessage } from '@/lib/llm/types';
import { ModelResponseFormatError } from '@/lib/llm/errors';
import { parseJsonFromLLM } from './json';

export interface AgentLLMOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  providerId?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  userSystemPrompt?: string;
}

const RETRY_NUDGE =
  'Your previous reply was invalid. Return ONLY valid JSON matching the required schema. No markdown fences, no commentary.';

export async function callAgentJson<T>(
  system: string,
  user: string,
  options: AgentLLMOptions,
  schema?: z.ZodType<T>,
): Promise<T> {
  const config: LLMConfig & { providerId?: string } = {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
    providerId: options.providerId,
    temperature: options.temperature ?? 0.4,
    maxTokens: options.maxTokens ?? 2048,
  };

  const attempt = async (messages: LLMMessage[]): Promise<T> => {
    const response = await callLLM(messages, [], config, options.signal);
    const content = response.content?.trim() || '';
    try {
      if (!content) {
        throw new Error('Agent returned empty content');
      }
      const parsed = parseJsonFromLLM<unknown>(content);
      if (schema) {
        return schema.parse(parsed);
      }
      return parsed as T;
    } catch (error) {
      throw new ModelResponseFormatError(error);
    }
  };

  const effectiveSystem = options.userSystemPrompt?.trim()
    ? `${system}\n\nUser instructions (apply unless they conflict with safety, citation truthfulness, or the required JSON protocol):\n${options.userSystemPrompt.trim()}`
    : system;
  const baseMessages: LLMMessage[] = [
    { role: 'system', content: effectiveSystem },
    { role: 'user', content: user },
  ];

  try {
    return await attempt(baseMessages);
  } catch (firstError) {
    if (!(firstError instanceof ModelResponseFormatError)) {
      throw firstError;
    }
    const retryMessages: LLMMessage[] = [
      ...baseMessages,
      {
        role: 'user',
        content: RETRY_NUDGE,
      },
    ];
    try {
      return await attempt(retryMessages);
    } catch (retryError) {
      if (!(retryError instanceof ModelResponseFormatError)) {
        throw retryError;
      }
      throw new ModelResponseFormatError(retryError);
    }
  }
}

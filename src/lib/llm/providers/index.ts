import type { LLMProvider } from './base';
import { openaiProvider } from './openai';
import { anthropicProvider } from './anthropic';
import { deepseekProvider } from './deepseek';
import { geminiProvider } from './gemini';

const providerMap = new Map<string, LLMProvider>();

function register(p: LLMProvider) {
  providerMap.set(p.id, p);
}

register(openaiProvider);
register(anthropicProvider);
register(deepseekProvider);
register(geminiProvider);

export function getProvider(providerId: string): LLMProvider {
  // Normalize legacy google id → gemini
  const id = providerId === 'google' ? 'gemini' : providerId;
  const p = providerMap.get(id);
  if (!p) {
    throw new Error(
      `Unknown provider: "${providerId}". Supported providers: openai, anthropic, deepseek, gemini. No fallback to OpenAI.`
    );
  }
  return p;
}

export function registerProvider(provider: LLMProvider): void {
  register(provider);
}

export { openaiProvider, anthropicProvider, deepseekProvider, geminiProvider };
export type { LLMProvider } from './base';

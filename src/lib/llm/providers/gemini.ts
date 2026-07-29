import type { LLMMessage, LLMTool, LLMResponse, LLMConfig } from '../types';
import type { LLMProvider } from './base';

export const geminiProvider: LLMProvider = {
  id: 'gemini',
  name: 'Google Gemini',
  supportsTools: true,

  async call(
    messages: LLMMessage[],
    tools: LLMTool[],
    config: LLMConfig,
    signal?: AbortSignal
  ): Promise<LLMResponse> {
    const baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const model = config.model || 'gemini-2.5-pro';

    // Gemini OpenAI-compatible endpoint
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 4096,
    };

    if (config.topP !== undefined) {
      body.top_p = config.topP;
    }
    if (config.frequencyPenalty !== undefined) {
      body.frequency_penalty = config.frequencyPenalty;
    }
    if (config.presencePenalty !== undefined) {
      body.presence_penalty = config.presencePenalty;
    }

    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = config.toolChoice || 'auto';
    }

    const response = await fetch(`${baseUrl}/openai/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error('No response from Gemini');
    }

    return {
      content: choice.message?.content || null,
      tool_calls: choice.message?.tool_calls || [],
      finish_reason: choice.finish_reason,
    };
  },
};

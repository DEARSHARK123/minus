import type { LLMMessage, LLMTool, LLMResponse, LLMConfig } from '../types';
import type { LLMProvider } from './base';

export const anthropicProvider: LLMProvider = {
  id: 'anthropic',
  name: 'Anthropic',
  supportsTools: true,

  async call(
    messages: LLMMessage[],
    tools: LLMTool[],
    config: LLMConfig,
    signal?: AbortSignal
  ): Promise<LLMResponse> {
    const baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
    const model = config.model || 'claude-sonnet-4-20250514';

    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');

    const anthropicTools = tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));

    const body: Record<string, unknown> = {
      model,
      max_tokens: config.maxTokens ?? 4096,
      temperature: config.temperature ?? 0.7,
      ...(config.topP !== undefined ? { top_p: config.topP } : {}),
      messages: nonSystemMsgs.map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: m.tool_call_id,
              content: m.content,
            }],
          };
        }
        if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
          const content = [];
          if (m.content) {
            content.push({ type: 'text', text: m.content });
          }
          for (const tc of m.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
            });
          }
          return { role: 'assistant', content };
        }
        return { role: m.role, content: m.content };
      }),
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }

    if (anthropicTools.length > 0) {
      body.tools = anthropicTools;

      if (config.toolChoice) {
        if (config.toolChoice === 'required') {
          body.tool_choice = { type: 'any' };
        } else if (config.toolChoice === 'auto') {
          body.tool_choice = { type: 'auto' };
        } else if (typeof config.toolChoice === 'object' && config.toolChoice.type === 'function') {
          body.tool_choice = { type: 'tool', name: config.toolChoice.function.name };
        }
      }
    }

    const response = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    let textContent: string | null = null;
    const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];

    for (const block of data.content || []) {
      if (block.type === 'text') {
        textContent = (textContent || '') + block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    return {
      content: textContent,
      tool_calls: toolCalls,
      finish_reason: data.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
    };
  },
};

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMMessage, LLMTool, LLMConfig } from '../types';
import { openaiProvider } from '../providers/openai';
import { anthropicProvider } from '../providers/anthropic';
import { getProvider } from '../providers';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const baseConfig: LLMConfig = {
  apiKey: 'sk-test-key',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 1024,
};

const sampleMessages: LLMMessage[] = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Hello' },
];

const sampleTools: LLMTool[] = [
  {
    type: 'function',
    function: {
      name: 'test_fn',
      description: 'A test function',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
    },
  },
];

describe('OpenAI Provider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should call the correct endpoint with proper headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hi!' }, finish_reason: 'stop' }],
      }),
    });

    await openaiProvider.call(sampleMessages, sampleTools, baseConfig);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/chat/completions');
    expect(options.method).toBe('POST');
    expect(options.headers['Authorization']).toBe('Bearer sk-test-key');
    expect(options.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toHaveLength(2);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe('function');
  });

  it('should return normalized response format', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: { name: 'test_fn', arguments: '{"q":"test"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      }),
    });

    const result = await openaiProvider.call(sampleMessages, sampleTools, baseConfig);

    expect(result.content).toBeNull();
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls![0].id).toBe('call_123');
    expect(result.tool_calls![0].function.name).toBe('test_fn');
    expect(result.finish_reason).toBe('tool_calls');
  });

  it('should handle API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(openaiProvider.call(sampleMessages, sampleTools, baseConfig))
      .rejects.toThrow('LLM API error (401)');
  });
});

describe('Anthropic Provider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should use Anthropic-specific headers and endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Hello!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    await anthropicProvider.call(sampleMessages, sampleTools, {
      ...baseConfig,
      baseUrl: 'https://api.anthropic.com',
    });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/messages');
    expect(options.headers['x-api-key']).toBe('sk-test-key');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(options.body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.system).toBe('You are helpful.');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
  });

  it('should convert tool definitions to Anthropic format', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'OK' }],
        stop_reason: 'end_turn',
      }),
    });

    await anthropicProvider.call(sampleMessages, sampleTools, {
      ...baseConfig,
      baseUrl: 'https://api.anthropic.com',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe('test_fn');
    expect(body.tools[0].input_schema).toBeDefined();
  });

  it('should handle tool_use response and convert to standard format', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'Let me search.' },
          { type: 'tool_use', id: 'toolu_123', name: 'test_fn', input: { q: 'test' } },
        ],
        stop_reason: 'tool_use',
      }),
    });

    const result = await anthropicProvider.call(sampleMessages, sampleTools, {
      ...baseConfig,
      baseUrl: 'https://api.anthropic.com',
    });

    expect(result.content).toBe('Let me search.');
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls![0].id).toBe('toolu_123');
    expect(result.tool_calls![0].function.name).toBe('test_fn');
    expect(result.tool_calls![0].function.arguments).toBe('{"q":"test"}');
    expect(result.finish_reason).toBe('tool_calls');
  });

  it('should handle assistant message with tool_calls conversion', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Done' }],
        stop_reason: 'end_turn',
      }),
    });

    const messagesWithToolCalls: LLMMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Search for X' },
      {
        role: 'assistant',
        content: 'Let me search.',
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'test_fn', arguments: '{"q":"X"}' },
        }],
      },
      { role: 'tool', content: 'Result: X found', tool_call_id: 'call_1' },
    ];

    await anthropicProvider.call(messagesWithToolCalls, sampleTools, {
      ...baseConfig,
      baseUrl: 'https://api.anthropic.com',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const assistantMsg = body.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.content).toBeInstanceOf(Array);
    expect(assistantMsg.content.some((c: { type: string }) => c.type === 'tool_use')).toBe(true);

    const toolResultMsg = body.messages.find(
      (m: { role: string; content: unknown }) =>
        m.role === 'user' && Array.isArray(m.content) && m.content.some((c: { type: string }) => c.type === 'tool_result')
    );
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.content[0].type).toBe('tool_result');
  });
});

describe('Provider Registry', () => {
  it('should return OpenAI provider by default', () => {
    const provider = getProvider('openai');
    expect(provider.name).toBe('OpenAI');
  });

  it('should return Anthropic provider', () => {
    const provider = getProvider('anthropic');
    expect(provider.name).toBe('Anthropic');
  });

  it('should throw for unknown provider (no OpenAI fallback)', () => {
    expect(() => getProvider('nonexistent')).toThrow(/Unknown provider/);
    expect(() => getProvider('nonexistent')).toThrow(/No fallback to OpenAI/);
  });

  it('should map legacy google id to gemini', () => {
    const provider = getProvider('google');
    expect(provider.id).toBe('gemini');
  });
});

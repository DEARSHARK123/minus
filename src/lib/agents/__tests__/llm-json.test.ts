import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/lib/llm/client', () => ({ callLLM: vi.fn() }));

import { callLLM } from '@/lib/llm/client';
import { ModelResponseFormatError } from '@/lib/llm/errors';
import { callAgentJson } from '../llm-json';

const options = {
  apiKey: 'test-key',
  model: 'test-model',
  providerId: 'openai',
};
const schema = z.object({ answer: z.string() });

describe('callAgentJson', () => {
  beforeEach(() => {
    vi.mocked(callLLM).mockReset();
  });

  it('does not retry a transport failure', async () => {
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('LLM调用失败: fetch failed'));

    await expect(callAgentJson('system', 'user', options, schema)).rejects.toThrow(
      /fetch failed/,
    );
    expect(callLLM).toHaveBeenCalledTimes(1);
  });

  it('retries invalid JSON once and returns a valid retry response', async () => {
    vi.mocked(callLLM)
      .mockResolvedValueOnce({ content: 'not-json' })
      .mockResolvedValueOnce({ content: JSON.stringify({ answer: 'ok' }) });

    await expect(callAgentJson('system', 'user', options, schema)).resolves.toEqual({
      answer: 'ok',
    });
    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it('throws MODEL_INVALID_RESPONSE after two protocol failures', async () => {
    vi.mocked(callLLM)
      .mockResolvedValueOnce({ content: JSON.stringify({ wrong: true }) })
      .mockResolvedValueOnce({ content: 'still-not-json' });

    const result = callAgentJson('system', 'user', options, schema);
    await expect(result).rejects.toBeInstanceOf(ModelResponseFormatError);
    await expect(result).rejects.toMatchObject({ code: 'MODEL_INVALID_RESPONSE' });
    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it('does not mask a transport failure during the protocol retry', async () => {
    vi.mocked(callLLM)
      .mockResolvedValueOnce({ content: 'not-json' })
      .mockRejectedValueOnce(new Error('LLM调用失败: ECONNRESET'));

    await expect(callAgentJson('system', 'user', options, schema)).rejects.toThrow(
      /ECONNRESET/,
    );
    expect(callLLM).toHaveBeenCalledTimes(2);
  });
});

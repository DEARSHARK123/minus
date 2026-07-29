import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseDone(): string {
  return 'data: [DONE]\n\n';
}

function createSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index++;
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function collectSse(response: Response): Promise<unknown[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: unknown[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice('data:'.length).trim();
      if (data === '[DONE]') {
        events.push('[DONE]');
      } else {
        try {
          events.push(JSON.parse(data));
        } catch {
          events.push(data);
        }
      }
    }
  }
  return events;
}

describe('POST /api/chat', () => {
  let POST: (req: NextRequest) => Promise<Response>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Ensure a clean env for each fresh module import.
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;

    vi.resetModules();
    const mod = await import('../route');
    POST = mod.POST;

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return createSseResponse([
        sseChunk({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          choices: [{ delta: { role: 'assistant' } }],
        }),
        sseChunk({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          choices: [{ delta: { content: 'Hello' } }],
        }),
        sseChunk({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          choices: [{ delta: { content: ' world' } }],
        }),
        sseDone(),
      ]);
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns 400 when messages is missing', async () => {
    const res = await POST(post({ providerId: 'openai' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/Messages array is required/i);
  });

  it('returns 400 for unsupported provider', async () => {
    const res = await POST(post({ messages: [{ role: 'user', content: 'hi' }], providerId: 'unknown' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/Unsupported provider/i);
  });

  it('returns 400 with clear missing-key error for unconfigured provider', async () => {
    const res = await POST(post({ messages: [{ role: 'user', content: 'hi' }], providerId: 'openai' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/OPENAI_API_KEY/i);
  });

  it('streams text deltas and ends with [DONE]', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-12345678';

    // Re-import to pick up the env key.
    vi.resetModules();
    const mod = await import('../route');
    POST = mod.POST;

    const res = await POST(
      post({ messages: [{ role: 'user', content: 'hi' }], providerId: 'openai' }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    const events = await collectSse(res);
    const deltas = events
      .filter((e): e is { delta: string } => typeof e === 'object' && e !== null && 'delta' in e)
      .map((e) => e.delta);

    expect(deltas).toEqual(['Hello', ' world']);
    expect(events).toContain('[DONE]');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/chat\/completions$/);
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.stream).toBe(true);
    expect(sentBody.messages.at(-1)).toEqual({ role: 'user', content: 'hi' });
    expect(sentBody.messages[0].role).toBe('system');
  });

  it('reports unsupported streaming for configured but unsupported providers', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-12345678';

    vi.resetModules();
    const mod = await import('../route');
    POST = mod.POST;

    const res = await POST(
      post({ messages: [{ role: 'user', content: 'hi' }], providerId: 'anthropic' }),
    );

    expect(res.status).toBe(200);
    const events = await collectSse(res);
    const errorEvent = events.find(
      (e): e is { error: string } =>
        typeof e === 'object' && e !== null && 'error' in e,
    );
    expect(errorEvent).toBeTruthy();
    expect(errorEvent!.error).toMatch(/Streaming is not supported/i);
    expect(errorEvent!.error).toMatch(/anthropic/i);
  });

  it('emits an error event when the LLM stream errors', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-12345678';

    fetchSpy.mockImplementation(async () => {
      return createSseResponse([
        sseChunk({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          choices: [{ delta: { content: 'Partial' } }],
        }),
        sseChunk({ error: { message: 'Rate limit exceeded' } }),
      ]);
    });

    vi.resetModules();
    const mod = await import('../route');
    POST = mod.POST;

    const res = await POST(
      post({ messages: [{ role: 'user', content: 'hi' }], providerId: 'openai' }),
    );

    const events = await collectSse(res);
    const errorEvent = events.find(
      (e): e is { error: string } => typeof e === 'object' && e !== null && 'error' in e,
    );
    expect(errorEvent).toBeTruthy();
    expect(errorEvent!.error).toMatch(/Rate limit exceeded/i);
  });

  it('learnMode false: does not wrap plain greeting into teach fences', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-12345678';

    fetchSpy.mockImplementation(async () => {
      return createSseResponse([
        sseChunk({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          choices: [{ delta: { content: '你好！很高兴见到你。' } }],
        }),
        sseDone(),
      ]);
    });

    vi.resetModules();
    const mod = await import('../route');
    POST = mod.POST;

    const res = await POST(
      post({
        messages: [{ role: 'user', content: '你好' }],
        providerId: 'openai',
        learnMode: false,
        scene: 'chat',
      }),
    );

    const events = await collectSse(res);
    const deltas = events
      .filter((e): e is { delta: string } => typeof e === 'object' && e !== null && 'delta' in e)
      .map((e) => e.delta);
    const replaces = events.filter(
      (e): e is { replace: string } =>
        typeof e === 'object' && e !== null && 'replace' in e,
    );

    expect(deltas.join('')).toContain('你好');
    // No fence injection on casual chat
    for (const r of replaces) {
      expect(r.replace).not.toMatch(/:::summary/);
      expect(r.replace).not.toMatch(/:::key/);
    }
    expect(deltas.join('')).not.toMatch(/:::summary/);
  });

  it('learnMode false: strips teach fences if model emits them', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-12345678';

    const fenced = ':::summary\n误用摘要\n:::\n\n:::key\n- 点\n:::';
    fetchSpy.mockImplementation(async () => {
      return createSseResponse([
        sseChunk({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          choices: [{ delta: { content: fenced } }],
        }),
        sseDone(),
      ]);
    });

    vi.resetModules();
    const mod = await import('../route');
    POST = mod.POST;

    const res = await POST(
      post({
        messages: [{ role: 'user', content: '你好' }],
        providerId: 'openai',
        learnMode: false,
        scene: 'chat',
      }),
    );

    const events = await collectSse(res);
    const replaceEvent = events.find(
      (e): e is { replace: string } =>
        typeof e === 'object' && e !== null && 'replace' in e,
    );
    expect(replaceEvent).toBeTruthy();
    expect(replaceEvent!.replace).not.toMatch(/:::summary/);
    expect(replaceEvent!.replace).toContain('误用摘要');
  });

  it('learnMode true: final payload uses contentBlocks without raw fences', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-12345678';

    const fenced =
      ':::summary\n闭包摘要\n:::\n\n:::key\n- 重点一\n:::\n\n**节**\n正文';
    fetchSpy.mockImplementation(async () => {
      return createSseResponse([
        sseChunk({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          choices: [{ delta: { content: fenced } }],
        }),
        sseDone(),
      ]);
    });

    vi.resetModules();
    const mod = await import('../route');
    POST = mod.POST;

    const res = await POST(
      post({
        messages: [{ role: 'user', content: '讲一下闭包' }],
        providerId: 'openai',
        learnMode: true,
        scene: 'session_teach',
      }),
    );

    const events = await collectSse(res);
    const replaceEvent = events.find(
      (e): e is { replace: string; contentBlocks?: unknown[] } =>
        typeof e === 'object' && e !== null && 'replace' in e,
    );
    expect(replaceEvent).toBeTruthy();
    expect(replaceEvent!.replace).not.toMatch(/:::summary|:::key|:::/);
    expect(replaceEvent!.replace).toContain('闭包');
    expect(Array.isArray(replaceEvent!.contentBlocks)).toBe(true);
    expect((replaceEvent!.contentBlocks as unknown[]).length).toBeGreaterThan(0);
  });

  it('does not treat system teach hint as learnMode without explicit flag', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-12345678';

    fetchSpy.mockImplementation(async () => {
      return createSseResponse([
        sseChunk({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          choices: [{ delta: { content: '普通回复' } }],
        }),
        sseDone(),
      ]);
    });

    vi.resetModules();
    const mod = await import('../route');
    POST = mod.POST;

    const res = await POST(
      post({
        messages: [
          {
            role: 'system',
            content: '## Learning content format (when teaching / explaining)\nUse :::summary',
          },
          { role: 'user', content: 'hi' },
        ],
        providerId: 'openai',
        // learnMode omitted / false
      }),
    );

    expect(res.status).toBe(200);
    const events = await collectSse(res);
    const replaces = events.filter(
      (e): e is { replace: string } =>
        typeof e === 'object' && e !== null && 'replace' in e,
    );
    // Plain "普通回复" should not be fence-wrapped
    for (const r of replaces) {
      expect(r.replace).not.toMatch(/:::summary/);
    }
  });
});

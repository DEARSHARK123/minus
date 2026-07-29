import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionEngine, SessionEngineError } from '@/lib/learning/session-engine';
import type { SessionSection } from '@/types/learning';
import { callLLM } from '@/lib/llm/client';

vi.mock('@/lib/llm/client', () => ({ callLLM: vi.fn() }));
vi.mock('@/lib/tools/web-search', () => ({ searchWeb: vi.fn() }));

const mockedCallLLM = vi.mocked(callLLM);

describe('sessionFollowUp — SessionEngine', () => {
  const engine = new SessionEngine();

  beforeEach(() => {
    mockedCallLLM.mockResolvedValue({
      content: 'let 允许重新赋值，const 不允许重新绑定；两者都具有块级作用域。实际编码中，默认使用 const 能减少意外重赋值，需要改变绑定时再选择 let。',
    });
  });

  it('rejects empty follow-up', async () => {
    const section: SessionSection = {
      id: 's1',
      status: 'open',
      phase: 'teach',
      turns: [],
    };
    await expect(engine.generateFollowUp(section, '   ')).rejects.toThrow(
      SessionEngineError,
    );
  });

  it('persists two turns on section', async () => {
    const section: SessionSection = {
      id: 's1',
      status: 'open',
      phase: 'teach',
      title: '变量',
      turns: [{ id: 't0', role: 'assistant', content: '讲解', createdAt: new Date().toISOString() }],
    };
    const { section: next } = await engine.generateFollowUp(
      section,
      'let 和 const 区别？',
      { provider: { apiKey: 'test', baseUrl: 'http://localhost', model: 'test' } },
    );
    expect(next.turns).toHaveLength(3);
    expect(next.turns?.[1]?.role).toBe('user');
    expect(next.turns?.[2]?.role).toBe('assistant');
  });

  it('does not append the user question when model generation fails', async () => {
    mockedCallLLM.mockRejectedValue(new Error('provider offline'));
    const section: SessionSection = { id: 's1', status: 'open', phase: 'teach', turns: [] };
    await expect(engine.generateFollowUp(section, '为什么？', {
      provider: { apiKey: 'test', baseUrl: 'http://localhost', model: 'test' },
    })).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    expect(section.turns).toHaveLength(0);
  });
});

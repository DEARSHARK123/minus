import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseJsonFromLLM } from '@/lib/agents/json';
import { runOrchestrator } from '@/lib/agents/orchestrator';
import type { ResolvedProviderConfig } from '@/lib/config/server-env';

vi.mock('@/lib/agents/llm-json', () => ({
  callAgentJson: vi.fn(),
}));

vi.mock('@/lib/agents/resource', () => ({
  runResourceAgent: vi.fn(),
}));

vi.mock('@/lib/memory/context-pack-server', () => ({
  loadLearnerContextPack: vi.fn(async () => ({
    empty: true,
    labeledBlock: '',
    summaryLine: '',
    entries: [],
  })),
}));

vi.mock('@/lib/memory/context-pack', async () => {
  const actual = await vi.importActual<typeof import('@/lib/memory/context-pack')>(
    '@/lib/memory/context-pack',
  );
  return {
    ...actual,
    injectContextPack: (s: string) => s,
  };
});

import { callAgentJson } from '@/lib/agents/llm-json';
import { runResourceAgent } from '@/lib/agents/resource';

const resolved: ResolvedProviderConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://example.com/v1',
  model: 'test-model',
  source: 'server',
  providerId: 'openai',
};

const outlineUnits = [
  {
    title: 'Unit 1',
    knowledgePoints: ['所有权', '借用'],
    description: 'intro',
    estimatedMinutes: 40,
  },
  {
    title: 'Unit 2',
    knowledgePoints: ['生命周期', '结构体'],
    description: 'mid',
    estimatedMinutes: 45,
  },
  {
    title: 'Unit 3',
    knowledgePoints: ['错误处理', '练习巩固'],
    description: 'practice',
    estimatedMinutes: 50,
  },
];

describe('parseJsonFromLLM', () => {
  it('parses fenced json', () => {
    expect(parseJsonFromLLM<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('parses raw object', () => {
    expect(parseJsonFromLLM<{ b: string }>('prefix {"b":"x"} trailing')).toEqual({ b: 'x' });
  });
});

describe('runOrchestrator (mocked LLM) — UX02 Experience Planner', () => {
  beforeEach(() => {
    vi.mocked(callAgentJson).mockReset();
    vi.mocked(runResourceAgent).mockReset();
    vi.mocked(runResourceAgent).mockResolvedValue({
      resources: [
        { title: 'Book A', reason: 'basics', source: 'llm' as const },
        { title: 'Course B', reason: 'practice', source: 'llm' as const },
      ],
    });
  });

  it('one-shot / chat intent → streamChat (no confirm_gate funnel)', async () => {
    vi.mocked(callAgentJson).mockResolvedValueOnce({
      intent: 'chat',
      topic: '闭包',
      confidence: 0.9,
      rationale: 'one-shot concept Q',
      proposalSummary: '',
    });

    const result = await runOrchestrator(
      { message: '什么是闭包', action: 'intent' },
      resolved,
    );

    expect(result.route).toBe('chat');
    expect(result.streamChat).toBe(true);
    expect(result.artifacts.some((a) => a.kind === 'confirm_gate')).toBe(false);
    expect(result.nextStage).toBe('idle');
    expect(result.experiencePlan?.mode).toMatch(/chat|normal/);
    expect(result.experiencePlan?.skippedSteps).toEqual(
      expect.arrayContaining(['memory', 'calibration', 'resources', 'outline']),
    );
  });

  it('learn without explicit deep → normal stream (not fixed ten-stage)', async () => {
    vi.mocked(callAgentJson).mockResolvedValueOnce({
      intent: 'learn',
      topic: '机器学习',
      confidence: 0.9,
      rationale: 'user asked to learn',
      proposalSummary: '想学机器学习',
    });

    const result = await runOrchestrator(
      { message: '我想学习机器学习', action: 'intent' },
      resolved,
    );

    expect(result.route).toBe('chat');
    expect(result.streamChat).toBe(true);
    expect(result.artifacts.some((a) => a.kind === 'confirm_gate')).toBe(false);
    expect(result.experiencePlan?.mode).toBe('normal');
    expect(result.experiencePlan?.nextAction).toBe('stream_chat');
  });

  it('low confidence → natural clarification structured choice (not 意图待确认)', async () => {
    vi.mocked(callAgentJson).mockResolvedValueOnce({
      intent: 'learn',
      topic: '',
      confidence: 0.25,
      rationale: 'ambiguous',
      proposalSummary: '',
    });

    const result = await runOrchestrator(
      { message: '那个东西怎么办', action: 'intent' },
      resolved,
    );

    expect(result.streamChat).toBe(false);
    expect(result.artifacts.some((a) => a.kind === 'confirm_gate')).toBe(false);
    // Batch-03: structured ClarificationSpec → single_choice (not plain 意图待确认)
    const clarify = result.artifacts.find(
      (a) => a.kind === 'single_choice' || a.kind === 'plain_assistant',
    );
    expect(clarify).toBeTruthy();
    expect(clarify?.content || '').not.toMatch(/意图待确认/);
    if (clarify?.kind === 'single_choice') {
      expect(clarify.clarification?.field).toBe('intent_mode');
      expect(clarify.options?.length).toBeGreaterThan(0);
    }
    expect(result.experiencePlan?.nextAction).toBe('natural_clarify');
    expect(result.experiencePlan?.clarificationSpec?.field).toBe('intent_mode');
    // Public payload must not expose internalReason (batch-05)
    expect(
      result.experiencePlan && 'internalReason' in result.experiencePlan,
    ).toBe(false);
  });

  it('explicit deep with goal+level → outline; ResourceAgent not called when skipped', async () => {
    vi.mocked(callAgentJson)
      // IntentJudge
      .mockResolvedValueOnce({
        intent: 'learn',
        topic: 'Rust',
        confidence: 0.95,
        rationale: 'explicit deep',
        proposalSummary: '深入学习 Rust',
      })
      // OutlineAgent
      .mockResolvedValueOnce({
        goalTitle: '掌握 Rust',
        units: outlineUnits,
      });

    const result = await runOrchestrator(
      {
        message: '深入学习 Rust，零基础',
        action: 'intent',
        context: {
          userModePreference: 'deep',
          knownGoal: 'Rust',
          knownLevel: '零基础',
          skipResources: true,
        },
      },
      resolved,
    );

    expect(result.nextStage).toBe('outline');
    expect(result.artifacts.filter((a) => a.kind === 'outline_card')).toHaveLength(1);
    expect(result.artifacts.some((a) => a.kind === 'plain_assistant')).toBe(true);
    expect(result.artifacts.some((a) => a.kind === 'resource_list')).toBe(false);
    expect(result.artifacts.some((a) => a.content?.includes(':::summary'))).toBe(false);
    expect(runResourceAgent).not.toHaveBeenCalled();
    expect(result.experiencePlan?.mode).toBe('deep_planning');
    expect(
      result.experiencePlan && 'internalReason' in result.experiencePlan,
    ).toBe(false);
    expect(result.experiencePlan?.skippedSteps).toEqual(
      expect.arrayContaining(['memory', 'calibration', 'resources']),
    );
  });

  it('calendar surface routes without learn funnel', async () => {
    vi.mocked(callAgentJson).mockResolvedValueOnce({
      intent: 'chat',
      topic: '',
      confidence: 0.8,
      rationale: 'calendar',
      proposalSummary: '',
    });

    const result = await runOrchestrator(
      {
        message: '帮我看看安排',
        action: 'intent',
        context: { surface: 'calendar' },
      },
      resolved,
    );

    expect(result.experiencePlan?.mode).toBe('calendar');
    expect(result.streamChat).toBe(true);
    expect(result.artifacts.some((a) => a.kind === 'confirm_gate')).toBe(false);
  });

  it('routes desktop intent to runDesktop', async () => {
    vi.mocked(callAgentJson).mockResolvedValueOnce({
      intent: 'desktop',
      topic: 'project',
      confidence: 0.95,
      rationale: 'run command',
      proposalSummary: '',
    });

    const result = await runOrchestrator(
      { message: '帮我在项目里跑一下测试', action: 'intent' },
      resolved,
    );

    expect(result.route).toBe('desktop');
    expect(result.runDesktop).toBe(true);
    expect(result.experiencePlan?.mode).toBe('desktop');
    expect(result.experiencePlan?.commitPolicy).toBe('policy_gated');
  });

  it('requires confirm when trust requested without trustConfirmed', async () => {
    vi.mocked(callAgentJson).mockResolvedValueOnce({
      intent: 'desktop',
      topic: '',
      confidence: 0.9,
      rationale: 'tools',
      proposalSummary: '',
    });

    const result = await runOrchestrator(
      {
        message: '改一下本地文件',
        action: 'intent',
        context: { requestedExecutionMode: 'trust' },
      },
      resolved,
    );

    expect(result.route).toBe('desktop');
    expect(result.runDesktop).toBe(false);
    expect(result.desktopEvents?.some((e) => e.kind === 'pending_tool_confirm')).toBe(true);
  });

  it('confirm_learn with goal+level skips memory/calibration and can skip resources', async () => {
    vi.mocked(callAgentJson).mockResolvedValueOnce({
      goalTitle: '掌握 Rust',
      units: outlineUnits,
    });

    const result = await runOrchestrator(
      {
        message: 'ok',
        action: 'confirm_learn',
        context: {
          topic: 'Rust',
          proposal: '学 Rust',
          knownGoal: 'Rust',
          knownLevel: '零基础',
          skipMemory: true,
          skipCalibration: true,
          skipResources: true,
          userModePreference: 'deep',
        },
      },
      resolved,
    );

    expect(result.nextStage).toBe('outline');
    expect(result.artifacts.some((a) => a.kind === 'memory_card')).toBe(false);
    expect(result.artifacts.some((a) => a.kind === 'resource_list')).toBe(false);
    expect(runResourceAgent).not.toHaveBeenCalled();
    expect(result.artifacts.filter((a) => a.kind === 'outline_card')).toHaveLength(1);
    expect(result.artifacts.some((a) => a.kind === 'plain_assistant')).toBe(true);
  });

  it('select_calibration: sole outline_card + natural guide; no teach dual-write', async () => {
    vi.mocked(callAgentJson).mockResolvedValueOnce({
      goalTitle: '掌握 Rust',
      units: outlineUnits,
    });

    // runResourceAgent is mocked separately — when not skip, it may still run
    // but must not emit resource_list / teach dual-write next to outline_card
    const result = await runOrchestrator(
      {
        message: '零基础',
        action: 'select_calibration',
        context: {
          topic: 'Rust',
          calibrationAnswer: '零基础',
          userModePreference: 'deep',
          skipResources: false,
        },
      },
      resolved,
    );

    expect(result.route).toBe('learn_resources');
    expect(result.nextStage).toBe('outline');
    expect(runResourceAgent).toHaveBeenCalled();
    expect(result.artifacts.filter((a) => a.kind === 'outline_card')).toHaveLength(1);
    expect(result.artifacts.some((a) => a.kind === 'resource_list')).toBe(false);
    expect(result.artifacts.some((a) => a.kind === 'plain_assistant')).toBe(true);
    const out = result.artifacts.find((a) => a.kind === 'outline_card');
    expect(out?.units?.[0]?.title).toBe('Unit 1');
    expect(result.artifacts.some((a) => a.content?.includes(':::summary'))).toBe(false);
    expect(result.artifacts.some((a) => a.content?.includes(':::key'))).toBe(false);
  });

  it('select_calibration with skipResources does not call ResourceAgent', async () => {
    vi.mocked(callAgentJson).mockResolvedValueOnce({
      goalTitle: '掌握 ML',
      units: outlineUnits,
    });

    const result = await runOrchestrator(
      {
        message: '我只会基础概率',
        action: 'select_calibration',
        context: {
          topic: 'ML',
          stage: 'calibration',
          calibrationAnswer: '我只会基础概率',
          calibrationKind: 'free_text',
          skipResources: true,
          userModePreference: 'deep',
        },
      },
      resolved,
    );

    expect(result.nextStage).toBe('outline');
    expect(result.artifacts.filter((a) => a.kind === 'outline_card')).toHaveLength(1);
    expect(result.artifacts.some((a) => a.kind === 'resource_list')).toBe(false);
    expect(runResourceAgent).not.toHaveBeenCalled();
  });

  it('confirm_learn default still can build memory when not skipped', async () => {
    vi.mocked(callAgentJson)
      .mockResolvedValueOnce({
        entries: ['曾学过一点 Python'],
        summary: '有一点编程基础',
      })
      .mockResolvedValueOnce({
        title: '进度',
        content: '目标澄清',
        steps: [{ id: 'goal_clarification', label: '目标', status: 'active' }],
      });

    const result = await runOrchestrator(
      {
        message: 'ok',
        action: 'confirm_learn',
        context: {
          topic: 'Rust',
          proposal: '学 Rust',
          userModePreference: 'deep',
          // no known level → planner may still try memory path
          skipMemory: false,
          skipCalibration: false,
        },
      },
      resolved,
    );

    expect(result.route).toBe('learn_memory');
    expect(result.nextStage).toBe('goal_clarification');
    expect(result.artifacts.some((a) => a.kind === 'memory_card')).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('@/lib/llm/client', () => ({
  callLLM: vi.fn(async () => ({
    content: 'Done without more tools.',
    tool_calls: [],
  })),
}));

vi.mock('@/lib/memory/context-pack-server', () => ({
  loadLearnerContextPack: vi.fn(async () => ({
    empty: true,
    labeledBlock: '',
  })),
}));

import {
  resolveConfirmReason,
  CONFIRM_REASONS,
  buildPauseState,
  savePauseState,
  loadPauseState,
  deletePauseState,
  createResumeToken,
  denyToolResultContent,
  answerToolResultContent,
  writeHitlAudit,
  isConfirmReason,
  isHitlDecisionAction,
  confirmReasonRiskLabel,
  describeWhatChanges,
  type HitlPauseState,
} from '../hitl';
import { resumeAgentLoop, cancelHitl } from '../loop';
import { readSafetyAuditEntries } from '../action-policy';
import { toolRegistry } from '@/lib/tools';
import type { ToolResult } from '@/types/tool';

const tmpRoot = path.join(
  os.tmpdir(),
  `minus-hitl-${process.pid}-${Date.now()}`,
);

function basePause(overrides: Partial<HitlPauseState> = {}): HitlPauseState {
  return buildPauseState({
    toolCallId: 'tc_test_1',
    toolName: 'web_search',
    parameters: { query: 'hello' },
    confirmReason: 'network_access',
    llmMessages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'search something' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc_test_1',
            type: 'function',
            function: {
              name: 'web_search',
              arguments: JSON.stringify({ query: 'hello' }),
            },
          },
        ],
      },
    ],
    agentMessages: [
      {
        id: 'm1',
        role: 'user',
        content: 'search something',
        timestamp: new Date(),
      },
    ],
    toolCalls: [],
    plan: [],
    artifacts: [],
    iteration: 1,
    chatId: 'test',
    userMessage: 'search something',
    pendingTool: {
      id: 'tc_test_1',
      type: 'function',
      function: {
        name: 'web_search',
        arguments: JSON.stringify({ query: 'hello' }),
      },
    },
    completedToolResults: [],
    executionMode: 'sandbox',
    approvalPolicy: 'supervised',
    autoApprovedCategories: [],
    sessionCategoryApprovals: [],
    trustConfirmed: false,
    approvedToolCallIds: [],
    workspacePath: tmpRoot,
    provider: {
      apiKey: 'test-key-not-real',
      model: 'test-model',
    },
    maxSteps: 5,
    ...overrides,
  });
}

describe('HITL taxonomy & pause store', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    process.env.MINUS_DATA_DIR = tmpRoot;
  });

  afterEach(() => {
    delete process.env.MINUS_DATA_DIR;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('exposes full confirm reason taxonomy', () => {
    expect(CONFIRM_REASONS).toEqual([
      'trust_elevation',
      'dangerous_tool',
      'workspace_write',
      'network_access',
      'package_install',
      'publish_external',
      'delete_or_overwrite',
      'human_question',
    ]);
    for (const r of CONFIRM_REASONS) {
      expect(isConfirmReason(r)).toBe(true);
      expect(confirmReasonRiskLabel(r).length).toBeGreaterThan(0);
    }
  });

  it('resolveConfirmReason maps tools correctly', () => {
    expect(resolveConfirmReason('ask_human', { question: 'q' })).toBe(
      'human_question',
    );
    expect(resolveConfirmReason('web_search', { query: 'x' })).toBe(
      'network_access',
    );
    expect(
      resolveConfirmReason('file_manager', { action: 'write', path: 'a' }),
    ).toBe('workspace_write');
    expect(
      resolveConfirmReason('file_manager', { action: 'delete', path: 'a' }),
    ).toBe('delete_or_overwrite');
    expect(resolveConfirmReason('execution_mode', {})).toBe('trust_elevation');
    expect(
      resolveConfirmReason(
        'code_executor',
        { code: 'npm publish' },
        { yellowReason: 'npm publish' },
      ),
    ).toBe('publish_external');
  });

  it('describeWhatChanges covers all reasons', () => {
    for (const r of CONFIRM_REASONS) {
      const d = describeWhatChanges('tool', { path: 'artifacts/x' }, r);
      expect(d.length).toBeGreaterThan(0);
    }
  });

  it('persists and loads pause by resumeToken', () => {
    const pause = basePause();
    savePauseState(pause);
    const loaded = loadPauseState(pause.resumeToken);
    expect(loaded).not.toBeNull();
    expect(loaded?.toolCallId).toBe('tc_test_1');
    expect(loaded?.confirmReason).toBe('network_access');
    deletePauseState(pause.resumeToken);
    expect(loadPauseState(pause.resumeToken)).toBeNull();
  });

  it('createResumeToken is unique', () => {
    const a = createResumeToken();
    const b = createResumeToken();
    expect(a).not.toBe(b);
    expect(a.startsWith('rt_')).toBe(true);
  });

  it('isHitlDecisionAction validates actions', () => {
    expect(isHitlDecisionAction('approve_once')).toBe(true);
    expect(isHitlDecisionAction('deny')).toBe(true);
    expect(isHitlDecisionAction('cancel')).toBe(true);
    expect(isHitlDecisionAction('explode')).toBe(false);
  });
});

describe('HITL resume / deny / cancel', () => {
  let executeSpy: ReturnType<typeof vi.fn>;
  let originalExecute: typeof toolRegistry.execute;

  beforeEach(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    process.env.MINUS_DATA_DIR = tmpRoot;
    executeSpy = vi.fn(
      async (): Promise<ToolResult> => ({
        success: true,
        data: 'SEARCH_OK',
      }),
    );
    originalExecute = toolRegistry.execute.bind(toolRegistry);
    toolRegistry.execute = executeSpy as typeof toolRegistry.execute;
  });

  afterEach(() => {
    toolRegistry.execute = originalExecute;
    delete process.env.MINUS_DATA_DIR;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('deny injects USER_DENIED and does not execute the tool', async () => {
    const pause = basePause();
    savePauseState(pause);

    const state = await resumeAgentLoop(pause.resumeToken, {
      action: 'deny',
    });

    expect(executeSpy).not.toHaveBeenCalled();
    const toolMsgs = state.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.some((m) => m.content.includes('USER_DENIED'))).toBe(true);
    expect(loadPauseState(pause.resumeToken)).toBeNull();
  });

  it('approve_once executes the pending tool exactly once (skipHitlGate)', async () => {
    const pause = basePause();
    savePauseState(pause);

    await resumeAgentLoop(pause.resumeToken, { action: 'approve_once' });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const callArgs = executeSpy.mock.calls[0];
    expect(callArgs[0]).toBe('web_search');
    const ctx = callArgs[2] as {
      skipHitlGate?: boolean;
      dangerousConfirmed?: boolean;
    };
    expect(ctx.skipHitlGate).toBe(true);
    expect(ctx.dangerousConfirmed).toBe(true);
    expect(loadPauseState(pause.resumeToken)).toBeNull();
  });

  it('cancelHitl removes pause and does not execute tool', async () => {
    const pause = basePause();
    savePauseState(pause);
    await cancelHitl(pause.resumeToken);
    expect(loadPauseState(pause.resumeToken)).toBeNull();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('resume cancel decision does not execute tool', async () => {
    const pause = basePause();
    savePauseState(pause);
    const state = await resumeAgentLoop(pause.resumeToken, { action: 'cancel' });
    expect(executeSpy).not.toHaveBeenCalled();
    expect(state.messages.some((m) => m.content.includes('取消'))).toBe(true);
  });

  it('trust approve does not execute dangerous tools as side effect', async () => {
    const pause = basePause({
      toolCallId: 'trust_elevation',
      toolName: 'execution_mode',
      confirmReason: 'trust_elevation',
      parameters: { requestedExecutionMode: 'trust' },
      userMessage: 'run a task',
      llmMessages: [],
      pendingTool: {
        id: 'trust_elevation',
        type: 'function',
        function: {
          name: 'execution_mode',
          arguments: JSON.stringify({ requestedExecutionMode: 'trust' }),
        },
      },
    });
    savePauseState(pause);

    await resumeAgentLoop(pause.resumeToken, {
      action: 'approve_once',
    });

    // Trust-only path starts loop; stub LLM has no tools → no execute
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('ask_human answer injects tool result without execute', async () => {
    const pause = basePause({
      toolName: 'ask_human',
      confirmReason: 'human_question',
      parameters: { question: 'What OS?' },
      pendingTool: {
        id: 'tc_test_1',
        type: 'function',
        function: {
          name: 'ask_human',
          arguments: JSON.stringify({ question: 'What OS?' }),
        },
      },
    });
    savePauseState(pause);

    const state = await resumeAgentLoop(pause.resumeToken, {
      action: 'answer',
      answerText: 'Windows',
    });

    expect(executeSpy).not.toHaveBeenCalled();
    const toolMsgs = state.messages.filter((m) => m.role === 'tool');
    expect(
      toolMsgs.some(
        (m) =>
          m.content.includes('Windows') && m.content.includes('human_answer'),
      ),
    ).toBe(true);
  });

  it('audit events are written for pause/confirm/deny chain', () => {
    writeHitlAudit({
      kind: 'hitl_pause',
      detail: 'test pause',
      toolName: 'web_search',
      confirmReason: 'network_access',
      resumeToken: 'rt_test',
    });
    writeHitlAudit({
      kind: 'hitl_confirm',
      detail: 'test confirm',
      toolName: 'web_search',
      resumeToken: 'rt_test',
    });
    writeHitlAudit({
      kind: 'hitl_deny',
      detail: 'test deny',
      toolName: 'web_search',
      resumeToken: 'rt_test',
    });
    const entries = readSafetyAuditEntries(20);
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain('hitl_pause');
    expect(kinds).toContain('hitl_confirm');
    expect(kinds).toContain('hitl_deny');
  });

  it('denyToolResultContent and answerToolResultContent shapes', () => {
    const d = denyToolResultContent('web_search', 'network_access');
    expect(d).toContain('USER_DENIED');
    const a = answerToolResultContent('yes', 'q?');
    const parsed = JSON.parse(a) as { type: string; answer: string };
    expect(parsed.type).toBe('human_answer');
    expect(parsed.answer).toBe('yes');
  });
});

describe('file_manager confirm reasons', () => {
  it('write → workspace_write; delete → delete_or_overwrite', () => {
    expect(
      resolveConfirmReason('file_manager', {
        action: 'write',
        path: 'artifacts/a',
      }),
    ).toBe('workspace_write');
    expect(
      resolveConfirmReason('file_manager', {
        action: 'delete',
        path: 'artifacts/a',
      }),
    ).toBe('delete_or_overwrite');
  });
});

import { AgentState, Message, TaskStep, ToolCall, ExecutionStep } from '@/types/agent';
import { toolRegistry } from '../tools';
import { callLLM } from '../llm/client';
import { buildSystemPrompt } from './prompt';
import { traceManager } from '../observability/trace';
import { listEffectivePlaybooks } from '@/lib/config/user-configuration';
import { detectExecutionIntent, generateSummary, LLMIterationResponse, LLMToolCallResult } from './loop-utils';
import { executeSingleTool, type ToolExecutionResult } from './executor';
import { loadLearnerContextPack } from '@/lib/memory/context-pack-server';
import {
  buildPauseState,
  savePauseState,
  loadPauseState,
  deletePauseState,
  writeHitlAudit,
  denyToolResultContent,
  answerToolResultContent,
  isConfirmReason,
  resolveConfirmReason,
  type ConfirmReason,
  type HitlDecision,
  type HitlPauseState,
  type SerializedLlmMessage,
} from './hitl';
import { categoryForTool, type AutonomyCategory } from './action-policy';

export interface AgentLoopConfig {
  maxSteps: number;
  maxRetries: number;
  timeout: number;
  signal?: AbortSignal;
  activePlaybookId?: string;
  chatId?: string;
  /** Server-controlled; defaults to sandbox. Client must not supply trust elevation. */
  executionMode?: 'sandbox' | 'trust';
  /**
   * User confirmed dangerous tool HITL for a specific call / resume.
   * Must NOT be set just because trust was elevated.
   */
  dangerousConfirmed?: boolean;
  /** Server-resolved auto-approve categories (bounded_auto / full_auto). */
  autoApprovedCategories?: Array<
    'web_search' | 'code_run' | 'artifacts_write' | 'package_install'
  >;
  sessionCategoryApprovals?: AutonomyCategory[];
  trustConfirmed?: boolean;
  approvalPolicy?:
    | 'chat_only'
    | 'supervised'
    | 'bounded_auto'
    | 'full_auto';
  workspacePath?: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  providerId?: string;
  providerName?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  userName?: string;
  systemPrompt?: string;
  onStepStart?: (step: TaskStep) => void;
  onStepComplete?: (step: TaskStep, result: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolCallUpdate?: (toolCall: ToolCall) => void;
  onToolStream?: (stream: { toolCallId: string; type: 'stdout' | 'stderr' | 'status'; data: string }) => void;
  onExecutionStep?: (step: ExecutionStep) => void;
  onPendingToolCall?: (pending: {
    toolCallId: string;
    toolName: string;
    parameters: Record<string, unknown>;
    confirmReason?: ConfirmReason;
    resumeToken?: string;
    whatChanges?: string;
    riskLabel?: string;
  }) => void;
  onThinking?: (thinking: string) => void;
  onError?: (error: string) => void;
  onDone?: (state: AgentState) => void;
  onFinalResponse?: (response: string) => void;
  onWaitingConfirm?: (info: {
    resumeToken: string;
    toolCallId: string;
    toolName: string;
    parameters: Record<string, unknown>;
    confirmReason: ConfirmReason;
  }) => void;
}

type LlmMsg = SerializedLlmMessage;

function providerFromConfig(config: AgentLoopConfig) {
  return {
    id: config.providerId || '',
    name: config.providerName || '',
    apiKey: config.apiKey,
    baseUrl: config.baseUrl || '',
    model: config.model,
  };
}

function snapshotProvider(config: AgentLoopConfig): HitlPauseState['provider'] {
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    providerId: config.providerId,
    providerName: config.providerName,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    topP: config.topP,
    frequencyPenalty: config.frequencyPenalty,
    presencePenalty: config.presencePenalty,
    userName: config.userName,
    systemPrompt: config.systemPrompt,
    activePlaybookId: config.activePlaybookId,
  };
}

function configFromPause(pause: HitlPauseState, overrides?: Partial<AgentLoopConfig>): AgentLoopConfig {
  return {
    maxSteps: pause.maxSteps,
    maxRetries: 2,
    timeout: 120000,
    chatId: pause.chatId,
    executionMode: pause.executionMode,
    autoApprovedCategories: pause.autoApprovedCategories,
    sessionCategoryApprovals: pause.sessionCategoryApprovals,
    trustConfirmed: pause.trustConfirmed,
    approvalPolicy: pause.approvalPolicy,
    workspacePath: pause.workspacePath,
    apiKey: pause.provider.apiKey,
    baseUrl: pause.provider.baseUrl,
    model: pause.provider.model,
    providerId: pause.provider.providerId,
    providerName: pause.provider.providerName,
    temperature: pause.provider.temperature,
    maxTokens: pause.provider.maxTokens,
    topP: pause.provider.topP,
    frequencyPenalty: pause.provider.frequencyPenalty,
    presencePenalty: pause.provider.presencePenalty,
    userName: pause.provider.userName,
    systemPrompt: pause.provider.systemPrompt,
    activePlaybookId: pause.provider.activePlaybookId,
    ...overrides,
  };
}

function pushToolResult(
  llmMessages: LlmMsg[],
  state: AgentState,
  result: ToolExecutionResult,
): void {
  llmMessages.push({
    role: 'tool',
    tool_call_id: result.toolCallId,
    name: result.toolName,
    content: result.content,
  });
  state.messages.push({
    id: `msg_${Date.now()}_tr_${result.toolCallId}`,
    role: 'tool',
    content: result.content,
    timestamp: new Date(),
    toolCallId: result.toolCallId,
    toolName: result.toolName,
  });
}

/**
 * Continue the agent loop after tool results are in llmMessages.
 */
async function continueLoopFromMessages(
  state: AgentState,
  llmMessages: LlmMsg[],
  config: AgentLoopConfig,
  startIteration: number,
  sessionCategoryApprovals: AutonomyCategory[],
  trustConfirmed: boolean,
  approvedToolCallIds: string[],
): Promise<AgentState> {
  const checkCancelled = () => {
    if (config.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
  };

  const activePlaybook = config.activePlaybookId
    ? listEffectivePlaybooks().find((item) => item.id === config.activePlaybookId && item.enabled)
    : null;

  const filteredTools = activePlaybook?.tools?.length
    ? toolRegistry.getByNames([...activePlaybook.tools, 'ask_human'])
    : toolRegistry.getAll();

  let iteration = startIteration;
  const maxIterations = config.maxSteps;
  const trace = traceManager.startTrace(`agent_loop_continue_${config.chatId || 'default'}`);
  const rootSpan = trace.rootSpan;

  try {
    while (iteration < maxIterations) {
      iteration++;
      checkCancelled();

      const iterSpan = traceManager.createSpan(trace.id, `iteration_${iteration}`, rootSpan.id);
      config.onThinking?.(`Iteration ${iteration}: Calling LLM...`);

      const allLlmTools = toolRegistry.getAllAsLLMTools();
      const llmTools = allLlmTools.filter(t =>
        filteredTools.some(ft => ft.name === t.function.name)
      );

      const rawResponse = await callLLM(
        llmMessages as Array<{
          role: 'system' | 'user' | 'assistant' | 'tool';
          content: string;
          tool_call_id?: string;
          name?: string;
          tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
        }>,
        llmTools,
        {
          model: config.model,
          temperature: config.temperature ?? 0.7,
          maxTokens: config.maxTokens ?? 4096,
          topP: config.topP,
          frequencyPenalty: config.frequencyPenalty,
          presencePenalty: config.presencePenalty,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          providerId: config.providerId,
          toolChoice: 'auto',
        },
        config.signal
      );

      const response: LLMIterationResponse = {
        content: rawResponse.content,
        tool_calls: rawResponse.tool_calls || [],
        hasToolCalls: !!(rawResponse.tool_calls && rawResponse.tool_calls.length > 0),
      };

      if (!response.hasToolCalls) {
        const finalContent = response.content || 'Task completed.';
        state.messages.push({
          id: `msg_${Date.now()}_final`,
          role: 'assistant',
          content: finalContent,
          timestamp: new Date(),
        });
        state.status = 'done';
        traceManager.endSpan(trace.id, iterSpan.id, 'ok');
        traceManager.endTrace(trace.id);
        config.onThinking?.('Task completed');
        config.onFinalResponse?.(finalContent);
        config.onDone?.(state);
        return state;
      }

      state.status = 'executing';
      config.onThinking?.(`Executing ${response.tool_calls.length} tool call(s)...`);

      llmMessages.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.tool_calls,
      });
      state.messages.push({
        id: `msg_${Date.now()}_tc`,
        role: 'assistant',
        content: response.content || '',
        timestamp: new Date(),
        toolCalls: response.tool_calls.map(tc => ({
          id: tc.id,
          toolName: tc.function.name,
          parameters: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
          status: 'completed' as const,
        })),
      });

      const batchOutcome = await runToolBatch(
        response.tool_calls as LLMToolCallResult[],
        iteration,
        state,
        llmMessages,
        config,
        sessionCategoryApprovals,
        trustConfirmed,
        approvedToolCallIds,
        checkCancelled,
      );

      if (batchOutcome.paused) {
        state.status = 'thinking';
        traceManager.endSpan(trace.id, iterSpan.id, 'ok');
        traceManager.endTrace(trace.id);
        config.onThinking?.('等待用户确认…');
        config.onDone?.(state);
        return state;
      }

      for (const result of batchOutcome.results) {
        pushToolResult(llmMessages, state, result);
      }

      traceManager.endSpan(trace.id, iterSpan.id, 'ok');
    }

    state.status = 'done';
    const summary = generateSummary(state);
    state.messages.push({
      id: `msg_${Date.now()}_summary`,
      role: 'assistant',
      content: summary,
      timestamp: new Date(),
    });
    traceManager.endSpan(trace.id, rootSpan.id, 'ok', 'Max iterations reached');
    traceManager.endTrace(trace.id);
    config.onThinking?.('Max iterations reached');
    config.onDone?.(state);
    return state;
  } catch (error) {
    state.status = 'error';
    const isCancelled = error instanceof DOMException && error.name === 'AbortError';
    const errorMessage = isCancelled
      ? '任务已取消'
      : (error instanceof Error ? error.message : 'Unknown error');

    if (isCancelled) {
      config.onThinking?.('任务已取消');
    } else {
      config.onError?.(`Agent execution error: ${errorMessage}`);
    }

    traceManager.endSpan(trace.id, rootSpan.id, 'error', errorMessage);
    traceManager.endTrace(trace.id);

    state.messages.push({
      id: `msg_${Date.now()}_error`,
      role: 'assistant',
      content: isCancelled ? '⏹️ 任务已取消' : `❌ Error: ${errorMessage}`,
      timestamp: new Date(),
    });

    return state;
  }
}

async function runToolBatch(
  toolCalls: LLMToolCallResult[],
  iteration: number,
  state: AgentState,
  llmMessages: LlmMsg[],
  config: AgentLoopConfig,
  sessionCategoryApprovals: AutonomyCategory[],
  trustConfirmed: boolean,
  approvedToolCallIds: string[],
  checkCancelled: () => void,
): Promise<{ paused: boolean; results: ToolExecutionResult[] }> {
  const results: ToolExecutionResult[] = [];
  let pendingConfirm: ToolExecutionResult | null = null;
  let pendingTool: LLMToolCallResult | null = null;

  // Sequential execution so we can pause at first confirm without parallel side effects racing
  for (const toolCall of toolCalls) {
    checkCancelled();
    if (pendingConfirm) {
      // Do not run remaining tools until user resolves the pause
      break;
    }

    const execStep: ExecutionStep = {
      id: `exec_${iteration}_${toolCall.id}`,
      type: 'tool_call',
      title: `Execute ${toolCall.function.name}`,
      status: 'running',
      timestamp: Date.now(),
    };
    config.onExecutionStep?.(execStep);

    const alreadyApprovedOnce = approvedToolCallIds.includes(toolCall.id);
    const result = await executeSingleTool(
      toolCall,
      iteration,
      {
        workspacePath: config.workspacePath,
        chatId: config.chatId,
        executionMode: config.executionMode,
        dangerousConfirmed:
          config.dangerousConfirmed === true || alreadyApprovedOnce,
        autoApprovedCategories: config.autoApprovedCategories,
        sessionCategoryApprovals,
        approvalPolicy: config.approvalPolicy,
        skipHitlGate: alreadyApprovedOnce,
        onToolStream: config.onToolStream,
      },
      checkCancelled,
      {
        onStepStart: (step) => {
          state.plan.push(step);
          state.currentStep = state.plan.length - 1;
          config.onStepStart?.(step);
        },
        onStepComplete: config.onStepComplete ?? (() => {}),
        onToolCall: (tc) => {
          state.toolCalls.push(tc);
          config.onToolCall?.(tc);
        },
        onToolCallUpdate: config.onToolCallUpdate ?? (() => {}),
        onArtifact: (artifact) => {
          state.artifacts.push(artifact);
        },
        onThinking: config.onThinking ?? (() => {}),
      }
    );

    if (result.needsConfirmation) {
      execStep.status = 'waiting';
      execStep.detail = result.content.slice(0, 200);
      config.onExecutionStep?.(execStep);
      pendingConfirm = result;
      pendingTool = toolCall;
      break;
    }

    execStep.status = result.content.startsWith('ERROR:') ? 'failed' : 'completed';
    execStep.detail = result.content.slice(0, 200);
    config.onExecutionStep?.(execStep);
    results.push(result);
  }

  if (pendingConfirm && pendingTool) {
    let params: Record<string, unknown> = pendingConfirm.parameters || {};
    try {
      params = JSON.parse(pendingTool.function.arguments);
    } catch { /* keep */ }

    const reason: ConfirmReason = isConfirmReason(pendingConfirm.confirmReason)
      ? pendingConfirm.confirmReason
      : resolveConfirmReason(pendingTool.function.name, params);

    const pause = buildPauseState({
      toolCallId: pendingTool.id,
      toolName: pendingTool.function.name,
      parameters: params,
      confirmReason: reason,
      llmMessages: JSON.parse(JSON.stringify(llmMessages)) as SerializedLlmMessage[],
      agentMessages: state.messages.map(m => ({
        ...m,
        timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp),
      })),
      toolCalls: state.toolCalls,
      plan: state.plan,
      artifacts: state.artifacts,
      iteration,
      chatId: config.chatId || 'default',
      userMessage: '',
      pendingTool: {
        id: pendingTool.id,
        type: 'function',
        function: pendingTool.function,
      },
      completedToolResults: results.map(r => ({
        toolCallId: r.toolCallId,
        toolName: r.toolName,
        content: r.content,
        isHumanEscalation: r.isHumanEscalation,
      })),
      executionMode: config.executionMode || 'sandbox',
      approvalPolicy: config.approvalPolicy || 'supervised',
      autoApprovedCategories: (config.autoApprovedCategories || []) as AutonomyCategory[],
      sessionCategoryApprovals: [...sessionCategoryApprovals],
      trustConfirmed,
      approvedToolCallIds: [...approvedToolCallIds],
      workspacePath: config.workspacePath || process.cwd(),
      provider: snapshotProvider(config),
      maxSteps: config.maxSteps,
    });

    savePauseState(pause);
    writeHitlAudit({
      kind: 'hitl_pause',
      detail: `暂停等待确认：${pendingTool.function.name}`,
      toolName: pendingTool.function.name,
      toolCallId: pendingTool.id,
      confirmReason: reason,
      resumeToken: pause.resumeToken,
      approvalPolicy: config.approvalPolicy,
    });

    config.onPendingToolCall?.({
      toolCallId: pendingTool.id,
      toolName: pendingTool.function.name,
      parameters: params,
      confirmReason: reason,
      resumeToken: pause.resumeToken,
    });
    config.onWaitingConfirm?.({
      resumeToken: pause.resumeToken,
      toolCallId: pendingTool.id,
      toolName: pendingTool.function.name,
      parameters: params,
      confirmReason: reason,
    });

    // Push completed sibling results into messages so resume continues cleanly
    for (const r of results) {
      pushToolResult(llmMessages, state, r);
    }
    // Update pause with messages after sibling push
    pause.llmMessages = JSON.parse(JSON.stringify(llmMessages)) as SerializedLlmMessage[];
    pause.agentMessages = state.messages.map(m => ({
      ...m,
      timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp),
    }));
    pause.completedToolResults = results.map(r => ({
      toolCallId: r.toolCallId,
      toolName: r.toolName,
      content: r.content,
      isHumanEscalation: r.isHumanEscalation,
    }));
    savePauseState(pause);

    state.pendingToolCall = {
      id: pendingTool.id,
      toolName: pendingTool.function.name,
      parameters: params,
      callId: pendingTool.id,
      messageIndex: state.messages.length,
    };

    return { paused: true, results };
  }

  return { paused: false, results };
}

export async function runAgentLoop(
  userMessage: string,
  context: Message[],
  config: AgentLoopConfig
): Promise<AgentState> {
  const checkCancelled = () => {
    if (config.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
  };

  const provider = providerFromConfig(config);
  const settings = {
    userName: config.userName,
    systemPrompt: config.systemPrompt,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  };

  checkCancelled();

  if (!provider.apiKey) {
    const errorMsg = '未配置 API Key。请在 设置 → 模型 中配置当前提供商的 API Key。';
    config.onError?.(errorMsg);
    return {
      status: 'error',
      plan: [],
      currentStep: 0,
      messages: [...context, {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
      }, {
        id: `msg_${Date.now()}_error`,
        role: 'assistant',
        content: `❌ ${errorMsg}`,
        timestamp: new Date(),
      }],
      toolCalls: [],
      artifacts: [],
      toolStreams: [],
    };
  }

  const state: AgentState = {
    status: 'thinking',
    plan: [],
    currentStep: 0,
    messages: [...context, {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    }],
    toolCalls: [],
    artifacts: [],
    toolStreams: [],
  };

  const llmMessages: LlmMsg[] = [];

  const activePlaybook = config.activePlaybookId
    ? listEffectivePlaybooks().find((item) => item.id === config.activePlaybookId && item.enabled)
    : null;

  const filteredTools = activePlaybook?.tools?.length
    ? toolRegistry.getByNames([...activePlaybook.tools, 'ask_human'])
    : toolRegistry.getAll();

  let learnerContextBlock: string | undefined;
  try {
    const pack = await loadLearnerContextPack('desktop');
    if (!pack.empty) learnerContextBlock = pack.labeledBlock;
  } catch (err) {
    console.warn(
      '[agent/loop] LearnerContextPack (desktop) failed:',
      err instanceof Error ? err.message : err,
    );
  }

  const systemPrompt = buildSystemPrompt({
    tools: filteredTools,
    playbook: activePlaybook,
    provider,
    userName: settings.userName || undefined,
    userSystemPrompt: settings.systemPrompt || undefined,
    learnerContextBlock,
  });
  llmMessages.push({ role: 'system', content: systemPrompt });

  for (const msg of context) {
    if (msg.thinking) continue;

    if (msg.role === 'tool') {
      llmMessages.push({
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.toolCallId || '',
        name: msg.toolName,
      });
      continue;
    }

    if (msg.role !== 'user' && msg.role !== 'assistant') continue;

    const llmMsg: LlmMsg = {
      role: msg.role,
      content: msg.content,
    };

    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      llmMsg.tool_calls = msg.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.toolName,
          arguments: typeof tc.parameters === 'string'
            ? tc.parameters
            : JSON.stringify(tc.parameters),
        },
      }));
    }

    llmMessages.push(llmMsg);
  }

  llmMessages.push({
    role: 'user',
    content: userMessage,
  });

  let iteration = 0;
  const maxIterations = config.maxSteps;
  const trace = traceManager.startTrace(`agent_loop_${userMessage.slice(0, 50)}`);
  const rootSpan = trace.rootSpan;
  const sessionCategoryApprovals: AutonomyCategory[] = [
    ...(config.sessionCategoryApprovals || []),
  ];
  const trustConfirmed = config.trustConfirmed === true;
  const approvedToolCallIds: string[] = [];

  try {
    while (iteration < maxIterations) {
      iteration++;
      checkCancelled();

      const iterSpan = traceManager.createSpan(trace.id, `iteration_${iteration}`, rootSpan.id);
      config.onThinking?.(`Iteration ${iteration}: Calling LLM...`);

      const allLlmTools = toolRegistry.getAllAsLLMTools();
      const llmTools = allLlmTools.filter(t =>
        filteredTools.some(ft => ft.name === t.function.name)
      );

      const shouldForceTools = iteration === 1 && detectExecutionIntent(userMessage);

      const rawResponse = await callLLM(
        llmMessages as Array<{
          role: 'system' | 'user' | 'assistant' | 'tool';
          content: string;
          tool_call_id?: string;
          name?: string;
          tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
        }>,
        llmTools,
        {
          model: config.model,
          temperature: config.temperature ?? 0.7,
          maxTokens: config.maxTokens ?? 4096,
          topP: config.topP,
          frequencyPenalty: config.frequencyPenalty,
          presencePenalty: config.presencePenalty,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          providerId: config.providerId,
          toolChoice: shouldForceTools ? 'required' : 'auto',
        },
        config.signal
      );

      const response: LLMIterationResponse = {
        content: rawResponse.content,
        tool_calls: rawResponse.tool_calls || [],
        hasToolCalls: !!(rawResponse.tool_calls && rawResponse.tool_calls.length > 0),
      };

      if (!response.hasToolCalls) {
        const finalContent = response.content || 'Task completed.';

        state.messages.push({
          id: `msg_${Date.now()}_final`,
          role: 'assistant',
          content: finalContent,
          timestamp: new Date(),
        });

        state.status = 'done';
        traceManager.endSpan(trace.id, iterSpan.id, 'ok');
        traceManager.endTrace(trace.id);
        config.onThinking?.('Task completed');
        config.onFinalResponse?.(finalContent);
        config.onDone?.(state);
        return state;
      }

      if (response.hasToolCalls && response.tool_calls.length > 0) {
        state.status = 'executing';
        config.onThinking?.(`Executing ${response.tool_calls.length} tool call(s)...`);

        llmMessages.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
        });
        state.messages.push({
          id: `msg_${Date.now()}_tc`,
          role: 'assistant',
          content: response.content || '',
          timestamp: new Date(),
          toolCalls: response.tool_calls.map(tc => ({
            id: tc.id,
            toolName: tc.function.name,
            parameters: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
            status: 'completed' as const,
          })),
        });

        const batchOutcome = await runToolBatch(
          response.tool_calls as LLMToolCallResult[],
          iteration,
          state,
          llmMessages,
          config,
          sessionCategoryApprovals,
          trustConfirmed,
          approvedToolCallIds,
          checkCancelled,
        );

        if (batchOutcome.paused) {
          state.status = 'thinking';
          traceManager.endSpan(trace.id, iterSpan.id, 'ok');
          traceManager.endTrace(trace.id);
          config.onThinking?.('等待用户确认…');
          config.onDone?.(state);
          return state;
        }

        for (const result of batchOutcome.results) {
          pushToolResult(llmMessages, state, result);
        }
      }
    }

    state.status = 'done';
    const summary = generateSummary(state);
    state.messages.push({
      id: `msg_${Date.now()}_summary`,
      role: 'assistant',
      content: summary,
      timestamp: new Date(),
    });

    traceManager.endSpan(trace.id, rootSpan.id, 'ok', 'Max iterations reached');
    traceManager.endTrace(trace.id);
    config.onThinking?.('Max iterations reached');
    config.onDone?.(state);
    return state;

  } catch (error) {
    state.status = 'error';
    const isCancelled = error instanceof DOMException && error.name === 'AbortError';
    const errorMessage = isCancelled
      ? '任务已取消'
      : (error instanceof Error ? error.message : 'Unknown error');

    if (isCancelled) {
      config.onThinking?.('任务已取消');
    } else {
      config.onError?.(`Agent execution error: ${errorMessage}`);
    }

    traceManager.endSpan(trace.id, rootSpan.id, 'error', errorMessage);
    traceManager.endTrace(trace.id);

    state.messages.push({
      id: `msg_${Date.now()}_error`,
      role: 'assistant',
      content: isCancelled ? '⏹️ 任务已取消' : `❌ Error: ${errorMessage}`,
      timestamp: new Date(),
    });

    return state;
  }
}

/**
 * Resume a paused loop: execute **only** the pending tool (if approved), inject result, continue.
 * Forbidden path: re-running the original user message from scratch is not used here.
 */
export async function resumeAgentLoop(
  resumeToken: string,
  decision: HitlDecision,
  configOverrides?: Partial<AgentLoopConfig>,
): Promise<AgentState> {
  const pause = loadPauseState(resumeToken);
  if (!pause) {
    return {
      status: 'error',
      plan: [],
      currentStep: 0,
      messages: [{
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        content: '❌ 恢复令牌无效或已过期。请重新发送任务。',
        timestamp: new Date(),
      }],
      toolCalls: [],
      artifacts: [],
      toolStreams: [],
    };
  }

  if (decision.action === 'cancel') {
    writeHitlAudit({
      kind: 'hitl_cancel',
      detail: '用户取消任务',
      toolName: pause.toolName,
      toolCallId: pause.toolCallId,
      confirmReason: pause.confirmReason,
      resumeToken,
      approvalPolicy: pause.approvalPolicy,
    });
    deletePauseState(resumeToken);
    return {
      status: 'error',
      plan: pause.plan,
      currentStep: 0,
      messages: [
        ...pause.agentMessages.map(m => ({
          ...m,
          timestamp: new Date(m.timestamp),
        })),
        {
          id: `msg_${Date.now()}_cancel`,
          role: 'assistant',
          content: '⏹️ 任务已取消',
          timestamp: new Date(),
        },
      ],
      toolCalls: pause.toolCalls,
      artifacts: pause.artifacts,
      toolStreams: [],
    };
  }

  const sessionCats = [...pause.sessionCategoryApprovals];
  let trustConfirmed = pause.trustConfirmed;
  const approvedIds = [...pause.approvedToolCallIds];

  // Trust elevation is separate: only when confirmReason is trust_elevation
  if (
    pause.confirmReason === 'trust_elevation' &&
    (decision.action === 'approve_once' || decision.action === 'approve_category')
  ) {
    trustConfirmed = true;
    writeHitlAudit({
      kind: 'hitl_confirm',
      detail: '批准本机权限提升（不自动批准全部危险工具）',
      confirmReason: 'trust_elevation',
      resumeToken,
      approvalPolicy: pause.approvalPolicy,
    });
  }

  if (decision.action === 'approve_category') {
    const cat =
      decision.category ||
      categoryForTool(pause.toolName, pause.parameters);
    if (cat && !sessionCats.includes(cat)) {
      sessionCats.push(cat);
    }
    writeHitlAudit({
      kind: 'hitl_confirm',
      detail: `本会话批准类别 ${cat || 'unknown'}`,
      toolName: pause.toolName,
      toolCallId: pause.toolCallId,
      confirmReason: pause.confirmReason,
      resumeToken,
      approvalPolicy: pause.approvalPolicy,
      categories: cat ? [cat] : undefined,
    });
  }

  const config = configFromPause(pause, {
    ...configOverrides,
    sessionCategoryApprovals: sessionCats,
    trustConfirmed,
    executionMode:
      trustConfirmed || pause.executionMode === 'trust' ? 'trust' : 'sandbox',
  });

  const llmMessages: LlmMsg[] = JSON.parse(
    JSON.stringify(pause.llmMessages),
  ) as SerializedLlmMessage[];

  const state: AgentState = {
    status: 'executing',
    plan: pause.plan,
    currentStep: pause.plan.length,
    messages: pause.agentMessages.map(m => ({
      ...m,
      timestamp: new Date(m.timestamp),
    })),
    toolCalls: pause.toolCalls,
    artifacts: pause.artifacts,
    toolStreams: [],
  };

  const checkCancelled = () => {
    if (config.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
  };

  // Resolve pending tool
  if (decision.action === 'deny') {
    writeHitlAudit({
      kind: 'hitl_deny',
      detail: `拒绝工具 ${pause.toolName}`,
      toolName: pause.toolName,
      toolCallId: pause.toolCallId,
      confirmReason: pause.confirmReason,
      resumeToken,
      approvalPolicy: pause.approvalPolicy,
    });
    const denyContent = denyToolResultContent(pause.toolName, pause.confirmReason);
    pushToolResult(llmMessages, state, {
      toolCallId: pause.toolCallId,
      toolName: pause.toolName,
      content: denyContent,
      isHumanEscalation: false,
    });
    deletePauseState(resumeToken);
    writeHitlAudit({
      kind: 'hitl_resume',
      detail: '拒绝后继续循环（无副作用）',
      toolName: pause.toolName,
      toolCallId: pause.toolCallId,
      resumeToken,
    });
    return continueLoopFromMessages(
      state,
      llmMessages,
      { ...config, dangerousConfirmed: false },
      pause.iteration,
      sessionCats,
      trustConfirmed,
      approvedIds,
    );
  }

  if (decision.action === 'answer' || pause.confirmReason === 'human_question') {
    const text =
      decision.action === 'answer'
        ? (decision.answerText || '').trim()
        : (decision.answerText || '').trim();
    if (!text && decision.action === 'answer') {
      return {
        status: 'error',
        plan: state.plan,
        currentStep: 0,
        messages: [
          ...state.messages,
          {
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content: '❌ 请提供回答后再继续。',
            timestamp: new Date(),
          },
        ],
        toolCalls: state.toolCalls,
        artifacts: state.artifacts,
        toolStreams: [],
      };
    }
    if (text || decision.action === 'answer') {
      writeHitlAudit({
        kind: 'hitl_answer',
        detail: '用户回答 ask_human',
        toolName: pause.toolName,
        toolCallId: pause.toolCallId,
        confirmReason: 'human_question',
        resumeToken,
      });
      const q =
        typeof pause.parameters.question === 'string'
          ? pause.parameters.question
          : '';
      pushToolResult(llmMessages, state, {
        toolCallId: pause.toolCallId,
        toolName: pause.toolName,
        content: answerToolResultContent(text || '(空)', q),
        isHumanEscalation: false,
      });
      deletePauseState(resumeToken);
      writeHitlAudit({
        kind: 'hitl_resume',
        detail: '注入回答后继续循环',
        toolName: pause.toolName,
        resumeToken,
      });
      return continueLoopFromMessages(
        state,
        llmMessages,
        config,
        pause.iteration,
        sessionCats,
        trustConfirmed,
        approvedIds,
      );
    }
  }

  // approve_once or approve_category → execute **only** this tool once
  if (decision.action === 'approve_once' || decision.action === 'approve_category') {
    // Trust-only pause: elevate mode and start/continue loop — never set global dangerousConfirmed
    if (pause.toolName === 'execution_mode' || pause.confirmReason === 'trust_elevation') {
      deletePauseState(resumeToken);
      writeHitlAudit({
        kind: 'hitl_resume',
        detail:
          'trust 已确认；以 trust 继续（危险工具仍单独 HITL，不自动 dangerousConfirmed）',
        confirmReason: 'trust_elevation',
        resumeToken,
      });
      // Pre-loop trust gate: start agent loop once with stored user message
      if (pause.userMessage && llmMessages.length === 0) {
        const history = pause.agentMessages.map(m => ({
          ...m,
          timestamp: new Date(m.timestamp),
        }));
        return runAgentLoop(pause.userMessage, history, {
          ...config,
          trustConfirmed: true,
          executionMode: 'trust',
          // Critical: trust ≠ auto-approve all dangerous tools
          dangerousConfirmed: false,
          sessionCategoryApprovals: sessionCats,
        });
      }
      // Mid-loop trust (rare): continue from existing transcript without re-running user msg
      if (llmMessages.length > 0) {
        return continueLoopFromMessages(
          state,
          llmMessages,
          {
            ...config,
            trustConfirmed: true,
            executionMode: 'trust',
            dangerousConfirmed: false,
          },
          pause.iteration,
          sessionCats,
          true,
          approvedIds,
        );
      }
      return {
        status: 'done',
        plan: [],
        currentStep: 0,
        messages: [
          ...state.messages,
          {
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content:
              '已确认本机权限。请重新发送任务以在 trust 模式下执行（危险工具仍会单独确认）。',
            timestamp: new Date(),
          },
        ],
        toolCalls: [],
        artifacts: [],
        toolStreams: [],
      };
    }

    // ask_human must use answer path, not tool execute
    if (pause.confirmReason === 'human_question' || pause.toolName === 'ask_human') {
      const answer =
        (decision.answerText || '').trim() ||
        '(用户批准继续，但未填写具体回答)';
      writeHitlAudit({
        kind: 'hitl_answer',
        detail: 'approve 路径注入 ask_human 回答',
        toolName: pause.toolName,
        toolCallId: pause.toolCallId,
        confirmReason: 'human_question',
        resumeToken,
      });
      const q =
        typeof pause.parameters.question === 'string'
          ? pause.parameters.question
          : '';
      pushToolResult(llmMessages, state, {
        toolCallId: pause.toolCallId,
        toolName: pause.toolName,
        content: answerToolResultContent(answer, q),
        isHumanEscalation: false,
      });
      deletePauseState(resumeToken);
      return continueLoopFromMessages(
        state,
        llmMessages,
        config,
        pause.iteration,
        sessionCats,
        trustConfirmed,
        approvedIds,
      );
    }

    writeHitlAudit({
      kind: 'hitl_confirm',
      detail:
        decision.action === 'approve_once'
          ? `批准单次执行 ${pause.toolName}`
          : `批准类别后执行 ${pause.toolName}`,
      toolName: pause.toolName,
      toolCallId: pause.toolCallId,
      confirmReason: pause.confirmReason,
      resumeToken,
      approvalPolicy: pause.approvalPolicy,
    });

    approvedIds.push(pause.toolCallId);
    checkCancelled();

    const result = await executeSingleTool(
      pause.pendingTool as LLMToolCallResult,
      pause.iteration,
      {
        workspacePath: config.workspacePath,
        chatId: config.chatId,
        executionMode: config.executionMode,
        dangerousConfirmed: true,
        autoApprovedCategories: config.autoApprovedCategories,
        sessionCategoryApprovals: sessionCats,
        approvalPolicy: config.approvalPolicy,
        skipHitlGate: true,
        onToolStream: config.onToolStream,
      },
      checkCancelled,
      {
        onStepStart: (step) => {
          state.plan.push(step);
          state.currentStep = state.plan.length - 1;
          config.onStepStart?.(step);
        },
        onStepComplete: config.onStepComplete ?? (() => {}),
        onToolCall: (tc) => {
          state.toolCalls.push(tc);
          config.onToolCall?.(tc);
        },
        onToolCallUpdate: config.onToolCallUpdate ?? (() => {}),
        onArtifact: (artifact) => {
          state.artifacts.push(artifact);
        },
        onThinking: config.onThinking ?? (() => {}),
      }
    );

    // If tool still needs confirm (e.g. nested yellow after outer approve) — re-pause
    if (result.needsConfirmation) {
      const reason: ConfirmReason = isConfirmReason(result.confirmReason)
        ? result.confirmReason
        : resolveConfirmReason(pause.toolName, pause.parameters);
      const nested = buildPauseState({
        ...pause,
        confirmReason: reason,
        sessionCategoryApprovals: sessionCats,
        trustConfirmed,
        approvedToolCallIds: approvedIds,
        llmMessages,
        agentMessages: state.messages,
        toolCalls: state.toolCalls,
        plan: state.plan,
        artifacts: state.artifacts,
      });
      savePauseState(nested);
      writeHitlAudit({
        kind: 'hitl_pause',
        detail: `二次确认：${pause.toolName}`,
        toolName: pause.toolName,
        confirmReason: reason,
        resumeToken: nested.resumeToken,
      });
      config.onWaitingConfirm?.({
        resumeToken: nested.resumeToken,
        toolCallId: pause.toolCallId,
        toolName: pause.toolName,
        parameters: pause.parameters,
        confirmReason: reason,
      });
      config.onPendingToolCall?.({
        toolCallId: pause.toolCallId,
        toolName: pause.toolName,
        parameters: pause.parameters,
        confirmReason: reason,
        resumeToken: nested.resumeToken,
      });
      deletePauseState(resumeToken);
      state.status = 'thinking';
      config.onDone?.(state);
      return state;
    }

    pushToolResult(llmMessages, state, result);
    deletePauseState(resumeToken);
    writeHitlAudit({
      kind: 'hitl_resume',
      detail: `单次工具已执行并继续循环：${pause.toolName}`,
      toolName: pause.toolName,
      toolCallId: pause.toolCallId,
      resumeToken,
    });

    return continueLoopFromMessages(
      state,
      llmMessages,
      config,
      pause.iteration,
      sessionCats,
      trustConfirmed,
      approvedIds,
    );
  }

  // Fallback
  deletePauseState(resumeToken);
  return {
    status: 'error',
    plan: state.plan,
    currentStep: 0,
    messages: [
      ...state.messages,
      {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: '❌ 未知的恢复操作',
        timestamp: new Date(),
      },
    ],
    toolCalls: state.toolCalls,
    artifacts: state.artifacts,
    toolStreams: [],
  };
}

export async function cancelHitl(resumeToken: string): Promise<void> {
  const pause = loadPauseState(resumeToken);
  if (pause) {
    writeHitlAudit({
      kind: 'hitl_cancel',
      detail: 'cancelHitl',
      toolName: pause.toolName,
      toolCallId: pause.toolCallId,
      resumeToken,
    });
    deletePauseState(resumeToken);
  }
}

import { NextRequest } from 'next/server';
import { runAgentLoop, resumeAgentLoop, cancelHitl } from '@/lib/agent/loop';
import { resolveProviderConfig, missingApiKeyError } from '@/lib/config/server-env';
import type { ResolvedProviderConfig } from '@/lib/config/server-env';
import type { Message } from '@/types/agent';
import {
  resolveEffectivePolicy,
  isApprovalPolicy,
  isExecutionEnvironment,
  normalizeGrant,
  type ApprovalPolicy,
  type ExecutionEnvironment,
  type AutonomyGrant,
  writeSafetyAudit,
} from '@/lib/agent/action-policy';
import {
  buildPauseState,
  savePauseState,
  writeHitlAudit,
  isHitlDecisionAction,
  isConfirmReason,
  CONFIRM_REASON_LABELS,
  confirmReasonRiskLabel,
  describeWhatChanges,
  type ConfirmReason,
  type HitlDecision,
} from '@/lib/agent/hitl';

export const runtime = 'nodejs';
export const maxDuration = 300;

type AgentBody = {
  /** 'run' (default) | 'resume' | 'cancel' */
  action?: 'run' | 'resume' | 'cancel';
  resumeToken?: string;
  decision?: {
    action?: string;
    answerText?: string;
    category?: string;
  };
  userMessage?: string;
  chatHistory?: Message[];
  providerId?: string;
  providerName?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  activePlaybookId?: string;
  userName?: string;
  systemPrompt?: string;
  chatId?: string;
  /** Only honored when trustConfirmed === true; default remains sandbox. */
  requestedExecutionMode?: 'sandbox' | 'trust';
  trustConfirmed?: boolean;
  /**
   * User confirmed dangerous tool HITL for this run / resume once.
   * Must not be set merely because trust was elevated.
   */
  dangerousConfirmed?: boolean;
  /** Client claim — server re-validates against grant store. */
  approvalPolicy?: ApprovalPolicy;
  executionEnvironment?: ExecutionEnvironment;
  autonomyGrant?: AutonomyGrant | null;
  sessionCategoryApprovals?: Array<
    'web_search' | 'code_run' | 'artifacts_write' | 'package_install'
  >;
};

function sseResponse(
  stream: ReadableStream,
): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function bindLoopCallbacks(
  send: (data: Record<string, unknown>) => void,
  executionMode: string,
  approvalPolicy: ApprovalPolicy,
) {
  return {
    onThinking: (content: string) => {
      send({ type: 'thinking', content });
    },
    onStepStart: (step: unknown) => {
      send({ type: 'step_start', step });
    },
    onStepComplete: (step: unknown, result: string) => {
      send({ type: 'step_complete', step, result });
    },
    onToolCall: (toolCall: unknown) => {
      send({ type: 'tool_call', toolCall });
    },
    onToolCallUpdate: (toolCall: unknown) => {
      send({ type: 'tool_call_update', toolCall });
    },
    onToolStream: (chunk: unknown) => {
      send({ type: 'tool_stream', chunk });
    },
    onExecutionStep: (step: unknown) => {
      send({ type: 'execution_step', step });
    },
    onPendingToolCall: (pending: {
      toolCallId: string;
      toolName: string;
      parameters: Record<string, unknown>;
      confirmReason?: ConfirmReason;
      resumeToken?: string;
    }) => {
      const reason: ConfirmReason =
        pending.confirmReason && isConfirmReason(pending.confirmReason)
          ? pending.confirmReason
          : 'dangerous_tool';
      send({
        type: 'pending_tool_confirm',
        pending: {
          ...pending,
          confirmReason: reason,
          reasonLabel: CONFIRM_REASON_LABELS[reason],
          riskLabel: confirmReasonRiskLabel(reason),
          whatChanges: describeWhatChanges(
            pending.toolName,
            pending.parameters,
            reason,
          ),
          content:
            reason === 'human_question'
              ? describeWhatChanges(pending.toolName, pending.parameters, reason)
              : `工具「${pending.toolName}」需要确认（${CONFIRM_REASON_LABELS[reason]}）`,
        },
      });
    },
    onWaitingConfirm: (info: {
      resumeToken: string;
      toolCallId: string;
      toolName: string;
      parameters: Record<string, unknown>;
      confirmReason: ConfirmReason;
    }) => {
      send({
        type: 'waiting_confirm',
        resumeToken: info.resumeToken,
        toolCallId: info.toolCallId,
        toolName: info.toolName,
        confirmReason: info.confirmReason,
      });
    },
    onError: (message: string) => {
      send({ type: 'error', message });
    },
    onFinalResponse: (content: string) => {
      send({ type: 'final', content });
    },
    onDone: (state: {
      plan: unknown;
      artifacts: unknown;
      toolCalls: unknown;
      messages: Message[];
      status: string;
    }) => {
      send({
        type: 'done',
        plan: state.plan,
        artifacts: state.artifacts,
        toolCalls: state.toolCalls,
        executionMode,
        approvalPolicy,
        status: state.status,
        messages: state.messages.map(m => ({
          ...m,
          timestamp: m.timestamp instanceof Date
            ? m.timestamp.toISOString()
            : m.timestamp,
        })),
      });
    },
  };
}

export async function POST(request: NextRequest) {
  let body: AgentBody;

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const action = body.action === 'resume' || body.action === 'cancel' ? body.action : 'run';

  // ── cancel ─────────────────────────────────────────────────────────────
  if (action === 'cancel') {
    const token = body.resumeToken;
    if (token) {
      await cancelHitl(token);
    }
    writeHitlAudit({
      kind: 'hitl_cancel',
      detail: '客户端取消',
      resumeToken: token,
    });
    return new Response(
      JSON.stringify({ success: true, status: 'cancelled' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Provider credentials: server env only
  let resolved: ResolvedProviderConfig;
  try {
    resolved = resolveProviderConfig(body.providerId || 'openai');
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unsupported provider',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!resolved.apiKey) {
    return new Response(JSON.stringify({ error: missingApiKeyError(resolved.providerId) }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const {
    userMessage,
    chatHistory,
    providerName,
    temperature,
    maxTokens,
    activePlaybookId,
    userName,
    systemPrompt,
    chatId,
    requestedExecutionMode,
    trustConfirmed,
    dangerousConfirmed,
    approvalPolicy: claimPolicy,
    executionEnvironment: claimEnv,
    autonomyGrant: claimGrant,
    sessionCategoryApprovals,
  } = body;

  const effective = resolveEffectivePolicy({
    approvalPolicy: isApprovalPolicy(claimPolicy) ? claimPolicy : undefined,
    executionEnvironment: isExecutionEnvironment(claimEnv) ? claimEnv : undefined,
    autonomyGrant: normalizeGrant(claimGrant),
    requestedExecutionMode,
    trustConfirmed,
    // Only for run path; resume uses skipHitlGate + explicit decision
    dangerousConfirmed: action === 'run' ? dangerousConfirmed : false,
  });

  const executionMode = effective.executionMode;
  const workspacePath = process.env.MINUS_WORKSPACE || process.cwd();

  // ── resume ─────────────────────────────────────────────────────────────
  if (action === 'resume') {
    const token = body.resumeToken;
    if (!token || typeof token !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing resumeToken' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const rawAction = body.decision?.action;
    if (!isHitlDecisionAction(rawAction)) {
      return new Response(JSON.stringify({ error: 'Invalid decision.action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const decision: HitlDecision = {
      action: rawAction,
      answerText: body.decision?.answerText,
      category: body.decision?.category as HitlDecision['category'],
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };
        try {
          const callbacks = bindLoopCallbacks(
            send,
            executionMode,
            effective.approvalPolicy,
          );
          const result = await resumeAgentLoop(token, decision, {
            signal: request.signal,
            maxSteps: 10,
            maxRetries: 2,
            timeout: 120000,
            apiKey: resolved.apiKey,
            baseUrl: resolved.baseUrl,
            model: resolved.model,
            providerId: resolved.providerId,
            providerName,
            temperature,
            maxTokens,
            userName,
            systemPrompt,
            activePlaybookId,
            chatId: chatId || 'default',
            workspacePath,
            approvalPolicy: effective.approvalPolicy,
            autoApprovedCategories: effective.autoApprovedCategories,
            ...callbacks,
          });

          send({
            type: 'complete',
            status:
              result.status === 'thinking' && result.pendingToolCall
                ? 'waiting_confirm'
                : result.status === 'error' &&
                    result.messages.some(m => m.content.includes('取消'))
                  ? 'cancelled'
                  : result.status,
            messageCount: result.messages.length,
            executionMode,
            approvalPolicy: effective.approvalPolicy,
          });
        } catch (error) {
          const isCancelled =
            error instanceof DOMException && error.name === 'AbortError';
          if (isCancelled) {
            await cancelHitl(token);
          }
          send({
            type: 'error',
            message: isCancelled
              ? '任务已取消'
              : error instanceof Error
                ? error.message
                : 'Unknown server error',
          });
        } finally {
          controller.close();
        }
      },
    });
    return sseResponse(stream);
  }

  // ── run ────────────────────────────────────────────────────────────────
  if (!userMessage) {
    return new Response(JSON.stringify({ error: 'Missing userMessage' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const parsedHistory: Message[] = (chatHistory || []).map(msg => ({
    ...msg,
    timestamp: new Date(msg.timestamp),
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      if (!effective.toolsAllowed || effective.approvalPolicy === 'chat_only') {
        writeSafetyAudit({
          kind: 'chat_only_block',
          detail: '仅对话模式拒绝 /api/agent 工具环',
          approvalPolicy: 'chat_only',
        });
        send({
          type: 'error',
          message:
            '当前为「仅对话」模式，已禁用 Desktop 工具环。请在 设置 → 执行与安全 中调整安全级别。',
          approvalPolicy: 'chat_only',
        });
        send({ type: 'complete', status: 'blocked_chat_only', messageCount: 0 });
        controller.close();
        return;
      }

      const wantsLocal =
        requestedExecutionMode === 'trust' ||
        claimEnv === 'local' ||
        effective.executionEnvironment === 'local';
      const autoLocal =
        effective.approvalPolicy === 'full_auto' &&
        effective.executionEnvironment === 'local' &&
        effective.grant !== null;

      // Trust elevation HITL — persist pause with resumeToken (not full tool loop re-entry as only path)
      if (
        wantsLocal &&
        !autoLocal &&
        trustConfirmed !== true &&
        effective.executionEnvironment !== 'local'
      ) {
        const pause = buildPauseState({
          toolCallId: 'trust_elevation',
          toolName: 'execution_mode',
          parameters: { requestedExecutionMode: 'trust' },
          confirmReason: 'trust_elevation',
          llmMessages: [],
          agentMessages: parsedHistory,
          toolCalls: [],
          plan: [],
          artifacts: [],
          iteration: 0,
          chatId: chatId || 'default',
          userMessage,
          pendingTool: {
            id: 'trust_elevation',
            type: 'function',
            function: {
              name: 'execution_mode',
              arguments: JSON.stringify({ requestedExecutionMode: 'trust' }),
            },
          },
          completedToolResults: [],
          executionMode: 'sandbox',
          approvalPolicy: effective.approvalPolicy,
          autoApprovedCategories: effective.autoApprovedCategories,
          sessionCategoryApprovals: sessionCategoryApprovals || [],
          trustConfirmed: false,
          approvedToolCallIds: [],
          workspacePath,
          provider: {
            apiKey: resolved.apiKey,
            baseUrl: resolved.baseUrl,
            model: resolved.model,
            providerId: resolved.providerId,
            providerName,
            temperature,
            maxTokens,
            userName,
            systemPrompt,
            activePlaybookId,
          },
          maxSteps: 10,
        });
        savePauseState(pause);
        writeHitlAudit({
          kind: 'hitl_pause',
          detail: '等待确认本机权限提升',
          confirmReason: 'trust_elevation',
          resumeToken: pause.resumeToken,
          approvalPolicy: effective.approvalPolicy,
        });
        send({
          type: 'pending_tool_confirm',
          pending: {
            toolCallId: 'trust_elevation',
            toolName: 'execution_mode',
            parameters: { requestedExecutionMode: 'trust' },
            confirmReason: 'trust_elevation',
            reasonLabel: CONFIRM_REASON_LABELS.trust_elevation,
            riskLabel: confirmReasonRiskLabel('trust_elevation'),
            whatChanges: describeWhatChanges(
              'execution_mode',
              { requestedExecutionMode: 'trust' },
              'trust_elevation',
            ),
            resumeToken: pause.resumeToken,
            content:
              '请求 trust 本机更高权限。默认 sandbox；确认后才升权（不会自动批准全部危险工具）。',
          },
        });
        send({
          type: 'waiting_confirm',
          resumeToken: pause.resumeToken,
          toolCallId: 'trust_elevation',
          toolName: 'execution_mode',
          confirmReason: 'trust_elevation',
        });
        send({ type: 'complete', status: 'waiting_confirm', messageCount: 0 });
        controller.close();
        return;
      }

      if (
        requestedExecutionMode === 'trust' &&
        trustConfirmed !== true &&
        !autoLocal &&
        effective.approvalPolicy === 'supervised'
      ) {
        const pause = buildPauseState({
          toolCallId: 'trust_elevation',
          toolName: 'execution_mode',
          parameters: { requestedExecutionMode: 'trust' },
          confirmReason: 'trust_elevation',
          llmMessages: [],
          agentMessages: parsedHistory,
          toolCalls: [],
          plan: [],
          artifacts: [],
          iteration: 0,
          chatId: chatId || 'default',
          userMessage,
          pendingTool: {
            id: 'trust_elevation',
            type: 'function',
            function: {
              name: 'execution_mode',
              arguments: JSON.stringify({ requestedExecutionMode: 'trust' }),
            },
          },
          completedToolResults: [],
          executionMode: 'sandbox',
          approvalPolicy: effective.approvalPolicy,
          autoApprovedCategories: effective.autoApprovedCategories,
          sessionCategoryApprovals: sessionCategoryApprovals || [],
          trustConfirmed: false,
          approvedToolCallIds: [],
          workspacePath,
          provider: {
            apiKey: resolved.apiKey,
            baseUrl: resolved.baseUrl,
            model: resolved.model,
            providerId: resolved.providerId,
            providerName,
            temperature,
            maxTokens,
            userName,
            systemPrompt,
            activePlaybookId,
          },
          maxSteps: 10,
        });
        savePauseState(pause);
        writeHitlAudit({
          kind: 'hitl_pause',
          detail: '等待确认本机权限提升（supervised）',
          confirmReason: 'trust_elevation',
          resumeToken: pause.resumeToken,
        });
        send({
          type: 'pending_tool_confirm',
          pending: {
            toolCallId: 'trust_elevation',
            toolName: 'execution_mode',
            parameters: { requestedExecutionMode: 'trust' },
            confirmReason: 'trust_elevation',
            reasonLabel: CONFIRM_REASON_LABELS.trust_elevation,
            riskLabel: confirmReasonRiskLabel('trust_elevation'),
            whatChanges: describeWhatChanges(
              'execution_mode',
              { requestedExecutionMode: 'trust' },
              'trust_elevation',
            ),
            resumeToken: pause.resumeToken,
            content:
              '请求 trust 本机更高权限。默认 sandbox；确认后才升权（不会自动批准全部危险工具）。',
          },
        });
        send({
          type: 'waiting_confirm',
          resumeToken: pause.resumeToken,
          toolCallId: 'trust_elevation',
          toolName: 'execution_mode',
          confirmReason: 'trust_elevation',
        });
        send({ type: 'complete', status: 'waiting_confirm', messageCount: 0 });
        controller.close();
        return;
      }

      if (effective.downgradeReason) {
        send({
          type: 'thinking',
          content: `安全策略：${effective.downgradeReason}`,
        });
      }

      try {
        const callbacks = bindLoopCallbacks(
          send,
          executionMode,
          effective.approvalPolicy,
        );
        const result = await runAgentLoop(userMessage, parsedHistory, {
          maxSteps: 10,
          maxRetries: 2,
          timeout: 120000,
          signal: request.signal,
          activePlaybookId,
          chatId: chatId || 'default',
          executionMode,
          // Do NOT pass global dangerousConfirmed from trust; only explicit client flag for this run
          dangerousConfirmed: dangerousConfirmed === true,
          autoApprovedCategories: effective.autoApprovedCategories,
          sessionCategoryApprovals: sessionCategoryApprovals || [],
          trustConfirmed: trustConfirmed === true || executionMode === 'trust',
          approvalPolicy: effective.approvalPolicy,
          workspacePath,
          apiKey: resolved.apiKey,
          baseUrl: resolved.baseUrl,
          model: resolved.model,
          providerId: resolved.providerId,
          providerName,
          temperature,
          maxTokens,
          userName,
          systemPrompt,
          ...callbacks,
        });

        const waiting =
          result.status === 'thinking' && !!result.pendingToolCall;
        send({
          type: 'complete',
          status: waiting ? 'waiting_confirm' : result.status,
          messageCount: result.messages.length,
          executionMode,
          approvalPolicy: effective.approvalPolicy,
        });
      } catch (error) {
        const isCancelled =
          error instanceof DOMException && error.name === 'AbortError';
        send({
          type: 'error',
          message: isCancelled
            ? '任务已取消'
            : error instanceof Error
              ? error.message
              : 'Unknown server error',
        });
      } finally {
        controller.close();
      }
    },
  });

  return sseResponse(stream);
}

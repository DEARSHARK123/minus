import { TaskStep, ToolCall, Artifact } from '@/types/agent';
import { toolRegistry } from '../tools';
import { blackboard } from './blackboard';
import { MAX_TOOL_RETRIES, isRetryableError, LLMToolCallResult } from './loop-utils';

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  content: string;
  isHumanEscalation: boolean;
  needsConfirmation?: boolean;
  confirmReason?: string;
  parameters?: Record<string, unknown>;
}

export interface ToolExecutionCallbacks {
  onStepStart: (step: TaskStep) => void;
  onStepComplete: (step: TaskStep, result: string) => void;
  onToolCall: (tc: ToolCall) => void;
  onToolCallUpdate: (tc: ToolCall) => void;
  onArtifact: (artifact: Artifact) => void;
  onThinking: (msg: string) => void;
}

export async function executeSingleTool(
  toolCall: LLMToolCallResult,
  iteration: number,
  config: {
    workspacePath?: string;
    chatId?: string;
    executionMode?: 'sandbox' | 'trust';
    dangerousConfirmed?: boolean;
    autoApprovedCategories?: Array<
      'web_search' | 'code_run' | 'artifacts_write' | 'package_install'
    >;
    sessionCategoryApprovals?: Array<
      'web_search' | 'code_run' | 'artifacts_write' | 'package_install'
    >;
    approvalPolicy?:
      | 'chat_only'
      | 'supervised'
      | 'bounded_auto'
      | 'full_auto';
    /** Resume: skip registry HITL for this authorized call only */
    skipHitlGate?: boolean;
    onToolStream?: (stream: { toolCallId: string; type: 'stdout' | 'stderr' | 'status'; data: string }) => void;
  },
  checkCancelled: () => void,
  callbacks: ToolExecutionCallbacks
): Promise<ToolExecutionResult> {
  const toolName = toolCall.function.name;
  let toolParams: Record<string, unknown>;

  try {
    toolParams = JSON.parse(toolCall.function.arguments);
  } catch {
    toolParams = {};
  }

  checkCancelled();

  const stepId = `step_${iteration}_${toolCall.id}`;
  const step: TaskStep = {
    id: stepId,
    title: `Execute ${toolName}`,
    status: 'in_progress',
    description: `Calling ${toolName} with parameters: ${JSON.stringify(toolParams).slice(0, 100)}`,
  };

  callbacks.onStepStart(step);

  const toolCallRecord: ToolCall = {
    id: toolCall.id,
    toolName,
    parameters: toolParams,
    status: 'running',
  };

  callbacks.onToolCall(toolCallRecord);

  let lastError = '';

  for (let attempt = 0; attempt <= MAX_TOOL_RETRIES; attempt++) {
    checkCancelled();
    try {
      const toolResult = await toolRegistry.execute(toolName, toolParams, {
        workspacePath: config.workspacePath || process.cwd(),
        chatId: config.chatId,
        executionMode: config.executionMode || 'sandbox',
        dangerousConfirmed: config.dangerousConfirmed === true,
        autoApprovedCategories: config.autoApprovedCategories,
        sessionCategoryApprovals: config.sessionCategoryApprovals,
        approvalPolicy: config.approvalPolicy,
        skipHitlGate: config.skipHitlGate === true,
        onStream: (chunk) => {
          config.onToolStream?.({
            toolCallId: toolCall.id,
            type: chunk.type,
            data: chunk.data,
          });
        },
      });

      if (toolResult.needsConfirmation) {
        toolCallRecord.status = 'pending';
        toolCallRecord.error = toolResult.error || '需要确认';
        step.status = 'pending';
        step.result = toolResult.error || '需要确认';
        callbacks.onToolCallUpdate({ ...toolCallRecord });
        callbacks.onStepComplete(step, toolResult.error || '需要确认');
        return {
          toolCallId: toolCall.id,
          toolName,
          content: toolResult.error || 'CONFIRMATION_REQUIRED',
          isHumanEscalation: true,
          needsConfirmation: true,
          confirmReason: toolResult.confirmReason,
          parameters: toolParams,
        };
      }

      if (toolResult.success) {
        const resultStr = typeof toolResult.data === 'string'
          ? toolResult.data
          : JSON.stringify(toolResult.data);

        toolCallRecord.status = 'completed';
        toolCallRecord.result = resultStr;
        step.status = 'completed';
        step.result = resultStr;

        callbacks.onToolCallUpdate({ ...toolCallRecord });

        if (toolResult.artifacts) {
          for (const a of toolResult.artifacts) {
            callbacks.onArtifact({
              ...a,
              id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              createdAt: new Date(),
              type: a.type as 'file' | 'code' | 'image' | 'data',
            });
          }
        }

        if (toolName === 'code_executor' && toolParams.code) {
          callbacks.onArtifact({
            id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: `code_executor_${(toolParams.language as string) || 'python'}`,
            type: 'code',
            content: toolParams.code as string,
            createdAt: new Date(),
          });
        }

        if ((toolName === 'file_manager') && toolResult.data && typeof toolResult.data === 'object') {
          const fd = toolResult.data as Record<string, unknown>;
          if (fd.action === 'read' && fd.content) {
            callbacks.onArtifact({
              id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: (fd.path as string) || 'file',
              type: 'file',
              content: fd.content as string,
              createdAt: new Date(),
            });
          }
        }

        callbacks.onStepComplete(step, resultStr);

        if (resultStr.length < 5000) {
          blackboard.set(`tool_${toolName}_${Date.now()}`, resultStr, toolName, 5 * 60 * 1000);
        }

        if (toolName === 'ask_human' && toolResult.data) {
          return {
            toolCallId: toolCall.id,
            toolName,
            content: JSON.stringify(toolResult.data),
            isHumanEscalation: true,
          };
        }

        return {
          toolCallId: toolCall.id,
          toolName,
          content: resultStr,
          isHumanEscalation: false,
        };
      }

      lastError = toolResult.error || 'Tool execution failed';

      if (attempt < MAX_TOOL_RETRIES && isRetryableError(lastError)) {
        callbacks.onThinking(`Retrying ${toolName} (attempt ${attempt + 2}/${MAX_TOOL_RETRIES + 1})...`);
        continue;
      }

      toolCallRecord.status = 'failed';
      toolCallRecord.error = lastError;
      step.status = 'failed';
      step.result = lastError;

      callbacks.onToolCallUpdate({ ...toolCallRecord });
      callbacks.onStepComplete(step, lastError);

      return {
        toolCallId: toolCall.id,
        toolName,
        content: `ERROR: ${lastError}`,
        isHumanEscalation: false,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';

      if (attempt < MAX_TOOL_RETRIES && isRetryableError(lastError)) {
        callbacks.onThinking(`Retrying ${toolName} (attempt ${attempt + 2}/${MAX_TOOL_RETRIES + 1})...`);
        continue;
      }

      toolCallRecord.status = 'failed';
      toolCallRecord.error = lastError;
      step.status = 'failed';
      step.result = lastError;

      callbacks.onToolCallUpdate({ ...toolCallRecord });
      callbacks.onStepComplete(step, lastError);

      return {
        toolCallId: toolCall.id,
        toolName,
        content: `ERROR: ${lastError}`,
        isHumanEscalation: false,
      };
    }
  }

  return {
    toolCallId: toolCall.id,
    toolName,
    content: `ERROR: ${lastError}`,
    isHumanEscalation: false,
  };
}

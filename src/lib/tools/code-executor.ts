import { z } from 'zod';
import { Tool, ToolResult, ToolExecutionContext } from '@/types/tool';
import { getSandboxManager } from '@/lib/sandbox';
import { checkCodeSafety, executeTrust } from '@/lib/trust';
import { truncateResult, validateFilePath } from './sandbox';
import { resolveConfirmReason } from '@/lib/agent/hitl';

const codeExecutorSchema = z.object({
  code: z.string().default('').describe('The code to execute directly'),
  language: z.enum(['python', 'javascript', 'typescript']).default('python'),
  timeout: z.number().default(30000).describe('Execution timeout in milliseconds'),
  file_path: z.string().optional().describe('Path to an existing script file to execute (instead of inline code). Use this when you have already written a file with file_manager.'),
});

async function executeInSandbox(
  code: string,
  language: 'python' | 'javascript' | 'typescript',
  timeout: number,
  context?: ToolExecutionContext
): Promise<ToolResult> {
  const chatId = context?.chatId || 'default';
  const manager = await getSandboxManager();
  const result = await manager.executeCode(chatId, code, language, {
    timeout,
    onStream: context?.onStream,
  });

  const artifacts = result.artifacts.map(a => ({
    name: a.name,
    type: a.type as 'file' | 'code' | 'image' | 'data',
    content: a.content,
    mimeType: a.mimeType,
  }));

  if (result.success) {
    return {
      success: true,
      data: truncateResult(result.stdout || '(no output)'),
      artifacts: artifacts.length > 0 ? artifacts : undefined,
    };
  }
  return {
    success: false,
    error: truncateResult(result.stderr || `Exit code: ${result.exitCode}`),
    artifacts: artifacts.length > 0 ? artifacts : undefined,
  };
}

async function executeInTrust(
  code: string,
  language: 'python' | 'javascript' | 'typescript',
  timeout: number,
  context?: ToolExecutionContext,
  filePath?: string,
): Promise<ToolResult> {
  const safety = checkCodeSafety(code, language);
  if (!safety.allowed) {
    return {
      success: false,
      error: `🚫 Blocked: ${safety.reason}. This command is classified as catastrophic and will not be executed.`,
    };
  }

  // Yellow commands: same HITL path (pause → resume once). Never hard-fail with no recovery.
  // After user approve_once, dangerousConfirmed / skipHitlGate allows execution.
  if (safety.requiresApproval && context?.dangerousConfirmed !== true) {
    const reason = resolveConfirmReason('code_executor', { code, language }, {
      yellowReason: safety.reason,
    });
    return {
      success: false,
      needsConfirmation: true,
      confirmReason: reason,
      error:
        `CONFIRMATION_REQUIRED: Trust 黄名单操作需要确认：${safety.reason}。` +
        ` 确认后仅执行这一次工具调用（不会整轮重跑）。`,
    };
  }

  const cwd = context?.workspacePath || process.cwd();
  const result = await executeTrust({
    code,
    language,
    timeout,
    cwd,
    chatId: context?.chatId,
    onStdout: (chunk) => context?.onStream?.({ type: 'stdout', data: chunk, timestamp: Date.now() }),
    onStderr: (chunk) => context?.onStream?.({ type: 'stderr', data: chunk, timestamp: Date.now() }),
    approvedBy: context?.dangerousConfirmed ? 'user' : 'auto',
    filePath,
  });

  if (result.success) {
    return { success: true, data: truncateResult(result.stdout || '(no output)') };
  }
  return { success: false, error: truncateResult(result.stderr || `Exit code: ${result.exitCode}`) };
}

export const codeExecutorTool: Tool = {
  name: 'code_executor',
  description: 'Execute code or run an existing script file. Supports sandbox mode (E2B/Docker) and local trust mode. Pass "code" for inline execution, or "file_path" to execute a script created by file_manager.',
  parameters: codeExecutorSchema,
  isDangerous: true,
  capability: {
    keywords: {
      zh: ['执行', '运行', '代码', '脚本', '程序', '生成', '创建', '编写'],
      en: ['execute', 'run', 'code', 'script', 'program', 'generate', 'create', 'write'],
    },
    intents: ['code_execution', 'code_generation', 'script_running'],
  },
  execute: async (params, context?: ToolExecutionContext): Promise<ToolResult> => {
    const { code, language, timeout, file_path } = params as z.infer<typeof codeExecutorSchema>;

    const clampedTimeout = Math.min(Math.max(timeout, 1000), 120_000);
    const mode = context?.executionMode || 'sandbox';

    let resolvedFilePath: string | undefined;
    let codeToExecute = code;

    if (file_path) {
      try {
        resolvedFilePath = validateFilePath(file_path, context?.workspacePath);
        const fs = await import('fs');
        if (!fs.existsSync(resolvedFilePath)) {
          return { success: false, error: `File not found: ${file_path}. Use file_manager to create it first.` };
        }
        if (!codeToExecute || codeToExecute.trim().length === 0) {
          codeToExecute = fs.readFileSync(resolvedFilePath, 'utf-8');
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Path validation failed' };
      }
    }

    if (!codeToExecute || codeToExecute.trim().length === 0) {
      return { success: false, error: 'No code to execute. Provide either "code" (inline) or "file_path" (existing file).' };
    }

    try {
      if (mode === 'sandbox') {
        return await executeInSandbox(codeToExecute, language, clampedTimeout, context);
      }
      return await executeInTrust(codeToExecute, language, clampedTimeout, context, resolvedFilePath);
    } catch (error) {
      console.error('[code_executor] Trust execution error:', error);
      const errorMsg = error instanceof Error ? error.message
        : typeof error === 'string' ? error
        : JSON.stringify(error, Object.getOwnPropertyNames(error as object));
      return {
        success: false,
        error: `Execution error: ${errorMsg}`,
      };
    }
  },
};

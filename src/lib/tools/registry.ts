import { z } from 'zod';
import { Tool, ToolResult, ToolRegistry, ToolExecutionContext } from '@/types/tool';
import {
  mayAutoApproveTool,
  writeSafetyAudit,
  type AutonomyCategory,
  type ApprovalPolicy,
  type EffectivePolicy,
} from '@/lib/agent/action-policy';
import {
  resolveConfirmReason,
  toolRequiresHitlGate,
  type ConfirmReason,
} from '@/lib/agent/hitl';
import { readUserConfigurationSync } from '@/lib/config/user-configuration';

function sanitizeJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = schema.required as string[] | undefined;

  if (!properties || !Array.isArray(required)) {
    return schema;
  }

  const fieldsWithDefaults = new Set<string>();
  for (const [key, propSchema] of Object.entries(properties)) {
    if (propSchema && typeof propSchema === 'object' && 'default' in propSchema) {
      fieldsWithDefaults.add(key);
    }
  }

  if (fieldsWithDefaults.size === 0) {
    return schema;
  }

  const filteredRequired = required.filter(field => !fieldsWithDefaults.has(field));

  return {
    ...schema,
    required: filteredRequired.length > 0 ? filteredRequired : undefined,
  };
}

function buildPolicy(context?: ToolExecutionContext): EffectivePolicy {
  return {
    approvalPolicy: (context?.approvalPolicy || 'supervised') as ApprovalPolicy,
    executionEnvironment:
      context?.executionMode === 'trust' ? 'local' : 'sandbox',
    executionMode: context?.executionMode || 'sandbox',
    toolsAllowed: context?.approvalPolicy !== 'chat_only',
    autoApprovedCategories:
      (context?.autoApprovedCategories as AutonomyCategory[]) || [],
    dangerousConfirmed: context?.dangerousConfirmed === true,
    grant: null,
    redLines: [],
    networkAccess: readUserConfigurationSync().networkAccess,
  };
}

/**
 * ask_human always pauses for an answer (not a side-effect gate).
 */
function askHumanNeedsPause(
  name: string,
  context?: ToolExecutionContext,
): boolean {
  if (name !== 'ask_human') return false;
  // Resume path injects answer without re-executing the tool gate
  return context?.skipHitlGate !== true;
}

export class ToolRegistryImpl implements ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    if (!tool.cachedJsonSchema) {
      const raw = z.toJSONSchema(tool.parameters) as Record<string, unknown>;
      const cleaned = { ...raw };
      delete cleaned.$schema;
      tool.cachedJsonSchema = sanitizeJsonSchema(cleaned);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getByNames(names: string[]): Tool[] {
    return names
      .map(name => this.tools.get(name))
      .filter((t): t is Tool => t !== undefined);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  getAllAsLLMTools(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
    return this.getAll().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.cachedJsonSchema || {},
      },
    }));
  }

  async execute(
    name: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool "${name}" not found`,
      };
    }

    // Resume path: skip outer HITL gate (caller already authorized this single call)
    if (context?.skipHitlGate === true) {
      try {
        const validatedParams = tool.parameters.parse(params) as Record<string, unknown>;
        return await tool.execute(validatedParams, context);
      } catch (error) {
        if (error instanceof Error) {
          return { success: false, error: error.message };
        }
        return { success: false, error: 'Unknown error occurred' };
      }
    }

    // ask_human: pause for answer (never auto)
    if (askHumanNeedsPause(name, context)) {
      const reason: ConfirmReason = 'human_question';
      return {
        success: false,
        needsConfirmation: true,
        confirmReason: reason,
        error:
          `CONFIRMATION_REQUIRED: 需要用户回答。` +
          ` ${typeof params.question === 'string' ? params.question : '请回答 Agent 的问题。'}`,
      };
    }

    const needsGate =
      tool.isDangerous === true || toolRequiresHitlGate(name, params);

    if (needsGate) {
      const policy = buildPolicy(context);
      // Merge session category approvals into auto list for this decision
      const sessionCats = context?.sessionCategoryApprovals || [];
      if (sessionCats.length > 0) {
        const merged = new Set([
          ...policy.autoApprovedCategories,
          ...sessionCats,
        ]);
        policy.autoApprovedCategories = Array.from(merged) as AutonomyCategory[];
      }

      const decision = mayAutoApproveTool(policy, name, params);
      if (decision.blocked) {
        return {
          success: false,
          needsConfirmation: false,
          error: `NETWORK_ACCESS_DISABLED: ${decision.reason || '网络读取已关闭'}`,
        };
      }
      if (decision.redLines.length > 0) {
        writeSafetyAudit({
          kind: 'red_line_block',
          detail: decision.reason || `红线拦截：${name}`,
          approvalPolicy: policy.approvalPolicy,
        });
        return {
          success: false,
          needsConfirmation: false,
          confirmReason: 'red_line',
          error:
            `RED_LINE_BLOCKED: 红线操作「${name}」被永久禁止。` +
            ` ${decision.reason || ''} 即使本机完全自主也不允许执行。`,
        };
      }

      if (!decision.auto) {
        const reason = resolveConfirmReason(name, params);
        return {
          success: false,
          needsConfirmation: true,
          confirmReason: reason,
          error:
            `CONFIRMATION_REQUIRED: 工具「${name}」需要用户确认后才能执行。` +
            ` ${decision.reason || '请确认后再继续（不会先执行再询问）。'}`,
        };
      }

      if (
        policy.autoApprovedCategories.length > 0 &&
        context?.dangerousConfirmed !== true
      ) {
        writeSafetyAudit({
          kind: 'auto_approve',
          detail: `自动批准工具 ${name}`,
          approvalPolicy: policy.approvalPolicy,
          categories: policy.autoApprovedCategories,
        });
      }
    }

    try {
      const validatedParams = tool.parameters.parse(params) as Record<string, unknown>;
      return await tool.execute(validatedParams, context);
    } catch (error) {
      if (error instanceof Error) {
        return {
          success: false,
          error: error.message,
        };
      }
      return {
        success: false,
        error: 'Unknown error occurred',
      };
    }
  }
}

export const toolRegistry: ToolRegistry = new ToolRegistryImpl();

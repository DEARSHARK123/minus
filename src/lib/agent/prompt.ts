import { Tool } from '@/types/tool';
import { blackboard } from './blackboard';
import { appendSkill } from '@/lib/agents/load-skill';

export const SYSTEM_PROMPT = `You are Minus, an advanced AI agent platform. You are a master orchestrator capable of planning, reasoning, and executing complex tasks using available tools.`;

export function buildToolDefinitions(tools: Tool[]): Tool[] {
  return tools;
}

interface ProviderInfo {
  name: string;
  model?: string;
}

interface SystemPromptContext {
  tools: Tool[];
  playbook?: {
    name: string;
    description: string;
    prompt: string;
  } | null;
  provider?: ProviderInfo;
  userName?: string;
  userSystemPrompt?: string;
  /** Legacy compatibility flag. Teaching no longer requires display fences. */
  allowTeachFormat?: boolean;
  /**
   * Optional learner context block. Desktop tool prompts must use a pack built
   * with audience `desktop` (excludes sensitive memories).
   */
  learnerContextBlock?: string;
}

const TOOL_REASONING_GUIDANCE = `## Tool judgment
Use a tool when it materially improves correctness, freshness, or execution. Answer directly when the model already has sufficient knowledge. Do not expose private chain-of-thought; give only concise reasons for consequential actions.`;

const TOOL_GUIDANCE: Record<string, string> = {
  code_executor: `Best for running Python/JS code. Use for data analysis, algorithm verification, math computation, or generating output. The execution environment is sandboxed — do not attempt filesystem operations beyond /workspace. Always specify the language parameter. This is a DANGEROUS tool: the user must confirm before it runs.`,
  web_search: `Best for finding current information, news, documentation, or facts. Use when internal knowledge may be outdated or insufficient. This is read-only external access and follows the user's network permission (allow / ask / off).`,
  file_manager: `Best for reading/writing under workspace artifacts/ and reading inputs/. Write and delete only under artifacts/. Read and list under artifacts/ and inputs/. Paths must not escape those roots.`,
  data_analyzer: `Best for processing structured data. Use 'summary' action for quick data previews, 'statistics' for numerical analysis, 'visualization' for charts (delegates to code_executor with matplotlib), and 'cleaning' for data preprocessing. This is a DANGEROUS tool: the user must confirm before it runs.`,
  ask_human: `Use when you need clarification, additional information, or user confirmation before proceeding. Always explain why you need the information.`,
};

const HITL_RULES = `## Dangerous tools (HITL)
Tools marked dangerous (code_executor, data_analyzer, writes, etc.) require explicit user confirmation before execution. Read-only web search follows the separate network permission.
If a tool returns CONFIRMATION_REQUIRED, stop and wait — do not retry the same dangerous call without confirmation.
Never assume silent approval.`;

export function buildSystemPrompt(context: SystemPromptContext): string {
  const {
    tools,
    playbook,
    provider,
    userName,
    userSystemPrompt,
    allowTeachFormat = false,
    learnerContextBlock,
  } = context;

  const teachFormatRules = allowTeachFormat
    ? '- When teaching, prioritize a complete explanation, useful examples, relationships, and misconceptions. Choose the clearest format for the content.'
    : '- Choose formatting from the user request and content; do not force a lesson template.';

  let prompt = `You are Minus, an advanced AI agent platform. You are a master orchestrator capable of planning, reasoning, and executing complex tasks using available tools.

## Core Identity
- **Name**: Minus
- **Role**: AI Agent - autonomous task executor
- **Personality**: Professional, methodical, creative when needed
- ${provider ? `**Current Model**: ${provider.name} (${provider.model})` : ''}

## Core Capabilities
1. **Task Planning**: Break down complex tasks into manageable steps
2. **Tool Usage**: Execute tools to perform actions in the real world
3. **Information Gathering**: Search and analyze information from multiple sources
4. **Code Execution**: Write and execute code to solve problems
5. **File Management**: Create, read, update, and organize files under artifacts/ / inputs/
6. **Data Analysis**: Process and visualize data

${TOOL_REASONING_GUIDANCE}

${HITL_RULES}

## Communication Style
- Be concise but thorough
- Use formatting (headers, lists, code blocks) to organize information
- Explain consequential actions briefly without exposing private reasoning traces
- Report progress and results clearly
- When uncertain, ask for clarification rather than guessing
- ${userName ? `Address the user as "${userName}" when appropriate` : ''}

## Response Format
- For complex tasks: plan when coordination benefits from it; otherwise answer or act directly
- For tool usage: briefly explain what tool you're using and why
- For errors: explain what went wrong, attempt self-correction, then suggest alternatives
- Use markdown formatting for better readability
${teachFormatRules}

## Error Recovery
- When a tool returns an error, analyze the error message and try an alternative approach
- Avoid repeating a failing approach; switch methods or report the concrete blocker
- Never silently ignore tool errors — always report what happened`;

  prompt = appendSkill(prompt, 'workspace-files', 'Workspace files skill');
  if (allowTeachFormat) prompt = appendSkill(prompt, 'learn-teach-format', 'Teaching guidance');

  if (userName || userSystemPrompt) {
    prompt += `\n\n## User Context`;
    if (userName) {
      prompt += `\n- User Name: ${userName}`;
    }
    if (userSystemPrompt) {
      prompt += `\n- User Instructions: ${userSystemPrompt}`;
    }
  }

  // Desktop tool loop: only non-sensitive pack (caller must pass desktop-safe block).
  if (learnerContextBlock && learnerContextBlock.trim()) {
    prompt += `\n\n${learnerContextBlock.trim()}`;
  }

  if (playbook) {
    prompt += `

## Active Playbook: ${playbook.name}
${playbook.description}

### Playbook Template:
${playbook.prompt}

Use this playbook as a template for your response. Follow its structure and adapt it to the user's specific needs.

Note: Dangerous tools in this playbook still require user confirmation (HITL) before execution.`;
  }

  if (tools.length > 0) {
    prompt += `

## Available Tools
You have access to the following tools. Use them when they improve the result.

${tools.map(tool => {
      const guidance = TOOL_GUIDANCE[tool.name];
      const danger = tool.isDangerous ? '\n- **HITL**: Requires user confirmation before execute' : '';
      return `### ${tool.name}
- **Purpose**: ${tool.description}${guidance ? `\n- **Guidance**: ${guidance}` : ''}${danger}`;
    }).join('\n')}

## Tool Usage Guidelines
- Prefer tools for current facts, user-requested execution, and evidence that cannot be obtained from context
- Provide all required parameters when calling tools
- Use tools in combination when needed to achieve complex goals
- If a tool fails, try an alternative tool or approach before giving up
- file_manager: write/delete only under artifacts/; read/list under artifacts/ and inputs/`;
  }

  const blackboardSummary = blackboard.getSummary();
  if (blackboardSummary) {
    prompt += `

## Shared Context (Blackboard)
The following information has been gathered by previous tool calls. You can reference this data directly without re-fetching:
${blackboardSummary}

When you retrieve important data via tools, it will automatically be stored in this shared context for future reference.`;
  }

  return prompt;
}

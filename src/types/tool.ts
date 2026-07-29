import { z } from 'zod';

export interface ToolKeywords {
  zh: string[];
  en: string[];
}

export interface ToolCapability {
  keywords: ToolKeywords;
  intents: string[];
}

export interface ToolExecutionContext {
  workspacePath: string;
  maxResultLength?: number;
  chatId?: string;
  executionMode?: 'sandbox' | 'trust';
  /**
   * When true, isDangerous tools may execute for **this call**
   * (user HITL approve_once / resume). Does not imply trust elevation.
   */
  dangerousConfirmed?: boolean;
  /**
   * Server-resolved categories that may auto-approve dangerous tools
   * under bounded_auto / full_auto (never red-line ops).
   */
  autoApprovedCategories?: Array<
    'web_search' | 'code_run' | 'artifacts_write' | 'package_install'
  >;
  /** Session-scoped category approvals from HITL "approve category this session". */
  sessionCategoryApprovals?: Array<
    'web_search' | 'code_run' | 'artifacts_write' | 'package_install'
  >;
  approvalPolicy?:
    | 'chat_only'
    | 'supervised'
    | 'bounded_auto'
    | 'full_auto';
  /**
   * Resume path: skip registry HITL gate; tool already authorized for this single call.
   * Trust yellow checks inside tools still honor dangerousConfirmed.
   */
  skipHitlGate?: boolean;
  onStream?: (chunk: { type: 'stdout' | 'stderr' | 'status'; data: string; timestamp: number }) => void;
}

export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  execute: (params: Record<string, unknown>, context?: ToolExecutionContext) => Promise<ToolResult>;
  render?: (result: ToolResult) => React.ReactNode;
  capability?: ToolCapability;
  isDangerous?: boolean;
  cachedJsonSchema?: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  artifacts?: Artifact[];
  /** Structured signal: dangerous tool needs user confirm before execute. */
  needsConfirmation?: boolean;
  /**
   * Unified HITL reason:
   * trust_elevation | dangerous_tool | workspace_write | network_access |
   * package_install | publish_external | delete_or_overwrite | human_question
   * (also 'red_line' for hard blocks — not resumable as approve)
   */
  confirmReason?: string;
}

export interface Artifact {
  name: string;
  type: 'file' | 'code' | 'image' | 'data';
  content: string;
  mimeType?: string;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  getByNames(names: string[]): Tool[];
  getAll(): Tool[];
  getAllAsLLMTools(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
  execute(name: string, params: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolResult>;
}

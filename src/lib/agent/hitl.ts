/**
 * Batch 04 — Unified HITL: confirm taxonomy, pause/resume store, audit events.
 * Server persists pause state; client resumes a single tool call (no full re-run).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Message, TaskStep, ToolCall, Artifact } from '@/types/agent';
import type { AutonomyCategory, ApprovalPolicy } from './action-policy';
import { categoryForTool, writeSafetyAudit } from './action-policy';

// ── Confirm reason taxonomy ────────────────────────────────────────────────

export type ConfirmReason =
  | 'trust_elevation'
  | 'dangerous_tool'
  | 'workspace_write'
  | 'network_access'
  | 'package_install'
  | 'publish_external'
  | 'delete_or_overwrite'
  | 'human_question';

export const CONFIRM_REASONS: ConfirmReason[] = [
  'trust_elevation',
  'dangerous_tool',
  'workspace_write',
  'network_access',
  'package_install',
  'publish_external',
  'delete_or_overwrite',
  'human_question',
];

export const CONFIRM_REASON_LABELS: Record<ConfirmReason, string> = {
  trust_elevation: '本机权限提升',
  dangerous_tool: '危险工具',
  workspace_write: '写入工作区',
  network_access: '网络访问',
  package_install: '安装依赖',
  publish_external: '对外发布',
  delete_or_overwrite: '删除或覆盖',
  human_question: '需要你回答',
};

export function isConfirmReason(v: unknown): v is ConfirmReason {
  return (
    typeof v === 'string' &&
    (CONFIRM_REASONS as string[]).includes(v)
  );
}

/**
 * Map tool + params (+ optional yellow safety reason) → unified confirm reason.
 * Trust elevation is handled at the route layer, not here.
 */
export function resolveConfirmReason(
  toolName: string,
  params?: Record<string, unknown>,
  opts?: { yellowReason?: string; isAskHuman?: boolean },
): ConfirmReason {
  if (opts?.isAskHuman || toolName === 'ask_human') {
    return 'human_question';
  }

  if (toolName === 'execution_mode' || toolName === 'trust_elevation') {
    return 'trust_elevation';
  }

  if (toolName === 'web_search') {
    return 'network_access';
  }

  if (toolName === 'file_manager') {
    const action = params?.action;
    if (action === 'delete') return 'delete_or_overwrite';
    if (action === 'write') return 'workspace_write';
    return 'dangerous_tool';
  }

  const yellow = (opts?.yellowReason || '').toLowerCase();
  if (yellow) {
    if (
      /npm\s+publish|unpublish|git\s+push|publish|webhook|upload/.test(yellow)
    ) {
      return 'publish_external';
    }
    if (/install|pip|yarn|pnpm|package/.test(yellow)) {
      return 'package_install';
    }
    if (/delet|remove-item|\brm\b|\bdel\b|overwrite/.test(yellow)) {
      return 'delete_or_overwrite';
    }
    if (/http|curl|wget|network|webrequest/.test(yellow)) {
      return 'network_access';
    }
  }

  // Heuristic from params blob (code_executor yellow paths)
  const blob = JSON.stringify(params || {}).toLowerCase();
  if (/\bnpm\s+(publish|unpublish)|\bgit\s+push/.test(blob)) {
    return 'publish_external';
  }
  if (/\b(npm|pip|yarn|pnpm)\s+(install|add|uninstall)/.test(blob)) {
    return 'package_install';
  }
  if (/\brm\s+|remove-item|\bdel\s+/.test(blob)) {
    return 'delete_or_overwrite';
  }

  const cat = categoryForTool(toolName, params);
  if (cat === 'package_install') return 'package_install';
  if (cat === 'web_search') return 'network_access';
  if (cat === 'artifacts_write') {
    if (params?.action === 'delete') return 'delete_or_overwrite';
    return 'workspace_write';
  }

  return 'dangerous_tool';
}

export function confirmReasonRiskLabel(reason: ConfirmReason): string {
  switch (reason) {
    case 'trust_elevation':
      return '高 — 本机权限';
    case 'dangerous_tool':
      return '中高 — 副作用工具';
    case 'workspace_write':
      return '中 — 写入产物目录';
    case 'network_access':
      return '中 — 出网';
    case 'package_install':
      return '中高 — 安装依赖';
    case 'publish_external':
      return '高 — 对外发布';
    case 'delete_or_overwrite':
      return '高 — 删除/覆盖';
    case 'human_question':
      return '低 — 问答';
    default: {
      const _e: never = reason;
      void _e;
      return '未知';
    }
  }
}

export function describeWhatChanges(
  toolName: string,
  params: Record<string, unknown>,
  reason: ConfirmReason,
): string {
  switch (reason) {
    case 'trust_elevation':
      return '将执行环境从沙箱提升为本机（local/trust），后续工具可访问本机资源。';
    case 'human_question':
      return typeof params.question === 'string'
        ? `Agent 提问：${params.question}`
        : 'Agent 需要你提供信息后才能继续。';
    case 'network_access':
      return toolName === 'web_search'
        ? `将发起网络搜索：${String(params.query || '').slice(0, 120)}`
        : '将访问外部网络。';
    case 'workspace_write':
      return `将写入 artifacts/：${String(params.path || params.file_path || '（路径见参数）')}`;
    case 'delete_or_overwrite':
      return `将删除或覆盖：${String(params.path || params.file_path || '（见参数）')}`;
    case 'package_install':
      return '将安装或卸载软件包（可能修改本机/环境依赖）。';
    case 'publish_external':
      return '将向外部发布或推送（如 npm publish / git push）。';
    case 'dangerous_tool':
      return `将执行工具「${toolName}」，可能产生副作用。`;
    default: {
      const _e: never = reason;
      void _e;
      return `将执行 ${toolName}`;
    }
  }
}

// ── Resume decision ────────────────────────────────────────────────────────

export type HitlDecisionAction =
  | 'approve_once'
  | 'approve_category'
  | 'deny'
  | 'answer'
  | 'cancel';

export interface HitlDecision {
  action: HitlDecisionAction;
  /** User answer for ask_human */
  answerText?: string;
  /** When approve_category — optional override; else derived from tool */
  category?: AutonomyCategory;
}

export function isHitlDecisionAction(v: unknown): v is HitlDecisionAction {
  return (
    v === 'approve_once' ||
    v === 'approve_category' ||
    v === 'deny' ||
    v === 'answer' ||
    v === 'cancel'
  );
}

// ── LLM message shape (serializable pause snapshot) ────────────────────────

export interface SerializedLlmMessage {
  role: string;
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface PendingToolSnapshot {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface CompletedToolSnapshot {
  toolCallId: string;
  toolName: string;
  content: string;
  isHumanEscalation: boolean;
}

export interface HitlPauseState {
  resumeToken: string;
  toolCallId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  confirmReason: ConfirmReason;
  /** Full LLM transcript at pause (includes assistant tool_calls message) */
  llmMessages: SerializedLlmMessage[];
  agentMessages: Message[];
  toolCalls: ToolCall[];
  plan: TaskStep[];
  artifacts: Artifact[];
  iteration: number;
  chatId: string;
  userMessage: string;
  pendingTool: PendingToolSnapshot;
  /** Sibling tool results already finished in the same batch (side-effect free or done) */
  completedToolResults: CompletedToolSnapshot[];
  executionMode: 'sandbox' | 'trust';
  approvalPolicy: ApprovalPolicy;
  autoApprovedCategories: AutonomyCategory[];
  /** Session-only category approvals (approve_category) — not global grant */
  sessionCategoryApprovals: AutonomyCategory[];
  trustConfirmed: boolean;
  /** Per-run: user approved dangerous once for a specific toolCallId set */
  approvedToolCallIds: string[];
  workspacePath: string;
  /** Provider snapshot for resume (no secrets in audit; kept only in memory pause) */
  provider: {
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
    activePlaybookId?: string;
  };
  maxSteps: number;
  createdAt: number;
  expiresAt: number;
}

// ── In-memory + optional disk pause store ──────────────────────────────────

const PAUSE_TTL_MS = 30 * 60 * 1000;
const pauseMap = new Map<string, HitlPauseState>();

function dataDir(): string {
  if (process.env.MINUS_DATA_DIR) {
    return process.env.MINUS_DATA_DIR;
  }
  return path.join(os.homedir(), '.minus', 'data');
}

function pauseDir(): string {
  return path.join(dataDir(), 'hitl-pauses');
}

function pauseFile(token: string): string {
  const safe = token.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return path.join(pauseDir(), `${safe}.json`);
}

export function createResumeToken(): string {
  return `rt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function savePauseState(state: HitlPauseState): void {
  pauseMap.set(state.resumeToken, state);
  try {
    fs.mkdirSync(pauseDir(), { recursive: true });
    // Strip apiKey from disk snapshot for safety — memory keeps full state
    const disk = {
      ...state,
      provider: {
        ...state.provider,
        apiKey: state.provider.apiKey ? '[redacted]' : '',
      },
    };
    fs.writeFileSync(pauseFile(state.resumeToken), JSON.stringify(disk), 'utf-8');
  } catch {
    // memory is enough for same-process resume
  }
}

export function loadPauseState(token: string): HitlPauseState | null {
  const mem = pauseMap.get(token);
  if (mem) {
    if (Date.now() > mem.expiresAt) {
      deletePauseState(token);
      return null;
    }
    return mem;
  }
  // Disk restore cannot recover apiKey — only useful if process still holds memory
  try {
    const p = pauseFile(token);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as HitlPauseState;
    if (Date.now() > raw.expiresAt) {
      deletePauseState(token);
      return null;
    }
    // Without in-memory apiKey, resume cannot call LLM — treat as missing
    if (!raw.provider?.apiKey || raw.provider.apiKey === '[redacted]') {
      return null;
    }
    pauseMap.set(token, raw);
    return raw;
  } catch {
    return null;
  }
}

export function deletePauseState(token: string): void {
  pauseMap.delete(token);
  try {
    const p = pauseFile(token);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

export function buildPauseState(input: Omit<HitlPauseState, 'resumeToken' | 'createdAt' | 'expiresAt'> & {
  resumeToken?: string;
}): HitlPauseState {
  const now = Date.now();
  return {
    ...input,
    resumeToken: input.resumeToken || createResumeToken(),
    createdAt: now,
    expiresAt: now + PAUSE_TTL_MS,
  };
}

// ── HITL audit (writes into safety-audit.jsonl via writeSafetyAudit) ───────

export type HitlAuditKind =
  | 'hitl_confirm'
  | 'hitl_deny'
  | 'hitl_resume'
  | 'hitl_cancel'
  | 'hitl_pause'
  | 'hitl_answer';

export function writeHitlAudit(entry: {
  kind: HitlAuditKind;
  detail: string;
  toolName?: string;
  toolCallId?: string;
  confirmReason?: ConfirmReason;
  resumeToken?: string;
  approvalPolicy?: ApprovalPolicy;
  categories?: AutonomyCategory[];
}): void {
  writeSafetyAudit({
    kind: entry.kind,
    detail: [
      entry.detail,
      entry.toolName ? `tool=${entry.toolName}` : '',
      entry.toolCallId ? `tc=${entry.toolCallId}` : '',
      entry.confirmReason ? `reason=${entry.confirmReason}` : '',
      entry.resumeToken ? `token=${entry.resumeToken.slice(0, 16)}…` : '',
    ]
      .filter(Boolean)
      .join(' | '),
    approvalPolicy: entry.approvalPolicy,
    categories: entry.categories,
  });
}

/**
 * Whether this tool invocation requires interactive HITL before execute
 * (beyond global isDangerous + mayAutoApprove).
 */
export function toolRequiresHitlGate(
  toolName: string,
  params?: Record<string, unknown>,
): boolean {
  if (toolName === 'ask_human') return true;
  if (toolName === 'web_search') return true;
  if (toolName === 'code_executor' || toolName === 'data_analyzer') return true;
  if (toolName === 'file_manager') {
    const action = params?.action;
    return action === 'write' || action === 'delete';
  }
  return false;
}

export function denyToolResultContent(toolName: string, reason: ConfirmReason): string {
  return (
    `USER_DENIED: 用户拒绝了工具「${toolName}」（原因类型：${CONFIRM_REASON_LABELS[reason]}）。` +
    ` 未执行任何副作用。请提供不涉及该操作的替代方案，或询问用户是否改用只读/沙箱路径。`
  );
}

export function answerToolResultContent(answer: string, question?: string): string {
  return JSON.stringify({
    type: 'human_answer',
    question: question || '',
    answer,
    timestamp: Date.now(),
  });
}

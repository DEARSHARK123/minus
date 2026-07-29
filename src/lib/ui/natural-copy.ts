/**
 * UX07 — Natural Chinese copy helpers for primary UI.
 * Internal audit/code identifiers may still use English; primary surfaces must not.
 */

/** Forbidden terms that must not appear as primary user-visible copy. */
export const UX07_FORBIDDEN_PRIMARY_TERMS = [
  'IntentJudge',
  'OutlineAgent',
  'ContextPack',
  'LearnerContextPack',
  'HITL',
  'propose ≠ commit',
  'propose≠commit',
  'propose != commit',
  'sandbox',
  'Loading skills',
  'no relevant memory',
  'Agent is thinking',
  'Start Session',
  'AUTONOMOUS',
  'Confirmed',
  'Pending',
  'session repository',
  '会话仓库',
  'multi-agent',
  '多 Agent',
  '多Agent',
  'LLM Desktop',
  'Local Trust Mode',
  'Sandbox Mode',
  'Agent Mode',
  'Task Steps',
  '工具调用确认',
] as const;

/**
 * Paths / patterns allowed to contain internal terms (audit, types, advanced).
 * Used by scan tests — not a runtime gate.
 */
export const UX07_ALLOWED_INTERNAL_PATH_FRAGMENTS = [
  '/__tests__/',
  'safety-audit',
  'hitl.ts',
  'action-policy',
  'context-pack',
  'experience-plan',
  'skill-router',
  'types/',
  'settings-modal', // Settings audit/advanced may mention HITL in tech detail
] as const;

export type HitlActionKind =
  | 'command'
  | 'file'
  | 'network'
  | 'package'
  | 'delete'
  | 'publish'
  | 'trust'
  | 'question'
  | 'generic';

export type PendingConfirmLike = {
  toolName?: string;
  confirmReason?: string;
  reasonLabel?: string;
  riskLabel?: string;
  whatChanges?: string;
  content?: string;
  parameters?: Record<string, unknown>;
};

/** Map tool + reason → natural action kind for titles. */
export function resolveHitlActionKind(pending: PendingConfirmLike): HitlActionKind {
  const reason = (pending.confirmReason || '').toLowerCase();
  const tool = (pending.toolName || '').toLowerCase();

  if (reason === 'human_question' || tool === 'ask_human') return 'question';
  if (reason === 'trust_elevation' || tool === 'execution_mode' || tool === 'trust_elevation') {
    return 'trust';
  }
  if (reason === 'network_access' || tool === 'web_search') return 'network';
  if (reason === 'package_install') return 'package';
  if (reason === 'delete_or_overwrite') return 'delete';
  if (reason === 'publish_external') return 'publish';
  if (
    reason === 'workspace_write' ||
    tool === 'file_manager' ||
    tool.includes('file') ||
    tool.includes('write')
  ) {
    return 'file';
  }
  if (
    tool.includes('shell') ||
    tool.includes('exec') ||
    tool.includes('code') ||
    tool === 'code_executor' ||
    reason === 'dangerous_tool'
  ) {
    return 'command';
  }
  return 'generic';
}

/** Primary confirm title — contract §3.1. */
export function hitlConfirmTitle(pending: PendingConfirmLike): string {
  const kind = resolveHitlActionKind(pending);
  switch (kind) {
    case 'question':
      return '需要你回答';
    case 'trust':
      return 'Minus 想访问本机权限';
    case 'network':
      return 'Minus 想访问网络';
    case 'file':
      return 'Minus 想修改文件';
    case 'package':
      return 'Minus 想安装依赖';
    case 'delete':
      return 'Minus 想删除或覆盖文件';
    case 'publish':
      return 'Minus 想对外发布';
    case 'command':
      return 'Minus 想运行命令';
    default:
      return 'Minus 想执行操作';
  }
}

/** One-line natural description of what will happen. */
export function hitlConfirmSummary(pending: PendingConfirmLike): string {
  const kind = resolveHitlActionKind(pending);
  const what =
    (pending.whatChanges || pending.content || '').trim() ||
    (typeof pending.parameters?.command === 'string'
      ? String(pending.parameters.command)
      : typeof pending.parameters?.path === 'string'
        ? String(pending.parameters.path)
        : typeof pending.parameters?.query === 'string'
          ? String(pending.parameters.query)
          : '');

  const truncated =
    what.length > 160 ? `${what.slice(0, 159)}…` : what;

  if (kind === 'question') {
    const q =
      typeof pending.parameters?.question === 'string'
        ? pending.parameters.question
        : truncated;
    return q || '请回答下面的问题后继续。';
  }

  if (kind === 'trust') {
    return truncated || '请求使用本机更高权限；不会自动批准全部危险操作。';
  }

  if (truncated) return truncated;

  switch (kind) {
    case 'network':
      return '将访问网络以检索或获取信息。';
    case 'file':
      return '将读取或修改工作区内的文件。';
    case 'package':
      return '将安装软件依赖。';
    case 'delete':
      return '将删除或覆盖已有文件，请确认路径无误。';
    case 'publish':
      return '将向外部发布内容，请确认目标安全。';
    case 'command':
      return '将在本机运行一条命令。';
    default:
      return '将执行一项需要你授权的操作。';
  }
}

export const HITL_UI_BUTTONS = {
  allowOnce: '允许一次',
  rememberSession: '本次会话记住',
  deny: '不允许',
  submitAnswer: '提交回答并继续',
  viewDetails: '查看详情',
  hideDetails: '收起详情',
} as const;

/** Chat surface only: 需要确认 / 已授权 (full tiers live in Settings). */
export type ChatSafetySurfaceState = 'needs_confirm' | 'authorized';

export function chatSafetySurfaceState(
  approvalPolicy: string | undefined | null,
  opts?: { waitingConfirm?: boolean },
): ChatSafetySurfaceState {
  if (opts?.waitingConfirm) return 'needs_confirm';
  if (approvalPolicy === 'bounded_auto' || approvalPolicy === 'full_auto') {
    return 'authorized';
  }
  return 'needs_confirm';
}

export function chatSafetySurfaceLabel(
  approvalPolicy: string | undefined | null,
  opts?: { waitingConfirm?: boolean },
): string {
  return chatSafetySurfaceState(approvalPolicy, opts) === 'authorized'
    ? '已授权'
    : '需要确认';
}

/** Loading / progress strings — never Agent is thinking / Loading skills. */
export const LOADING_COPY = {
  processing: '正在处理',
  preparingAnswer: '正在整理回答…',
  preparingOutline: '正在准备大纲…',
  preparingCourse: '正在准备课程…',
  generatingDiagram: '正在生成图示…',
  processingFile: '正在处理文件…',
  analyzing: '正在分析…',
  working: '处理中…',
  done: '已完成',
  error: '出了点问题',
} as const;

/** Detect forbidden primary-UI copy (case-insensitive for ASCII terms). */
export function hasForbiddenPrimaryCopy(text: string): boolean {
  if (!text) return false;
  for (const term of UX07_FORBIDDEN_PRIMARY_TERMS) {
    if (term.toLowerCase() !== term) {
      // Mixed / non-ASCII: exact substring
      if (text.includes(term)) return true;
    } else {
      if (text.toLowerCase().includes(term.toLowerCase())) return true;
    }
  }
  // pass/fail/partial as standalone English mastery labels
  if (/\b(pass|fail|partial)\b/i.test(text) && !/password|passphrase|bypass/i.test(text)) {
    // Allow technical code fences context is hard; treat bare enum labels as leak
    if (/\b(pass|fail|partial)\b/.test(text) && !/掌握|再练|部分/.test(text)) {
      // Only flag if looks like a status badge not Chinese sentence
      if (/^(pass|fail|partial)$/i.test(text.trim())) return true;
    }
  }
  return false;
}

/** Soften residual engineer labels in free text (defensive). */
export function sanitizePrimaryCopy(text: string): string {
  return text
    .replace(/Agent is thinking/gi, LOADING_COPY.preparingAnswer)
    .replace(/Loading skills/gi, LOADING_COPY.preparingAnswer)
    .replace(/no relevant memory/gi, '')
    .replace(/Start Session/gi, '开始学习')
    .replace(/\bAUTONOMOUS\b/g, '本机完全自主')
    .replace(/\bConfirmed\b/g, '已确认')
    .replace(/\bPending\b/g, '待确认')
    .replace(/工具调用确认/g, '需要你确认')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

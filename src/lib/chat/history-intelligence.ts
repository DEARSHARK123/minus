/**
 * B07 / UX06 — History intelligence (deterministic heuristics).
 * Titles = user goals; short outcomes + unfinished items.
 * Hide message counts / session IDs / repetitive safety essays from primary UI.
 * Resume must never auto-replay tools — only restore conversation/session context.
 */

export type HistoryItemKind = 'chat' | 'learning_session';

export interface HistoryDecision {
  label: string;
  detail?: string;
}

export interface HistoryIncompleteItem {
  label: string;
  /** Soft hint only — never a tool call payload. */
  resumeHint?: string;
}

export interface HistoryIntelligence {
  kind: HistoryItemKind;
  id: string;
  /** Display title = user goal / topic (not session id). */
  title: string;
  /** One-line natural outcome — no message counts as primary. */
  summary: string;
  /** Explicit decisions / outcomes inferred from content. */
  decisions: HistoryDecision[];
  /** Open / incomplete items. */
  incomplete: HistoryIncompleteItem[];
  /**
   * Safe resume contract:
   * - restore context only (messages / session id)
   * - never auto-run tools or agent loops
   */
  safeResume: {
    mode: 'context_only';
    autoReplayTools: false;
    target: 'home' | 'session';
    conversationId?: string;
    sessionId?: string;
    courseId?: string;
  };
  /** Primary UI must not show these (tests / guards). */
  hideFromPrimary: {
    messageCount: true;
    sessionId: true;
    repetitiveSafetyEssay: true;
  };
}

export interface ChatMessageLike {
  role: string;
  content: string;
}

export interface ConversationLike {
  id: string;
  title?: string;
  messages: ChatMessageLike[];
  updatedAt?: Date | string;
}

export interface LearningSessionLike {
  id: string;
  courseId: string;
  taskId?: string;
  notes?: string;
  startedAt: string;
  endedAt?: string;
  sections?: Array<{
    id: string;
    status?: string;
    phase?: string;
    title?: string;
    assessment?: { result?: string; notes?: string };
    masteryLevel?: string;
  }>;
  currentSectionId?: string | null;
}

export interface SessionContext {
  courseTitle?: string;
  taskTitle?: string;
}

function firstLine(text: string, max = 80): string {
  const line = text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return '';
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return '';
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Soft decision labels — natural Chinese, not safety essays. */
const DECISION_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /已确认|确认学习|开始会话|Start Session|已创建课程/i, label: '已开始相关学习' },
  { re: /已拒绝|取消|不开始/i, label: '已取消' },
  { re: /等待你的确认|待确认|请确认|是否开始/i, label: '曾等待你的确认' },
];

/**
 * Heuristic title for a chat thread when store title is generic.
 * Prefer first user goal line — never conversation id.
 */
export function deriveChatTitle(messages: ChatMessageLike[], existingTitle?: string): string {
  const existing = (existingTitle || '').trim();
  if (existing && existing !== '新对话' && existing !== '未命名对话') {
    return existing;
  }
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
  if (firstUser) {
    return firstLine(firstUser.content, 40) || '未命名对话';
  }
  return existing || '未命名对话';
}

/**
 * Short outcome line — goals and last turn, not「N 条消息」.
 */
export function deriveChatSummary(messages: ChatMessageLike[]): string {
  const userMsgs = messages.filter((m) => m.role === 'user' && m.content.trim());
  const asstMsgs = messages.filter((m) => m.role === 'assistant' && m.content.trim());

  if (userMsgs.length === 0) {
    return '还没有内容';
  }

  const lastAsst = asstMsgs[asstMsgs.length - 1]?.content || '';
  const lastUser = userMsgs[userMsgs.length - 1]?.content || '';

  if (/等待你的确认|待确认|请确认|是否开始/i.test(lastAsst)) {
    return '上次停在待你确认';
  }
  if (/^⚠️|失败|错误|无法/i.test(lastAsst.trim()) || /HTTP Error|Error/i.test(lastAsst)) {
    return '上次可能未完成';
  }
  if (asstMsgs.length === 0) {
    return `你提到：${firstLine(lastUser, 48)}`;
  }
  if (userMsgs.length > asstMsgs.length) {
    return '有一条回复可能还没写完';
  }

  const outcome = firstLine(lastAsst, 56);
  if (outcome) return outcome;
  return `最近：${firstLine(lastUser, 48)}`;
}

export function buildChatIntelligence(conv: ConversationLike): HistoryIntelligence {
  const messages = conv.messages || [];
  const title = deriveChatTitle(messages, conv.title);
  const summary = deriveChatSummary(messages);

  const decisions: HistoryDecision[] = [];
  const joined = messages.map((m) => m.content).join('\n');
  for (const p of DECISION_PATTERNS) {
    if (p.re.test(joined)) {
      decisions.push({ label: p.label });
    }
  }

  const incomplete: HistoryIncompleteItem[] = [];
  const userMsgs = messages.filter((m) => m.role === 'user' && m.content.trim());
  const asstMsgs = messages.filter((m) => m.role === 'assistant' && m.content.trim());
  const lastAsst = asstMsgs[asstMsgs.length - 1]?.content || '';

  if (/等待你的确认|待确认|请确认|是否开始/i.test(lastAsst)) {
    incomplete.push({
      label: '待你确认后继续',
      resumeHint: '打开对话后由你决定',
    });
  }
  if (/^⚠️|失败|错误|无法/i.test(lastAsst.trim()) || /HTTP Error|Error/i.test(lastAsst)) {
    incomplete.push({
      label: '上次未完成',
      resumeHint: '可重新提问',
    });
  }
  if (userMsgs.length > 0 && asstMsgs.length < userMsgs.length) {
    incomplete.push({
      label: '回复可能未写完',
      resumeHint: '打开后可继续发送',
    });
  }

  return {
    kind: 'chat',
    id: conv.id,
    title,
    summary,
    decisions,
    incomplete,
    safeResume: {
      mode: 'context_only',
      autoReplayTools: false,
      target: 'home',
      conversationId: conv.id,
    },
    hideFromPrimary: {
      messageCount: true,
      sessionId: true,
      repetitiveSafetyEssay: true,
    },
  };
}

function masteryNatural(result?: string): string | null {
  if (result === 'pass') return '掌握得不错';
  if (result === 'partial') return '部分掌握';
  if (result === 'fail') return '再练一下';
  return null;
}

export function buildSessionIntelligence(
  session: LearningSessionLike,
  ctx: SessionContext = {},
): HistoryIntelligence {
  const course = ctx.courseTitle || '课程';
  const task = ctx.taskTitle;
  // Title = user goal (task) first; never session.id
  const title = task?.trim()
    ? task.trim()
    : session.notes?.trim()
      ? truncate(session.notes, 40)
      : course;

  const sections = session.sections || [];
  const openSections = sections.filter((s) => s.status !== 'done');
  const doneSections = sections.filter((s) => s.status === 'done');
  const fails = sections.filter(
    (s) => s.assessment?.result === 'fail' || s.assessment?.result === 'partial',
  );

  const summaryParts: string[] = [];
  if (session.endedAt) {
    summaryParts.push('已结束');
  } else {
    summaryParts.push('未完成');
  }
  if (sections.length > 0) {
    summaryParts.push(`已完成 ${doneSections.length}/${sections.length} 节`);
  } else if (course && course !== title) {
    summaryParts.push(course);
  }
  if (session.notes?.trim() && !task) {
    summaryParts.push(truncate(session.notes, 40));
  }

  const decisions: HistoryDecision[] = [];
  for (const s of sections) {
    const natural = masteryNatural(s.assessment?.result);
    if (natural) {
      decisions.push({
        label: `${natural}：${s.title || s.id}`,
      });
    }
  }

  const incomplete: HistoryIncompleteItem[] = [];
  if (!session.endedAt) {
    incomplete.push({
      label: '还可以继续',
      resumeHint: '仅恢复进度，不会自动执行操作',
    });
  }
  for (const s of openSections) {
    incomplete.push({
      label: `未完成：${s.title || s.phase || '小节'}`,
      resumeHint: '进入后由你继续',
    });
  }
  for (const s of fails) {
    if (s.status !== 'done') {
      incomplete.push({
        label: `待补强：${s.title || s.id}`,
      });
    }
  }

  return {
    kind: 'learning_session',
    id: session.id,
    title,
    summary: summaryParts.join(' · '),
    decisions: decisions.slice(0, 8),
    incomplete: incomplete.slice(0, 8),
    safeResume: {
      mode: 'context_only',
      autoReplayTools: false,
      target: 'session',
      sessionId: session.id,
      courseId: session.courseId,
    },
    hideFromPrimary: {
      messageCount: true,
      sessionId: true,
      repetitiveSafetyEssay: true,
    },
  };
}

/**
 * Guard for UI/store callers: resume payload must not request tool replay.
 */
export function assertSafeResume(intel: HistoryIntelligence): void {
  if (intel.safeResume.autoReplayTools !== false) {
    throw new Error('History resume must not auto-replay tools');
  }
  if (intel.safeResume.mode !== 'context_only') {
    throw new Error('History resume mode must be context_only');
  }
}

/**
 * Build a safe resume payload for UI navigation — never includes tool replay.
 */
export function buildSafeResumePayload(intel: HistoryIntelligence): {
  mode: 'context_only';
  autoReplayTools: false;
  conversationId?: string;
  sessionId?: string;
  courseId?: string;
  target: 'home' | 'session';
} {
  assertSafeResume(intel);
  return {
    mode: 'context_only',
    autoReplayTools: false,
    target: intel.safeResume.target,
    conversationId: intel.safeResume.conversationId,
    sessionId: intel.safeResume.sessionId,
    courseId: intel.safeResume.courseId,
  };
}

/** True when a primary UI string looks like forbidden history chrome. */
export function isForbiddenHistoryPrimaryCopy(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/Session\s*ID/i.test(t)) return true;
  if (/\d+\s*条(用户)?消息/.test(t)) return true;
  if (/消息计数|message count/i.test(t)) return true;
  if (/安全恢复：仅恢复对话上下文，不会自动重放工具/.test(t)) return true;
  if (/恢复模式：仅上下文\s*·\s*不重放工具/.test(t)) return true;
  if (/不自动重跑工具或教学环|不自动重放工具或 Desktop/.test(t)) return true;
  return false;
}

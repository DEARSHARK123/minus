/**
 * UX03 — Natural Home suggestion chips.
 * New users: ≤3 neutral entry chips (no fake personalization).
 * Contextual users: ≤1 aggregated「继续学习」(+ optional neutral fill, still capped).
 * Prompts are natural short phrases — no system policy / sandbox jargon.
 */

import { selectHomeContinuation } from './continuation-selector';
import type { TaskDedupeInput } from './task-dedupe';

export type HomeSuggestionSource =
  | 'capability'
  | 'recent_task'
  | 'recent_chat'
  | 'context'
  | 'continue';

export type HomeSuggestionClickMode = 'send' | 'edit';

export interface HomeSuggestion {
  id: string;
  category: string;
  title: string;
  /** Message text used on send / edit fill. */
  prompt: string;
  source: HomeSuggestionSource;
  /** Default primary click behavior. */
  defaultMode: HomeSuggestionClickMode;
}

export interface HomeSuggestionInput {
  /**
   * @deprecated Prefer `recentTasks` for dedupe. Titles-only still supported.
   */
  recentTaskTitles?: string[];
  /** Full tasks for dedupe + single continue entry (preferred). */
  recentTasks?: TaskDedupeInput[];
  /** Conversation titles with real content. */
  recentConversationTitles?: string[];
  /** LearnerContextPack.summaryLine when non-empty. */
  contextSummaryLine?: string;
  /** True when pack has usable memory (not empty vacuum). */
  hasContext?: boolean;
  /** Max chips. New user hard-cap 3; contextual hard-cap 1 continue + neutrals. */
  max?: number;
}

/** Neutral entry chips — short natural Chinese, no policy dump. */
export const NEUTRAL_CAPABILITY_CHIPS: readonly Omit<HomeSuggestion, 'id'>[] = [
  {
    category: '探索',
    title: '解释一个概念',
    prompt: '请用简洁中文解释：什么是闭包？',
    source: 'capability',
    defaultMode: 'edit',
  },
  {
    category: '对话',
    title: '随便聊聊',
    prompt: '你好，我想随便聊聊。',
    source: 'capability',
    defaultMode: 'send',
  },
  {
    category: '学习',
    title: '帮我理清一个问题',
    prompt: '我有一个问题想理清，请先听我说完再给建议。',
    source: 'capability',
    defaultMode: 'edit',
  },
] as const;

const NEW_USER_MAX = 3;
const CONTEXTUAL_MAX = 4;

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function hasPersonalSignals(input: HomeSuggestionInput): boolean {
  if (input.hasContext && (input.contextSummaryLine || '').trim()) return true;
  if ((input.recentTasks || []).some((t) => (t.title || '').trim())) return true;
  if ((input.recentTaskTitles || []).some((t) => t.trim())) return true;
  if (
    (input.recentConversationTitles || []).some(
      (t) => t.trim() && t.trim() !== '新对话',
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Build chips for Home empty state.
 * - New / empty users → ≤3 neutral capabilities only
 * - Contextual → ≤1 aggregated「继续学习」; do not stack duplicate task chips
 */
export function buildHomeSuggestions(input: HomeSuggestionInput = {}): HomeSuggestion[] {
  const neutralOnly = !hasPersonalSignals(input);
  const max = input.max ?? (neutralOnly ? NEW_USER_MAX : CONTEXTUAL_MAX);
  const out: HomeSuggestion[] = [];
  const seen = new Set<string>();

  const push = (s: Omit<HomeSuggestion, 'id'> & { id?: string }) => {
    const key = `${s.source}:${s.prompt.trim().toLowerCase()}`;
    if (!s.prompt.trim() || seen.has(key)) return;
    if (out.length >= max) return;
    seen.add(key);
    out.push({
      id: s.id || `sug_${s.source}_${out.length}`,
      category: s.category,
      title: s.title,
      prompt: s.prompt,
      source: s.source,
      defaultMode: s.defaultMode,
    });
  };

  if (neutralOnly) {
    for (const chip of NEUTRAL_CAPABILITY_CHIPS) {
      if (out.length >= NEW_USER_MAX) break;
      push({ ...chip });
    }
    return out.slice(0, NEW_USER_MAX);
  }

  // Contextual: at most one aggregated continue-learning entry
  const tasks: TaskDedupeInput[] =
    input.recentTasks && input.recentTasks.length > 0
      ? input.recentTasks
      : (input.recentTaskTitles || [])
          .filter((t) => t.trim())
          .map((title, i) => ({
            id: `title_${i}_${title}`,
            title,
            status: 'confirmed' as const,
            updatedAt: new Date(Date.now() - i * 1000).toISOString(),
          }));

  const cont = selectHomeContinuation(tasks);
  if (cont) {
    push({
      id: 'sug_continue',
      category: '继续',
      title: cont.label,
      prompt: cont.prompt,
      source: 'continue',
      defaultMode: 'send',
    });
  } else if (input.hasContext && (input.contextSummaryLine || '').trim()) {
    // Context without open tasks — single soft continue, not a policy dump
    const summary = truncate(input.contextSummaryLine!, 48);
    push({
      id: 'sug_context',
      category: '继续',
      title: '继续上次的学习',
      prompt: `结合我之前的学习情况（${summary}），请用简洁中文帮我接着推进。`,
      source: 'context',
      defaultMode: 'edit',
    });
  } else {
    // Recent chat as soft continue (still only one personal chip)
    const chatTitle = (input.recentConversationTitles || []).find(
      (t) => t.trim() && t.trim() !== '新对话',
    );
    if (chatTitle) {
      push({
        id: 'sug_recent_chat',
        category: '继续',
        title: `接着聊：${truncate(chatTitle, 24)}`,
        prompt: `关于「${chatTitle.trim()}」，请用简洁中文继续补充要点。`,
        source: 'recent_chat',
        defaultMode: 'edit',
      });
    }
  }

  // Fill remaining slots with neutrals (never exceed max; personal already ≤1)
  for (const chip of NEUTRAL_CAPABILITY_CHIPS) {
    if (out.length >= max) break;
    push({ ...chip });
  }

  return out.slice(0, max);
}

/** True when user has no personalization signals — UI must not claim “为你推荐”. */
export function isNeutralOnlyHome(input: HomeSuggestionInput): boolean {
  return !hasPersonalSignals(input);
}

/** Count of personal (non-capability) chips — should be ≤1 when contextual. */
export function countPersonalHomeSuggestions(chips: HomeSuggestion[]): number {
  return chips.filter((c) => c.source !== 'capability').length;
}

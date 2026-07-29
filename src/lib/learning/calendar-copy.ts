/**
 * UX05 — Natural Chinese copy for Calendar surfaces.
 * Forbidden internal terms must never appear in primary UI strings.
 */

import type { CalendarBrief } from './calendar-companion';
import type { PlanScheduleDiff, TaskStatus } from '@/types/learning';

/** Terms that must not appear in calendar primary UI. */
export const CALENDAR_FORBIDDEN_TERMS = [
  'Agent 简报',
  '规则简报',
  '规则回退',
  'ContextPack',
  'ContextPack(calendar)',
  'propose ≠ commit',
  'propose≠commit',
  'propose != commit',
  'sandbox',
  'pending_suggestion',
  'internalReason',
  'LearnerContextPack',
] as const;

export function taskStatusLabelZh(status: TaskStatus | string): string {
  switch (status) {
    case 'pending_suggestion':
    case 'pending':
      return '待确认';
    case 'confirmed':
      return '已确认';
    case 'scheduled':
      return '已安排';
    case 'in_progress':
      return '进行中';
    case 'done':
    case 'completed':
      return '已完成';
    default:
      return '进行中';
  }
}

/** Header chips: 已确认 N · 待确认 M */
export function confirmationCountLabel(confirmed: number, pending: number): string {
  return `已确认 ${confirmed} · 待确认 ${pending}`;
}

export function formatTimeHm(iso?: string): string {
  if (!iso) return '未安排';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未安排';
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${m}/${day} ${hh}:${mm}`;
}

/** Natural before/after slot without raw status enums. */
export function formatProposalSlotNatural(
  start?: string,
  end?: string,
  status?: TaskStatus | string,
): string {
  if (!start && !end) {
    const st = status ? taskStatusLabelZh(status) : '未安排';
    return st === '未安排' ? '未安排' : `未安排（${st}）`;
  }
  const a = formatTimeHm(start);
  const b = end ? formatTimeHm(end) : '';
  if (b && b !== '未安排') return `${a} – ${b}`;
  return a;
}

export function formatDiffPreviewLine(diff: PlanScheduleDiff): {
  title: string;
  before: string;
  after: string;
} {
  return {
    title: diff.title,
    before: `调整前：${formatProposalSlotNatural(diff.beforeStart, diff.beforeEnd, diff.beforeStatus)}`,
    after: `调整后：${formatProposalSlotNatural(diff.afterStart, diff.afterEnd, diff.afterStatus)}`,
  };
}

/**
 * Companion pane copy from internal brief — strip engineering labels.
 * Does not render agentGenerated / contextPackLoaded flags.
 */
export function naturalCompanionSummary(brief: CalendarBrief | null | undefined): {
  summary: string;
  loadLine: string;
  hints: string[];
} {
  if (!brief) {
    return { summary: '', loadLine: '', hints: [] };
  }

  const cleaned = brief.summary
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const lower = line.toLowerCase();
      if (lower.includes('contextpack')) return false;
      if (line.includes('学习者上下文：暂无可用记忆')) return false;
      if (line.includes('学习者上下文：') && line.includes('ContextPack')) return false;
      // Soften preference line without exposing pack machinery
      return true;
    })
    .map((line) => {
      if (line.startsWith('学习者上下文：')) {
        const rest = line.replace(/^学习者上下文：/, '').trim();
        if (!rest || rest.includes('暂无')) return '';
        return `根据你的偏好：${rest}`;
      }
      return line;
    })
    .filter(Boolean)
    .join('\n');

  return {
    summary: cleaned || '今天可以按已确认的安排推进，或从待确认里挑几项。',
    loadLine: brief.loadExplanation.replace(/ContextPack/gi, '').trim(),
    hints: brief.conflictHints.map((h) => h.message),
  };
}

export function hasCalendarJargonLeak(text: string): boolean {
  const t = text || '';
  return CALENDAR_FORBIDDEN_TERMS.some((term) => {
    if (term.toLowerCase() !== term) {
      return t.includes(term);
    }
    return t.toLowerCase().includes(term.toLowerCase());
  });
}

export const CALENDAR_UI = {
  title: '学习日历',
  companionTitle: '学习伴侣',
  todayTodos: '今日待办',
  pendingDecisions: '待确认',
  confirmed: '已确认',
  pending: '待确认',
  month: '月',
  week: '周',
  today: '今天',
  prev: '上一页',
  next: '下一页',
  proposeDraft: '查看安排草案',
  accept: '应用这个安排',
  edit: '再改一下',
  discard: '先不应用',
  draftTitle: '安排预览（尚未保存）',
  draftHint: '确认前不会写入日历；你可以改时间后再应用。',
  emptyDay: '这一天还没有安排',
  emptyMonth: '这个月还没有已确认的学习安排。确认任务后会出现在这里。',
  dayDetail: '当日详情',
  collapseCompanion: '收起伴侣',
  expandCompanion: '学习伴侣',
  saveTimeEdit: '更新时间',
  overflowPrefix: '还有',
} as const;

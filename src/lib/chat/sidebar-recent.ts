/**
 * UX06 — Sidebar recent lists: max 5 conversations + max 5 deep sessions,
 * plus「查看全部」; dedupe courses/tasks so one course is not listed thrice.
 */

import { conversationHasContent, type ConversationLike } from '@/lib/navigation/draft-conversation';

export const SIDEBAR_RECENT_CAP = 5;

export type SidebarSessionLike = {
  id: string;
  courseId: string;
  taskId?: string;
  notes?: string;
  startedAt: string;
  endedAt?: string;
};

export type SidebarTaskLike = {
  id: string;
  title: string;
  courseId?: string | null;
};

export type SidebarCourseLike = {
  id: string;
  title: string;
  archivedAt?: string | null;
};

/**
 * Batch-06: sidebar「学习课程」lists real Course entities only.
 * Never use task/session names as the course title.
 * Archived courses are excluded from the primary list.
 * Caller should pre-sort (e.g. by updatedAt desc); this preserves order.
 */
export function capSidebarCourses<T extends SidebarCourseLike>(
  courses: T[],
  cap = SIDEBAR_RECENT_CAP,
): { items: T[]; total: number; hasMore: boolean } {
  const filtered = courses.filter((c) => !c.archivedAt);
  const total = filtered.length;
  const limit = Math.max(0, cap);
  return {
    items: filtered.slice(0, limit),
    total,
    hasMore: total > limit,
  };
}

/** Display label for a course row — course.title only, never task/session. */
export function courseSidebarLabel(
  course: SidebarCourseLike | null | undefined,
  fallback = '未命名课程',
): string {
  const t = (course?.title || '').trim();
  if (!t) return fallback;
  if (/^(course|session|task|conv)[_-]/i.test(t) && t.length > 12) {
    return fallback;
  }
  return t;
}

export type SidebarSessionRow = {
  sessionId: string;
  courseId: string;
  taskId?: string;
  /** Natural label (task > course > notes) — never raw session id as title. */
  label: string;
  /** Soft dedupe key (one row per course+task or course). */
  dedupeKey: string;
  startedAt: string;
};

function toTime(v?: Date | string | number): number {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Cap recent conversations (contentful only). Caller adds「查看全部」when
 * total contentful count exceeds cap.
 */
export function capSidebarConversations<T extends ConversationLike>(
  conversations: T[],
  cap = SIDEBAR_RECENT_CAP,
): { items: T[]; total: number; hasMore: boolean } {
  const contentful = [...conversations]
    .filter(conversationHasContent)
    .sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt));
  const total = contentful.length;
  const limit = Math.max(0, cap);
  return {
    items: contentful.slice(0, limit),
    total,
    hasMore: total > limit,
  };
}

function sessionSoftKey(s: SidebarSessionLike): string {
  const course = (s.courseId || '').trim();
  const task = (s.taskId || '').trim();
  if (course && task) return `ct:${course}:${task}`;
  if (course) return `c:${course}`;
  return `s:${s.id}`;
}

export function sessionDisplayLabel(
  session: SidebarSessionLike,
  opts?: {
    courses?: SidebarCourseLike[];
    tasks?: SidebarTaskLike[];
  },
): string {
  const task = session.taskId
    ? opts?.tasks?.find((t) => t.id === session.taskId)?.title
    : undefined;
  if (task?.trim()) return task.trim();
  const course = opts?.courses?.find((c) => c.id === session.courseId)?.title;
  if (course?.trim()) return course.trim();
  if (session.notes?.trim()) {
    const n = session.notes.trim();
    return n.length <= 28 ? n : `${n.slice(0, 27)}…`;
  }
  return '学习会话';
}

/**
 * Dedupe by course+task (or course), newest session wins, then cap at 5.
 */
export function capAndDedupeSidebarSessions(
  sessions: SidebarSessionLike[],
  opts?: {
    courses?: SidebarCourseLike[];
    tasks?: SidebarTaskLike[];
    cap?: number;
  },
): { items: SidebarSessionRow[]; totalUnique: number; hasMore: boolean } {
  const cap = opts?.cap ?? SIDEBAR_RECENT_CAP;
  const sorted = [...sessions].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );

  const seen = new Set<string>();
  const unique: SidebarSessionRow[] = [];
  for (const s of sorted) {
    const key = sessionSoftKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      sessionId: s.id,
      courseId: s.courseId,
      taskId: s.taskId,
      label: sessionDisplayLabel(s, opts),
      dedupeKey: key,
      startedAt: s.startedAt,
    });
  }

  const limit = Math.max(0, cap);
  return {
    items: unique.slice(0, limit),
    totalUnique: unique.length,
    hasMore: unique.length > limit,
  };
}

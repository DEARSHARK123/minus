/**
 * UX06 — Unified continuation selector for Home / Calendar / History.
 * One task → one primary continuation entry with a real deep link
 * (course / session / task). Surfaces must not stack three identical
 * “continue” summary cards for the same identity.
 */

import {
  APP_PATHS,
  chatPath,
  coursePath,
} from '@/lib/navigation/app-routes';
import {
  dedupeRecentTasks,
  isHomeContinuationCandidate,
  type TaskDedupeInput,
} from './task-dedupe';

export type ContinuationSurface = 'home' | 'calendar' | 'history';

export type ContinuationTargetKind = 'course' | 'session' | 'task' | 'chat';

export interface ContinuationDeepLink {
  kind: ContinuationTargetKind;
  /** Navigable path (App Router). */
  href: string;
  courseId?: string;
  sessionId?: string;
  taskId?: string;
  conversationId?: string;
}

export interface ContinuationEntry<T extends TaskDedupeInput = TaskDedupeInput> {
  /** Primary task for “continue learning”. */
  task: T;
  /**
   * Surface that owns the aggregated summary chip for this identity.
   * Home owns the chip; Calendar owns schedule blocks; History owns resume rows.
   */
  ownerSurface: ContinuationSurface;
  /** Short natural Chinese label for chips. */
  label: string;
  /** User-facing prompt (no policy jargon). */
  prompt: string;
  /** Stable identity: one task → one continuation key. */
  identity: string;
  /** Real course / session / task deep link. */
  deepLink: ContinuationDeepLink;
}

export interface ContinuationContext {
  /** Latest session per course/task for deep links. */
  sessions?: Array<{
    id: string;
    courseId: string;
    taskId?: string;
    startedAt: string;
    endedAt?: string;
  }>;
  conversationId?: string | null;
}

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Stable identity for a continuation candidate.
 * Prefer task id; else course+unit / course+goal / normalized title bucket.
 */
export function continuationIdentity(task: TaskDedupeInput): string {
  const id = (task.id || '').trim();
  if (id) return `task:${id}`;
  const course = (task.courseId || '').trim();
  const unit = (task.unitId || '').trim();
  if (course && unit) return `cu:${course}:${unit}`;
  const goal = (task.goalId || '').trim();
  if (course && goal) return `cg:${course}:${goal}`;
  const title = (task.title || '').trim().toLowerCase().replace(/\s+/g, '');
  return `title:${title || 'unknown'}`;
}

function findBestSession(
  task: TaskDedupeInput,
  sessions: ContinuationContext['sessions'],
): { id: string; courseId: string } | null {
  if (!sessions?.length) return null;
  const courseId = (task.courseId || '').trim();
  const taskId = (task.id || '').trim();

  const byTask = sessions
    .filter((s) => s.taskId && s.taskId === taskId)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  if (byTask[0]) {
    return { id: byTask[0].id, courseId: byTask[0].courseId };
  }

  if (courseId) {
    const open = sessions
      .filter((s) => s.courseId === courseId && !s.endedAt)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    if (open[0]) return { id: open[0].id, courseId: open[0].courseId };

    const any = sessions
      .filter((s) => s.courseId === courseId)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    if (any[0]) return { id: any[0].id, courseId: any[0].courseId };
  }

  return null;
}

/**
 * Resolve a real deep link for the primary continuation task.
 * Prefer /course/[id]?s=session; else /course/[id]; else chat pin.
 */
export function resolveContinuationDeepLink(
  task: TaskDedupeInput,
  ctx: ContinuationContext = {},
): ContinuationDeepLink {
  const courseId = (task.courseId || '').trim();
  const taskId = (task.id || '').trim() || undefined;
  const session = findBestSession(task, ctx.sessions);

  if (session?.courseId) {
    return {
      kind: 'session',
      href: coursePath(session.courseId, session.id),
      courseId: session.courseId,
      sessionId: session.id,
      taskId,
    };
  }

  if (courseId) {
    return {
      kind: 'course',
      href: coursePath(courseId),
      courseId,
      taskId,
    };
  }

  if (taskId) {
    // Task without course — still addressable as task identity on chat continue
    return {
      kind: 'task',
      href: chatPath(ctx.conversationId),
      taskId,
      conversationId: ctx.conversationId || undefined,
    };
  }

  return {
    kind: 'chat',
    href: APP_PATHS.chat,
    conversationId: ctx.conversationId || undefined,
  };
}

function buildEntry<T extends TaskDedupeInput>(
  task: T,
  ownerSurface: ContinuationSurface,
  ctx: ContinuationContext,
): ContinuationEntry<T> {
  const short = truncate(task.title, 28);
  const identity = continuationIdentity(task);
  const deepLink = resolveContinuationDeepLink(task, ctx);
  return {
    task,
    ownerSurface,
    label: `继续学习：${short}`,
    prompt: `我想继续学习「${task.title.trim()}」，请直接接着上次进度讲，用简洁中文。`,
    identity,
    deepLink,
  };
}

/**
 * Unified selector: at most one primary continue entry after dedupe.
 * `ownerSurface` records which surface is allowed to show the aggregated chip;
 * Home is the default owner for the chip form.
 */
export function selectContinuation<T extends TaskDedupeInput>(
  tasks: T[],
  surface: ContinuationSurface = 'home',
  ctx: ContinuationContext = {},
): ContinuationEntry<T> | null {
  const candidates = dedupeRecentTasks(
    tasks.filter(isHomeContinuationCandidate),
  );
  const task = candidates[0];
  if (!task) return null;
  // Aggregated chip ownership is always Home; Calendar/History use deepLink
  // for resume without re-emitting the same chip.
  const owner: ContinuationSurface =
    surface === 'home' ? 'home' : 'home';
  void owner;
  return buildEntry(task, 'home', ctx);
}

/**
 * Pick at most one aggregated continue-learning entry for Home.
 * Dedupes first, then takes the freshest eligible task.
 */
export function selectHomeContinuation<T extends TaskDedupeInput>(
  tasks: T[],
  ctx: ContinuationContext = {},
): ContinuationEntry<T> | null {
  return selectContinuation(tasks, 'home', ctx);
}

/**
 * True when Calendar/History should suppress a duplicate “continue” summary
 * because the unified selector already owns this task as primary.
 */
export function isOwnedByHomeContinuation(
  taskId: string,
  tasks: TaskDedupeInput[],
  ctx: ContinuationContext = {},
): boolean {
  const entry = selectContinuation(tasks, 'home', ctx);
  if (!entry) return false;
  return entry.task.id === taskId;
}

/**
 * Filter tasks for non-Home surfaces: drop the single Home-owned primary
 * so the same summary is not stacked on Calendar/History lists that offer
 * a continue affordance. Full calendar schedule blocks still may show the task.
 */
export function excludeHomeOwnedContinuation<T extends TaskDedupeInput>(
  tasks: T[],
  surface: Exclude<ContinuationSurface, 'home'>,
  ctx: ContinuationContext = {},
): T[] {
  void surface;
  const owned = selectContinuation(tasks, 'home', ctx);
  if (!owned) return tasks;
  return tasks.filter((t) => t.id !== owned.task.id);
}

/**
 * Whether two entries refer to the same primary continuation identity.
 */
export function sameContinuationIdentity(
  a: TaskDedupeInput | ContinuationEntry,
  b: TaskDedupeInput | ContinuationEntry,
): boolean {
  const taskA = 'identity' in a ? a.task : a;
  const taskB = 'identity' in b ? b.task : b;
  return continuationIdentity(taskA) === continuationIdentity(taskB);
}

/**
 * History/Calendar primary continue CTA for the owned task — deep link only,
 * not a second summary chip. Returns null when no open continuation.
 */
export function selectContinuationDeepLink(
  tasks: TaskDedupeInput[],
  ctx: ContinuationContext = {},
): ContinuationDeepLink | null {
  const entry = selectContinuation(tasks, 'home', ctx);
  return entry?.deepLink ?? null;
}

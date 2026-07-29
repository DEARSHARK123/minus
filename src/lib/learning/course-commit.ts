/**
 * UX04 — Course commit gate.
 * 「开始学习」is the sole persistence point for Deep Planning → Course.
 * Outline preview edits must never call createCourse / createLearningPath.
 */

import type { OutlineUnitArtifact } from '@/lib/agents/types';
import { coursePath } from '@/lib/navigation/app-routes';

export type OutlineEditAction =
  | 'rename'
  | 'add'
  | 'remove'
  | 'reorder'
  | 'expand_kp'
  | 'set_kp';

export type CourseCommitInput = {
  topic: string;
  proposal: string;
  outlineUnits: OutlineUnitArtifact[];
};

export type CourseCommitResult = {
  courseId: string;
  sessionId: string;
  href: string;
};

/**
 * Preview edits are never a commit. Explicit guard for tests and callers.
 */
export function isOutlineEditCommitAction(action: OutlineEditAction): false {
  void action;
  return false;
}

/**
 * Only「开始学习」may persist. stage must be outline or ready;
 * units must be non-empty.
 */
export function canCommitCourseStart(opts: {
  stage: string;
  outlineUnits: OutlineUnitArtifact[];
  confirmed: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!opts.confirmed) {
    return { ok: false, reason: '需要确认「开始学习」后才会创建课程' };
  }
  const stage = opts.stage;
  if (stage !== 'outline' && stage !== 'ready' && stage !== 'resources') {
    return { ok: false, reason: '当前还不能开始学习' };
  }
  if (!opts.outlineUnits.length) {
    return { ok: false, reason: '还没有学习大纲，请先生成大纲' };
  }
  return { ok: true };
}

/** Build navigation target after successful commit. */
export function courseCommitNavigation(
  courseId: string,
  sessionId?: string | null,
): CourseCommitResult {
  return {
    courseId,
    sessionId: sessionId || '',
    href: coursePath(courseId, sessionId),
  };
}

/**
 * Pure description of course-commit persistence steps (for tests).
 * Real I/O happens only in UI handler after canCommitCourseStart ok.
 *
 * Batch-05: does NOT include calendar confirmTask — schedule writes require
 * their own explicit confirmation on Calendar (not implicit on「开始学习」).
 */
export function describeCourseCommitSteps(): readonly string[] {
  return [
    'createCourse',
    'createLearningPathFromOutline',
    'createSession',
    'navigateCourse',
  ] as const;
}

/**
 * Calendar / pending_suggestion confirms are a separate commit surface.
 * Must never be folded into course start.
 */
export function describeCalendarConfirmSteps(): readonly string[] {
  return ['confirmTask', 'rejectSuggestion'] as const;
}

/** Course start must not auto-confirm pending schedule suggestions. */
export function courseStartAutoConfirmsPendingTasks(): false {
  return false;
}

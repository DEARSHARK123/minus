/**
 * Batch-07 — Normalize legacy task status labels (done/completed).
 */

import type { TaskStatus } from '@/types/learning';

/** Canonical v2 task status. */
export function normalizeTaskStatus(status: string | TaskStatus): TaskStatus {
  switch (status) {
    case 'completed':
      return 'done';
    case 'pending':
      return 'pending_suggestion';
    default:
      return status as TaskStatus;
  }
}

export function isTaskDone(status: string | TaskStatus): boolean {
  const n = normalizeTaskStatus(status);
  return n === 'done';
}

export function isTaskActiveForContinuation(status: string | TaskStatus): boolean {
  const n = normalizeTaskStatus(status);
  return (
    n === 'confirmed' ||
    n === 'scheduled' ||
    n === 'in_progress'
  );
}
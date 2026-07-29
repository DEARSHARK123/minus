/**
 * UX03 — Dedupe recent study tasks before truncating for Home / shared surfaces.
 * Keys: entity id, course+unit, normalized title + status bucket.
 */

export type TaskDedupeStatus =
  | 'pending_suggestion'
  | 'confirmed'
  | 'scheduled'
  | 'in_progress'
  | 'done'
  | 'pending'
  | 'completed'
  | string;

export interface TaskDedupeInput {
  id: string;
  title: string;
  status: TaskDedupeStatus;
  courseId?: string | null;
  unitId?: string | null;
  goalId?: string | null;
  /** ISO timestamp — newer wins within a duplicate group. */
  updatedAt?: string;
}

/** Collapse whitespace, case, and common punctuation for title matching. */
export function normalizeTaskTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？、；：""''（）()[\]【】《》<>·…—\-_/\\|:：]/g, '');
}

function statusBucket(status: TaskDedupeStatus): string {
  switch (status) {
    case 'done':
    case 'completed':
      return 'done';
    case 'pending_suggestion':
    case 'pending':
      return 'pending';
    case 'in_progress':
      return 'active';
    case 'confirmed':
    case 'scheduled':
      return 'open';
    default:
      return String(status || 'unknown');
  }
}

/**
 * Primary merge key for a task:
 * 1. entity id (unique)
 * 2. courseId + unitId when both present
 * 3. courseId + goalId when unit missing
 * 4. normalized title + status bucket
 */
export function taskDedupeKey(task: TaskDedupeInput): string {
  const id = (task.id || '').trim();
  if (id) return `id:${id}`;
  const course = (task.courseId || '').trim();
  const unit = (task.unitId || '').trim();
  if (course && unit) return `cu:${course}:${unit}`;
  const goal = (task.goalId || '').trim();
  if (course && goal) return `cg:${course}:${goal}`;
  const nt = normalizeTaskTitle(task.title || '');
  return `ts:${nt}:${statusBucket(task.status)}`;
}

/**
 * Secondary identity for near-duplicates that share course+unit or title+status
 * even when ids differ (e.g. re-imported tasks).
 */
export function taskSoftDedupeKey(task: TaskDedupeInput): string {
  const course = (task.courseId || '').trim();
  const unit = (task.unitId || '').trim();
  if (course && unit) return `cu:${course}:${unit}`;
  const goal = (task.goalId || '').trim();
  if (course && goal) return `cg:${course}:${goal}`;
  const nt = normalizeTaskTitle(task.title || '');
  if (!nt) return `id:${(task.id || '').trim()}`;
  return `ts:${nt}:${statusBucket(task.status)}`;
}

function parseUpdated(iso?: string): number {
  if (!iso) return 0;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Dedupe then optionally truncate.
 * Prefer newest `updatedAt`; keep first occurrence order among winners.
 */
export function dedupeRecentTasks<T extends TaskDedupeInput>(
  tasks: T[],
  opts?: { max?: number },
): T[] {
  const softSeen = new Map<string, T>();
  const idSeen = new Set<string>();

  // Sort newest first so winners are freshest
  const sorted = [...tasks].sort(
    (a, b) => parseUpdated(b.updatedAt) - parseUpdated(a.updatedAt),
  );

  const winners: T[] = [];
  for (const t of sorted) {
    const id = (t.id || '').trim();
    if (id && idSeen.has(id)) continue;
    const soft = taskSoftDedupeKey(t);
    const prev = softSeen.get(soft);
    if (prev) {
      // Same soft key — keep already chosen (newer because sorted)
      continue;
    }
    softSeen.set(soft, t);
    if (id) idSeen.add(id);
    winners.push(t);
  }

  // Restore recency order among winners (already newest-first)
  const max = opts?.max;
  if (typeof max === 'number' && max >= 0) {
    return winners.slice(0, max);
  }
  return winners;
}

/** Active (non-terminal, non-suggestion-only fluff) tasks for Home continue entry. */
export function isHomeContinuationCandidate(task: TaskDedupeInput): boolean {
  const s = task.status;
  if (s === 'done' || s === 'completed' || s === 'pending_suggestion') return false;
  return Boolean((task.title || '').trim());
}

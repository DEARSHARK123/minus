/**
 * Batch-02 — Conversation aggregate pure helpers.
 *
 * conversationId is the boundary for mode preference, experience snapshot,
 * turn ids, and message-level artifacts. No sticky merge of empty orchestrator
 * results; legacy messages without metadata remain readable.
 */

import type {
  ConversationExperienceSnapshot,
  Message,
  MessageStatus,
  MessageTurnArtifact,
  UserModePreference,
} from '@/types/agent';
import { deriveChatTitle } from '@/lib/chat/history-intelligence';

/** Unpersisted draft key for learn-flow slice map (not a real conversation id). */
export const LEARN_FLOW_DRAFT_KEY = '__draft__' as const;

/** Chat persist schema version after conversation-aggregate migration. */
export const CHAT_PERSIST_SCHEMA_VERSION = 2 as const;

export type LearnFlowSliceKey = string;

export function learnFlowSliceKey(
  conversationId: string | null | undefined,
): LearnFlowSliceKey {
  if (conversationId == null || conversationId === '') {
    return LEARN_FLOW_DRAFT_KEY;
  }
  return conversationId;
}

export function isDraftLearnFlowKey(key: string): boolean {
  return key === LEARN_FLOW_DRAFT_KEY;
}

export function newTurnId(): string {
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Apply orchestrator artifacts to a turn: **replace**, never sticky-merge.
 * Empty array clears prior turn artifacts.
 */
export function applyTurnArtifacts(
  previous: MessageTurnArtifact[] | undefined,
  next: MessageTurnArtifact[] | null | undefined,
): MessageTurnArtifact[] {
  void previous; // intentionally discarded — no sticky merge
  if (!Array.isArray(next)) return [];
  return next.map((a) => ({ ...a }));
}

/**
 * Whether an orchestrator result should clear the current turn artifact strip.
 */
export function shouldClearTurnArtifacts(artifacts: unknown): boolean {
  return !Array.isArray(artifacts) || artifacts.length === 0;
}

/**
 * Race guard: only apply store updates when the bound conversation still matches
 * the request that was in flight (and optional generation token).
 */
export function isStaleConversationWrite(input: {
  expectedConversationId: string | null;
  boundConversationId: string | null;
  expectedGeneration?: number;
  currentGeneration?: number;
}): boolean {
  if (input.expectedConversationId !== input.boundConversationId) {
    return true;
  }
  if (
    input.expectedGeneration != null &&
    input.currentGeneration != null &&
    input.expectedGeneration !== input.currentGeneration
  ) {
    return true;
  }
  return false;
}

/** Generic「新对话」titles that should be backfilled from first user message. */
export function isGenericConversationTitle(title: string | null | undefined): boolean {
  const t = (title || '').trim();
  return !t || t === '新对话' || t === '未命名对话';
}

/**
 * Backfill conversation title from first user message when still generic.
 * Does not invent content for empty conversations.
 */
export function backfillConversationTitle(input: {
  title?: string;
  messages: Array<{ role: string; content: string }>;
}): string {
  return deriveChatTitle(input.messages, input.title);
}

/**
 * Empty experience snapshot for a new draft / fresh conversation.
 */
export function emptyExperienceSnapshot(
  modePreference: UserModePreference = null,
): ConversationExperienceSnapshot {
  return {
    stage: 'idle',
    topic: '',
    proposal: '',
    experienceMode: null,
    modePreference,
    courseId: null,
    sessionId: null,
    outlineUnits: [],
    artifacts: [],
    memoryEntries: [],
    calibrationQuestion: '',
    calibrationOptions: [],
    calibrationKind: null,
    lastRoute: null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Merge a partial snapshot without inventing wipe of unknown fields.
 */
export function mergeExperienceSnapshot(
  base: ConversationExperienceSnapshot | null | undefined,
  patch: Partial<ConversationExperienceSnapshot>,
): ConversationExperienceSnapshot {
  const b = base ?? emptyExperienceSnapshot();
  return {
    ...b,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
}

/**
 * Attach turn metadata to a message without requiring legacy fields.
 */
export function withTurnMeta(
  message: Message,
  meta: {
    turnId?: string;
    status?: MessageStatus;
    artifacts?: MessageTurnArtifact[];
  },
): Message {
  return {
    ...message,
    ...(meta.turnId !== undefined ? { turnId: meta.turnId } : {}),
    ...(meta.status !== undefined ? { status: meta.status } : {}),
    ...(meta.artifacts !== undefined
      ? { artifacts: applyTurnArtifacts(message.artifacts, meta.artifacts) }
      : {}),
  };
}

/**
 * URL pin for course/session: resolve selection without letting auto "first active"
 * overwrite an explicit pin that still exists in data.
 */
export function resolvePinnedLearningSelection(input: {
  courses: Array<{ id: string }>;
  sessions: Array<{
    id: string;
    courseId: string;
    taskId?: string | null;
    startedAt?: string;
    endedAt?: string | null;
  }>;
  pinnedCourseId?: string | null;
  pinnedSessionId?: string | null;
  previousSelectedCourseId?: string | null;
  previousActiveSessionId?: string | null;
}): {
  selectedCourseId: string | null;
  activeSession: {
    id: string;
    courseId: string;
    taskId?: string | null;
    startedAt?: string;
    endedAt?: string | null;
  } | null;
  activeTaskId: string | null;
  pinHonored: boolean;
} {
  const courseIds = new Set(input.courses.map((c) => c.id));

  // Explicit URL course pin wins when the course still exists.
  if (input.pinnedCourseId && courseIds.has(input.pinnedCourseId)) {
    const courseId = input.pinnedCourseId;
    if (input.pinnedSessionId) {
      const pinned = input.sessions.find(
        (s) => s.id === input.pinnedSessionId && s.courseId === courseId,
      );
      if (pinned) {
        return {
          selectedCourseId: courseId,
          activeSession: pinned,
          activeTaskId: pinned.taskId ?? null,
          pinHonored: true,
        };
      }
    }
    // Course pin without valid session: do not invent unrelated course session.
    const courseSessions = input.sessions
      .filter((s) => s.courseId === courseId)
      .sort(
        (a, b) =>
          Date.parse(b.startedAt || '') - Date.parse(a.startedAt || ''),
      );
    const session = courseSessions[0] ?? null;
    return {
      selectedCourseId: courseId,
      activeSession: session,
      activeTaskId: session?.taskId ?? null,
      pinHonored: true,
    };
  }

  // Preserve previous selection when still valid (refresh without URL pin wipe).
  if (
    input.previousActiveSessionId &&
    input.sessions.some((s) => s.id === input.previousActiveSessionId)
  ) {
    const session = input.sessions.find(
      (s) => s.id === input.previousActiveSessionId,
    )!;
    return {
      selectedCourseId: session.courseId,
      activeSession: session,
      activeTaskId: session.taskId ?? null,
      pinHonored: false,
    };
  }

  const selected =
    input.previousSelectedCourseId &&
    courseIds.has(input.previousSelectedCourseId)
      ? input.previousSelectedCourseId
      : input.courses[0]?.id ?? null;

  if (!selected) {
    return {
      selectedCourseId: null,
      activeSession: null,
      activeTaskId: null,
      pinHonored: false,
    };
  }

  const activeSessions = input.sessions
    .filter((s) => s.courseId === selected && !s.endedAt)
    .sort(
      (a, b) =>
        Date.parse(b.startedAt || '') - Date.parse(a.startedAt || ''),
    );
  const activeSession = activeSessions[0] ?? null;
  return {
    selectedCourseId: selected,
    activeSession,
    activeTaskId: activeSession?.taskId ?? null,
    pinHonored: false,
  };
}

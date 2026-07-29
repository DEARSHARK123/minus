/**
 * Batch-04 — Turn-scoped artifacts, safe edit/regenerate, SSE race, HITL invalidate.
 *
 * Pure helpers only (no store I/O). Keep server-only secrets out of browser path.
 */

import type {
  ConversationExperienceSnapshot,
  Message,
  MessageTurnArtifact,
} from '@/types/agent';
import type { LearnArtifact, LearnArtifactKind } from '@/lib/agents/types';
import { isStaleConversationWrite } from '@/lib/chat/conversation-aggregate';

/** Client-visible notice when edit cannot unwind committed side effects. */
export const COMMITTED_SIDE_EFFECT_NOTICE =
  '已创建的课程、日程或写入的文件不会自动撤销。如需调整，请到课程/日历或文件中手动处理。';

/** Regenerate must not silently replay prior tool results. */
export const REGENERATE_POLICY = {
  /** Never re-apply previous tool outputs; new tool use goes through policy/HITL. */
  replayTools: false as const,
  /** Assistant message body is not user-editable. */
  allowAssistantContentEdit: false as const,
  /** User messages may be edited then re-run. */
  allowUserEditAndRegenerate: true as const,
} as const;

export type EditUserMessageResult = {
  ok: boolean;
  /** Messages removed after the edited user message (assistant/tool/later turns). */
  truncatedCount: number;
  /** Non-null when conversation already committed course/calendar-ish side effects. */
  sideEffectNotice: string | null;
  /** Edited user message id when ok. */
  messageId?: string;
  /** Content after trim when ok. */
  content?: string;
};

export type StreamWriteGuard = {
  expectedConversationId: string | null;
  activeConversationId: string | null;
  expectedTurnId?: string | null;
  currentTurnId?: string | null;
  expectedGeneration?: number;
  currentGeneration?: number;
  /** Assistant message must still exist in the active conversation. */
  assistantMessageId?: string;
  messages?: Message[];
};

/**
 * Whether a streaming write may mutate the active conversation / turn.
 * Covers conversation switch, turn supersession (edit), generation bump, deleted assistant.
 */
export function isStaleStreamWrite(input: StreamWriteGuard): boolean {
  if (
    isStaleConversationWrite({
      expectedConversationId: input.expectedConversationId,
      boundConversationId: input.activeConversationId,
      expectedGeneration: input.expectedGeneration,
      currentGeneration: input.currentGeneration,
    })
  ) {
    return true;
  }

  if (
    input.expectedTurnId != null &&
    input.currentTurnId != null &&
    input.expectedTurnId !== input.currentTurnId
  ) {
    return true;
  }

  if (input.assistantMessageId && Array.isArray(input.messages)) {
    const stillThere = input.messages.some(
      (m) => m.id === input.assistantMessageId,
    );
    if (!stillThere) return true;
  }

  return false;
}

/**
 * Pure truncate: keep messages up to and including the edited user message,
 * replace its content, clear its artifacts/status for a clean regenerate.
 * Does not mutate input arrays.
 */
export function truncateMessagesAfterUserEdit(
  messages: Message[],
  messageId: string,
  newContent: string,
): {
  ok: boolean;
  messages: Message[];
  truncatedCount: number;
  editIndex: number;
} {
  const value = newContent.trim();
  if (!value) {
    return { ok: false, messages: [...messages], truncatedCount: 0, editIndex: -1 };
  }
  const index = messages.findIndex((m) => m.id === messageId);
  if (index < 0) {
    return { ok: false, messages: [...messages], truncatedCount: 0, editIndex: -1 };
  }
  const target = messages[index];
  if (!target || target.role !== 'user') {
    return { ok: false, messages: [...messages], truncatedCount: 0, editIndex: -1 };
  }
  const truncatedCount = messages.length - (index + 1);
  const next = messages.slice(0, index + 1).map((m, i) =>
    i === index
      ? {
          ...m,
          content: value,
          status: 'complete' as const,
          artifacts: [],
          thinking: false,
        }
      : m,
  );
  return { ok: true, messages: next, truncatedCount, editIndex: index };
}

/**
 * Prepare regenerate from an assistant message: keep history through the
 * preceding user message; drop the assistant and everything after.
 */
export function truncateForAssistantRegenerate(
  messages: Message[],
  assistantMessageId: string,
): {
  ok: boolean;
  messages: Message[];
  truncatedCount: number;
  userMessageId: string | null;
  userContent: string | null;
} {
  const aIdx = messages.findIndex((m) => m.id === assistantMessageId);
  if (aIdx < 0) {
    return {
      ok: false,
      messages: [...messages],
      truncatedCount: 0,
      userMessageId: null,
      userContent: null,
    };
  }
  if (messages[aIdx]?.role !== 'assistant') {
    return {
      ok: false,
      messages: [...messages],
      truncatedCount: 0,
      userMessageId: null,
      userContent: null,
    };
  }
  let userIdx = -1;
  for (let i = aIdx - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      userIdx = i;
      break;
    }
  }
  if (userIdx < 0) {
    return {
      ok: false,
      messages: [...messages],
      truncatedCount: 0,
      userMessageId: null,
      userContent: null,
    };
  }
  const truncatedCount = messages.length - (userIdx + 1);
  const next = messages.slice(0, userIdx + 1);
  return {
    ok: true,
    messages: next,
    truncatedCount,
    userMessageId: messages[userIdx]!.id,
    userContent: messages[userIdx]!.content,
  };
}

/**
 * Detect committed (non-preview) side effects that must not auto-rollback on edit.
 * Preview-only outline in learn-flow is cleared; courseId/sessionId on experience
 * means a prior explicit commit may exist.
 */
export function committedSideEffectNotice(
  experience: ConversationExperienceSnapshot | null | undefined,
  opts?: { hasLinkedCourse?: boolean; hasPendingUncommittedPreview?: boolean },
): string | null {
  const committed =
    Boolean(experience?.courseId) ||
    Boolean(experience?.sessionId) ||
    opts?.hasLinkedCourse === true;
  if (!committed) return null;
  return COMMITTED_SIDE_EFFECT_NOTICE;
}

/** True when artifacts list is owned by the given turn id (message.turnId match). */
export function artifactsBelongToTurn(
  message: Pick<Message, 'turnId' | 'artifacts' | 'role'> | null | undefined,
  turnId: string | null | undefined,
): boolean {
  if (!message || !turnId) return false;
  if (message.role !== 'assistant') return false;
  return message.turnId === turnId;
}

/**
 * Active (interactive) assistant turn: latest assistant that still exists and
 * optionally matches currentTurnId when set.
 */
export function resolveInteractiveAssistantId(
  messages: Message[],
  currentTurnId?: string | null,
): string | null {
  if (currentTurnId) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m?.role === 'assistant' && m.turnId === currentTurnId) {
        return m.id;
      }
    }
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'assistant') {
      return messages[i]!.id;
    }
  }
  return null;
}

const LEARN_KINDS = new Set<string>([
  'confirm_gate',
  'memory_card',
  'single_choice',
  'multi_choice',
  'free_text',
  'resource_list',
  'outline_card',
  'progress_update',
  'plain_assistant',
]);

/** Convert message-level turn artifacts to LearnArtifact for card render. */
export function messageArtifactsToLearn(
  artifacts: MessageTurnArtifact[] | undefined | null,
): LearnArtifact[] {
  if (!Array.isArray(artifacts)) return [];
  return artifacts
    .filter((a) => a && LEARN_KINDS.has(a.kind))
    .map((a) => {
      const kind = a.kind as LearnArtifactKind;
      const out: LearnArtifact = {
        id: a.id,
        kind,
        title: a.title,
        content: a.content,
        options: a.options,
        selectedIndex: a.selectedIndex,
        topic: a.topic,
        proposal: a.proposal,
        memoryEntries: a.memoryEntries,
        resources: a.resources as LearnArtifact['resources'],
        units: a.units as LearnArtifact['units'],
        progressSteps: a.progressSteps as LearnArtifact['progressSteps'],
      };
      if (a.clarification) {
        out.clarification = a.clarification;
      }
      return out;
    });
}

/** Snapshot learn artifacts onto message-level turn artifacts (strip sticky merge). */
export function learnArtifactsToMessage(
  artifacts: LearnArtifact[] | undefined | null,
): MessageTurnArtifact[] {
  if (!Array.isArray(artifacts)) return [];
  return artifacts.map((a) => ({
    id: a.id,
    kind: a.kind,
    title: a.title,
    content: a.content,
    options: a.options,
    selectedIndex: a.selectedIndex ?? null,
    topic: a.topic,
    proposal: a.proposal,
    memoryEntries: a.memoryEntries,
    resources: a.resources,
    units: a.units,
    progressSteps: a.progressSteps,
    clarification: a.clarification,
  }));
}

/**
 * HITL invalidate client protocol: cancel server wait then drop local token.
 * Callers supply the network cancel; this helper only shapes the request body
 * and decides whether cancel is required.
 */
export function hitlInvalidateRequest(resumeToken: string | null | undefined): {
  shouldCancel: boolean;
  body: { action: 'cancel'; resumeToken: string } | null;
} {
  const token = (resumeToken || '').trim();
  if (!token) {
    return { shouldCancel: false, body: null };
  }
  return {
    shouldCancel: true,
    body: { action: 'cancel', resumeToken: token },
  };
}

/** After cancel, token must be treated as unusable (fail-closed on resume). */
export function isHitlTokenInvalidated(
  activeToken: string | null | undefined,
  invalidatedTokens: ReadonlySet<string> | readonly string[],
): boolean {
  if (!activeToken) return true;
  if (invalidatedTokens instanceof Set) {
    return invalidatedTokens.has(activeToken);
  }
  const list = invalidatedTokens as readonly string[];
  return list.includes(activeToken);
}

export function copyAssistantContentPolicy(): {
  allowed: boolean;
  editContentAllowed: boolean;
} {
  return {
    allowed: true,
    editContentAllowed: REGENERATE_POLICY.allowAssistantContentEdit,
  };
}

export function regenerateAssistantPolicy(): {
  allowed: boolean;
  replayTools: boolean;
} {
  return {
    allowed: true,
    replayTools: REGENERATE_POLICY.replayTools,
  };
}

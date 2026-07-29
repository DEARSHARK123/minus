/**
 * UX01 — Draft conversation lifecycle helpers.
 * Blank home is unpersisted; only conversations with content appear in Recent.
 */

export type ConversationLike = {
  id: string;
  title?: string;
  messages: unknown[];
  updatedAt?: Date | string | number;
};

/** True when the conversation has at least one message (user or assistant). */
export function conversationHasContent(
  conversation: ConversationLike | null | undefined,
): boolean {
  if (!conversation) return false;
  return Array.isArray(conversation.messages) && conversation.messages.length > 0;
}

/**
 * Recent list: only conversations with content, newest first, capped.
 * Empty drafts never appear.
 */
export function filterRecentConversations<T extends ConversationLike>(
  conversations: T[],
  limit = 8,
): T[] {
  return [...conversations]
    .filter(conversationHasContent)
    .sort((a, b) => {
      const ta = toTime(a.updatedAt);
      const tb = toTime(b.updatedAt);
      return tb - ta;
    })
    .slice(0, Math.max(0, limit));
}

/** Drop empty conversations from a list (e.g. before persist / after rehydrate). */
export function stripEmptyConversations<T extends ConversationLike>(
  conversations: T[],
): T[] {
  return conversations.filter(conversationHasContent);
}

/**
 * Resolve activeConversationId after filtering empties.
 * Keeps id only if it still exists and has content.
 */
export function resolveActiveConversationId(
  conversations: ConversationLike[],
  activeId: string | null | undefined,
): string | null {
  if (!activeId) return null;
  const found = conversations.find((c) => c.id === activeId);
  return conversationHasContent(found) ? activeId : null;
}

/**
 * Snapshot suitable for zustand persist partialize:
 * only contentful conversations + valid active id.
 */
export function persistableChatSlice<T extends ConversationLike>(state: {
  conversations: T[];
  activeConversationId: string | null;
}): {
  conversations: T[];
  activeConversationId: string | null;
} {
  const conversations = stripEmptyConversations(state.conversations);
  return {
    conversations,
    activeConversationId: resolveActiveConversationId(
      conversations,
      state.activeConversationId,
    ),
  };
}

/**
 * Simulate: open home draft N times without sending.
 * Must not grow conversation count or recent list.
 */
export function applyOpenHomeDrafts(
  state: { conversations: ConversationLike[]; activeConversationId: string | null },
  times: number,
): { conversations: ConversationLike[]; activeConversationId: string | null } {
  let next = { ...state, conversations: [...state.conversations] };
  for (let i = 0; i < times; i++) {
    // Draft = clear active id only; no createConversation.
    next = { ...next, activeConversationId: null };
  }
  return next;
}

/**
 * First user message on a blank draft creates exactly one conversation.
 */
export function applyFirstUserMessagePersist<T extends ConversationLike>(
  state: { conversations: T[]; activeConversationId: string | null },
  create: () => T,
  message: unknown,
): { conversations: T[]; activeConversationId: string; created: T } {
  if (state.activeConversationId) {
    const existing = state.conversations.find((c) => c.id === state.activeConversationId);
    if (existing) {
      const updated: T = {
        ...existing,
        messages: [...existing.messages, message],
      };
      return {
        conversations: state.conversations.map((c) =>
          c.id === existing.id ? updated : c,
        ),
        activeConversationId: existing.id,
        created: updated,
      };
    }
  }
  const created = create();
  const withMsg: T = {
    ...created,
    messages: [...created.messages, message],
  };
  return {
    conversations: [withMsg, ...state.conversations.filter((c) => c.id !== created.id)],
    activeConversationId: created.id,
    created: withMsg,
  };
}

function toTime(value: Date | string | number | undefined): number {
  if (value == null) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

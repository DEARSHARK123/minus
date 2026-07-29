import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ConversationExperienceSnapshot,
  Message,
  MessageStatus,
  MessageTurnArtifact,
  UserModePreference,
} from '@/types/agent';
import {
  filterRecentConversations,
  persistableChatSlice,
  resolveActiveConversationId,
  stripEmptyConversations,
} from '@/lib/navigation/draft-conversation';
import {
  CHAT_PERSIST_SCHEMA_VERSION,
  backfillConversationTitle,
  emptyExperienceSnapshot,
  isGenericConversationTitle,
  newTurnId,
  applyTurnArtifacts,
} from '@/lib/chat/conversation-aggregate';
import {
  committedSideEffectNotice,
  truncateForAssistantRegenerate,
  truncateMessagesAfterUserEdit,
  type EditUserMessageResult,
} from '@/lib/chat/turn-editing';
import {
  migrateChatPersistToV2,
  rehydrateChatPersistV2,
} from '@/lib/migration';
import { useLearnFlowStore } from '@/store/learn-flow-store';

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  playbookId?: string;
  createdAt: Date;
  updatedAt: Date;
  /** Conversation-scoped Normal/Deep preference. */
  modePreference?: UserModePreference;
  /** Learn-flow / experience snapshot for switch + refresh restore. */
  experience?: ConversationExperienceSnapshot | null;
  /** Active turn id for in-flight generation / artifact binding. */
  currentTurnId?: string | null;
}

interface ChatStore {
  /** Persist schema version (v2 = conversation aggregate). */
  version: typeof CHAT_PERSIST_SCHEMA_VERSION;
  conversations: Conversation[];
  activeConversationId: string | null;
  isLoading: boolean;
  error: string | null;
  /**
   * Fail-closed rehydrate error — set when migrate refuses corrupt payload.
   * UI may surface; store does not silently wipe.
   */
  rehydrateError: string | null;

  getActiveConversation: () => Conversation | undefined;
  getActiveMessages: () => Message[];
  /** Recent list: only conversations with at least one message. */
  getRecentConversations: (limit?: number) => Conversation[];

  /**
   * Open an unpersisted blank draft (主页).
   * Clears active id and binds learn-flow to a fresh draft slice.
   */
  openDraft: () => void;
  /**
   * Create a conversation in memory. Prefer first-message path via addMessage
   * so empty drafts are not left around. Not written to persist until it has messages.
   */
  createConversation: (
    title?: string,
    playbookId?: string,
    opts?: { modePreference?: UserModePreference },
  ) => Conversation;
  switchConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;

  setModePreference: (mode: UserModePreference) => void;
  setExperienceSnapshot: (
    conversationId: string | null,
    experience: ConversationExperienceSnapshot | null,
  ) => void;
  beginTurn: (conversationId?: string | null) => string;
  setMessageTurnArtifacts: (
    messageId: string,
    artifacts: MessageTurnArtifact[],
    status?: MessageStatus,
  ) => void;

  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  removeMessage: (messageId: string) => void;
  /**
   * Edit a user message, truncate subsequent turns/artifacts/uncommitted preview.
   * Does not roll back committed course/calendar/file side effects.
   */
  editUserMessage: (
    messageId: string,
    content: string,
  ) => EditUserMessageResult;
  /**
   * Truncate after the user message preceding an assistant (regenerate path).
   * Clears uncommitted learn-flow preview; no tool replay / no side-effect rollback.
   */
  prepareAssistantRegenerate: (assistantMessageId: string) => {
    ok: boolean;
    userMessageId: string | null;
    userContent: string | null;
    truncatedCount: number;
    sideEffectNotice: string | null;
  };

  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;

  /** Drop any empty conversations from state (safety net). */
  pruneEmptyConversations: () => void;
}

function newConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildConversation(partial: {
  id?: string;
  title?: string;
  messages?: Message[];
  playbookId?: string;
  modePreference?: UserModePreference;
  experience?: ConversationExperienceSnapshot | null;
  currentTurnId?: string | null;
}): Conversation {
  const modePreference = partial.modePreference ?? null;
  return {
    id: partial.id ?? newConversationId(),
    title: partial.title || '新对话',
    messages: partial.messages ?? [],
    playbookId: partial.playbookId,
    createdAt: new Date(),
    updatedAt: new Date(),
    modePreference,
    experience: partial.experience ?? emptyExperienceSnapshot(modePreference),
    currentTurnId: partial.currentTurnId ?? null,
  };
}

function titleForMessages(messages: Message[], existing?: string): string {
  return backfillConversationTitle({
    title: existing,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      version: CHAT_PERSIST_SCHEMA_VERSION,
      conversations: [],
      activeConversationId: null,
      isLoading: false,
      error: null,
      rehydrateError: null,

      getActiveConversation: () => {
        const { conversations, activeConversationId } = get();
        return conversations.find((c) => c.id === activeConversationId);
      },

      getActiveMessages: () => {
        const conv = get().getActiveConversation();
        return conv ? conv.messages : [];
      },

      getRecentConversations: (limit = 8) =>
        filterRecentConversations(get().conversations, limit),

      openDraft: () => {
        // Snapshot active experience before leaving (if any).
        const active = get().getActiveConversation();
        if (active) {
          const snap = useLearnFlowStore.getState().getActiveSnapshot();
          set((state) => ({
            conversations: state.conversations.map((c) =>
              c.id === active.id
                ? {
                    ...c,
                    experience: snap,
                    modePreference:
                      snap.modePreference ?? c.modePreference ?? null,
                    updatedAt: new Date(),
                  }
                : c,
            ),
          }));
        }
        set({ activeConversationId: null, error: null });
        useLearnFlowStore.getState().bindConversation(null, {
          resetDraft: true,
        });
      },

      createConversation: (title, playbookId, opts) => {
        const modePreference = opts?.modePreference ?? null;
        const newConv = buildConversation({
          title: title || '新对话',
          playbookId,
          modePreference,
        });
        set((state) => ({
          conversations: [newConv, ...state.conversations],
          activeConversationId: newConv.id,
        }));
        useLearnFlowStore.getState().bindConversation(newConv.id, {
          snapshot: newConv.experience ?? emptyExperienceSnapshot(modePreference),
          createIfMissing: true,
        });
        return newConv;
      },

      switchConversation: (id) => {
        const exists = get().conversations.some((c) => c.id === id);
        if (!exists) return;

        // Persist current experience into leaving conversation.
        const leavingId = get().activeConversationId;
        if (leavingId && leavingId !== id) {
          const snap = useLearnFlowStore.getState().getActiveSnapshot();
          set((state) => ({
            conversations: state.conversations.map((c) =>
              c.id === leavingId
                ? {
                    ...c,
                    experience: snap,
                    modePreference:
                      snap.modePreference ?? c.modePreference ?? null,
                    updatedAt: new Date(),
                  }
                : c,
            ),
          }));
        }

        set({ activeConversationId: id });
        const target = get().conversations.find((c) => c.id === id);
        useLearnFlowStore.getState().bindConversation(id, {
          snapshot: target?.experience ?? emptyExperienceSnapshot(target?.modePreference ?? null),
          createIfMissing: true,
        });
      },

      deleteConversation: (id) => {
        // Batch-06: deleting the *current* conversation always enters an
        // unpersisted /chat draft — never auto-switch to another thread.
        set((state) => {
          const filtered = state.conversations.filter((c) => c.id !== id);
          const wasActive = state.activeConversationId === id;
          return {
            conversations: filtered,
            activeConversationId: wasActive ? null : state.activeConversationId,
          };
        });
        useLearnFlowStore.getState().dropConversationSlice(id);
        const nextActive = get().activeConversationId;
        if (nextActive) {
          const target = get().conversations.find((c) => c.id === nextActive);
          useLearnFlowStore.getState().bindConversation(nextActive, {
            snapshot:
              target?.experience ??
              emptyExperienceSnapshot(target?.modePreference ?? null),
            createIfMissing: true,
          });
        } else {
          useLearnFlowStore.getState().bindConversation(null, {
            resetDraft: true,
          });
        }
      },

      renameConversation: (id, title) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, title, updatedAt: new Date() } : c,
          ),
        }));
      },

      setModePreference: (mode) => {
        const { activeConversationId } = get();
        useLearnFlowStore.getState().setModePreference(mode);
        if (!activeConversationId) return;
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === activeConversationId
              ? {
                  ...c,
                  modePreference: mode,
                  experience: {
                    ...(c.experience ?? emptyExperienceSnapshot(mode)),
                    modePreference: mode,
                    updatedAt: new Date().toISOString(),
                  },
                  updatedAt: new Date(),
                }
              : c,
          ),
        }));
      },

      setExperienceSnapshot: (conversationId, experience) => {
        if (!conversationId) return;
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  experience,
                  modePreference:
                    experience?.modePreference ?? c.modePreference ?? null,
                  updatedAt: new Date(),
                }
              : c,
          ),
        }));
      },

      beginTurn: (conversationId) => {
        const id = conversationId ?? get().activeConversationId;
        const turnId = newTurnId();
        if (!id) {
          useLearnFlowStore.getState().setCurrentTurnId(turnId);
          return turnId;
        }
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id
              ? { ...c, currentTurnId: turnId, updatedAt: new Date() }
              : c,
          ),
        }));
        useLearnFlowStore.getState().setCurrentTurnId(turnId);
        return turnId;
      },

      setMessageTurnArtifacts: (messageId, artifacts, status) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === state.activeConversationId
              ? {
                  ...c,
                  messages: c.messages.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          artifacts: applyTurnArtifacts(
                            msg.artifacts,
                            artifacts,
                          ),
                          ...(status !== undefined ? { status } : {}),
                        }
                      : msg,
                  ),
                  updatedAt: new Date(),
                }
              : c,
          ),
        }));
      },

      addMessage: (message) => {
        const { activeConversationId, conversations } = get();
        const draftMode =
          useLearnFlowStore.getState().modePreference ?? null;

        if (!activeConversationId) {
          // First user message on blank draft → create + persist with content.
          const messages = [message];
          const newConv = buildConversation({
            title: titleForMessages(messages, '新对话'),
            messages,
            modePreference: draftMode,
            experience: useLearnFlowStore.getState().getActiveSnapshot(),
            currentTurnId: message.turnId ?? null,
          });
          set({
            conversations: [newConv, ...conversations],
            activeConversationId: newConv.id,
          });
          // Re-key draft learn-flow slice onto the new conversation.
          useLearnFlowStore.getState().promoteDraftToConversation(newConv.id);
          return;
        }

        const active = conversations.find((c) => c.id === activeConversationId);
        if (!active) {
          const messages = [message];
          const newConv = buildConversation({
            title: titleForMessages(messages, '新对话'),
            messages,
            modePreference: draftMode,
            experience: useLearnFlowStore.getState().getActiveSnapshot(),
            currentTurnId: message.turnId ?? null,
          });
          set({
            conversations: [newConv, ...conversations],
            activeConversationId: newConv.id,
          });
          useLearnFlowStore.getState().promoteDraftToConversation(newConv.id);
          return;
        }

        set((state) => ({
          conversations: state.conversations.map((c) => {
            if (c.id !== state.activeConversationId) return c;
            const messages = [...c.messages, message];
            const nextTitle =
              isGenericConversationTitle(c.title) && message.role === 'user'
                ? titleForMessages(messages, c.title)
                : c.title;
            return {
              ...c,
              title: nextTitle,
              messages,
              updatedAt: new Date(),
              currentTurnId: message.turnId ?? c.currentTurnId ?? null,
            };
          }),
        }));
      },

      updateMessage: (messageId, updates) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === state.activeConversationId
              ? {
                  ...c,
                  messages: c.messages.map((msg) =>
                    msg.id === messageId ? { ...msg, ...updates } : msg,
                  ),
                  updatedAt: new Date(),
                }
              : c,
          ),
        }));
      },

      removeMessage: (messageId) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === state.activeConversationId
              ? {
                  ...c,
                  messages: c.messages.filter((msg) => msg.id !== messageId),
                  updatedAt: new Date(),
                }
              : c,
          ),
        }));
      },

      editUserMessage: (messageId, content) => {
        const activeId = get().activeConversationId;
        if (!activeId) {
          return {
            ok: false,
            truncatedCount: 0,
            sideEffectNotice: null,
          };
        }
        const active = get().conversations.find((c) => c.id === activeId);
        if (!active) {
          return {
            ok: false,
            truncatedCount: 0,
            sideEffectNotice: null,
          };
        }
        const notice = committedSideEffectNotice(active.experience);
        const truncated = truncateMessagesAfterUserEdit(
          active.messages,
          messageId,
          content,
        );
        if (!truncated.ok) {
          return {
            ok: false,
            truncatedCount: 0,
            sideEffectNotice: null,
          };
        }
        // Preserve mode preference; clear uncommitted preview only.
        // Keep courseId/sessionId on experience only as read-only notice source —
        // learn-flow slice is reset so UI does not show stale outline/choices.
        const modePref = active.modePreference ?? null;
        const preservedCommitted = {
          courseId: active.experience?.courseId ?? null,
          sessionId: active.experience?.sessionId ?? null,
        };
        set((state) => ({
          conversations: state.conversations.map((c) => {
            if (c.id !== activeId) return c;
            return {
              ...c,
              messages: truncated.messages,
              currentTurnId: null,
              experience: {
                ...emptyExperienceSnapshot(modePref),
                // Retain ids only for side-effect notice / navigation — not live preview.
                courseId: preservedCommitted.courseId,
                sessionId: preservedCommitted.sessionId,
              },
              updatedAt: new Date(),
            };
          }),
        }));
        // Reset active learn-flow slice but restore mode preference for regenerate.
        useLearnFlowStore.getState().resetActiveSlice();
        if (modePref) {
          useLearnFlowStore.getState().setModePreference(modePref);
        }
        return {
          ok: true,
          truncatedCount: truncated.truncatedCount,
          sideEffectNotice: notice,
          messageId,
          content: content.trim(),
        };
      },

      prepareAssistantRegenerate: (assistantMessageId) => {
        const activeId = get().activeConversationId;
        if (!activeId) {
          return {
            ok: false,
            userMessageId: null,
            userContent: null,
            truncatedCount: 0,
            sideEffectNotice: null,
          };
        }
        const active = get().conversations.find((c) => c.id === activeId);
        if (!active) {
          return {
            ok: false,
            userMessageId: null,
            userContent: null,
            truncatedCount: 0,
            sideEffectNotice: null,
          };
        }
        const notice = committedSideEffectNotice(active.experience);
        const prepared = truncateForAssistantRegenerate(
          active.messages,
          assistantMessageId,
        );
        if (!prepared.ok) {
          return {
            ok: false,
            userMessageId: null,
            userContent: null,
            truncatedCount: 0,
            sideEffectNotice: null,
          };
        }
        const modePref = active.modePreference ?? null;
        const preservedCommitted = {
          courseId: active.experience?.courseId ?? null,
          sessionId: active.experience?.sessionId ?? null,
        };
        set((state) => ({
          conversations: state.conversations.map((c) => {
            if (c.id !== activeId) return c;
            return {
              ...c,
              messages: prepared.messages,
              currentTurnId: null,
              experience: {
                ...emptyExperienceSnapshot(modePref),
                courseId: preservedCommitted.courseId,
                sessionId: preservedCommitted.sessionId,
              },
              updatedAt: new Date(),
            };
          }),
        }));
        useLearnFlowStore.getState().resetActiveSlice();
        if (modePref) {
          useLearnFlowStore.getState().setModePreference(modePref);
        }
        return {
          ok: true,
          userMessageId: prepared.userMessageId,
          userContent: prepared.userContent,
          truncatedCount: prepared.truncatedCount,
          sideEffectNotice: notice,
        };
      },

      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
      clearMessages: () => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === state.activeConversationId
              ? {
                  ...c,
                  messages: [],
                  currentTurnId: null,
                  experience: emptyExperienceSnapshot(c.modePreference ?? null),
                  updatedAt: new Date(),
                }
              : c,
          ),
          error: null,
        }));
        useLearnFlowStore.getState().resetActiveSlice();
        get().pruneEmptyConversations();
      },

      pruneEmptyConversations: () => {
        set((state) => {
          const conversations = stripEmptyConversations(state.conversations);
          return {
            conversations,
            activeConversationId: resolveActiveConversationId(
              conversations,
              state.activeConversationId,
            ),
          };
        });
      },
    }),
    {
      name: 'minus-chat',
      // Next.js renders this store on the server where localStorage is absent.
      // Rehydrate explicitly behind the app hydration gate so the server HTML
      // and the first client render always use the same neutral state.
      skipHydration: true,
      version: CHAT_PERSIST_SCHEMA_VERSION,
      partialize: (state) => {
        const slice = persistableChatSlice({
          conversations: state.conversations,
          activeConversationId: state.activeConversationId,
        });
        return {
          version: CHAT_PERSIST_SCHEMA_VERSION,
          conversations: slice.conversations,
          activeConversationId: slice.activeConversationId,
        };
      },
      migrate: (persisted, fromVersion) => {
        void fromVersion;
        const result = migrateChatPersistToV2(persisted);
        if (!result.ok) {
          // Fail-closed: do not replace payload with empty conversations.
          // Tag for merge; raw fields preserved for inspection.
          const base =
            persisted && typeof persisted === 'object'
              ? { ...(persisted as object) }
              : {};
          return {
            ...base,
            __migrateFailed: true,
            __migrateReason: result.reason,
            __rawPreserved: true,
          };
        }
        return result.state;
      },
      merge: (persisted, current) => {
        const raw = persisted as Record<string, unknown> | undefined;
        if (raw && raw.__migrateFailed === true) {
          // Keep in-memory current; surface error; never silent wipe.
          return {
            ...current,
            rehydrateError:
              typeof raw.__migrateReason === 'string'
                ? raw.__migrateReason
                : 'chat persist migration failed',
          };
        }
        const result = rehydrateChatPersistV2(persisted ?? null);
        if (!result.ok) {
          return {
            ...current,
            rehydrateError: result.reason,
          };
        }
        return {
          ...current,
          version: CHAT_PERSIST_SCHEMA_VERSION,
          conversations: result.state.conversations as Conversation[],
          activeConversationId: result.state.activeConversationId,
          rehydrateError: null,
        };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          // Do not wipe — leave in-memory defaults.
          return;
        }
        if (!state) return;
        if (state.rehydrateError) return;

        // Bind learn-flow to restored active conversation experience.
        const activeId = state.activeConversationId;
        if (activeId) {
          const conv = state.conversations.find((c) => c.id === activeId);
          useLearnFlowStore.getState().bindConversation(activeId, {
            snapshot:
              conv?.experience ??
              emptyExperienceSnapshot(conv?.modePreference ?? null),
            forceSnapshot: true,
          });
        } else {
          useLearnFlowStore.getState().bindConversation(null, {
            resetDraft: true,
          });
        }
      },
    },
  ),
);

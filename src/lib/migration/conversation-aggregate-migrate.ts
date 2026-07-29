/**
 * Batch-02 — Chat persist schema v2 migration (conversation aggregate).
 *
 * - version 1 / unversioned: conversations + activeConversationId (+ optional legacy global learn-flow)
 * - version 2: each conversation holds modePreference / experience / currentTurnId;
 *   messages may hold turnId / status / artifacts (optional; legacy readable)
 *
 * Fail-closed: corrupt payloads are NOT replaced with empty stores.
 */

import {
  CHAT_PERSIST_SCHEMA_VERSION,
  backfillConversationTitle,
  emptyExperienceSnapshot,
  isGenericConversationTitle,
  type LearnFlowSliceKey,
} from '@/lib/chat/conversation-aggregate';
import {
  conversationHasContent,
  persistableChatSlice,
  resolveActiveConversationId,
  stripEmptyConversations,
  type ConversationLike,
} from '@/lib/navigation/draft-conversation';
import { migrateLearnFlowStage } from '@/lib/migration/ux08-client-migrate';
import type {
  ConversationExperienceSnapshot,
  Message,
  MessageTurnArtifact,
  UserModePreference,
} from '@/types/agent';

export { CHAT_PERSIST_SCHEMA_VERSION };

export type ChatPersistV2Conversation = ConversationLike & {
  title?: string;
  playbookId?: string;
  createdAt?: Date | string | number;
  updatedAt?: Date | string | number;
  modePreference?: UserModePreference;
  experience?: ConversationExperienceSnapshot | null;
  currentTurnId?: string | null;
  messages: Array<
    Partial<Message> & {
      id?: string;
      role?: string;
      content?: string;
      timestamp?: Date | string | number;
      turnId?: string;
      status?: Message['status'];
      artifacts?: MessageTurnArtifact[];
    }
  >;
};

export type ChatPersistV2State = {
  version: typeof CHAT_PERSIST_SCHEMA_VERSION;
  conversations: ChatPersistV2Conversation[];
  activeConversationId: string | null;
};

export type ChatMigrateSuccess = {
  ok: true;
  state: ChatPersistV2State;
  notes: string[];
  /** Empty drafts stripped only — never contentful. */
  strippedEmpty: number;
};

export type ChatMigrateFailure = {
  ok: false;
  reason: string;
  /** Caller must not invent empty store / silent wipe. */
  preservedRaw: true;
  raw: unknown;
};

export type ChatMigrateResult = ChatMigrateSuccess | ChatMigrateFailure;

/** Legacy global learn-flow shape that may live beside chat persist. */
export type LegacyGlobalLearnFlow = {
  stage?: string | null;
  topic?: string;
  proposal?: string;
  experienceMode?: string | null;
  modePreference?: UserModePreference;
  courseId?: string | null;
  sessionId?: string | null;
  outlineUnits?: unknown[];
  artifacts?: MessageTurnArtifact[];
  memoryEntries?: string[];
  calibrationQuestion?: string;
  calibrationOptions?: string[];
  calibrationKind?: ConversationExperienceSnapshot['calibrationKind'];
  lastRoute?: string | null;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeModePreference(raw: unknown): UserModePreference {
  if (raw === 'normal' || raw === 'deep') return raw;
  if (raw === null) return null;
  return null;
}

function normalizeMessage(
  raw: unknown,
  index: number,
): ChatPersistV2Conversation['messages'][number] | null {
  if (!isPlainObject(raw)) return null;
  const role = raw.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'tool') {
    // Keep readable best-effort if content exists
    if (typeof raw.content !== 'string') return null;
  }
  const content = typeof raw.content === 'string' ? raw.content : '';
  const id =
    typeof raw.id === 'string' && raw.id
      ? raw.id
      : `msg_migrated_${index}_${Math.random().toString(36).slice(2, 6)}`;
  const timestamp = raw.timestamp
    ? new Date(raw.timestamp as string | number | Date)
    : new Date();

  const msg: ChatPersistV2Conversation['messages'][number] = {
    ...raw,
    id,
    role: (role === 'user' || role === 'assistant' || role === 'tool'
      ? role
      : 'assistant') as Message['role'],
    content,
    timestamp,
  };

  // A browser refresh cannot resume the client-owned fetch/stream. Persisted
  // in-flight assistant messages must therefore become retryable terminal
  // messages instead of restoring an endless thinking indicator.
  const wasInterruptedAssistant =
    msg.role === 'assistant' &&
    (raw.thinking === true || raw.status === 'pending' || raw.status === 'streaming');
  if (wasInterruptedAssistant) {
    msg.thinking = false;
    msg.status = 'error';
    if (!content.trim()) {
      msg.content = '上次回答在生成完成前中断，请重新生成。';
    }
  }

  // Optional metadata — omit when absent (legacy readable)
  if (typeof raw.turnId === 'string') msg.turnId = raw.turnId;
  if (typeof raw.status === 'string' && !wasInterruptedAssistant) {
    msg.status = raw.status as Message['status'];
  }
  if (Array.isArray(raw.artifacts)) {
    msg.artifacts = raw.artifacts as MessageTurnArtifact[];
  }

  return msg;
}

function normalizeExperience(
  raw: unknown,
  fallbackMode: UserModePreference,
): ConversationExperienceSnapshot {
  if (!isPlainObject(raw)) {
    return emptyExperienceSnapshot(fallbackMode);
  }
  return {
    stage: migrateLearnFlowStage(
      typeof raw.stage === 'string' ? raw.stage : 'idle',
    ),
    topic: typeof raw.topic === 'string' ? raw.topic : '',
    proposal: typeof raw.proposal === 'string' ? raw.proposal : '',
    experienceMode:
      typeof raw.experienceMode === 'string' ? raw.experienceMode : null,
    modePreference: normalizeModePreference(
      raw.modePreference !== undefined ? raw.modePreference : fallbackMode,
    ),
    courseId: typeof raw.courseId === 'string' ? raw.courseId : null,
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
    outlineUnits: Array.isArray(raw.outlineUnits) ? raw.outlineUnits : [],
    artifacts: Array.isArray(raw.artifacts)
      ? (raw.artifacts as MessageTurnArtifact[])
      : [],
    memoryEntries: Array.isArray(raw.memoryEntries)
      ? (raw.memoryEntries as string[])
      : [],
    calibrationQuestion:
      typeof raw.calibrationQuestion === 'string' ? raw.calibrationQuestion : '',
    calibrationOptions: Array.isArray(raw.calibrationOptions)
      ? (raw.calibrationOptions as string[])
      : [],
    calibrationKind:
      raw.calibrationKind === 'single_choice' ||
      raw.calibrationKind === 'multi_choice' ||
      raw.calibrationKind === 'free_text'
        ? raw.calibrationKind
        : null,
    lastRoute: typeof raw.lastRoute === 'string' ? raw.lastRoute : null,
    updatedAt:
      typeof raw.updatedAt === 'string'
        ? raw.updatedAt
        : new Date().toISOString(),
  };
}

function normalizeConversation(
  raw: unknown,
): ChatPersistV2Conversation | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (!Array.isArray(raw.messages)) return null;

  const messages: ChatPersistV2Conversation['messages'] = [];
  for (let i = 0; i < raw.messages.length; i++) {
    const m = normalizeMessage(raw.messages[i], i);
    if (m) messages.push(m);
  }

  // If every message was garbage but array was non-empty → treat as corrupt conv
  if (raw.messages.length > 0 && messages.length === 0) {
    return null;
  }

  const modePreference = normalizeModePreference(raw.modePreference);
  const titleRaw = typeof raw.title === 'string' ? raw.title : '新对话';
  const title = backfillConversationTitle({
    title: titleRaw,
    messages: messages.map((m: { role?: string; content?: string }) => ({
      role: String(m.role || ''),
      content: String(m.content || ''),
    })),
  });

  return {
    id: raw.id,
    title,
    messages,
    playbookId: typeof raw.playbookId === 'string' ? raw.playbookId : undefined,
    createdAt: raw.createdAt
      ? new Date(raw.createdAt as string | number | Date)
      : new Date(),
    updatedAt: raw.updatedAt
      ? new Date(raw.updatedAt as string | number | Date)
      : new Date(),
    modePreference,
    experience: normalizeExperience(raw.experience, modePreference),
    currentTurnId:
      typeof raw.currentTurnId === 'string' ? raw.currentTurnId : null,
  };
}

/**
 * Attach legacy global learn-flow to the active conversation's experience.
 * Does not create conversations. Does not wipe other conversations.
 */
export function migrateGlobalLearnFlowToActiveConversation(
  state: ChatPersistV2State,
  global: LegacyGlobalLearnFlow | null | undefined,
): ChatPersistV2State {
  if (!global || !isPlainObject(global as object)) return state;
  const activeId = state.activeConversationId;
  if (!activeId) return state;

  const conversations = state.conversations.map((c) => {
    if (c.id !== activeId) return c;
    const modePreference = normalizeModePreference(
      global.modePreference ?? c.modePreference ?? null,
    );
    const experience = normalizeExperience(
      {
        stage: global.stage,
        topic: global.topic,
        proposal: global.proposal,
        experienceMode: global.experienceMode,
        modePreference,
        courseId: global.courseId,
        sessionId: global.sessionId,
        outlineUnits: global.outlineUnits,
        artifacts: global.artifacts,
        memoryEntries: global.memoryEntries,
        calibrationQuestion: global.calibrationQuestion,
        calibrationOptions: global.calibrationOptions,
        calibrationKind: global.calibrationKind,
        lastRoute: global.lastRoute,
      },
      modePreference,
    );
    return {
      ...c,
      modePreference,
      experience,
    };
  });

  return { ...state, conversations };
}

/**
 * Migrate arbitrary localStorage / zustand persist payload to schema v2.
 * Fail-closed on structural corruption (does not return empty conversations).
 */
export function migrateChatPersistToV2(
  raw: unknown,
  opts?: { legacyGlobalLearnFlow?: LegacyGlobalLearnFlow | null },
): ChatMigrateResult {
  const notes: string[] = [];

  if (raw == null) {
    // First launch — empty is valid
    return {
      ok: true,
      state: {
        version: CHAT_PERSIST_SCHEMA_VERSION,
        conversations: [],
        activeConversationId: null,
      },
      notes: ['empty_initial'],
      strippedEmpty: 0,
    };
  }

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      reason: 'chat persist payload is not an object',
      preservedRaw: true,
      raw,
    };
  }

  if (!('conversations' in raw)) {
    return {
      ok: false,
      reason: 'chat persist missing conversations field',
      preservedRaw: true,
      raw,
    };
  }

  if (!Array.isArray(raw.conversations)) {
    return {
      ok: false,
      reason: 'chat persist conversations is not an array',
      preservedRaw: true,
      raw,
    };
  }

  const version =
    typeof raw.version === 'number' ? raw.version : raw.version === undefined ? 1 : -1;
  if (version !== 1 && version !== 2 && version !== CHAT_PERSIST_SCHEMA_VERSION) {
    // Unknown future version — fail-closed, do not downgrade wipe
    if (version > CHAT_PERSIST_SCHEMA_VERSION) {
      return {
        ok: false,
        reason: `unsupported chat persist version: ${version}`,
        preservedRaw: true,
        raw,
      };
    }
    if (version < 1 && version !== -1) {
      return {
        ok: false,
        reason: `invalid chat persist version: ${version}`,
        preservedRaw: true,
        raw,
      };
    }
  }
  if (version === 1 || raw.version === undefined) {
    notes.push('upgraded_from_v1_or_unversioned');
  }

  const normalized: ChatPersistV2Conversation[] = [];
  let corruptCount = 0;
  for (let i = 0; i < raw.conversations.length; i++) {
    const c = normalizeConversation(raw.conversations[i]);
    if (c) normalized.push(c);
    else {
      // Only skip if the row was empty-looking; if id existed with bad messages, fail-closed
      const row = raw.conversations[i];
      if (
        isPlainObject(row) &&
        typeof row.id === 'string' &&
        Array.isArray(row.messages) &&
        row.messages.length > 0
      ) {
        corruptCount += 1;
      }
    }
  }

  if (corruptCount > 0 && normalized.length === 0 && raw.conversations.length > 0) {
    return {
      ok: false,
      reason: `all ${corruptCount} contentful conversations failed normalization`,
      preservedRaw: true,
      raw,
    };
  }
  if (corruptCount > 0) {
    notes.push(`skipped_corrupt_conversations:${corruptCount}`);
  }

  // Title backfill stats
  let backfilled = 0;
  for (const c of normalized) {
    if (
      conversationHasContent(c) &&
      isGenericConversationTitle(
        typeof (raw.conversations as Array<{ id?: string; title?: string }>).find(
          (r) => r?.id === c.id,
        )?.title,
      ) &&
      !isGenericConversationTitle(c.title)
    ) {
      backfilled += 1;
    }
  }
  if (backfilled > 0) notes.push(`title_backfill:${backfilled}`);

  const before = normalized.length;
  const conversations = stripEmptyConversations(normalized);
  const strippedEmpty = Math.max(0, before - conversations.length);
  if (strippedEmpty > 0) notes.push(`stripped_empty:${strippedEmpty}`);

  const activeConversationId = resolveActiveConversationId(
    conversations,
    typeof raw.activeConversationId === 'string'
      ? raw.activeConversationId
      : null,
  );

  let state: ChatPersistV2State = {
    version: CHAT_PERSIST_SCHEMA_VERSION,
    conversations,
    activeConversationId,
  };

  if (opts?.legacyGlobalLearnFlow) {
    state = migrateGlobalLearnFlowToActiveConversation(
      state,
      opts.legacyGlobalLearnFlow,
    );
    notes.push('migrated_global_learn_flow_to_active');
  }

  // Also accept legacy global nested on same payload
  if (isPlainObject(raw.learnFlow) || isPlainObject(raw.globalLearnFlow)) {
    state = migrateGlobalLearnFlowToActiveConversation(
      state,
      (raw.learnFlow || raw.globalLearnFlow) as LegacyGlobalLearnFlow,
    );
    notes.push('migrated_embedded_global_learn_flow');
  }

  return {
    ok: true,
    state: {
      version: CHAT_PERSIST_SCHEMA_VERSION,
      ...persistableChatSlice({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
      }),
    },
    notes,
    strippedEmpty,
  };
}

/**
 * Rehydrate helper for zustand onRehydrateStorage.
 * On failure returns null so caller can fail-closed without wiping.
 */
export function rehydrateChatPersistV2(
  raw: unknown,
  opts?: { legacyGlobalLearnFlow?: LegacyGlobalLearnFlow | null },
): ChatMigrateResult {
  return migrateChatPersistToV2(raw, opts);
}

/**
 * Build a learn-flow slice map seed from migrated conversations.
 * Active conversation gets experience; others get idle snapshots from their experience field.
 */
export function seedLearnFlowSlicesFromChat(
  state: ChatPersistV2State,
): Record<LearnFlowSliceKey, ConversationExperienceSnapshot> {
  const out: Record<LearnFlowSliceKey, ConversationExperienceSnapshot> = {};
  for (const c of state.conversations) {
    out[c.id] = c.experience
      ? { ...c.experience }
      : emptyExperienceSnapshot(c.modePreference ?? null);
  }
  return out;
}

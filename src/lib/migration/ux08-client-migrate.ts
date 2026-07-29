/**
 * UX08 — Safe client/local data migration.
 *
 * Goals:
 * - Migrate legacy learn-flow stage names, activeAppView aliases, empty conversations
 * - Keep courses / Memory / safety grants / HITL audit compatible
 * - Never silently delete contentful user data or reset safety grants without cause
 *
 * Destructive drops are limited to: empty conversations (no messages),
 * unparseable orphan keys, and expired autonomy grants (existing B03 policy).
 */

import {
  appViewToPath,
  type RouteAppView,
} from '@/lib/navigation/app-routes';
import {
  conversationHasContent,
  persistableChatSlice,
  resolveActiveConversationId,
  stripEmptyConversations,
  type ConversationLike,
} from '@/lib/navigation/draft-conversation';
import {
  normalizeLearnStage,
  type LearnFlowStage,
} from '@/lib/agents/learn-state-machine';
import {
  isV1LearningData,
  migrateV1ToV2,
} from '@/lib/learning/migrate';
import { migrateFromExecutionMode } from '@/lib/agent/action-policy-core';

export const UX08_MIGRATE_VERSION = 1 as const;

// ── Learn-flow stage ───────────────────────────────────────────────────────

/**
 * Map any stored/orchestrator stage string to the canonical learn-flow stage.
 * Unknown stages → idle (safe default; does not wipe topic/outline payloads).
 */
export function migrateLearnFlowStage(
  stage: string | null | undefined,
): LearnFlowStage {
  return normalizeLearnStage(stage);
}

/**
 * Migrate a partial learn-flow snapshot (localStorage / in-memory resume).
 * Preserves topic, outline, course/session ids; normalizes stage only.
 */
export function migrateLearnFlowSnapshot<
  T extends {
    stage?: string | null;
    topic?: string | null;
    courseId?: string | null;
    sessionId?: string | null;
    outlineUnits?: unknown[];
    experienceMode?: string | null;
  },
>(snap: T): T & { stage: LearnFlowStage } {
  return {
    ...snap,
    stage: migrateLearnFlowStage(snap.stage),
  };
}

// ── activeAppView / URL ────────────────────────────────────────────────────

/** Legacy view names that may appear in old UI store / bookmarks. */
const LEGACY_VIEW_MAP: Record<string, RouteAppView> = {
  home: 'home',
  chat: 'home',
  feed: 'home',
  library: 'library',
  knowledge: 'library',
  calendar: 'calendar',
  history: 'history',
  session: 'session',
  course: 'session',
  video: 'video',
};

/**
 * Map legacy activeAppView / activeLearningView strings to RouteAppView + path.
 * URL remains source of truth; this only helps compatibility mirrors.
 */
export function migrateActiveAppView(
  raw: string | null | undefined,
  opts?: { courseId?: string | null },
): { view: RouteAppView; path: string; legacy: boolean } {
  const key = (raw || 'home').trim().toLowerCase();
  const mapped = LEGACY_VIEW_MAP[key];
  if (mapped) {
    return {
      view: mapped,
      path: appViewToPath(mapped, { courseId: opts?.courseId }),
      legacy: key !== mapped && key !== 'home',
    };
  }
  return {
    view: 'home',
    path: appViewToPath('home'),
    legacy: Boolean(raw),
  };
}

// ── Conversations ──────────────────────────────────────────────────────────

export type MigratedChatState<T extends ConversationLike> = {
  conversations: T[];
  activeConversationId: string | null;
  /** Count of empty conversations removed (never removes contentful ones). */
  strippedEmpty: number;
};

/**
 * Migrate persisted chat state:
 * - Drop empty conversations only (no messages)
 * - Keep all contentful conversations and titles
 * - Clear active id when it pointed at an empty/missing conv
 */
export function migrateChatPersistedState<T extends ConversationLike>(state: {
  conversations?: T[] | null;
  activeConversationId?: string | null;
}): MigratedChatState<T> {
  const raw = Array.isArray(state.conversations) ? state.conversations : [];
  const before = raw.length;
  const conversations = stripEmptyConversations(raw);
  const activeConversationId = resolveActiveConversationId(
    conversations,
    state.activeConversationId,
  );
  return {
    conversations,
    activeConversationId,
    strippedEmpty: Math.max(0, before - conversations.length),
  };
}

/**
 * Safe rehydrate helper for zustand chat persist.
 * Dates are rehydrated; empties stripped; content preserved.
 */
export function rehydrateChatPersistSlice<
  T extends ConversationLike & {
    createdAt?: Date | string | number;
    updatedAt?: Date | string | number;
    title?: string;
    messages: unknown[];
  },
>(state: {
  conversations?: T[] | null;
  activeConversationId?: string | null;
}): {
  conversations: T[];
  activeConversationId: string | null;
} {
  const withDates = (Array.isArray(state.conversations) ? state.conversations : []).map(
    (c) => ({
      ...c,
      createdAt: c.createdAt ? new Date(c.createdAt as Date | string | number) : new Date(),
      updatedAt: c.updatedAt ? new Date(c.updatedAt as Date | string | number) : new Date(),
    }),
  ) as T[];

  const migrated = migrateChatPersistedState({
    conversations: withDates,
    activeConversationId: state.activeConversationId,
  });

  return persistableChatSlice({
    conversations: migrated.conversations,
    activeConversationId: migrated.activeConversationId,
  });
}

// ── Learning data (courses) ────────────────────────────────────────────────

export type LearningMigrateResult =
  | { ok: true; data: unknown; migratedFromV1: boolean }
  | { ok: false; reason: string; preservedRaw: true };

/**
 * Compatible course/learning payload migration.
 * - v2: pass-through (preserve all entities)
 * - v1: migrate via migrateV1ToV2 (preserve courses/tasks; map statuses)
 * - invalid: do **not** invent empty data; report failure so caller keeps file
 */
export function migrateLearningPayloadCompat(raw: unknown): LearningMigrateResult {
  if (raw == null || typeof raw !== 'object') {
    return { ok: false, reason: 'learning payload missing', preservedRaw: true };
  }
  const version = (raw as { version?: unknown }).version;
  if (version === 2) {
    return { ok: true, data: raw, migratedFromV1: false };
  }
  if (isV1LearningData(raw) || version === 1) {
    try {
      const data = migrateV1ToV2(raw);
      return { ok: true, data, migratedFromV1: true };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : 'v1 migrate failed',
        preservedRaw: true,
      };
    }
  }
  // Unknown version — preserve; do not wipe
  return {
    ok: false,
    reason: `unsupported learning version: ${String(version)}`,
    preservedRaw: true,
  };
}

// ── Memory ─────────────────────────────────────────────────────────────────

export type MemoryMigrateResult =
  | { ok: true; data: Record<string, unknown>; notes: string[] }
  | { ok: false; reason: string; preservedRaw: true };

/**
 * Memory store compat: keep memories/persona; fill missing version defaults.
 * Never drops confirmed memories.
 */
export function migrateMemoryPayloadCompat(raw: unknown): MemoryMigrateResult {
  if (raw == null || typeof raw !== 'object') {
    return { ok: false, reason: 'memory payload missing', preservedRaw: true };
  }
  const obj = { ...(raw as Record<string, unknown>) };
  const notes: string[] = [];

  if (obj.version !== 2) {
    obj.version = 2;
    notes.push('normalized memory.version → 2');
  }
  if (!Array.isArray(obj.memories)) {
    // Preserve unknown shape rather than wiping
    if (obj.memories != null) {
      return {
        ok: false,
        reason: 'memories field is not an array',
        preservedRaw: true,
      };
    }
    obj.memories = [];
    notes.push('defaulted empty memories[]');
  }
  if (!Array.isArray(obj.strengths)) obj.strengths = [];
  if (!Array.isArray(obj.stylePrefs)) obj.stylePrefs = [];
  if (typeof obj.persona !== 'string') obj.persona = '';
  if (typeof obj.externalDoc !== 'string') obj.externalDoc = '';

  return { ok: true, data: obj, notes };
}

// ── Safety grants ──────────────────────────────────────────────────────────

export type SafetyMigrateInput = {
  executionMode?: 'sandbox' | 'trust';
  executionEnvironment?: 'sandbox' | 'local';
  approvalPolicy?: string;
  autonomyGrant?: {
    expiresAt?: string;
    [k: string]: unknown;
  } | null;
};

/**
 * Map legacy executionMode-only settings → env + policy.
 * Expired grants downgrade via caller policy (B03); this helper only maps mode.
 * Does not invent full_auto or trust elevation.
 */
export function migrateSafetyFieldsCompat(input: SafetyMigrateInput): {
  executionMode: 'sandbox' | 'trust';
  executionEnvironment: 'sandbox' | 'local';
  approvalPolicy: string;
  grantExpired: boolean;
} {
  const mapped = migrateFromExecutionMode(input.executionMode);
  let executionEnvironment =
    input.executionEnvironment === 'local' || input.executionEnvironment === 'sandbox'
      ? input.executionEnvironment
      : mapped.executionEnvironment;
  let approvalPolicy =
    typeof input.approvalPolicy === 'string' && input.approvalPolicy
      ? input.approvalPolicy
      : mapped.approvalPolicy;

  let grantExpired = false;
  const exp = input.autonomyGrant?.expiresAt;
  if (exp) {
    const t = Date.parse(exp);
    grantExpired = !Number.isFinite(t) || t <= Date.now();
  }

  if (
    grantExpired &&
    (approvalPolicy === 'bounded_auto' || approvalPolicy === 'full_auto')
  ) {
    approvalPolicy = 'supervised';
    executionEnvironment = 'sandbox';
  }

  const executionMode: 'sandbox' | 'trust' =
    executionEnvironment === 'local' ? 'trust' : 'sandbox';

  return {
    executionMode,
    executionEnvironment,
    approvalPolicy,
    grantExpired,
  };
}

// ── HITL audit ─────────────────────────────────────────────────────────────

export type HitlAuditLike = {
  id?: string;
  kind?: string;
  at?: string;
  [k: string]: unknown;
};

/**
 * HITL audit records: keep valid entries; skip only null/non-object rows.
 * Never rewrites allow/deny semantics.
 */
export function migrateHitlAuditRecords(
  records: unknown,
): { records: HitlAuditLike[]; dropped: number } {
  if (!Array.isArray(records)) {
    return { records: [], dropped: 0 };
  }
  const out: HitlAuditLike[] = [];
  let dropped = 0;
  for (const row of records) {
    if (row && typeof row === 'object') {
      out.push(row as HitlAuditLike);
    } else {
      dropped += 1;
    }
  }
  return { records: out, dropped };
}

// ── Aggregate client bootstrap ─────────────────────────────────────────────

export type ClientBootstrapInput = {
  chat?: {
    conversations?: ConversationLike[];
    activeConversationId?: string | null;
  };
  learnFlowStage?: string | null;
  activeAppView?: string | null;
  courseId?: string | null;
  learningData?: unknown;
  memory?: unknown;
  safety?: SafetyMigrateInput;
  hitlAudit?: unknown;
};

export type ClientBootstrapResult = {
  migrateVersion: typeof UX08_MIGRATE_VERSION;
  chat: MigratedChatState<ConversationLike>;
  learnFlowStage: LearnFlowStage;
  appView: { view: RouteAppView; path: string; legacy: boolean };
  learning: LearningMigrateResult;
  memory: MemoryMigrateResult;
  safety: ReturnType<typeof migrateSafetyFieldsCompat> | null;
  hitlAudit: { records: HitlAuditLike[]; dropped: number };
};

/**
 * One-shot client bootstrap migration used by tests and optional rehydrate hooks.
 * Each domain is independent — failure in one does not wipe another.
 */
export function migrateClientBootstrap(
  input: ClientBootstrapInput,
): ClientBootstrapResult {
  return {
    migrateVersion: UX08_MIGRATE_VERSION,
    chat: migrateChatPersistedState(input.chat ?? {}),
    learnFlowStage: migrateLearnFlowStage(input.learnFlowStage),
    appView: migrateActiveAppView(input.activeAppView, {
      courseId: input.courseId,
    }),
    learning:
      input.learningData === undefined
        ? { ok: true, data: null, migratedFromV1: false }
        : migrateLearningPayloadCompat(input.learningData),
    memory:
      input.memory === undefined
        ? { ok: true, data: { version: 2, memories: [] }, notes: ['empty default'] }
        : migrateMemoryPayloadCompat(input.memory),
    safety: input.safety ? migrateSafetyFieldsCompat(input.safety) : null,
    hitlAudit: migrateHitlAuditRecords(input.hitlAudit ?? []),
  };
}

/** Guard: contentful conversations must survive migration. */
export function assertNoContentLoss(
  before: ConversationLike[],
  after: ConversationLike[],
): { ok: true } | { ok: false; lostIds: string[] } {
  const afterIds = new Set(after.map((c) => c.id));
  const lostIds = before
    .filter(conversationHasContent)
    .filter((c) => !afterIds.has(c.id))
    .map((c) => c.id);
  return lostIds.length === 0 ? { ok: true } : { ok: false, lostIds };
}

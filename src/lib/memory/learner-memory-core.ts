/**
 * Client-safe learner memory: types, labels, pure migrate/helpers.
 * No Node builtins — safe for client components that only need types/labels.
 * Persistence lives in learner-memory.ts.
 */

export type MemoryPersona =
  | 'high_school'
  | 'undergrad'
  | 'grad'
  | 'self_learner'
  | 'other'
  | '';

export type MemoryStrength =
  | 'math'
  | 'coding'
  | 'humanities'
  | 'business'
  | 'natural_science'
  | 'exploring';

export type MemoryStylePref =
  | 'simple_first'
  | 'analogy_first'
  | 'step_by_step'
  | 'examples_then_theory';

export type MemoryKind = 'preference' | 'goal' | 'fact' | 'other';

export type MemoryStatus =
  | 'proposed'
  | 'confirmed'
  | 'conflicted'
  | 'expired'
  | 'rejected';

export type MemorySource = 'ai' | 'manual';

/** Evidence for a memory: conversation/message id and/or short quote. */
export interface MemoryEvidence {
  conversationId?: string;
  messageId?: string;
  quote?: string;
}

export interface MemoryItem {
  id: string;
  text: string;
  source: MemorySource;
  kind: MemoryKind;
  /** 0–1 confidence from extract / user confirm. */
  confidence: number;
  evidence: MemoryEvidence[];
  firstObservedAt: string;
  lastObservedAt: string;
  status: MemoryStatus;
  /** When true, never inject into Desktop tool prompts. */
  sensitive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LearnerMemoryData {
  version: 2;
  persona: MemoryPersona;
  strengths: MemoryStrength[];
  stylePrefs: MemoryStylePref[];
  memories: MemoryItem[];
  externalDoc: string;
  updatedAt: string;
}

/** Chinese labels for profile enums (display only; never static defaults on empty UI). */
export const PERSONA_LABELS: Record<Exclude<MemoryPersona, ''>, string> = {
  high_school: '高中生',
  undergrad: '本科生',
  grad: '研究生',
  self_learner: '自学者 / 职场人士',
  other: '其他',
};

export const STRENGTH_LABELS: Record<MemoryStrength, string> = {
  math: '数理 / 定量推理',
  coding: '计算机 / 编程',
  humanities: '写作 / 阅读 / 人文',
  business: '商科 / 经济',
  natural_science: '自然科学',
  exploring: '还在摸索',
};

export const STYLE_LABELS: Record<MemoryStylePref, string> = {
  simple_first: '先用简单语言讲清概念',
  analogy_first: '先给例子或类比',
  step_by_step: '一步步拆解',
  examples_then_theory: '先练后讲',
};

export const KIND_LABELS: Record<MemoryKind, string> = {
  preference: '偏好',
  goal: '目标',
  fact: '事实',
  other: '其他',
};

export const STATUS_LABELS: Record<MemoryStatus, string> = {
  proposed: '待确认',
  confirmed: '已确认',
  conflicted: '冲突',
  expired: '已过期',
  rejected: '已拒绝',
};

export const EMPTY_LEARNER_MEMORY: LearnerMemoryData = {
  version: 2,
  persona: '',
  strengths: [],
  stylePrefs: [],
  memories: [],
  externalDoc: '',
  updatedAt: new Date(0).toISOString(),
};

function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function clampConfidence(n: unknown): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : 0.5;
  return Math.max(0, Math.min(1, x));
}

function isMemoryKind(v: unknown): v is MemoryKind {
  return v === 'preference' || v === 'goal' || v === 'fact' || v === 'other';
}

function isMemoryStatus(v: unknown): v is MemoryStatus {
  return (
    v === 'proposed' ||
    v === 'confirmed' ||
    v === 'conflicted' ||
    v === 'expired' ||
    v === 'rejected'
  );
}

function isMemorySource(v: unknown): v is MemorySource {
  return v === 'ai' || v === 'manual';
}

/**
 * Migrate a raw memory item (v1 or partial) to the v2 shape.
 *
 * Migration rule (documented):
 * - Items missing `status` / `confidence` / `evidence`:
 *   - source === 'ai' → status `proposed`, confidence 0.7, empty evidence
 *   - source === 'manual' (or missing) → status `confirmed`, confidence 1, empty evidence
 * - Timestamps: first/lastObservedAt fall back to createdAt / updatedAt
 */
export function migrateMemoryItem(raw: Partial<MemoryItem> & { text?: string }): MemoryItem {
  const now = new Date().toISOString();
  const source: MemorySource = isMemorySource(raw.source) ? raw.source : 'manual';
  const createdAt = typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : now;
  const updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : createdAt;

  let status: MemoryStatus;
  if (isMemoryStatus(raw.status)) {
    status = raw.status;
  } else if (source === 'ai') {
    status = 'proposed';
  } else {
    status = 'confirmed';
  }

  const hasConfidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence);
  const confidence = hasConfidence
    ? clampConfidence(raw.confidence)
    : status === 'confirmed'
      ? 1
      : 0.7;

  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence
        .filter((e): e is MemoryEvidence => e != null && typeof e === 'object')
        .map((e) => ({
          conversationId: e.conversationId ? String(e.conversationId) : undefined,
          messageId: e.messageId ? String(e.messageId) : undefined,
          quote: e.quote ? String(e.quote).slice(0, 200) : undefined,
        }))
    : [];

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    text: String(raw.text || '').trim(),
    source,
    kind: isMemoryKind(raw.kind) ? raw.kind : 'preference',
    confidence,
    evidence,
    firstObservedAt:
      typeof raw.firstObservedAt === 'string' && raw.firstObservedAt
        ? raw.firstObservedAt
        : createdAt,
    lastObservedAt:
      typeof raw.lastObservedAt === 'string' && raw.lastObservedAt
        ? raw.lastObservedAt
        : updatedAt,
    status,
    sensitive: raw.sensitive === true,
    createdAt,
    updatedAt,
  };
}

export function migrateLearnerMemoryData(raw: unknown): LearnerMemoryData {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_LEARNER_MEMORY, memories: [], strengths: [], stylePrefs: [] };
  }
  const p = raw as Partial<LearnerMemoryData> & { version?: number };
  const memories = Array.isArray(p.memories)
    ? p.memories.map((m) => migrateMemoryItem(m as Partial<MemoryItem>)).filter((m) => m.text)
    : [];
  return {
    version: 2,
    persona: (p.persona as MemoryPersona) || '',
    strengths: Array.isArray(p.strengths) ? (p.strengths as MemoryStrength[]) : [],
    stylePrefs: Array.isArray(p.stylePrefs) ? (p.stylePrefs as MemoryStylePref[]) : [],
    memories,
    externalDoc: typeof p.externalDoc === 'string' ? p.externalDoc : '',
    updatedAt:
      typeof p.updatedAt === 'string' && p.updatedAt
        ? p.updatedAt
        : new Date(0).toISOString(),
  };
}

/** True when there is nothing user/AI has contributed (vacuum UI). */
export function isMemoryStoreEmpty(data: LearnerMemoryData): boolean {
  const active = data.memories.filter((m) => m.status !== 'rejected' && m.status !== 'expired');
  return (
    !data.persona &&
    data.strengths.length === 0 &&
    data.stylePrefs.length === 0 &&
    active.length === 0 &&
    !data.externalDoc.trim()
  );
}

/** Active (non-rejected/expired) memories for overview. */
export function listVisibleMemories(data: LearnerMemoryData): MemoryItem[] {
  return data.memories.filter((m) => m.status !== 'rejected' && m.status !== 'expired');
}

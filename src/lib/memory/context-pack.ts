/**
 * LearnerContextPack — minimal labeled Chinese context for agents / chat / session.
 * Sensitive memories never go into Desktop tool prompts.
 *
 * Client-safe pure builders only. Server load: context-pack-server.ts.
 */

import {
  KIND_LABELS,
  PERSONA_LABELS,
  STATUS_LABELS,
  STRENGTH_LABELS,
  STYLE_LABELS,
  type LearnerMemoryData,
  type MemoryItem,
  type MemoryPersona,
  type MemoryStatus,
} from './learner-memory-core';

export type ContextPackAudience =
  | 'intent'
  | 'calibrate'
  | 'outline'
  | 'memory'
  | 'session'
  | 'chat'
  | 'desktop'
  | 'calendar';

export interface LearnerContextPack {
  /** Empty when no usable memory. */
  empty: boolean;
  /** Full labeled Chinese block for system prompts. */
  labeledBlock: string;
  /** Short one-line summary. */
  summaryLine: string;
  /** Entries used (for tests / UI). */
  entries: Array<{
    text: string;
    kind: string;
    status: MemoryStatus;
    confidence: number;
    sensitive: boolean;
  }>;
}

const HIGH_CONFIDENCE_PROPOSED = 0.75;

function isUsableForPack(m: MemoryItem, includeHighProposed: boolean): boolean {
  if (m.status === 'rejected' || m.status === 'expired') return false;
  if (m.status === 'confirmed') return true;
  if (m.status === 'conflicted') return false;
  if (m.status === 'proposed' && includeHighProposed && m.confidence >= HIGH_CONFIDENCE_PROPOSED) {
    return true;
  }
  return false;
}

function profileLines(data: LearnerMemoryData): string[] {
  const lines: string[] = [];
  if (data.persona && data.persona in PERSONA_LABELS) {
    lines.push(`画像：${PERSONA_LABELS[data.persona as Exclude<MemoryPersona, ''>]}`);
  }
  if (data.strengths.length > 0) {
    const labels = data.strengths
      .map((s) => STRENGTH_LABELS[s] || s)
      .filter(Boolean);
    if (labels.length) lines.push(`擅长：${labels.join('、')}`);
  }
  if (data.stylePrefs.length > 0) {
    const labels = data.stylePrefs
      .map((s) => STYLE_LABELS[s] || s)
      .filter(Boolean);
    if (labels.length) lines.push(`学习偏好：${labels.join('、')}`);
  }
  return lines;
}

function selectMemories(
  data: LearnerMemoryData,
  opts: { excludeSensitive: boolean; includeHighProposed: boolean; max: number },
): MemoryItem[] {
  return data.memories
    .filter((m) => isUsableForPack(m, opts.includeHighProposed))
    .filter((m) => !(opts.excludeSensitive && m.sensitive))
    .sort((a, b) => {
      // confirmed first, then confidence, then recency
      const sc = (s: MemoryStatus) => (s === 'confirmed' ? 2 : s === 'proposed' ? 1 : 0);
      if (sc(b.status) !== sc(a.status)) return sc(b.status) - sc(a.status);
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.lastObservedAt.localeCompare(a.lastObservedAt);
    })
    .slice(0, opts.max);
}

/**
 * Build a labeled Chinese pack from confirmed (+ optional high-confidence proposed).
 * Desktop audience always excludes sensitive memories.
 */
export function buildLearnerContextPack(
  data: LearnerMemoryData,
  audience: ContextPackAudience = 'chat',
): LearnerContextPack {
  const excludeSensitive = audience === 'desktop';
  // Desktop / tool prompts: confirmed only, no sensitive
  const includeHighProposed = audience !== 'desktop' && audience !== 'calendar';
  const max =
    audience === 'intent' ? 4 : audience === 'calibrate' || audience === 'outline' ? 6 : 10;

  const profile = profileLines(data);
  const items = selectMemories(data, {
    excludeSensitive,
    includeHighProposed,
    max,
  });

  const ext =
    !excludeSensitive && data.externalDoc.trim()
      ? data.externalDoc.trim().slice(0, 300)
      : '';

  if (profile.length === 0 && items.length === 0 && !ext) {
    return {
      empty: true,
      labeledBlock: '',
      summaryLine: '',
      entries: [],
    };
  }

  const lines: string[] = ['## 学习者上下文（LearnerContextPack）'];
  for (const p of profile) {
    lines.push(`- ${p}`);
  }
  for (const m of items) {
    const kindLabel = KIND_LABELS[m.kind] || m.kind;
    const st = STATUS_LABELS[m.status] || m.status;
    const conf = Math.round(m.confidence * 100);
    lines.push(
      `- [${kindLabel}/${st}/${conf}%] ${m.text}`,
    );
  }
  if (ext) {
    lines.push(`- [外部] ${ext}`);
  }

  const summaryBits = [
    ...profile,
    ...items.slice(0, 3).map((m) => m.text),
  ];
  const summaryLine = summaryBits.join('；').slice(0, 200);

  return {
    empty: false,
    labeledBlock: lines.join('\n'),
    summaryLine,
    entries: items.map((m) => ({
      text: m.text,
      kind: m.kind,
      status: m.status,
      confidence: m.confidence,
      sensitive: m.sensitive,
    })),
  };
}

/**
 * Append pack to a system prompt when non-empty.
 * Never use desktop audience for tool-heavy prompts without excludeSensitive (default).
 */
export function injectContextPack(
  systemPrompt: string,
  pack: LearnerContextPack,
): string {
  if (pack.empty || !pack.labeledBlock.trim()) return systemPrompt;
  return `${systemPrompt}\n\n${pack.labeledBlock}`;
}

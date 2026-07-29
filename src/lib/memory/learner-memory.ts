/**
 * Server-side learner memory persistence (Node fs).
 * Pure types/helpers: learner-memory-core.ts (client-safe).
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export type {
  MemoryPersona,
  MemoryStrength,
  MemoryStylePref,
  MemoryKind,
  MemoryStatus,
  MemorySource,
  MemoryEvidence,
  MemoryItem,
  LearnerMemoryData,
} from './learner-memory-core';

export {
  PERSONA_LABELS,
  STRENGTH_LABELS,
  STYLE_LABELS,
  KIND_LABELS,
  STATUS_LABELS,
  EMPTY_LEARNER_MEMORY,
  clampConfidence,
  migrateMemoryItem,
  migrateLearnerMemoryData,
  isMemoryStoreEmpty,
  listVisibleMemories,
} from './learner-memory-core';

import type {
  MemoryPersona,
  MemoryStrength,
  MemoryStylePref,
  MemoryKind,
  MemoryStatus,
  MemorySource,
  MemoryEvidence,
  MemoryItem,
  LearnerMemoryData,
} from './learner-memory-core';
import {
  EMPTY_LEARNER_MEMORY,
  clampConfidence,
  migrateLearnerMemoryData,
} from './learner-memory-core';

function memoryPath(): string {
  if (process.env.MINUS_DATA_DIR) {
    return path.join(process.env.MINUS_DATA_DIR, 'learner-memory.json');
  }
  return path.join(os.homedir(), '.minus', 'data', 'learner-memory.json');
}

export async function readLearnerMemory(): Promise<LearnerMemoryData> {
  try {
    const raw = await fs.readFile(memoryPath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return migrateLearnerMemoryData(parsed);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return {
        ...EMPTY_LEARNER_MEMORY,
        memories: [],
        strengths: [],
        stylePrefs: [],
      };
    }
    throw err;
  }
}

async function writeLearnerMemory(data: LearnerMemoryData): Promise<void> {
  const dir = path.dirname(memoryPath());
  await fs.mkdir(dir, { recursive: true });
  const next: LearnerMemoryData = {
    ...data,
    version: 2,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(memoryPath(), JSON.stringify(next, null, 2), 'utf8');
}

/**
 * Replace the learner-memory store from a user-selected local backup.
 * The payload is migrated before write and the current file is preserved beside
 * it as a dated backup. Provider secrets are not part of this store.
 */
export async function replaceLearnerMemory(
  input: unknown,
): Promise<LearnerMemoryData> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid learner memory backup');
  }
  const next = migrateLearnerMemoryData(input);
  const target = memoryPath();
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.copyFile(target, `${target}.before-import.${stamp}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
  await writeLearnerMemory(next);
  return next;
}

export async function saveLearnerPreferences(input: {
  persona: MemoryPersona;
  strengths: MemoryStrength[];
  stylePrefs: MemoryStylePref[];
}): Promise<LearnerMemoryData> {
  const current = await readLearnerMemory();
  const next: LearnerMemoryData = {
    ...current,
    persona: input.persona,
    strengths: input.strengths,
    stylePrefs: input.stylePrefs,
  };
  await writeLearnerMemory(next);
  return next;
}

export async function saveExternalDoc(externalDoc: string): Promise<LearnerMemoryData> {
  const current = await readLearnerMemory();
  const next = { ...current, externalDoc };
  await writeLearnerMemory(next);
  return next;
}

export async function upsertMemoryItem(input: {
  id?: string;
  text: string;
  kind?: MemoryKind;
  source?: MemorySource;
  confidence?: number;
  evidence?: MemoryEvidence[];
  status?: MemoryStatus;
  sensitive?: boolean;
}): Promise<LearnerMemoryData> {
  const text = input.text.trim();
  if (!text) throw new Error('Memory text required');
  const current = await readLearnerMemory();
  const now = new Date().toISOString();
  if (input.id) {
    const idx = current.memories.findIndex((m) => m.id === input.id);
    if (idx < 0) throw new Error('Memory not found');
    const prev = current.memories[idx]!;
    current.memories[idx] = {
      ...prev,
      text,
      kind: input.kind || prev.kind,
      confidence:
        input.confidence !== undefined ? clampConfidence(input.confidence) : prev.confidence,
      evidence: input.evidence !== undefined ? input.evidence : prev.evidence,
      status: input.status || prev.status,
      sensitive: input.sensitive !== undefined ? input.sensitive : prev.sensitive,
      lastObservedAt: now,
      updatedAt: now,
    };
  } else {
    const source = input.source || 'manual';
    const status: MemoryStatus =
      input.status || (source === 'ai' ? 'proposed' : 'confirmed');
    current.memories.unshift({
      id: globalThis.crypto.randomUUID(),
      text,
      source,
      kind: input.kind || 'preference',
      confidence:
        input.confidence !== undefined
          ? clampConfidence(input.confidence)
          : status === 'confirmed'
            ? 1
            : 0.7,
      evidence: input.evidence || [],
      firstObservedAt: now,
      lastObservedAt: now,
      status,
      sensitive: input.sensitive === true,
      createdAt: now,
      updatedAt: now,
    });
  }
  await writeLearnerMemory(current);
  return current;
}

export async function deleteMemoryItem(id: string): Promise<LearnerMemoryData> {
  const current = await readLearnerMemory();
  current.memories = current.memories.filter((m) => m.id !== id);
  await writeLearnerMemory(current);
  return current;
}

/** Promote proposed / conflicted → confirmed. */
export async function confirmMemoryItem(id: string): Promise<LearnerMemoryData> {
  const current = await readLearnerMemory();
  const idx = current.memories.findIndex((m) => m.id === id);
  if (idx < 0) throw new Error('Memory not found');
  const now = new Date().toISOString();
  const prev = current.memories[idx]!;
  current.memories[idx] = {
    ...prev,
    status: 'confirmed',
    confidence: Math.max(prev.confidence, 0.9),
    lastObservedAt: now,
    updatedAt: now,
  };
  await writeLearnerMemory(current);
  return current;
}

/** Reject: mark rejected (kept for audit) or hard-delete via deleteMemoryItem. */
export async function rejectMemoryItem(id: string, hardDelete = false): Promise<LearnerMemoryData> {
  if (hardDelete) {
    return deleteMemoryItem(id);
  }
  const current = await readLearnerMemory();
  const idx = current.memories.findIndex((m) => m.id === id);
  if (idx < 0) throw new Error('Memory not found');
  const now = new Date().toISOString();
  const prev = current.memories[idx]!;
  current.memories[idx] = {
    ...prev,
    status: 'rejected',
    updatedAt: now,
  };
  await writeLearnerMemory(current);
  return current;
}

export interface AiMemoryCandidate {
  text: string;
  kind?: MemoryKind;
  confidence?: number;
  evidence?: MemoryEvidence[];
  sensitive?: boolean;
}

/** Pure write helper used by pipeline. */
export async function writeMergedMemories(
  data: LearnerMemoryData,
): Promise<LearnerMemoryData> {
  await writeLearnerMemory(data);
  return data;
}

export async function replaceAllMemories(memories: MemoryItem[]): Promise<LearnerMemoryData> {
  const current = await readLearnerMemory();
  const next = { ...current, memories };
  await writeLearnerMemory(next);
  return next;
}

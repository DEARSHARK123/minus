/**
 * UX04 — Deep Planning outline preview edits (in-memory only).
 * Mutations never persist a course; commit is sole side-effect via「开始学习」.
 */

import type { OutlineUnitArtifact } from '@/lib/agents/types';

export type OutlinePreviewUnit = OutlineUnitArtifact;

function cloneUnits(units: OutlinePreviewUnit[]): OutlinePreviewUnit[] {
  return units.map((u) => ({
    ...u,
    knowledgePoints: [...(u.knowledgePoints ?? [])],
  }));
}

/** Rename a unit by index. Preview-only. */
export function renameOutlineUnit(
  units: OutlinePreviewUnit[],
  index: number,
  title: string,
): OutlinePreviewUnit[] {
  if (index < 0 || index >= units.length) return cloneUnits(units);
  const next = cloneUnits(units);
  next[index] = { ...next[index]!, title: title.trim() || next[index]!.title };
  return next;
}

/** Add a unit at the end (or after index). Preview-only. */
export function addOutlineUnit(
  units: OutlinePreviewUnit[],
  unit?: Partial<OutlinePreviewUnit>,
  afterIndex?: number,
): OutlinePreviewUnit[] {
  const next = cloneUnits(units);
  const created: OutlinePreviewUnit = {
    title: (unit?.title || `单元 ${next.length + 1}`).trim() || `单元 ${next.length + 1}`,
    knowledgePoints: unit?.knowledgePoints?.length
      ? [...unit.knowledgePoints]
      : ['待补充知识点'],
    description: unit?.description,
    estimatedMinutes: unit?.estimatedMinutes,
  };
  if (
    typeof afterIndex === 'number' &&
    afterIndex >= 0 &&
    afterIndex < next.length
  ) {
    next.splice(afterIndex + 1, 0, created);
  } else {
    next.push(created);
  }
  return next;
}

/** Remove a unit by index. Keeps at least one unit when possible. */
export function removeOutlineUnit(
  units: OutlinePreviewUnit[],
  index: number,
  opts?: { allowEmpty?: boolean },
): OutlinePreviewUnit[] {
  if (index < 0 || index >= units.length) return cloneUnits(units);
  if (units.length <= 1 && !opts?.allowEmpty) return cloneUnits(units);
  const next = cloneUnits(units);
  next.splice(index, 1);
  return next;
}

/** Move unit from fromIndex to toIndex. Preview-only. */
export function reorderOutlineUnit(
  units: OutlinePreviewUnit[],
  fromIndex: number,
  toIndex: number,
): OutlinePreviewUnit[] {
  if (
    fromIndex < 0 ||
    fromIndex >= units.length ||
    toIndex < 0 ||
    toIndex >= units.length ||
    fromIndex === toIndex
  ) {
    return cloneUnits(units);
  }
  const next = cloneUnits(units);
  const [item] = next.splice(fromIndex, 1);
  if (!item) return cloneUnits(units);
  next.splice(toIndex, 0, item);
  return next;
}

/** Replace knowledge points for a unit (expand / edit list). Preview-only. */
export function setOutlineUnitKnowledgePoints(
  units: OutlinePreviewUnit[],
  index: number,
  knowledgePoints: string[],
): OutlinePreviewUnit[] {
  if (index < 0 || index >= units.length) return cloneUnits(units);
  const next = cloneUnits(units);
  next[index] = {
    ...next[index]!,
    knowledgePoints: knowledgePoints.map((k) => k.trim()).filter(Boolean),
  };
  return next;
}

/** Add one knowledge point to a unit. */
export function addOutlineKnowledgePoint(
  units: OutlinePreviewUnit[],
  unitIndex: number,
  point: string,
): OutlinePreviewUnit[] {
  if (unitIndex < 0 || unitIndex >= units.length) return cloneUnits(units);
  const text = point.trim();
  if (!text) return cloneUnits(units);
  const next = cloneUnits(units);
  const kps = [...(next[unitIndex]!.knowledgePoints ?? []), text];
  next[unitIndex] = { ...next[unitIndex]!, knowledgePoints: kps };
  return next;
}

/** Remove a knowledge point by indices. */
export function removeOutlineKnowledgePoint(
  units: OutlinePreviewUnit[],
  unitIndex: number,
  kpIndex: number,
): OutlinePreviewUnit[] {
  if (unitIndex < 0 || unitIndex >= units.length) return cloneUnits(units);
  const next = cloneUnits(units);
  const kps = [...(next[unitIndex]!.knowledgePoints ?? [])];
  if (kpIndex < 0 || kpIndex >= kps.length) return next;
  kps.splice(kpIndex, 1);
  next[unitIndex] = { ...next[unitIndex]!, knowledgePoints: kps };
  return next;
}

/** Whether two outlines are structurally equal (for dirty detection). */
export function outlinesEqual(
  a: OutlinePreviewUnit[],
  b: OutlinePreviewUnit[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ua = a[i]!;
    const ub = b[i]!;
    if (ua.title !== ub.title) return false;
    if ((ua.description || '') !== (ub.description || '')) return false;
    const ka = ua.knowledgePoints ?? [];
    const kb = ub.knowledgePoints ?? [];
    if (ka.length !== kb.length) return false;
    for (let j = 0; j < ka.length; j++) {
      if (ka[j] !== kb[j]) return false;
    }
  }
  return true;
}

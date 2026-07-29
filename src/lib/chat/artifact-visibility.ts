/**
 * UX03 — Which learn artifacts may appear in primary UI.
 * Hide empty memory, pure progress_update, and internal rationale.
 * Normal mode: no funnel chrome (confirm_gate / empty memory / progress rail cards).
 */

import type { LearnArtifact } from '@/lib/agents/types';
import { progressRailAllowedForExperienceMode } from '@/lib/agents/learn-state-machine';

export type UiExperienceMode =
  | 'chat'
  | 'normal'
  | 'deep_planning'
  | 'deep_course'
  | 'calendar'
  | 'library'
  | 'desktop'
  | string;

const EMPTY_MEMORY_MARKERS = /暂无长期记忆|no relevant memory|没有相关记忆/i;

/** Empty or non-actionable memory card. */
export function isEmptyMemoryArtifact(a: LearnArtifact): boolean {
  if (a.kind !== 'memory_card') return false;
  const entries = a.memoryEntries?.filter((e) => e.trim()) ?? [];
  if (entries.length > 0) return false;
  const content = (a.content || '').trim();
  if (!content) return true;
  if (EMPTY_MEMORY_MARKERS.test(content)) return true;
  return false;
}

/** Pure progress rail / narrator chrome — not answer content. */
export function isPureProgressUpdate(a: LearnArtifact): boolean {
  return a.kind === 'progress_update';
}

/** Internal audit / engineer-facing titles that must not surface. */
export function hasInternalRationaleLeak(a: LearnArtifact): boolean {
  const blob = `${a.title || ''} ${a.content || ''}`;
  return /internalReason|IntentJudge|OutlineAgent|SkillPlan|ExperiencePlan|propose\s*[≠!=]=\s*commit/i.test(
    blob,
  );
}

/**
 * Filter artifacts for primary Home/Normal UI.
 * - Always drop empty memory, pure progress_update, internal rationale leaks
 * - Normal/chat: drop confirm_gate and memory_card empty paths; keep interactive choices + plain answer
 * - Deep: keep outline / resources / non-empty memory / choices
 */
export function filterVisibleArtifacts(
  artifacts: LearnArtifact[],
  opts?: { experienceMode?: UiExperienceMode | null },
): LearnArtifact[] {
  const mode = opts?.experienceMode || 'chat';
  const deepRail = progressRailAllowedForExperienceMode(mode);
  const isNormalSurface = mode === 'chat' || mode === 'normal';

  return artifacts.filter((a) => {
    if (isPureProgressUpdate(a)) return false;
    if (isEmptyMemoryArtifact(a)) return false;
    if (hasInternalRationaleLeak(a)) return false;

    if (isNormalSurface) {
      // Funnel chrome not shown in Normal — answer lives in assistant bubble
      if (a.kind === 'confirm_gate') return false;
      if (a.kind === 'memory_card') return false;
      if (a.kind === 'outline_card') return false;
      if (a.kind === 'resource_list') return false;
      // Interactive inline: choices / free_text / plain allowed
      return (
        a.kind === 'single_choice' ||
        a.kind === 'multi_choice' ||
        a.kind === 'free_text' ||
        a.kind === 'plain_assistant'
      );
    }

    if (!deepRail && a.kind === 'progress_update') return false;
    return true;
  });
}

/**
 * Whether Home may mount LearnProgressRail.
 *
 * UX08: Home LearnProgressRail is **quarantined** — never mount a second
 * progress chrome next to Normal inline cards or Deep editable outline.
 * Deep Course progress lives on `/course/[id]` Unit tree only.
 *
 * Args kept for call-site / test compatibility.
 */
export function shouldShowLearnProgressRail(
  _experienceMode?: UiExperienceMode | null,
  _stage?: string | null,
): boolean {
  void _experienceMode;
  void _stage;
  return false;
}

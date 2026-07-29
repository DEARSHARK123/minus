/**
 * UX04 — Course follow-up & advance policy (no IntentJudge re-entry).
 * Follow-ups stay on the current unit;「下一节」advances without side-effect confirm.
 */

export type CourseFollowUpDecision =
  | {
      kind: 'follow_up';
      /** Stay on this section/unit. */
      sectionId: string;
      /** Never re-enter intent / experience planner. */
      reenterIntent: false;
      message: string;
    }
  | {
      kind: 'advance';
      fromSectionId: string;
      toSectionId: string | null;
      /** No HITL / side-effect confirmation required for pure content advance. */
      requiresSideEffectConfirm: false;
    }
  | {
      kind: 'complete_course';
      sectionId: string;
      requiresSideEffectConfirm: false;
    };

/**
 * User typed a follow-up question in the course bottom input.
 * Always stays on current unit; never IntentJudge.
 */
export function decideCourseFollowUp(
  message: string,
  currentSectionId: string | null | undefined,
): CourseFollowUpDecision {
  const text = message.trim();
  const sectionId = currentSectionId || '';
  return {
    kind: 'follow_up',
    sectionId,
    reenterIntent: false,
    message: text,
  };
}

/**
 * User chose「下一节」/ proceed after a unit is done.
 * Content advance only — no redundant confirm for no side effect.
 */
export function decideCourseAdvance(
  sections: Array<{ id: string; status: string; order?: number }>,
  currentSectionId: string | null | undefined,
): CourseFollowUpDecision {
  const sorted = [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const currentIdx = sorted.findIndex((s) => s.id === currentSectionId);
  const current = currentIdx >= 0 ? sorted[currentIdx] : sorted.find((s) => s.status === 'open');

  // Prefer next open section after current
  const afterCurrent = sorted.filter(
    (s) => (s.order ?? 0) > (current?.order ?? -1) && s.status !== 'locked',
  );
  const nextOpen =
    afterCurrent.find((s) => s.status === 'open' || s.status === 'done') ||
    sorted.find((s) => s.status === 'open' && s.id !== current?.id);

  if (nextOpen && nextOpen.id !== current?.id) {
    return {
      kind: 'advance',
      fromSectionId: current?.id || '',
      toSectionId: nextOpen.id,
      requiresSideEffectConfirm: false,
    };
  }

  // All done
  if (sorted.every((s) => s.status === 'done')) {
    return {
      kind: 'complete_course',
      sectionId: current?.id || sorted[sorted.length - 1]?.id || '',
      requiresSideEffectConfirm: false,
    };
  }

  // Stay / no next
  return {
    kind: 'advance',
    fromSectionId: current?.id || '',
    toSectionId: null,
    requiresSideEffectConfirm: false,
  };
}

/**
 * Whether a free-text message on course surface should hit IntentJudge.
 * UX04: never — follow-ups stay in-unit.
 */
export function shouldReenterIntentOnCourseFollowUp(): false {
  return false;
}

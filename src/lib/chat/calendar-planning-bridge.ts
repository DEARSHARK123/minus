/**
 * Batch-07 — Bridge for LearnFlowCards chip clicks → Home calendar planning branch.
 */

import type { PlanningConstraintKey } from '@/lib/learning/planning-constraints';

export type CalendarPlanningSubmitHandler = (
  answer: string,
  key?: PlanningConstraintKey,
) => Promise<void>;

let submitHandler: CalendarPlanningSubmitHandler | null = null;

export function registerCalendarPlanningHandler(
  handler: CalendarPlanningSubmitHandler | null,
): void {
  submitHandler = handler;
}

export async function submitCalendarConstraint(
  answer: string,
  key?: PlanningConstraintKey,
): Promise<void> {
  if (!submitHandler) return;
  await submitHandler(answer, key);
}
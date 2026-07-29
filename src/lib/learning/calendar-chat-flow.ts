/**
 * Batch-07 — Chat→Calendar planning: conversation-scoped constraints, one question at a time.
 * Proposal is preview-only; Accept on Calendar is the only schedule write.
 */

import type { LearnArtifact } from '@/lib/agents/types';
import { newArtifactId } from '@/lib/agents/types';
import type { ConversationExperienceSnapshot } from '@/types/agent';
import type { PlanProposal } from '@/types/learning';
import {
  applyConstraintAnswer,
  formatConstraintsSummary,
  missingPlanningConstraints,
  nextPlanningConstraintQuestion,
  type PlanningConstraintKey,
  type PlanningConstraints,
} from './planning-constraints';

export type CalendarPlanningState = {
  active: boolean;
  constraints: PlanningConstraints;
  /** Key we are currently asking (null when idle or complete). */
  pendingKey: PlanningConstraintKey | null;
  /** Preview proposal id stored client-side until Accept/Discard on Calendar. */
  proposalPreviewId: string | null;
};

export function calendarPlanningFromSnapshot(
  snap: ConversationExperienceSnapshot | null | undefined,
): CalendarPlanningState {
  const constraints = (snap?.planningConstraints as PlanningConstraints) ?? {};
  const pendingKey =
    (snap?.calendarPendingConstraintKey as PlanningConstraintKey | null) ?? null;
  const active = Boolean(snap?.calendarPlanningActive);
  return {
    active,
    constraints,
    pendingKey,
    proposalPreviewId: snap?.calendarProposalPreviewId ?? null,
  };
}

export function snapshotFromCalendarPlanning(
  base: ConversationExperienceSnapshot | null | undefined,
  planning: CalendarPlanningState,
): ConversationExperienceSnapshot {
  return {
    ...(base ?? {}),
    calendarPlanningActive: planning.active,
    planningConstraints: planning.constraints,
    calendarPendingConstraintKey: planning.pendingKey,
    calendarProposalPreviewId: planning.proposalPreviewId,
    updatedAt: new Date().toISOString(),
  };
}

export type CalendarPlanningTurnResult =
  | {
      kind: 'ask';
      planning: CalendarPlanningState;
      artifacts: LearnArtifact[];
      assistantText: string;
    }
  | {
      kind: 'propose_ready';
      planning: CalendarPlanningState;
      artifacts: LearnArtifact[];
      assistantText: string;
      /** Caller must proposePlan(courseId) then navigate /calendar. */
      courseId: string;
    }
  | {
      kind: 'navigate_preview';
      planning: CalendarPlanningState;
      artifacts: LearnArtifact[];
      assistantText: string;
      proposal: PlanProposal;
    };

function constraintArtifact(
  key: PlanningConstraintKey,
  question: string,
  choices?: string[],
): LearnArtifact {
  return {
    id: newArtifactId('cal'),
    kind: 'calendar_constraint',
    content: question,
    options: choices,
    topic: key,
  };
}

/** Begin or continue calendar constraint collection from a user message. */
export function advanceCalendarPlanning(input: {
  planning: CalendarPlanningState;
  userMessage: string;
  courseId: string;
  /** When set, apply answer to this key instead of inferring from pendingKey. */
  answerKey?: PlanningConstraintKey;
}): CalendarPlanningTurnResult {
  const text = input.userMessage.trim();
  let constraints = { ...input.planning.constraints };
  let pendingKey = input.planning.pendingKey;

  // Apply answer when we have a pending question or explicit key.
  const keyToApply = input.answerKey ?? pendingKey;
  if (keyToApply && text) {
    constraints = applyConstraintAnswer(constraints, keyToApply, text);
    pendingKey = null;
  }

  const missing = missingPlanningConstraints(constraints);
  if (missing.length > 0) {
    const nextKey = missing[0]!;
    const q = nextPlanningConstraintQuestion(constraints);
    const question = q?.question ?? '请告诉我你的学习时间偏好。';
    const planning: CalendarPlanningState = {
      active: true,
      constraints,
      pendingKey: nextKey,
      proposalPreviewId: null,
    };
    return {
      kind: 'ask',
      planning,
      artifacts: [constraintArtifact(nextKey, question, q?.choices)],
      assistantText: question,
    };
  }

  // All constraints known — ready to propose (no schedule write here).
  const summary = formatConstraintsSummary(constraints);
  const planning: CalendarPlanningState = {
    active: true,
    constraints,
    pendingKey: null,
    proposalPreviewId: input.planning.proposalPreviewId,
  };
  return {
    kind: 'propose_ready',
    planning,
    artifacts: [
      {
        id: newArtifactId('cal'),
        kind: 'plain_assistant',
        content: `已了解你的安排偏好：${summary}。正在生成日历草案，稍后在日历页确认或修改。`,
      },
    ],
    assistantText: `已了解你的安排偏好：${summary}。`,
    courseId: input.courseId,
  };
}

/** After proposePlan API returns — attach preview and signal navigation. */
export function calendarPlanningWithProposal(
  planning: CalendarPlanningState,
  proposal: PlanProposal,
): CalendarPlanningTurnResult {
  const next: CalendarPlanningState = {
    ...planning,
    proposalPreviewId:
      proposal.diffs[0]?.taskId ??
      proposal.plan.tasks[0]?.id ??
      `preview_${Date.now()}`,
    pendingKey: null,
  };
  return {
    kind: 'navigate_preview',
    planning: next,
    proposal,
    artifacts: [
      {
        id: newArtifactId('cal'),
        kind: 'plain_assistant',
        content:
          '日历草案已准备好。请在日历页查看、修改时间，确认后才会写入日程。',
      },
    ],
    assistantText: '日历草案已准备好，正在打开日历…',
  };
}

/** Detect calendar planning intent from orchestrator mode or message. */
export function shouldStartCalendarPlanning(input: {
  experienceMode?: string | null;
  message: string;
  planning: CalendarPlanningState;
}): boolean {
  if (input.planning.active) return true;
  if (input.experienceMode === 'calendar') return true;
  return /日历|日程|排(程|课|计划)|学习安排|schedule/i.test(input.message);
}
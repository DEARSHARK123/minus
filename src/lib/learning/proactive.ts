import { planStudySchedule, rescheduleAfterSkipDay } from './planner';
import { StudyTaskSchema, newId, nowIso, type LearningData, type StudyTask, type PlanResult } from '@/types/learning';

export type ProactiveTrigger =
  | { kind: 'import_document'; courseId: string; documentTitle: string }
  | { kind: 'import_timetable'; courseId: string }
  | { kind: 'add_goal'; courseId: string; goalId: string; goalTitle: string }
  | { kind: 'add_unit'; courseId: string; unitId: string; unitTitle: string }
  | { kind: 'add_task'; courseId: string; taskId: string }
  | { kind: 'skip_day'; courseId: string; date: string }; // YYYY-MM-DD local date

export type ProactiveSuggestion = {
  type: 'suggestion';
  task: StudyTask;
  reason: string;
};

export type ProactiveReschedule = {
  type: 'reschedule';
  plan: PlanResult;
  reason: string;
  affectedTaskIds: string[];
};

export type ProactiveResult = {
  suggestions: ProactiveSuggestion[];
  reschedule: ProactiveReschedule | null;
  warnings: string[];
};

/**
 * Narrow proactive proposer.
 *
 * - Triggered by import / DDL change / skip-day.
 * - Returns pending_suggestion tasks OR a reschedule plan.
 * - Never auto-confirms: suggestions stay pending and must be confirmed by the user.
 * - Reschedule plans only move non-locked confirmed/scheduled tasks.
 */
export function runProactiveTrigger(
  data: LearningData,
  trigger: ProactiveTrigger,
  now = new Date(),
): ProactiveResult {
  switch (trigger.kind) {
    case 'import_document':
      return handleImportDocument(data, trigger);
    case 'import_timetable':
      return handleImportTimetable(data, trigger, now);
    case 'add_goal':
      return handleAddGoal(trigger);
    case 'add_unit':
      return handleAddUnit(trigger);
    case 'add_task':
      return handleAddTask(data, trigger, now);
    case 'skip_day':
      return handleSkipDay(data, trigger, now);
    default: {
      const _exhaustive: never = trigger;
      return {
        suggestions: [],
        reschedule: null,
        warnings: [`Unknown proactive trigger: ${String(_exhaustive)}`],
      };
    }
  }
}

function handleImportDocument(
  data: LearningData,
  trigger: Extract<ProactiveTrigger, { kind: 'import_document' }>,
): ProactiveResult {
  const courseDocs = data.documents.filter((d) => d.courseId === trigger.courseId);
  if (courseDocs.length >= 2) {
    const suggestion = buildSuggestionTask(
      trigger.courseId,
      `复习已导入的 ${courseDocs.length} 份资料`,
      30,
      `资料导入后建议综合复习: ${trigger.documentTitle}`,
    );
    return {
      suggestions: [
        {
          type: 'suggestion',
          task: suggestion,
          reason: `已导入 ${courseDocs.length} 份资料，建议安排综合复习`,
        },
      ],
      reschedule: null,
      warnings: [],
    };
  }
  return { suggestions: [], reschedule: null, warnings: [] };
}

function handleImportTimetable(
  data: LearningData,
  trigger: Extract<ProactiveTrigger, { kind: 'import_timetable' }>,
  now: Date,
): ProactiveResult {
  try {
    const plan = planStudySchedule(data, { courseId: trigger.courseId, now });
    const changedIds = plan.tasks
      .filter((t) => {
        const original = data.tasks.find((orig) => orig.id === t.id);
        if (!original) return false;
        return (
          original.scheduledStart !== t.scheduledStart ||
          original.scheduledEnd !== t.scheduledEnd ||
          original.status !== t.status
        );
      })
      .map((t) => t.id);

    if (changedIds.length > 0 || plan.warnings.length > 0) {
      return {
        suggestions: [],
        reschedule: {
          type: 'reschedule',
          plan,
          reason: '课表导入后检测到时间变化，建议重新排程',
          affectedTaskIds: changedIds,
        },
        warnings: plan.warnings,
      };
    }
  } catch (err) {
    return {
      suggestions: [],
      reschedule: null,
      warnings: [err instanceof Error ? err.message : '排程失败'],
    };
  }
  return { suggestions: [], reschedule: null, warnings: [] };
}

function handleAddGoal(
  trigger: Extract<ProactiveTrigger, { kind: 'add_goal' }>,
): ProactiveResult {
  const suggestion = buildSuggestionTask(
    trigger.courseId,
    `为「${trigger.goalTitle}」做学前自测`,
    20,
    `新增学习目标后建议先自测基础`,
  );
  return {
    suggestions: [
      {
        type: 'suggestion',
        task: suggestion,
        reason: `新增目标「${trigger.goalTitle}」，建议先自测`,
      },
    ],
    reschedule: null,
    warnings: [],
  };
}

function handleAddUnit(
  trigger: Extract<ProactiveTrigger, { kind: 'add_unit' }>,
): ProactiveResult {
  const suggestion = buildSuggestionTask(
    trigger.courseId,
    `预习单元：${trigger.unitTitle}`,
    25,
    `新增学习单元后建议预习`,
  );
  return {
    suggestions: [
      {
        type: 'suggestion',
        task: suggestion,
        reason: `新增单元「${trigger.unitTitle}」，建议预习`,
      },
    ],
    reschedule: null,
    warnings: [],
  };
}

function handleAddTask(
  data: LearningData,
  trigger: Extract<ProactiveTrigger, { kind: 'add_task' }>,
  now: Date,
): ProactiveResult {
  try {
    const plan = planStudySchedule(data, { courseId: trigger.courseId, now });
    return {
      suggestions: [],
      reschedule: {
        type: 'reschedule',
        plan,
        reason: '新增任务后建议重新排程以检查截止时间',
        affectedTaskIds: plan.tasks
          .filter((t) => {
            const original = data.tasks.find((orig) => orig.id === t.id);
            if (!original) return false;
            return (
              original.scheduledStart !== t.scheduledStart ||
              original.scheduledEnd !== t.scheduledEnd ||
              original.status !== t.status
            );
          })
          .map((t) => t.id),
      },
      warnings: plan.warnings,
    };
  } catch (err) {
    return {
      suggestions: [],
      reschedule: null,
      warnings: [err instanceof Error ? err.message : '排程失败'],
    };
  }
}

function handleSkipDay(
  data: LearningData,
  trigger: Extract<ProactiveTrigger, { kind: 'skip_day' }>,
  now: Date,
): ProactiveResult {
  const skippedDate = trigger.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(skippedDate)) {
    return {
      suggestions: [],
      reschedule: null,
      warnings: ['skip_day date must be YYYY-MM-DD'],
    };
  }

  const affected = data.tasks.filter(
    (t) =>
      t.courseId === trigger.courseId &&
      !t.locked &&
      (t.status === 'confirmed' || t.status === 'scheduled') &&
      t.scheduledStart &&
      localIsoDate(t.scheduledStart) === skippedDate,
  );

  if (affected.length === 0) {
    return {
      suggestions: [],
      reschedule: null,
      warnings: [`跳过 ${skippedDate} 没有影响已排程任务`],
    };
  }

  try {
    const plan = rescheduleAfterSkipDay(data, {
      courseId: trigger.courseId,
      skippedDate,
      now,
    });
    return {
      suggestions: [],
      reschedule: {
        type: 'reschedule',
        plan,
        reason: `跳过 ${skippedDate}，已重新排程 ${affected.length} 个任务`,
        affectedTaskIds: affected.map((t) => t.id),
      },
      warnings: plan.warnings,
    };
  } catch (err) {
    return {
      suggestions: [],
      reschedule: null,
      warnings: [err instanceof Error ? err.message : '重新排程失败'],
    };
  }
}

function buildSuggestionTask(
  courseId: string,
  title: string,
  estimatedMinutes: number,
  description?: string,
): StudyTask {
  const ts = nowIso();
  return StudyTaskSchema.parse({
    id: newId(),
    courseId,
    title,
    description,
    estimatedMinutes,
    status: 'pending_suggestion',
    locked: false,
    createdAt: ts,
    updatedAt: ts,
  });
}

function localIsoDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

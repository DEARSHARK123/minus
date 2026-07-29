import { z } from 'zod';
import type { LearningData, PlanConstraintSnapshot, PlanProposal } from '@/types/learning';
import {
  PlanConstraintSnapshotSchema,
  StudyTaskSchema,
  TaskStatusSchema,
} from '@/types/learning';
import { editProposalTaskTime } from './calendar-proposal-edit';

export const CalendarAssistantMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(2_000),
});

export type CalendarAssistantMessage = z.infer<typeof CalendarAssistantMessageSchema>;

const CalendarAssistantMoveSchema = z.object({
  taskId: z.string().trim().min(1).max(200),
  scheduledStart: z.string().datetime({ offset: true }),
  scheduledEnd: z.string().datetime({ offset: true }),
});

export const CalendarAssistantDecisionSchema = z
  .object({
    reply: z.string().trim().min(1).max(1_200),
    action: z.enum(['none', 'replan', 'move_task']),
    constraints: PlanConstraintSnapshotSchema.optional(),
    move: CalendarAssistantMoveSchema.optional(),
    suggestions: z.array(z.string().trim().min(1).max(80)).max(3).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'replan' && !value.constraints) {
      ctx.addIssue({
        code: 'custom',
        message: 'replan requires constraints',
        path: ['constraints'],
      });
    }
    if (value.action === 'move_task' && !value.move) {
      ctx.addIssue({
        code: 'custom',
        message: 'move_task requires move',
        path: ['move'],
      });
    }
  });

export type CalendarAssistantDecision = z.infer<typeof CalendarAssistantDecisionSchema>;

export const CalendarAssistantProposalSchema = z.object({
  id: z.string().trim().min(1).max(300),
  courseId: z.string().trim().min(1).max(200),
  baseRevision: z.string().trim().min(1).max(200),
  createdAt: z.string().datetime(),
  timeZone: z.string().trim().min(1).max(100),
  constraints: PlanConstraintSnapshotSchema.optional(),
  sourceConversationId: z.string().trim().min(1).max(300).optional(),
  plan: z.object({
    tasks: z.array(StudyTaskSchema).max(200),
    warnings: z.array(z.string().max(1_000)).max(100),
  }),
  diffs: z
    .array(
      z.object({
        taskId: z.string().trim().min(1).max(200),
        title: z.string().trim().min(1).max(500),
        beforeStart: z.string().datetime().optional(),
        beforeEnd: z.string().datetime().optional(),
        beforeStatus: TaskStatusSchema,
        afterStart: z.string().datetime().optional(),
        afterEnd: z.string().datetime().optional(),
        afterStatus: TaskStatusSchema,
      }),
    )
    .max(200),
  applied: z.literal(false),
});

export type CalendarAssistantResult = {
  reply: string;
  action: CalendarAssistantDecision['action'];
  proposal?: PlanProposal;
  suggestions: string[];
  issues: string[];
};

export const CALENDAR_ASSISTANT_SYSTEM_PROMPT = `你是 Minus 的日历学习伴侣。你的职责是帮助用户理解和调整当前课程的学习安排。

你只能返回一个 JSON 对象，不要使用 Markdown 代码围栏。字段必须是：
{
  "reply": "简洁自然的中文回复",
  "action": "none | replan | move_task",
  "constraints": {
    "availableDays": [1,2,3,4,5],
    "dailyBudgetMinutes": 60,
    "dayStartHour": 19,
    "dayEndHour": 22,
    "deadlinePreference": "front_load | even | before_deadline"
  },
  "move": {
    "taskId": "上下文中的真实任务 ID",
    "scheduledStart": "带时区偏移的 ISO 时间",
    "scheduledEnd": "带时区偏移的 ISO 时间"
  },
  "suggestions": ["最多三个简短追问建议"]
}

规则：
- 仅讨论上下文中列出的课程、任务、课表和草案，不得编造任务。
- 普通解释、冲突分析、信息不足或需要追问时使用 action=none。
- 用户要求整体调整学习日、每日时长、学习时段或截止策略时使用 action=replan，并只填写用户明确表达的约束。
- 用户要求把一个明确任务移动到明确日期和时段时使用 action=move_task。只能使用上下文里的真实 taskId。
- 不得确认、提交或声称已经写入日历。所有变更都只是待用户确认的草案。
- 回复不暴露任务 ID、内部状态名或实现细节；说明已生成/更新草案即可。
- 若用户请求会造成明显歧义，先简短追问，不猜测日期或时间。`;

export function buildCalendarAssistantUserPrompt(input: {
  data: LearningData;
  courseId: string;
  proposal?: PlanProposal | null;
  messages: CalendarAssistantMessage[];
  now?: Date;
}): string {
  const course = input.data.courses.find((item) => item.id === input.courseId);
  const tasks = input.data.tasks
    .filter((task) => task.courseId === input.courseId)
    .slice(0, 40)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      locked: task.locked === true,
      estimatedMinutes: task.estimatedMinutes,
      deadline: task.deadline ?? null,
      scheduledStart: task.scheduledStart ?? null,
      scheduledEnd: task.scheduledEnd ?? null,
    }));
  const timetable = input.data.timetable.slice(0, 60).map((slot) => ({
    weekday: slot.weekday,
    start: slot.start,
    end: slot.end,
    courseName: slot.courseName,
  }));
  const proposal = input.proposal
    ? {
        courseId: input.proposal.courseId,
        timeZone: input.proposal.timeZone,
        constraints: input.proposal.constraints ?? {},
        warnings: input.proposal.plan.warnings,
        tasks: input.proposal.plan.tasks.slice(0, 40).map((task) => ({
          id: task.id,
          title: task.title,
          locked: task.locked === true,
          scheduledStart: task.scheduledStart ?? null,
          scheduledEnd: task.scheduledEnd ?? null,
        })),
      }
    : null;

  return JSON.stringify(
    {
      now: (input.now ?? new Date()).toISOString(),
      localNow: formatLocalIso(input.now ?? new Date()),
      localTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
      course: { id: input.courseId, title: course?.title ?? '未命名课程' },
      tasks,
      timetable,
      currentDraft: proposal,
      conversation: input.messages.slice(-10),
    },
    null,
    2,
  );
}

function formatLocalIso(date: Date): string {
  const pad = (value: number) => String(Math.abs(value)).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetRemainder = Math.abs(offsetMinutes) % 60;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(offsetHours)}:${pad(offsetRemainder)}`;
}

export function mergeCalendarAssistantConstraints(
  current: PlanConstraintSnapshot | undefined,
  patch: PlanConstraintSnapshot | undefined,
): PlanConstraintSnapshot {
  return PlanConstraintSnapshotSchema.parse({
    ...(current ?? {}),
    ...(patch ?? {}),
  });
}

export function applyCalendarAssistantMove(input: {
  data: LearningData;
  courseId: string;
  proposal: PlanProposal | null | undefined;
  move: z.infer<typeof CalendarAssistantMoveSchema>;
}): PlanProposal {
  const proposal = input.proposal;
  if (!proposal || proposal.courseId !== input.courseId || proposal.applied !== false) {
    throw new Error('请先生成一个安排草案，再调整单项时间。');
  }

  const current = input.data.tasks.find((task) => task.id === input.move.taskId);
  const planned = proposal.plan.tasks.find((task) => task.id === input.move.taskId);
  if (!current || !planned || current.courseId !== input.courseId) {
    throw new Error('没有找到要调整的课程任务，请换一种说法。');
  }
  if (current.locked) {
    throw new Error(`“${current.title}”已锁定，不能移动。`);
  }

  const start = Date.parse(input.move.scheduledStart);
  const end = Date.parse(input.move.scheduledEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('新的结束时间必须晚于开始时间。');
  }
  if (end - start > 8 * 60 * 60 * 1_000) {
    throw new Error('单次学习时段不能超过 8 小时。');
  }

  return editProposalTaskTime(
    proposal,
    current.id,
    new Date(start).toISOString(),
    new Date(end).toISOString(),
  );
}

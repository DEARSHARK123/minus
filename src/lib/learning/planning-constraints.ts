/**
 * UX05 — Planning constraints collected primarily in Chat as one inline question at a time.
 * Calendar is for viewing results + Accept/Edit, not for interrogating constraints.
 */

export type PlanningConstraintKey =
  | 'available_days'
  | 'daily_budget_minutes'
  | 'preferred_hours'
  | 'deadline_preference';

export type PlanningConstraints = {
  availableDays?: number[]; // ISO weekday 1–7
  dailyBudgetMinutes?: number;
  preferredHours?: { startHour: number; endHour: number };
  deadlinePreference?: 'front_load' | 'even' | 'before_deadline';
};

export type PlanningConstraintQuestion = {
  key: PlanningConstraintKey;
  /** Natural Chinese inline question for Chat. */
  question: string;
  /** Optional short choice chips. */
  choices?: string[];
};

const QUESTION_ORDER: PlanningConstraintKey[] = [
  'available_days',
  'daily_budget_minutes',
  'preferred_hours',
  'deadline_preference',
];

const QUESTIONS: Record<PlanningConstraintKey, PlanningConstraintQuestion> = {
  available_days: {
    key: 'available_days',
    question: '这周哪些天比较方便学习？',
    choices: ['工作日', '周末', '每天都可以', '我自己说'],
  },
  daily_budget_minutes: {
    key: 'daily_budget_minutes',
    question: '每天大概能拿出多少时间？',
    choices: ['30 分钟', '1 小时', '2 小时', '更灵活'],
  },
  preferred_hours: {
    key: 'preferred_hours',
    question: '更想安排在一天的哪个时段？',
    choices: ['上午', '下午', '晚上', '都可以'],
  },
  deadline_preference: {
    key: 'deadline_preference',
    question: '有截止日期的任务，希望怎么排？',
    choices: ['尽量提前完成', '均匀分配', '临近截止再集中'],
  },
};

/** Constraints still missing — Chat should ask at most one. */
export function missingPlanningConstraints(
  known: PlanningConstraints,
): PlanningConstraintKey[] {
  const missing: PlanningConstraintKey[] = [];
  for (const key of QUESTION_ORDER) {
    if (key === 'available_days' && (!known.availableDays || known.availableDays.length === 0)) {
      missing.push(key);
    } else if (key === 'daily_budget_minutes' && known.dailyBudgetMinutes == null) {
      missing.push(key);
    } else if (key === 'preferred_hours' && !known.preferredHours) {
      missing.push(key);
    } else if (key === 'deadline_preference' && !known.deadlinePreference) {
      missing.push(key);
    }
  }
  return missing;
}

/** Next single inline question for Chat (or null when enough is known). */
export function nextPlanningConstraintQuestion(
  known: PlanningConstraints,
): PlanningConstraintQuestion | null {
  const missing = missingPlanningConstraints(known);
  if (missing.length === 0) return null;
  return QUESTIONS[missing[0]!];
}

/** Surface ownership: constraints → Chat; results/accept → Calendar. */
export function planningSurfaceFor(
  intent: 'collect_constraints' | 'view_results' | 'accept_edit',
): 'chat' | 'calendar' {
  if (intent === 'collect_constraints') return 'chat';
  return 'calendar';
}

export function applyConstraintAnswer(
  known: PlanningConstraints,
  key: PlanningConstraintKey,
  answer: string,
): PlanningConstraints {
  const next = { ...known };
  const a = answer.trim();

  switch (key) {
    case 'available_days': {
      if (a.includes('工作日')) next.availableDays = [1, 2, 3, 4, 5];
      else if (a.includes('周末')) next.availableDays = [6, 7];
      else if (a.includes('每天') || a.includes('都可以')) next.availableDays = [1, 2, 3, 4, 5, 6, 7];
      else {
        const weekdayTokens: Array<[RegExp, number]> = [
          [/(?:周|星期)一|\bmon(?:day)?\b/i, 1],
          [/(?:周|星期)二|\btue(?:sday)?\b/i, 2],
          [/(?:周|星期)三|\bwed(?:nesday)?\b/i, 3],
          [/(?:周|星期)四|\bthu(?:rsday)?\b/i, 4],
          [/(?:周|星期)五|\bfri(?:day)?\b/i, 5],
          [/(?:周|星期)六|\bsat(?:urday)?\b/i, 6],
          [/(?:周日|周天|星期日|星期天)|\bsun(?:day)?\b/i, 7],
        ];
        const parsed = weekdayTokens
          .filter(([pattern]) => pattern.test(a))
          .map(([, weekday]) => weekday);
        if (parsed.length > 0) next.availableDays = parsed;
      }
      break;
    }
    case 'daily_budget_minutes': {
      const hours = a.match(/(\d+(?:\.\d+)?)\s*(?:小时|钟头|hours?|hrs?)/i);
      const minutes = a.match(/(\d+)\s*(?:分钟|minutes?|mins?)/i);
      const parsed = hours
        ? Math.round(Number(hours[1]) * 60)
        : minutes
          ? Number(minutes[1])
          : /^\d+$/.test(a)
            ? Number(a)
            : null;
      if (parsed != null && Number.isFinite(parsed) && parsed >= 10 && parsed <= 480) {
        next.dailyBudgetMinutes = parsed;
      }
      break;
    }
    case 'preferred_hours': {
      if (a.includes('上午')) next.preferredHours = { startHour: 8, endHour: 12 };
      else if (a.includes('下午')) next.preferredHours = { startHour: 13, endHour: 18 };
      else if (a.includes('晚上')) next.preferredHours = { startHour: 19, endHour: 22 };
      else if (a.includes('都可以') || a.includes('不限')) next.preferredHours = { startHour: 8, endHour: 22 };
      else {
        const range = a.match(/(?:^|\D)(\d{1,2})(?::\d{2})?\s*(?:-|–|—|到|至)\s*(\d{1,2})(?::\d{2})?(?:\D|$)/);
        const startHour = range ? Number(range[1]) : NaN;
        const endHour = range ? Number(range[2]) : NaN;
        if (Number.isInteger(startHour) && Number.isInteger(endHour) && startHour >= 0 && endHour <= 24 && endHour > startHour) {
          next.preferredHours = { startHour, endHour };
        }
      }
      break;
    }
    case 'deadline_preference': {
      if (a.includes('提前')) next.deadlinePreference = 'front_load';
      else if (a.includes('均匀')) next.deadlinePreference = 'even';
      else if (a.includes('临近') || a.includes('截止')) next.deadlinePreference = 'before_deadline';
      break;
    }
  }
  return next;
}

/** Map constraints into planner-facing options (no persistence). */
export function constraintsToPlanHints(known: PlanningConstraints): {
  dayStartHour?: number;
  dayEndHour?: number;
  days?: number;
  availableDays?: number[];
  dailyBudgetMinutes?: number;
  deadlinePreference?: PlanningConstraints['deadlinePreference'];
} {
  const hints: {
    dayStartHour?: number;
    dayEndHour?: number;
    days?: number;
    availableDays?: number[];
    dailyBudgetMinutes?: number;
    deadlinePreference?: PlanningConstraints['deadlinePreference'];
  } = {};
  if (known.preferredHours) {
    hints.dayStartHour = known.preferredHours.startHour;
    hints.dayEndHour = known.preferredHours.endHour;
  }
  if (known.availableDays?.length) hints.availableDays = [...known.availableDays];
  if (known.dailyBudgetMinutes != null) hints.dailyBudgetMinutes = known.dailyBudgetMinutes;
  if (known.deadlinePreference) hints.deadlinePreference = known.deadlinePreference;
  return hints;
}

export function formatConstraintsSummary(known: PlanningConstraints): string {
  const parts: string[] = [];
  if (known.availableDays?.length) {
    parts.push(`可用 ${known.availableDays.length} 天/周`);
  }
  if (known.dailyBudgetMinutes != null) {
    parts.push(`每天约 ${known.dailyBudgetMinutes} 分钟`);
  }
  if (known.preferredHours) {
    parts.push(
      `${known.preferredHours.startHour}:00–${known.preferredHours.endHour}:00`,
    );
  }
  if (known.deadlinePreference === 'front_load') parts.push('尽量提前完成');
  if (known.deadlinePreference === 'even') parts.push('均匀分配');
  if (known.deadlinePreference === 'before_deadline') parts.push('临近截止集中');
  return parts.length ? parts.join(' · ') : '尚未收集学习时间偏好';
}

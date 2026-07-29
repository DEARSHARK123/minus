import { callLLM } from '@/lib/llm/client';
import { resolveProviderConfig } from '@/lib/config/server-env';
import {
  listEffectivePlaybooks,
  getEffectiveSkill,
  readUserConfigurationSync,
  writeUserConfiguration,
} from '@/lib/config/user-configuration';
import type {
  AutomationNotice,
  AutomationRule,
  UserConfiguration,
} from '@/lib/config/user-configuration-core';
import { appendAiMemories } from '@/lib/memory/pipeline';
import { parseJsonFromLLM } from '@/lib/agents/json';
import { writeSafetyAudit } from '@/lib/agent/action-policy';

export type AutomationRunContext = {
  now?: string;
  idleMinutes?: number;
  transcript?: Array<{ role: 'user' | 'assistant'; content: string }>;
  userSystemPrompt?: string;
  event?: {
    type: 'course_completed' | 'assessment_failed' | 'course_idle';
    courseId?: string;
    eventId: string;
  };
  courseActivity?: Array<{ courseId: string; idleMinutes: number }>;
};

export type AutomationRunResult = {
  automationId: string;
  status: 'success' | 'failed' | 'pending_confirmation' | 'skipped';
  message: string;
};

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function parseTime(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

export function automationRunKey(
  rule: AutomationRule,
  now: Date,
  context: AutomationRunContext = {},
): string | null {
  switch (rule.trigger.type) {
    case 'once':
      return now.getTime() >= Date.parse(rule.trigger.runAt) &&
        (rule.catchUp || now.getTime() - Date.parse(rule.trigger.runAt) < 120_000)
        ? `once:${rule.trigger.runAt}`
        : null;
    case 'daily':
      return minutesOfDay(now) >= parseTime(rule.trigger.time) &&
        (rule.catchUp || minutesOfDay(now) - parseTime(rule.trigger.time) <= 1)
        ? `daily:${localDateKey(now)}`
        : null;
    case 'weekly':
      return rule.trigger.daysOfWeek.includes(now.getDay()) &&
        minutesOfDay(now) >= parseTime(rule.trigger.time) &&
        (rule.catchUp || minutesOfDay(now) - parseTime(rule.trigger.time) <= 1)
        ? `weekly:${localDateKey(now)}`
        : null;
    case 'idle':
      return (context.idleMinutes || 0) >= rule.trigger.minutes
        ? `idle:${localDateKey(now)}`
        : null;
    case 'event': {
      const trigger = rule.trigger;
      if (trigger.event === 'course_idle' && !context.event) {
        const course = (context.courseActivity || []).find((item) =>
          (!trigger.courseId || item.courseId === trigger.courseId) &&
          item.idleMinutes >= trigger.idleMinutes,
        );
        return course ? `course_idle:${course.courseId}:${localDateKey(now)}` : null;
      }
      if (!context.event || context.event.type !== trigger.event) return null;
      if (trigger.courseId && context.event.courseId !== trigger.courseId) return null;
      return `event:${context.event.type}:${context.event.eventId}`;
    }
  }
}

export function listDueAutomations(
  config: UserConfiguration,
  context: AutomationRunContext = {},
): AutomationRule[] {
  const now = new Date(context.now || Date.now());
  return config.automations.filter((rule) => {
    if (!rule.enabled) return false;
    const key = automationRunKey(rule, now, context);
    return !!key && (
      key !== rule.lastRunKey ||
      (rule.lastStatus === 'failed' && (rule.failureCount || 0) <= rule.maxRetries)
    );
  });
}

function notice(
  rule: AutomationRule,
  title: string,
  message: string,
  status: AutomationNotice['status'],
  courseId?: string,
): AutomationNotice {
  return {
    id: crypto.randomUUID(),
    automationId: rule.id,
    title,
    message,
    status,
    ...(courseId ? { courseId } : {}),
    createdAt: new Date().toISOString(),
  };
}

async function runAgentTask(rule: AutomationRule, context: AutomationRunContext): Promise<{
  status: AutomationRunResult['status'];
  message: string;
  notice: AutomationNotice;
}> {
  if (rule.action.type !== 'agent_task') throw new Error('Invalid agent automation');
  const action = rule.action;
  const playbook = action.playbookId
    ? listEffectivePlaybooks().find((item) => item.id === action.playbookId && item.enabled)
    : undefined;
  if (playbook?.tools.length) {
    const message = `自动化需要工具：${playbook.tools.join('、')}。请在 Minus 中确认后手动运行。`;
    return {
      status: 'pending_confirmation',
      message,
      notice: notice(rule, rule.name, message, 'pending_confirmation', action.courseId),
    };
  }
  const provider = resolveProviderConfig(action.providerId);
  if (!provider.apiKey) throw new Error(`Provider ${provider.providerId} is not configured`);
  const skillText = action.skillIds
    .map((id) => getEffectiveSkill(id)?.body)
    .filter(Boolean)
    .join('\n\n');
  const response = await callLLM(
    [
      {
        role: 'system',
        content:
           'You are executing a user-created local automation. Produce the requested text result only. Do not claim tools or network access you did not use.' +
          (context.userSystemPrompt?.trim()
            ? `\n\nUser instructions (apply unless they conflict with safety or automation approval rules):\n${context.userSystemPrompt.trim()}`
            : '') +
          (skillText ? `\n\nEnabled user skills:\n${skillText}` : '') +
          (playbook?.prompt ? `\n\nPlaybook:\n${playbook.prompt}` : ''),
      },
      { role: 'user', content: action.prompt },
    ],
    [],
    provider,
  );
  const message = response.content?.trim() || '自动化没有返回内容。';
  return {
    status: 'success',
    message,
    notice: notice(rule, rule.name, message, 'success', action.courseId),
  };
}

async function runProfileDigest(
  rule: AutomationRule,
  context: AutomationRunContext,
): Promise<{ status: AutomationRunResult['status']; message: string; notice: AutomationNotice }> {
  if (rule.action.type !== 'profile_digest') throw new Error('Invalid profile automation');
  const transcript = (context.transcript || [])
    .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 1000) }))
    .slice(-30);
  if (transcript.length < 2) {
    const message = '可分析的对话不足，本次画像解读已跳过。';
    return { status: 'skipped', message, notice: notice(rule, rule.name, message, 'info') };
  }
  const provider = resolveProviderConfig(rule.action.providerId);
  if (!provider.apiKey) throw new Error(`Provider ${provider.providerId} is not configured`);
  const response = await callLLM(
    [
      {
        role: 'system',
        content:
          'Extract only durable learner preferences, goals, strengths, or recurring difficulties supported by the transcript. Exclude secrets, tool logs, one-off trivia, health, financial, identity, and other sensitive claims. Return JSON: {"memories":[{"text":string,"kind":"preference"|"goal"|"strength"|"difficulty","confidence":number}]}.',
      },
      { role: 'user', content: JSON.stringify(transcript) },
    ],
    [],
    { ...provider, temperature: 0.2, maxTokens: 1200 },
  );
  const parsed = parseJsonFromLLM<{ memories?: Array<{ text?: string; kind?: string; confidence?: number }> }>(
    response.content || '{}',
  );
  const candidates = (parsed.memories || [])
    .map((item) => ({
      text: String(item.text || '').trim(),
      kind: item.kind === 'goal'
        ? ('goal' as const)
        : item.kind === 'strength' || item.kind === 'difficulty'
          ? ('fact' as const)
          : ('preference' as const),
      confidence: typeof item.confidence === 'number' ? item.confidence : 0.6,
      evidence: [],
      sensitive: false,
    }))
    .filter((item) => item.text);
  if (candidates.length > 0) await appendAiMemories(candidates);
  const message = candidates.length > 0
    ? `已生成 ${candidates.length} 条待确认的用户画像记忆。`
    : '没有发现足够稳定的新画像信息。';
  return { status: 'success', message, notice: notice(rule, rule.name, message, 'success') };
}

export async function runAutomation(
  automationId: string,
  context: AutomationRunContext = {},
  options: { manual?: boolean } = {},
): Promise<AutomationRunResult> {
  const config = readUserConfigurationSync();
  const rule = config.automations.find((item) => item.id === automationId);
  if (!rule) throw new Error('Automation not found');
  if (!rule.enabled && !options.manual) {
    return { automationId, status: 'skipped', message: '自动化已停用。' };
  }
  const now = new Date(context.now || Date.now());
  const runKey = options.manual
    ? `manual:${now.toISOString()}`
    : automationRunKey(rule, now, context);
  const retryingFailure = rule.lastStatus === 'failed' &&
    (rule.failureCount || 0) <= rule.maxRetries;
  if (!runKey || (!options.manual && runKey === rule.lastRunKey && !retryingFailure)) {
    return { automationId, status: 'skipped', message: '当前没有到期任务。' };
  }

  try {
    let result: { status: AutomationRunResult['status']; message: string; notice: AutomationNotice };
    switch (rule.action.type) {
      case 'reminder':
        result = {
          status: 'success',
          message: rule.action.message || rule.action.title,
          notice: notice(
            rule,
            rule.action.title,
            rule.action.message,
            'info',
            rule.action.courseId,
          ),
        };
        break;
      case 'review_proposal': {
        const message = '已生成复习建议，请在学习日历中确认后安排。';
        result = {
          status: 'success',
          message,
          notice: notice(rule, rule.name, message, 'info', rule.action.courseId),
        };
        break;
      }
      case 'agent_task':
        result = await runAgentTask(rule, context);
        break;
      case 'profile_digest':
        result = await runProfileDigest(rule, context);
        break;
    }
    const latest = readUserConfigurationSync();
    await writeUserConfiguration({
      ...latest,
      automations: latest.automations.map((item) =>
        item.id === rule.id
          ? {
              ...item,
              lastRunAt: now.toISOString(),
              lastRunKey: runKey,
              lastStatus: result.status,
              lastError: undefined,
              failureCount: 0,
              updatedAt: now.toISOString(),
            }
          : item,
      ),
      automationNotices: [result.notice, ...latest.automationNotices].slice(0, 500),
    });
    writeSafetyAudit({
      kind: 'automation_run',
      detail: `${rule.name}: ${result.status}`,
      approvalPolicy: rule.approvalPolicy,
      executionEnvironment: 'sandbox',
    });
    return { automationId, status: result.status, message: result.message };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Automation failed';
    const latest = readUserConfigurationSync();
    await writeUserConfiguration({
      ...latest,
      automations: latest.automations.map((item) =>
        item.id === rule.id
          ? {
              ...item,
              lastRunAt: now.toISOString(),
              lastRunKey: runKey,
              lastStatus: 'failed',
              lastError: message,
              failureCount: (item.failureCount || 0) + 1,
              updatedAt: now.toISOString(),
            }
          : item,
      ),
      automationNotices: [notice(rule, rule.name, message, 'error'), ...latest.automationNotices].slice(0, 500),
    });
    return { automationId, status: 'failed', message };
  }
}

export async function runDueAutomations(
  context: AutomationRunContext = {},
): Promise<AutomationRunResult[]> {
  const due = listDueAutomations(readUserConfigurationSync(), context);
  const results: AutomationRunResult[] = [];
  for (const rule of due) results.push(await runAutomation(rule.id, context));
  return results;
}

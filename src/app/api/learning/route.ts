import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  LearningDataError,
  LearningRepository,
  learningRepository,
} from '@/lib/learning/repository';
import { ImportError, importDocument, importTimetableCsvStrict } from '@/lib/learning/importer';
import { SearchError, searchDocuments } from '@/lib/learning/search';
import { planStudySchedule } from '@/lib/learning/planner';
import { SessionEngine, SessionEngineError } from '@/lib/learning/session-engine';
import type { ProviderConfig } from '@/lib/learning/session-engine';
import {
  resolveProviderConfig,
  getProviderStatus,
} from '@/lib/config/server-env';
import { callAgentJson } from '@/lib/agents/llm-json';
import { classifyModelFailure } from '@/lib/llm/errors';
import { diagnoseGaps, DiagnosticError } from '@/lib/learning/diagnostic';
import { createArtifact, ArtifactError } from '@/lib/learning/artifacts';
import { recordFeedback, ProfileError } from '@/lib/learning/profile';
import {
  recordCounter,
  loadCounters,
} from '@/lib/learning/observability';
import { buildCalendarBriefAsync } from '@/lib/learning/calendar-companion';
import {
  applyCalendarAssistantMove,
  buildCalendarAssistantUserPrompt,
  CALENDAR_ASSISTANT_SYSTEM_PROMPT,
  CalendarAssistantDecisionSchema,
  CalendarAssistantMessageSchema,
  CalendarAssistantProposalSchema,
  mergeCalendarAssistantConstraints,
  type CalendarAssistantResult,
} from '@/lib/learning/calendar-assistant';
import { validatePlanProposal } from '@/lib/learning/calendar-proposal-edit';
import type {
  ApiResponse,
  Artifact,
  LearningData,
  PlanProposal,
  SessionSection,
  StudyTask,
} from '@/types/learning';
import { PlanConstraintSnapshotSchema, WebSearchModeSchema } from '@/types/learning';

export const runtime = 'nodejs';

const ActionSchema = z.enum([
  'getAll',
  'createCourse',
  'deleteCourse',
  'renameCourse',
  'archiveCourse',
  'unarchiveCourse',
  'renameDocument',
  'deleteDocument',
  'renameFolder',
  'deleteFolder',
  'upsertGoal',
  'upsertUnit',
  'upsertTask',
  'proposeTask',
  'confirmTask',
  'rejectSuggestion',
  'completeTask',
  'importDocument',
  'importTimetable',
  'search',
  'plan',
  'proposePlan',
  'confirmPlan',
  'getCalendarBrief',
  'calendarAssistant',
  'confirmImportSuggestion',
  'rejectImportSuggestion',
  'createSession',
  'endSession',
  'getSession',
  'saveSessionReflection',
  'sessionTeach',
  'sessionReteach',
  'sessionOpenSection',
  'sessionSetWebSearchMode',
  'sessionStartRecall',
  'sessionSubmitRecall',
  'sessionAssess',
  'sessionFollowUp',
  'diagnoseGaps',
  'confirmDiagnosticGap',
  'dismissDiagnosticGap',
  'createArtifact',
  'recordFeedback',
  'getLearnerProfile',
  'proactiveTrigger',
  'skipDay',
  'getObservabilityCounters',
  'getProviderStatus',
]);

const RequestSchema = z.object({
  action: z.string(),
  payload: z.unknown().optional(),
});

function ok<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ success: true, data }, { status });
}

function fail(error: string, status = 400, details?: unknown): NextResponse<ApiResponse> {
  return NextResponse.json(
    { success: false, error, ...(details !== undefined ? { details } : {}) },
    { status },
  );
}

function getRepo(): LearningRepository {
  // Allow tests / ops to point at an alternate JSON path without installing deps.
  if (process.env.LEARNING_DATA_PATH) {
    return new LearningRepository({ dataPath: process.env.LEARNING_DATA_PATH });
  }
  return learningRepository;
}

function getProviderConfig(providerId = 'openai'): ProviderConfig | undefined {
  try {
    const { apiKey, baseUrl, model, providerId: resolvedId } =
      resolveProviderConfig(providerId);
    if (!apiKey) return undefined;
    return { apiKey, baseUrl, model, providerId: resolvedId };
  } catch {
    return undefined;
  }
}

async function safeRecord(kind: 'llmCall' | 'citationReject' | 'scheduleChange'): Promise<void> {
  try {
    await recordCounter(kind);
  } catch {
    // Observability must never fail the API response.
  }
}

function requireString(value: unknown, field: string): string {
  const str = String(value ?? '').trim();
  if (!str) throw new LearningDataError(`${field} is required`, 'INVALID_INPUT');
  return str;
}

function findSection(session: { sections: SessionSection[] }, sectionId: string): SessionSection {
  const section = session.sections.find((s) => s.id === sectionId);
  if (!section) {
    throw new LearningDataError(`Section not found: ${sectionId}`, 'NOT_FOUND');
  }
  return section;
}

function parseProactiveTrigger(payload: Record<string, unknown>): import('@/lib/learning/proactive').ProactiveTrigger | null {
  const kind = String(payload.kind ?? '').trim();
  const courseId = String(payload.courseId ?? '').trim();
  if (!kind || !courseId) return null;

  switch (kind) {
    case 'import_document':
      return {
        kind,
        courseId,
        documentTitle: String(payload.documentTitle ?? '').trim(),
      };
    case 'import_timetable':
      return { kind, courseId };
    case 'add_goal':
      return {
        kind,
        courseId,
        goalId: String(payload.goalId ?? '').trim(),
        goalTitle: String(payload.goalTitle ?? '').trim(),
      };
    case 'add_unit':
      return {
        kind,
        courseId,
        unitId: String(payload.unitId ?? '').trim(),
        unitTitle: String(payload.unitTitle ?? '').trim(),
      };
    case 'add_task':
      return {
        kind,
        courseId,
        taskId: String(payload.taskId ?? '').trim(),
      };
    case 'skip_day':
      return {
        kind,
        courseId,
        date: String(payload.date ?? '').trim(),
      };
    default:
      return null;
  }
}

const engine = new SessionEngine();

export async function POST(request: NextRequest): Promise<NextResponse<ApiResponse>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('Invalid JSON body', 400);
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Request must be { action, payload? }', 400, parsed.error.issues);
  }

  const actionResult = ActionSchema.safeParse(parsed.data.action);
  if (!actionResult.success) {
    return fail(`Unknown action: ${String(parsed.data.action)}`, 400);
  }

  const action = actionResult.data;
  const payload = (parsed.data.payload ?? {}) as Record<string, unknown>;
  const repo = getRepo();

  try {
    switch (action) {
      case 'getAll': {
        const data = await repo.load();
        return ok(data);
      }

      case 'createCourse': {
        const title = String(payload.title ?? '').trim();
        if (!title) return fail('createCourse requires payload.title');
        const course = await repo.createCourse({
          title,
          description: payload.description != null ? String(payload.description) : undefined,
          id: payload.id != null ? String(payload.id) : undefined,
        });
        return ok(course);
      }

      case 'deleteCourse':
      case 'renameCourse':
      case 'archiveCourse':
      case 'unarchiveCourse':
      case 'renameDocument':
      case 'deleteDocument':
      case 'renameFolder':
      case 'deleteFolder': {
        // Batch-06: shared Zod EntityActionRequest via repository.
        try {
          const result = await repo.applyLearningApiEntityAction(action, payload);
          return ok(result);
        } catch (err) {
          if (err instanceof LearningDataError) {
            const status =
              err.code === 'NOT_FOUND'
                ? 404
                : err.code === 'INVALID_INPUT'
                  ? 400
                  : 400;
            return fail(err.message, status, err.details);
          }
          throw err;
        }
      }

      case 'upsertGoal': {
        const courseId = String(payload.courseId ?? '').trim();
        const title = String(payload.title ?? '').trim();
        if (!courseId || !title) return fail('upsertGoal requires payload.courseId and payload.title');
        const goal = await repo.upsertGoal({
          id: payload.id != null ? String(payload.id) : undefined,
          courseId,
          title,
          description: payload.description != null ? String(payload.description) : undefined,
          targetDate: payload.targetDate != null ? String(payload.targetDate) : undefined,
        });
        return ok(goal);
      }

      case 'upsertUnit': {
        const courseId = String(payload.courseId ?? '').trim();
        const title = String(payload.title ?? '').trim();
        if (!courseId || !title) return fail('upsertUnit requires payload.courseId and payload.title');
        const knowledgePoints = Array.isArray(payload.knowledgePoints)
          ? payload.knowledgePoints.map((k) => String(k).trim()).filter(Boolean)
          : undefined;
        const unit = await repo.upsertUnit({
          id: payload.id != null ? String(payload.id) : undefined,
          courseId,
          title,
          goalId: payload.goalId != null ? String(payload.goalId) : undefined,
          description: payload.description != null ? String(payload.description) : undefined,
          knowledgePoints,
          order: typeof payload.order === 'number' ? payload.order : undefined,
        });
        return ok(unit);
      }

      case 'upsertTask': {
        const courseId = String(payload.courseId ?? '').trim();
        const title = String(payload.title ?? '').trim();
        const estimatedMinutes = Number(payload.estimatedMinutes);
        if (!courseId || !title || !Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) {
          return fail('upsertTask requires payload.courseId, payload.title, payload.estimatedMinutes');
        }
        const task = await repo.upsertTask({
          id: payload.id != null ? String(payload.id) : undefined,
          courseId,
          title,
          estimatedMinutes,
          goalId: payload.goalId != null ? String(payload.goalId) : undefined,
          unitId: payload.unitId != null ? String(payload.unitId) : undefined,
          description: payload.description != null ? String(payload.description) : undefined,
          deadline: payload.deadline != null ? String(payload.deadline) : undefined,
          status: payload.status as StudyTask['status'] | undefined,
          locked: typeof payload.locked === 'boolean' ? payload.locked : undefined,
          scheduledStart: payload.scheduledStart != null ? String(payload.scheduledStart) : undefined,
          scheduledEnd: payload.scheduledEnd != null ? String(payload.scheduledEnd) : undefined,
        });
        return ok(task);
      }

      case 'proposeTask': {
        const courseId = String(payload.courseId ?? '').trim();
        const title = String(payload.title ?? '').trim();
        const estimatedMinutes = Number(payload.estimatedMinutes);
        if (!courseId || !title || !Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) {
          return fail('proposeTask requires payload.courseId, payload.title, payload.estimatedMinutes');
        }
        const task = await repo.proposeTask({
          id: payload.id != null ? String(payload.id) : undefined,
          courseId,
          title,
          estimatedMinutes,
          goalId: payload.goalId != null ? String(payload.goalId) : undefined,
          unitId: payload.unitId != null ? String(payload.unitId) : undefined,
          description: payload.description != null ? String(payload.description) : undefined,
          deadline: payload.deadline != null ? String(payload.deadline) : undefined,
        });
        return ok(task);
      }

      case 'confirmTask': {
        const taskId = String(payload.taskId ?? payload.id ?? '').trim();
        if (!taskId) return fail('confirmTask requires payload.taskId');
        const task = await repo.confirmTask(taskId);
        return ok(task);
      }

      case 'rejectSuggestion': {
        const taskId = String(payload.taskId ?? payload.id ?? '').trim();
        if (!taskId) return fail('rejectSuggestion requires payload.taskId');
        const result = await repo.rejectSuggestion(taskId);
        return ok(result);
      }

      case 'completeTask': {
        const taskId = String(payload.taskId ?? payload.id ?? '').trim();
        if (!taskId) return fail('completeTask requires payload.taskId');
        const task = await repo.completeTask(taskId);
        return ok(task);
      }

      case 'importDocument': {
        // Only title / format / content (and courseId) — reject path fields
        if ('path' in payload || 'filePath' in payload || 'filepath' in payload) {
          return fail('importDocument does not accept file paths; provide title, format, content');
        }
        const courseId = String(payload.courseId ?? '').trim();
        const title = String(payload.title ?? '').trim();
        const format = payload.format;
        const content = payload.content;
        if (!courseId || !title || format == null || typeof content !== 'string') {
          return fail('importDocument requires payload.courseId, title, format, content');
        }
        const doc = importDocument({
          courseId,
          title,
          format: format as 'markdown' | 'txt',
          content,
          id: payload.id != null ? String(payload.id) : undefined,
        });
        // B06: import assist — analysis + pending suggestions (propose ≠ commit).
        const result = await repo.importDocumentWithAssist(doc, {
          currentGoalId:
            payload.currentGoalId != null ? String(payload.currentGoalId) : undefined,
          currentUnitId:
            payload.currentUnitId != null ? String(payload.currentUnitId) : undefined,
        });
        return ok(result);
      }

      case 'confirmImportSuggestion': {
        const suggestionId = String(payload.suggestionId ?? payload.id ?? '').trim();
        if (!suggestionId) return fail('confirmImportSuggestion requires payload.suggestionId');
        const result = await repo.confirmImportSuggestion(suggestionId);
        return ok(result);
      }

      case 'rejectImportSuggestion': {
        const suggestionId = String(payload.suggestionId ?? payload.id ?? '').trim();
        if (!suggestionId) return fail('rejectImportSuggestion requires payload.suggestionId');
        const suggestion = await repo.rejectImportSuggestion(suggestionId);
        return ok(suggestion);
      }

      case 'getCalendarBrief': {
        // Always loads LearnerContextPack audience `calendar`.
        const data = await repo.load();
        const courseId =
          payload.courseId != null ? String(payload.courseId).trim() : undefined;
        const brief = await buildCalendarBriefAsync(data, {
          courseId: courseId || null,
          now: payload.now != null ? new Date(String(payload.now)) : undefined,
        });
        return ok(brief);
      }

      case 'calendarAssistant': {
        const courseId = String(payload.courseId ?? '').trim();
        if (!courseId) return fail('calendarAssistant requires payload.courseId');

        const messagesResult = CalendarAssistantMessageSchema.array()
          .min(1)
          .max(12)
          .safeParse(payload.messages);
        if (!messagesResult.success) {
          return fail(
            'calendarAssistant requires 1-12 valid messages',
            400,
            messagesResult.error.flatten(),
          );
        }

        const data = await repo.load();
        if (!data.courses.some((course) => course.id === courseId)) {
          return fail('Course not found', 404);
        }

        let currentProposal: PlanProposal | null = null;
        if (payload.proposal != null) {
          const proposalResult = CalendarAssistantProposalSchema.safeParse(payload.proposal);
          if (!proposalResult.success || proposalResult.data.courseId !== courseId) {
            return fail(
              'calendarAssistant payload.proposal is invalid',
              400,
              proposalResult.success ? undefined : proposalResult.error.flatten(),
            );
          }
          currentProposal = proposalResult.data;
        }

        const providerId = String(payload.providerId ?? 'openai').trim() || 'openai';
        let resolved;
        try {
          resolved = resolveProviderConfig(providerId);
        } catch (error) {
          return fail(
            error instanceof Error ? error.message : 'Unsupported provider',
            400,
          );
        }
        if (!resolved.apiKey) {
          return fail('模型认证失败，请在设置中配置 API Key。', 503, {
            code: 'MODEL_AUTH_ERROR',
          });
        }

        const assistantController = new AbortController();
        let assistantTimedOut = false;
        const abortFromRequest = () => assistantController.abort();
        if (request.signal.aborted) abortFromRequest();
        else request.signal.addEventListener('abort', abortFromRequest, { once: true });
        const assistantTimeout = setTimeout(() => {
          assistantTimedOut = true;
          assistantController.abort();
        }, 60_000);

        let decision;
        try {
          decision = await callAgentJson(
            CALENDAR_ASSISTANT_SYSTEM_PROMPT,
            buildCalendarAssistantUserPrompt({
              data,
              courseId,
              proposal: currentProposal,
              messages: messagesResult.data,
            }),
            {
              apiKey: resolved.apiKey,
              baseUrl: resolved.baseUrl,
              model: resolved.model,
              providerId: resolved.providerId,
              temperature: 0.2,
              maxTokens: 1_200,
              signal: assistantController.signal,
              userSystemPrompt:
                typeof payload.systemPrompt === 'string'
                  ? payload.systemPrompt.slice(0, 8_000)
                  : undefined,
            },
            CalendarAssistantDecisionSchema,
          );
        } catch (error) {
          if (assistantTimedOut) {
            return fail('学习伴侣响应超时，请重试或切换模型。', 504, {
              code: 'MODEL_TIMEOUT',
            });
          }
          const failure = classifyModelFailure(error);
          return fail(failure.message, failure.status, { code: failure.code });
        } finally {
          clearTimeout(assistantTimeout);
          request.signal.removeEventListener('abort', abortFromRequest);
        }
        await safeRecord('llmCall');

        let nextProposal: PlanProposal | undefined;
        if (decision.action === 'replan') {
          const constraints = mergeCalendarAssistantConstraints(
            currentProposal?.constraints,
            decision.constraints,
          );
          nextProposal = await repo.proposePlanAsync(
            courseId,
            undefined,
            undefined,
            constraints,
          );
          if (currentProposal?.sourceConversationId) {
            nextProposal = {
              ...nextProposal,
              sourceConversationId: currentProposal.sourceConversationId,
            };
          }
        } else if (decision.action === 'move_task' && decision.move) {
          try {
            nextProposal = applyCalendarAssistantMove({
              data,
              courseId,
              proposal: currentProposal,
              move: decision.move,
            });
          } catch (error) {
            const result: CalendarAssistantResult = {
              reply:
                error instanceof Error
                  ? error.message
                  : '这次调整没有生成有效草案，请再说明具体任务和时间。',
              action: 'none',
              suggestions: decision.suggestions,
              issues: [],
            };
            return ok(result);
          }
        }

        const result: CalendarAssistantResult = {
          reply: decision.reply,
          action: decision.action,
          ...(nextProposal ? { proposal: nextProposal } : {}),
          suggestions: decision.suggestions,
          issues: nextProposal
            ? validatePlanProposal(nextProposal, data).map((issue) => issue.message)
            : [],
        };
        return ok(result);
      }

      case 'proposePlan': {
        const courseId = String(payload.courseId ?? '').trim();
        if (!courseId) return fail('proposePlan requires payload.courseId');
        const now = payload.now != null ? new Date(String(payload.now)) : undefined;
        if (now && Number.isNaN(now.getTime())) {
          return fail('proposePlan payload.now must be a valid date', 400);
        }
        const constraintsResult = PlanConstraintSnapshotSchema.safeParse(payload.constraints ?? {});
        if (!constraintsResult.success) {
          return fail('proposePlan payload.constraints is invalid', 400, constraintsResult.error.flatten());
        }
        const proposal = await repo.proposePlanAsync(
          courseId,
          payload.goalId != null ? String(payload.goalId) : undefined,
          now,
          constraintsResult.data,
        );
        // propose ≠ commit: do not write schedule
        return ok(proposal);
      }

      case 'confirmPlan': {
        const proposal = payload.proposal as PlanProposal | undefined;
        if (
          !proposal ||
          typeof proposal.id !== 'string' ||
          typeof proposal.courseId !== 'string' ||
          typeof proposal.baseRevision !== 'string' ||
          typeof proposal.timeZone !== 'string' ||
          !proposal.plan ||
          !Array.isArray(proposal.plan.tasks)
        ) {
          return fail('confirmPlan requires payload.proposal from proposePlan');
        }
        const applied = await repo.confirmPlan(proposal);
        if (applied.changed && applied.plan.tasks.some((t) => t.status === 'scheduled')) {
          await safeRecord('scheduleChange');
        }
        return ok({
          plan: applied.plan,
          applied: true as const,
          replayed: !applied.changed,
        });
      }

      case 'importTimetable': {
        const courseId = String(payload.courseId ?? '').trim();
        const csv = payload.csv ?? payload.content;
        if (!courseId || typeof csv !== 'string') {
          return fail('importTimetable requires payload.courseId and payload.csv');
        }
        const slots = importTimetableCsvStrict(courseId, csv);
        const saved = await repo.replaceTimetableForCourse(courseId, slots);
        return ok(saved);
      }

      case 'search': {
        const courseId = String(payload.courseId ?? '').trim();
        const query = String(payload.query ?? '').trim();
        if (!courseId) return fail('search requires payload.courseId');
        const data = await repo.load();
        const hits = searchDocuments(data, {
          courseId,
          query,
          limit: typeof payload.limit === 'number' ? payload.limit : undefined,
        });
        return ok(hits);
      }

      case 'plan': {
        const courseId = String(payload.courseId ?? '').trim();
        if (!courseId) return fail('plan requires payload.courseId');
        const now = payload.now != null ? new Date(String(payload.now)) : undefined;
        if (now && Number.isNaN(now.getTime())) {
          return fail('plan payload.now must be a valid date', 400);
        }
        const data = await repo.load();
        const result = planStudySchedule(data, {
          courseId,
          goalId: payload.goalId != null ? String(payload.goalId) : undefined,
          now,
        });
        // Persist scheduled fields for non-locked planned tasks
        await repo.replaceTasks(result.tasks);
        if (result.tasks.some((t) => t.status === 'scheduled')) {
          await safeRecord('scheduleChange');
        }
        return ok(result);
      }

      case 'createSession': {
        const courseId = String(payload.courseId ?? '').trim();
        if (!courseId) return fail('createSession requires payload.courseId');
        let sections = Array.isArray(payload.sections) ? payload.sections : undefined;
        if (!sections) {
          const all = await repo.load();
          const units = all.units
            .filter((u) => u.courseId === courseId)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          sections = engine.buildSections(units);
        }
        const session = await repo.createSession({
          id: payload.id != null ? String(payload.id) : undefined,
          courseId,
          taskId: payload.taskId != null ? String(payload.taskId) : undefined,
          startedAt: payload.startedAt != null ? String(payload.startedAt) : undefined,
          endedAt: payload.endedAt != null ? String(payload.endedAt) : undefined,
          notes: payload.notes != null ? String(payload.notes) : undefined,
          sections,
        });
        return ok(session);
      }

      case 'endSession': {
        const sessionId = String(payload.sessionId ?? payload.id ?? '').trim();
        if (!sessionId) return fail('endSession requires payload.sessionId');
        const session = await repo.endSession(sessionId);
        return ok(session);
      }

      case 'getSession': {
        const sessionId = String(payload.sessionId ?? payload.id ?? '').trim();
        if (!sessionId) return fail('getSession requires payload.sessionId');
        const session = await repo.getSession(sessionId);
        return ok(session);
      }

      case 'saveSessionReflection': {
        const sessionId = String(payload.sessionId ?? '').trim();
        const notes = String(payload.notes ?? '').trim();
        if (!sessionId || !notes) {
          return fail('saveSessionReflection requires sessionId and notes');
        }
        if (notes.length > 8000) {
          return fail('saveSessionReflection notes too long');
        }
        const session = await repo.updateSession(sessionId, (current) => ({
          ...current,
          notes,
          updatedAt: new Date().toISOString(),
        }));
        return ok(session);
      }

      case 'sessionTeach': {
        const sessionId = requireString(payload.sessionId, 'sessionId');
        const courseId = requireString(payload.courseId, 'courseId');
        const sectionId = requireString(payload.sectionId, 'sectionId');
        const hits = Array.isArray(payload.hits) ? payload.hits : [];
        const providerId =
          payload.providerId != null ? String(payload.providerId) : 'openai';
        const webSearchMode = WebSearchModeSchema.catch('auto').parse(payload.webSearchMode);
        const userSystemPrompt = typeof payload.systemPrompt === 'string' ? payload.systemPrompt : undefined;
        const data = await repo.load();
        const session = await repo.getSession(sessionId);
        const section = findSection(session, sectionId);
        const provider = getProviderConfig(providerId);
        const result = await engine.generateTeach(
          data,
          courseId,
          section,
          hits as { documentId: string; title: string; chunkIndex: number; snippet: string; score: number }[],
          provider,
          { webSearchMode, userSystemPrompt },
        );
        if (provider?.apiKey) {
          await safeRecord('llmCall');
        }
        const next = await repo.updateSession(sessionId, (s) => ({
          ...s,
          webSearchMode,
          sections: s.sections.map((sec) => (sec.id === sectionId ? result.section : sec)),
          updatedAt: new Date().toISOString(),
        }));
        return ok(next);
      }

      case 'sessionReteach': {
        const sessionId = requireString(payload.sessionId, 'sessionId');
        const courseId = requireString(payload.courseId, 'courseId');
        const sectionId = requireString(payload.sectionId, 'sectionId');
        const hits = Array.isArray(payload.hits) ? payload.hits : [];
        const providerId = payload.providerId != null ? String(payload.providerId) : 'openai';
        const webSearchMode = WebSearchModeSchema.catch('auto').parse(payload.webSearchMode);
        const userSystemPrompt = typeof payload.systemPrompt === 'string' ? payload.systemPrompt : undefined;
        const data = await repo.load();
        const session = await repo.getSession(sessionId);
        const section = findSection(session, sectionId);
        const provider = getProviderConfig(providerId);
        const result = await engine.generateTeach(
          data,
          courseId,
          section,
          hits as { documentId: string; title: string; chunkIndex: number; snippet: string; score: number }[],
          provider,
          { webSearchMode, userSystemPrompt, reteach: true },
        );
        if (provider?.apiKey) await safeRecord('llmCall');
        const next = await repo.updateSession(sessionId, (s) => ({
          ...s,
          webSearchMode,
          sections: s.sections.map((sec) => (sec.id === sectionId ? result.section : sec)),
          updatedAt: new Date().toISOString(),
        }));
        return ok(next);
      }

      case 'sessionOpenSection': {
        const sessionId = requireString(payload.sessionId, 'sessionId');
        const sectionId = requireString(payload.sectionId, 'sectionId');
        const mode = payload.mode === 'flexible' ? 'flexible' : 'guided';
        const session = await repo.getSession(sessionId);
        const nextSession =
          mode === 'flexible'
            ? engine.openSectionFlexible(session, sectionId)
            : engine.openSection(session, sectionId);
        const next = await repo.updateSession(sessionId, () => nextSession);
        return ok(next);
      }

      case 'sessionSetWebSearchMode': {
        const sessionId = requireString(payload.sessionId, 'sessionId');
        const webSearchMode = WebSearchModeSchema.parse(payload.webSearchMode);
        const next = await repo.updateSession(sessionId, (session) => ({
          ...session,
          webSearchMode,
          updatedAt: new Date().toISOString(),
        }));
        return ok(next);
      }

      case 'sessionStartRecall': {
        const sessionId = requireString(payload.sessionId, 'sessionId');
        const sectionId = requireString(payload.sectionId, 'sectionId');
        const session = await repo.getSession(sessionId);
        const section = findSection(session, sectionId);
        const nextSection = engine.startRecall(section);
        const next = await repo.updateSession(sessionId, (s) => ({
          ...s,
          sections: s.sections.map((sec) => (sec.id === sectionId ? nextSection : sec)),
          updatedAt: new Date().toISOString(),
        }));
        return ok(next);
      }

      case 'sessionSubmitRecall': {
        const sessionId = requireString(payload.sessionId, 'sessionId');
        const sectionId = requireString(payload.sectionId, 'sectionId');
        const answer = requireString(payload.answer, 'answer');
        const session = await repo.getSession(sessionId);
        const section = findSection(session, sectionId);
        const nextSection = engine.submitRecall(section, answer);
        const next = await repo.updateSession(sessionId, (s) => ({
          ...s,
          sections: s.sections.map((sec) => (sec.id === sectionId ? nextSection : sec)),
          updatedAt: new Date().toISOString(),
        }));
        return ok(next);
      }

      case 'sessionFollowUp': {
        const sessionId = requireString(payload.sessionId, 'sessionId');
        const sectionId = requireString(payload.sectionId, 'sectionId');
        const question = requireString(payload.question, 'question');
        const hits = Array.isArray(payload.hits) ? payload.hits : [];
        const providerId =
          payload.providerId != null ? String(payload.providerId) : 'openai';
        const data = await repo.load();
        const session = await repo.getSession(sessionId);
        const webSearchMode = WebSearchModeSchema.catch(session.webSearchMode ?? 'auto').parse(payload.webSearchMode);
        const userSystemPrompt = typeof payload.systemPrompt === 'string' ? payload.systemPrompt : undefined;
        const section = findSection(session, sectionId);
        const unitTitle =
          typeof payload.unitTitle === 'string' ? payload.unitTitle : section.title;
        const provider = getProviderConfig(providerId);
        const result = await engine.generateFollowUp(section, question, {
          unitTitle,
          data,
          courseId: session.courseId,
          provider,
          hits: hits as {
            documentId: string;
            title: string;
            chunkIndex: number;
            snippet: string;
            score: number;
          }[],
          webSearchMode,
          userSystemPrompt,
        });
        if (provider?.apiKey) {
          await safeRecord('llmCall');
        }
        const next = await repo.updateSession(sessionId, (s) => ({
          ...s,
          webSearchMode,
          sections: s.sections.map((sec) =>
            sec.id === sectionId ? result.section : sec,
          ),
          updatedAt: new Date().toISOString(),
        }));
        return ok(next);
      }

      case 'sessionAssess': {
        const sessionId = requireString(payload.sessionId, 'sessionId');
        const courseId = requireString(payload.courseId, 'courseId');
        const sectionId = requireString(payload.sectionId, 'sectionId');
        const data = await repo.load();
        const session = await repo.getSession(sessionId);
        const section = findSection(session, sectionId);
        const providerId =
          payload.providerId != null ? String(payload.providerId) : 'openai';
        const provider = getProviderConfig(providerId);
        const { assessment } = await engine.generateAssessment(
          data,
          courseId,
          section,
          provider,
        );
        if (provider?.apiKey) {
          await safeRecord('llmCall');
        }
        const nextSession = engine.applyAssessment(session, section, assessment);
        const next = await repo.updateSession(sessionId, () => nextSession);
        return ok(next);
      }

      case 'diagnoseGaps': {
        const courseId = String(payload.courseId ?? '').trim();
        if (!courseId) return fail('diagnoseGaps requires payload.courseId');
        const documentIds = Array.isArray(payload.documentIds)
          ? payload.documentIds.map(String)
          : undefined;
        const data = await repo.load();
        const { gaps, tasks } = diagnoseGaps(data, { courseId, documentIds });
        const saved = await repo.addDiagnosticGaps(gaps, tasks);
        return ok(saved);
      }

      case 'confirmDiagnosticGap': {
        const gapId = String(payload.gapId ?? payload.id ?? '').trim();
        if (!gapId) return fail('confirmDiagnosticGap requires payload.gapId');
        const result = await repo.confirmDiagnosticGap(gapId);
        return ok(result);
      }

      case 'dismissDiagnosticGap': {
        const gapId = String(payload.gapId ?? payload.id ?? '').trim();
        if (!gapId) return fail('dismissDiagnosticGap requires payload.gapId');
        const gap = await repo.dismissDiagnosticGap(gapId);
        return ok(gap);
      }

      case 'createArtifact': {
        const courseId = String(payload.courseId ?? '').trim();
        const kind = payload.kind;
        const title = String(payload.title ?? '').trim();
        const hits = Array.isArray(payload.hits) ? payload.hits : [];
        if (!courseId || !title || !kind) {
          return fail('createArtifact requires payload.courseId, kind, title');
        }
        if (!['quiz', 'flashcard', 'summary'].includes(String(kind))) {
          return fail('createArtifact kind must be quiz, flashcard, or summary');
        }
        const data = await repo.load();
        try {
          const artifact = createArtifact(data, {
            courseId,
            kind: kind as Artifact['kind'],
            title,
            hits: hits as { documentId: string; title: string; chunkIndex: number; snippet: string; score: number }[],
            sessionId: payload.sessionId != null ? String(payload.sessionId) : undefined,
            taskId: payload.taskId != null ? String(payload.taskId) : undefined,
          });
          await repo.addArtifact(artifact);
          return ok(artifact);
        } catch (err) {
          if (err instanceof ArtifactError && err.code === 'INVALID_CITATION') {
            await safeRecord('citationReject');
          }
          throw err;
        }
      }

      case 'recordFeedback': {
        const courseId = String(payload.courseId ?? '').trim();
        const sessionId = String(payload.sessionId ?? '').trim();
        const rating = Number(payload.rating);
        if (!courseId || !sessionId || !Number.isFinite(rating)) {
          return fail('recordFeedback requires payload.courseId, sessionId, rating');
        }
        const data = await repo.load();
        const result = recordFeedback(data, {
          courseId,
          sessionId,
          rating,
          difficulty: typeof payload.difficulty === 'number' ? payload.difficulty : undefined,
          understood: typeof payload.understood === 'boolean' ? payload.understood : undefined,
          notes: payload.notes != null ? String(payload.notes) : undefined,
        });
        await repo.recordFeedback(result.feedback, result.profile);
        return ok(result);
      }

      case 'getLearnerProfile': {
        const courseId = String(payload.courseId ?? '').trim();
        if (!courseId) return fail('getLearnerProfile requires payload.courseId');
        const profile = await repo.getLearnerProfile(courseId);
        return ok(profile);
      }

      case 'proactiveTrigger': {
        const trigger = parseProactiveTrigger(payload);
        if (!trigger) return fail('proactiveTrigger requires payload.kind and payload.courseId');
        const result = await repo.runProactiveTrigger(trigger);
        return ok(result);
      }

      case 'skipDay': {
        const courseId = String(payload.courseId ?? '').trim();
        const skippedDate = String(payload.skippedDate ?? '').trim();
        if (!courseId || !/^\d{4}-\d{2}-\d{2}$/.test(skippedDate)) {
          return fail('skipDay requires payload.courseId and payload.skippedDate (YYYY-MM-DD)');
        }
        const result = await repo.rescheduleAfterSkipDay(courseId, skippedDate);
        if (result.tasks.length > 0) {
          await safeRecord('scheduleChange');
        }
        return ok(result);
      }

      case 'getObservabilityCounters': {
        const counters = await loadCounters();
        return ok(counters);
      }

      case 'getProviderStatus': {
        const providerId =
          payload.providerId != null ? String(payload.providerId) : 'openai';
        return ok(getProviderStatus(providerId));
      }

      default: {
        const exhaustiveAction: never = action;
        return fail(`Unknown action: ${String(exhaustiveAction)}`, 400);
      }
    }
  } catch (err) {
    if (err instanceof LearningDataError) {
      const serverCodes = new Set([
        'CORRUPT_JSON',
        'SCHEMA_INVALID',
        'READ_FAILED',
        'WRITE_FAILED',
        'BACKUP_FAILED',
      ]);
      const status = err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'PLAN_STALE'
          ? 409
          : serverCodes.has(err.code)
            ? 500
            : 400;
      const details = err.details && typeof err.details === 'object' && !Array.isArray(err.details)
        ? { code: err.code, ...err.details }
        : { code: err.code, details: err.details };
      return fail(err.message, status, details);
    }
    if (err instanceof SessionEngineError) {
      const status = err.code === 'NOT_FOUND'
        ? 404
        : ['LOCKED', 'INVALID_STATE'].includes(err.code)
          ? 400
          : err.code === 'LOW_QUALITY_GENERATION'
            ? 422
            : err.code === 'MODEL_UNAVAILABLE'
              ? 503
              : 500;
      return fail(err.message, status, { code: err.code });
    }
    if (err instanceof DiagnosticError || err instanceof ArtifactError || err instanceof ProfileError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return fail(err.message, status, { code: err.code });
    }
    if (err instanceof ImportError) {
      return fail(err.message, 400, err.details);
    }
    if (err instanceof SearchError) {
      return fail(err.message, 400);
    }
    if (err instanceof z.ZodError) {
      return fail('Validation failed', 400, err.issues);
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return fail(message, 500);
  }
}

/** Test helper — not used by Next runtime exports. */
export type { LearningData };

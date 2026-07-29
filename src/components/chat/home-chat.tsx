'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send,
  Sparkles,
  Brain,
  FileText,
  Trash2,
  Pencil,
  MessageSquare,
  RotateCcw,
  BookOpen,
  MessageCircle,
  Copy,
  Check,
  Wrench,
  CalendarPlus,
  FolderOpen,
  ChevronDown,
  Clock3,
} from 'lucide-react';
import { useChatStore } from '@/store/chat-store';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';
import { useLearnFlowStore } from '@/store/learn-flow-store';
import { useLearningStore } from '@/store/learning-store';
import { Message } from '@/types/agent';
import type { ExecutionStep } from '@/types/agent';
import type { DesktopEvent, PendingToolConfirm } from '@/lib/agents/types';
import type { HitlUiDecision } from '@/components/ui/tool-confirm-dialog';
import { MinusMark } from '@/components/brand/minus-mark';
import { MinusLogo } from '@/components/brand/minus-logo';
import { LearnFlowCards } from '@/components/chat/learn-flow/learn-cards';
import { DesktopToolTimeline } from '@/components/chat/desktop-tool-timeline';
import { AssistantRichContent } from '@/components/chat/learn-content-blocks';
import {
  allowsTeachFences,
  buildSkillPlan,
  sceneIdFromStage,
} from '@/lib/agents/control-plane';
import { LEARN_CONTENT_SYSTEM_HINT } from '@/lib/chat/learn-content';
import {
  buildHomeSuggestions,
  isNeutralOnlyHome,
  type HomeSuggestion,
  type HomeSuggestionClickMode,
} from '@/lib/chat/home-suggestions';
import {
  friendlyErrorMessageBody,
  friendlyErrorToast,
} from '@/lib/chat/error-sanitize';
import { takeComposerPrefill } from '@/lib/chat/composer-prefill';
import { buildLearnerContextPack } from '@/lib/memory/context-pack';
import type { LearnerMemoryData } from '@/lib/memory/learner-memory-core';
import {
  canUpgradeToDeep,
  effectiveExperienceMode,
  modeToggleUiState,
  resolveTogglePreference,
} from '@/lib/chat/effective-experience-mode';
import {
  copyAssistantContentPolicy,
  hitlInvalidateRequest,
  isStaleStreamWrite,
  learnArtifactsToMessage,
  messageArtifactsToLearn,
  regenerateAssistantPolicy,
  resolveInteractiveAssistantId,
} from '@/lib/chat/turn-editing';
import type { UserModePreference } from '@/types/agent';
import { appNavigate, APP_PATHS } from '@/lib/navigation';
import {
  advanceCalendarPlanning,
  calendarPlanningFromSnapshot,
  calendarPlanningWithProposal,
  shouldStartCalendarPlanning,
  snapshotFromCalendarPlanning,
} from '@/lib/learning/calendar-chat-flow';
import { constraintsToPlanHints } from '@/lib/learning/planning-constraints';
import type { PlanningConstraintKey } from '@/lib/learning/planning-constraints';
import { gateArtifactsCopy } from '@/lib/ui/outbound-copy-gate';
import { registerCalendarPlanningHandler } from '@/lib/chat/calendar-planning-bridge';

type AutonomyCat =
  | 'web_search'
  | 'code_run'
  | 'artifacts_write'
  | 'package_install';

/** Monotonic client message ids (avoids impure Date.now/Math.random in component body). */
let clientMessageSeq = 0;
function nextClientMessageId(prefix: string): string {
  clientMessageSeq += 1;
  return `${prefix}_${clientMessageSeq}`;
}

interface Toast {
  message: string;
  type: 'error' | 'success' | 'info';
  /** Optional retry for recoverable network failures. */
  onRetry?: () => void;
}

function suggestionIcon(source: HomeSuggestion['source']) {
  switch (source) {
    case 'capability':
      return Sparkles;
    case 'recent_task':
    case 'continue':
      return Brain;
    case 'recent_chat':
      return MessageSquare;
    case 'context':
      return FileText;
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

export function HomeChat() {
  const activeConversation = useChatStore((s) => s.getActiveConversation());
  const messages = activeConversation?.messages || [];
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const editUserMessage = useChatStore((s) => s.editUserMessage);
  const prepareAssistantRegenerate = useChatStore(
    (s) => s.prepareAssistantRegenerate,
  );
  const setMessageTurnArtifacts = useChatStore((s) => s.setMessageTurnArtifacts);
  const beginTurn = useChatStore((s) => s.beginTurn);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const conversations = useChatStore((s) => s.conversations);
  const setModePreference = useChatStore((s) => s.setModePreference);
  const setExperienceSnapshot = useChatStore((s) => s.setExperienceSnapshot);
  const activeConversationId = useChatStore((s) => s.activeConversationId);

  const settings = useSettingsStore((s) => s.settings);
  const revokeAutonomy = useSettingsStore((s) => s.revokeAutonomy);
  const setSafetyLevel = useSettingsStore((s) => s.setSafetyLevel);
  const openSettings = useUIStore((s) => s.openSettings);
  const considerUserMessage = useLearnFlowStore((s) => s.considerUserMessage);
  const learnStage = useLearnFlowStore((s) => s.stage);
  const learnExperienceMode = useLearnFlowStore((s) => s.experienceMode);
  const learnModePreference = useLearnFlowStore((s) => s.modePreference);
  const desktopEvents = useLearnFlowStore((s) => s.desktopEvents);
  const pushDesktopEvent = useLearnFlowStore((s) => s.pushDesktopEvent);
  const confirmTrustElevation = useLearnFlowStore((s) => s.confirmTrustElevation);
  const pendingDesktopMessage = useLearnFlowStore((s) => s.pendingDesktopMessage);
  const desktopResume = useLearnFlowStore((s) => s.desktopResume);
  const clearDesktopResume = useLearnFlowStore((s) => s.clearDesktopResume);

  const learningData = useLearningStore((s) => s.data);
  const loadLearning = useLearningStore((s) => s.load);
  const proposePlan = useLearningStore((s) => s.proposePlan);
  const createLearningSession = useLearningStore((s) => s.createSession);
  const setActiveLearningSession = useLearningStore((s) => s.setActiveSession);
  const setActiveLearningTaskId = useLearningStore((s) => s.setActiveTaskId);
  const setCalendarProposalPreview = useLearningStore(
    (s) => s.setCalendarProposalPreview,
  );
  const setActiveAppView = useUIStore((s) => s.setActiveAppView);

  const [input, setInput] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  /** Explicit edit mode when chip fills composer without sending. */
  const [chipEditMode, setChipEditMode] = useState(false);
  /** True while agent paused at HITL (loading UI paused; not streaming). */
  const [waitingConfirm, setWaitingConfirm] = useState(false);
  const [hitlBusy, setHitlBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [execSteps, setExecSteps] = useState<ExecutionStep[]>([]);
  /** Unified HITL card (resumeToken required for server resume path). */
  const [pendingHitl, setPendingHitl] = useState<PendingToolConfirm | null>(null);
  const [trustForNextDesktop, setTrustForNextDesktop] = useState(false);
  const [sessionCategoryApprovals, setSessionCategoryApprovals] = useState<
    AutonomyCat[]
  >([]);
  const [safetyMenuOpen, setSafetyMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  /** Dynamic LearnerContextPack summary for Home chips (no hard-coded hasContext:false). */
  const [contextPack, setContextPack] = useState<{
    hasContext: boolean;
    summaryLine: string;
  }>({ hasContext: false, summaryLine: '' });
  /** Last failed user text for toast retry. */
  const lastFailedInputRef = useRef<string | null>(null);

  /** Batch-03: single mode truth — conversation + learn-flow + route (no local dual state). */
  const experienceMode = useMemo(
    () =>
      effectiveExperienceMode({
        conversation: activeConversation,
        route: '/chat',
        experienceMode: learnExperienceMode,
        modePreference: learnModePreference ?? activeConversation?.modePreference ?? null,
        stage: learnStage,
      }),
    [
      activeConversation,
      learnExperienceMode,
      learnModePreference,
      learnStage,
    ],
  );
  const modeUi = useMemo(() => modeToggleUiState(experienceMode), [experienceMode]);
  const userModePreference: 'normal' | 'deep' = resolveTogglePreference(
    experienceMode,
    learnModePreference ?? activeConversation?.modePreference ?? null,
  );
  const setUserModePreference = useCallback(
    (mode: UserModePreference) => {
      if (mode === 'deep' && !canUpgradeToDeep(experienceMode) && experienceMode !== 'deep_planning') {
        return;
      }
      // deep_course: mode switch hidden — ignore
      if (experienceMode === 'deep_course') return;
      setModePreference(mode);
    },
    [experienceMode, setModePreference],
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  /** Monotonic stream generation — bumps on abort/edit/switch so stale SSE cannot write. */
  const streamGenerationRef = useRef(0);
  const streamGuardRef = useRef<{
    conversationId: string | null;
    turnId: string | null;
    generation: number;
    assistantMessageId: string | null;
  }>({
    conversationId: null,
    turnId: null,
    generation: 0,
    assistantMessageId: null,
  });
  /** Client-side invalidated HITL tokens (fail-closed after cancel). */
  const invalidatedHitlTokensRef = useRef<Set<string>>(new Set());
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // Auto-downgrade expired grant on mount / settings change
  useEffect(() => {
    const policy = settings.approvalPolicy;
    const grant = settings.autonomyGrant;
    if (
      (policy === 'bounded_auto' || policy === 'full_auto') &&
      (!grant || Date.parse(grant.expiresAt) <= Date.now())
    ) {
      revokeAutonomy();
      void fetch('/api/settings/safety', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke' }),
      }).catch(() => {
        /* non-blocking */
      });
    }
  }, [settings.approvalPolicy, settings.autonomyGrant, revokeAutonomy]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const scrollPinnedRef = useRef(true);
  const [hasUnreadContent, setHasUnreadContent] = useState(false);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    scrollPinnedRef.current = true;
    setHasUnreadContent(false);
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const node = messagesScrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    const pinned = distanceFromBottom <= 80;
    scrollPinnedRef.current = pinned;
    if (pinned) setHasUnreadContent(false);
  }, []);

  const lastMessageContent = messages[messages.length - 1]?.content;
  useEffect(() => {
    if (scrollPinnedRef.current) {
      scrollToBottom(messages.length <= 1 ? 'auto' : 'smooth');
      return;
    }
    setHasUnreadContent(true);
  }, [messages.length, lastMessageContent, scrollToBottom]);

  // UX06: Library document actions prefill composer (one-shot).
  useEffect(() => {
    const prefill = takeComposerPrefill();
    if (!prefill?.text) return;
    // Defer setState out of the effect body (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      setInput(prefill.text);
      setChipEditMode(true);
      if (prefill.mode === 'normal' || prefill.mode === 'deep') {
        setModePreference(prefill.mode);
      }
    });
  }, [setModePreference]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    void loadLearning();
  }, [loadLearning]);

  useEffect(() => {
    let cancelled = false;
    void fetch(
      `/api/settings/provider?providerId=${encodeURIComponent(settings.providerId)}`,
    )
      .then((response) => response.json())
      .then((json: { success?: boolean; data?: { hasKey?: boolean } }) => {
        if (!cancelled) setProviderReady(Boolean(json.success && json.data?.hasKey));
      })
      .catch(() => {
        if (!cancelled) setProviderReady(null);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.providerId]);

  // UX03: load LearnerContextPack via memory API — no hard-coded hasContext:false
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get' }),
        });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as {
          success?: boolean;
          data?: LearnerMemoryData;
        };
        if (!json.success || !json.data || cancelled) return;
        const pack = buildLearnerContextPack(json.data, 'chat');
        if (cancelled) return;
        setContextPack({
          hasContext: !pack.empty && Boolean(pack.summaryLine.trim()),
          summaryLine: pack.summaryLine || '',
        });
      } catch {
        /* non-blocking — leave empty context silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const homeSuggestionInput = useMemo(() => {
    const recentTasks = [...learningData.tasks]
      .filter(
        (t) =>
          t.status !== 'done' &&
          t.status !== 'completed' &&
          t.status !== 'pending_suggestion',
      )
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        courseId: t.courseId,
        unitId: t.unitId,
        goalId: t.goalId,
        updatedAt: t.updatedAt,
      }));

    const recentConversationTitles = [...conversations]
      .filter((c) => (c.messages || []).some((m) => m.content?.trim()))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .slice(0, 3)
      .map((c) => c.title || '未命名对话');

    return {
      recentTasks,
      recentConversationTitles,
      hasContext: contextPack.hasContext,
      contextSummaryLine: contextPack.summaryLine,
    };
  }, [learningData.tasks, conversations, contextPack]);

  const homeSuggestions = useMemo(
    () => buildHomeSuggestions(homeSuggestionInput),
    [homeSuggestionInput],
  );

  const neutralOnly = useMemo(
    () => isNeutralOnlyHome(homeSuggestionInput),
    [homeSuggestionInput],
  );

  const homeLearningSnapshot = useMemo(() => {
    const priority: Record<string, number> = {
      in_progress: 0,
      scheduled: 1,
      confirmed: 2,
      pending: 3,
    };
    const items = learningData.tasks
      .filter((task) => priority[task.status] !== undefined)
      .sort((a, b) => {
        const byStatus = priority[a.status]! - priority[b.status]!;
        if (byStatus !== 0) return byStatus;
        const aTime = Date.parse(a.scheduledStart || a.updatedAt || '') || Infinity;
        const bTime = Date.parse(b.scheduledStart || b.updatedAt || '') || Infinity;
        return aTime - bTime;
      })
      .slice(0, 2)
      .map((task) => ({
        task,
        courseTitle:
          learningData.courses.find((course) => course.id === task.courseId)?.title ||
          '学习课程',
        reason:
          task.status === 'in_progress'
            ? '上次学习还在进行中'
            : task.status === 'scheduled'
              ? '已在日历中安排'
              : task.status === 'confirmed'
                ? '已确认，等待开始'
                : '可以继续推进',
      }));
    const pendingCount = learningData.tasks.filter(
      (task) => task.status === 'pending_suggestion',
    ).length;
    return { items, pendingCount };
  }, [learningData.tasks, learningData.courses]);

  const showToast = (
    message: string,
    type: 'error' | 'success' | 'info' = 'error',
    onRetry?: () => void,
  ) => {
    setToast({ message, type, onRetry });
  };

  const handleOpenLearningTask = async (taskId: string) => {
    const task = learningData.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const existing = [...learningData.sessions]
      .filter(
        (session) =>
          !session.endedAt &&
          session.courseId === task.courseId &&
          session.taskId === task.id,
      )
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
    try {
      const session =
        existing ||
        (await createLearningSession({
          courseId: task.courseId,
          taskId: task.id,
          notes: `Home: ${task.title}`,
        }));
      setActiveLearningSession(session);
      setActiveLearningTaskId(task.id);
      setActiveAppView('session', {
        courseId: task.courseId,
        sessionId: session.id,
      });
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : '暂时无法打开学习任务',
        'error',
        () => void handleOpenLearningTask(taskId),
      );
    }
  };

  /** Safe message update — no-op when conversation switched, turn edited, or stream aborted. */
  const safeUpdateMessage = useCallback(
    (assistantMessageId: string, updates: Partial<Message>) => {
      const guard = streamGuardRef.current;
      const state = useChatStore.getState();
      const conv = state.getActiveConversation();
      if (
        isStaleStreamWrite({
          expectedConversationId: guard.conversationId,
          activeConversationId: state.activeConversationId,
          expectedTurnId: guard.turnId,
          currentTurnId: conv?.currentTurnId ?? null,
          expectedGeneration: guard.generation,
          currentGeneration: streamGenerationRef.current,
          assistantMessageId,
          messages: conv?.messages,
        })
      ) {
        return false;
      }
      if (
        guard.assistantMessageId &&
        guard.assistantMessageId !== assistantMessageId
      ) {
        return false;
      }
      updateMessage(assistantMessageId, updates);
      return true;
    },
    [updateMessage],
  );

  const beginStreamGuard = useCallback(
    (assistantMessageId: string, opts?: { reuseIfSameAssistant?: boolean }) => {
      if (
        opts?.reuseIfSameAssistant &&
        streamGuardRef.current.assistantMessageId === assistantMessageId &&
        streamGuardRef.current.turnId
      ) {
        return {
          generation: streamGuardRef.current.generation,
          turnId: streamGuardRef.current.turnId,
          conversationId: streamGuardRef.current.conversationId,
        };
      }
      const gen = streamGenerationRef.current + 1;
      streamGenerationRef.current = gen;
      const turnId = beginTurn();
      const convId = useChatStore.getState().activeConversationId;
      streamGuardRef.current = {
        conversationId: convId,
        turnId,
        generation: gen,
        assistantMessageId,
      };
      return { generation: gen, turnId, conversationId: convId };
    },
    [beginTurn],
  );

  /**
   * Cancel in-flight SSE + invalidate pending HITL token (server cancel + local set).
   * Single confirmation surface: clear pendingHitl so only one dialog remains possible.
   */
  const invalidatePendingHitlAndAbort = useCallback(
    (opts?: { reason?: string }) => {
      void opts;
      const token = pendingHitl?.resumeToken;
      abortRef.current?.abort();
      abortRef.current = null;
      streamGenerationRef.current += 1;
      streamGuardRef.current = {
        conversationId: useChatStore.getState().activeConversationId,
        turnId: null,
        generation: streamGenerationRef.current,
        assistantMessageId: null,
      };
      setPendingHitl(null);
      setWaitingConfirm(false);
      setHitlBusy(false);
      setExecSteps([]);

      const req = hitlInvalidateRequest(token);
      if (req.shouldCancel && req.body) {
        invalidatedHitlTokensRef.current.add(req.body.resumeToken);
        void fetch('/api/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
          }).catch(() => {
            /* non-blocking — token is already invalid client-side */
          });
      }
    },
    [pendingHitl],
  );

  // A real conversation switch invalidates the previous stream. Do this in the
  // effect body: cleanup on the draft null -> first conversation promotion used
  // to abort the brand-new first turn before /api/chat was even requested.
  useEffect(() => {
    const guard = streamGuardRef.current;
    if (
      guard.assistantMessageId &&
      guard.conversationId !== activeConversationId
    ) {
      const active = useChatStore.getState().getActiveConversation();
      const isDraftPromotion =
        guard.conversationId === null &&
        activeConversationId !== null &&
        active?.messages.some(
          (message) => message.id === guard.assistantMessageId,
        );
      if (isDraftPromotion) {
        streamGuardRef.current = {
          ...guard,
          conversationId: activeConversationId,
        };
        return;
      }
      streamGenerationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [activeConversationId]);

  // Component unmount still needs to release any live request.
  useEffect(() => {
    return () => {
      streamGenerationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  /** Explicit edit mode: fill composer only (no silent send). */
  const applySuggestionEdit = useCallback((s: HomeSuggestion) => {
    setInput(s.prompt);
    setChipEditMode(true);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(s.prompt.length, s.prompt.length);
    });
  }, []);

  /**
   * Fire-and-forget memory extract (B02):
   * - skip greeting-only last user message
   * - every 2nd user turn (min 2)
   * - failures logged, never break chat
   */
  const maybeExtractMemory = (payloadMessages: Array<{ role: string; content: string }>) => {
    const userMsgs = payloadMessages.filter((m) => m.role === 'user');
    const userTurns = userMsgs.length;
    if (userTurns < 2 || userTurns % 2 !== 0) return;

    const lastUser = (userMsgs[userMsgs.length - 1]?.content || '').trim();
    // B01/B02: greetings must not create memories
    if (
      /^(你好|您好|嗨|哈喽|hello|hi|hey|早上好|下午好|晚上好)([\s，,!！.。~～？?]*)$/i.test(
        lastUser,
      )
    ) {
      return;
    }

    void fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'extractFromChat',
        payload: {
          messages: payloadMessages,
          providerId: settings.providerId,
        },
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          console.warn('[memory/extract] non-ok:', res.status, body.slice(0, 200));
          return;
        }
        const json = (await res.json().catch(() => null)) as {
          success?: boolean;
          extracted?: string[];
          skipped?: string;
          error?: string;
        } | null;
        if (!json?.success) {
          console.warn('[memory/extract] failed:', json?.error || 'unknown');
          return;
        }
        if (json.skipped) {
          console.info('[memory/extract] skipped:', json.skipped);
          return;
        }
        if (json.extracted && json.extracted.length > 0) {
          console.info(
            '[memory/extract] proposed',
            json.extracted.length,
            'item(s)',
          );
        }
      })
      .catch((err) => {
        console.warn(
          '[memory/extract] network error:',
          err instanceof Error ? err.message : err,
        );
      });
  };

  const streamChat = async (
    assistantMessageId: string,
    payloadMessages: Array<{ role: string; content: string }>,
    opts?: { scene?: 'chat' | 'session_teach'; learnMode?: boolean },
  ) => {
    // Casual chat after IntentJudge `chat`: no teach fences (B01).
    // Teach format only when SkillPlan allows (session_teach / explicit learnMode).
    const sceneId =
      opts?.scene ??
      sceneIdFromStage(learnStage, { intent: 'chat', route: 'chat' });
    const skillPlan = buildSkillPlan({
      scene: sceneId === 'session_teach' ? 'session_teach' : 'chat',
      intent: opts?.learnMode === true ? 'learn' : 'chat',
      stage: learnStage,
    });
    const teachAllowed =
      opts?.learnMode === true || allowsTeachFences(skillPlan);
    const nonSystem = payloadMessages.filter((m) => m.role !== 'system');
    const messagesForApi = teachAllowed
      ? [{ role: 'system', content: LEARN_CONTENT_SYSTEM_HINT }, ...nonSystem]
      : nonSystem;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    // Reuse turn opened by runUserTurn when streaming the same assistant.
    beginStreamGuard(assistantMessageId, { reuseIfSameAssistant: true });

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messagesForApi,
        providerId: settings.providerId,
        systemPrompt: settings.systemPrompt,
        learnMode: teachAllowed,
        scene: teachAllowed ? 'session_teach' : 'chat',
      }),
      signal: ac.signal,
    });

    if (!response.ok) {
      let errorMessage = `HTTP Error ${response.status}`;
      try {
        const errData = await response.json();
        if (errData?.error) errorMessage = errData.error;
      } catch {
        /* ignore */
      }
      throw new Error(errorMessage);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法初始化 SSE 读取器，请检查网络连接');

    const decoder = new TextDecoder('utf-8');
    let done = false;
    let buffer = '';
    let accumulatedText = '';
    safeUpdateMessage(assistantMessageId, {
      thinking: false,
      content: '',
      status: 'streaming',
    });

    while (!done) {
      if (ac.signal.aborted) break;
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (!value) continue;
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const dataPart = trimmed.slice(6).trim();
        if (dataPart === '[DONE]' || dataPart === '"[DONE]"') {
          done = true;
          continue;
        }
        try {
          const parsed = JSON.parse(dataPart) as {
            delta?: string;
            replace?: string;
            contentBlocks?: Array<{
              kind: 'summary' | 'key' | 'tip' | 'definition' | 'section' | 'prose';
              title?: string;
              body: string;
            }>;
            error?: string;
          };
          if (parsed.error) throw new Error(parsed.error);
          if (typeof parsed.replace === 'string') {
            accumulatedText = parsed.replace;
            const patch: {
              content: string;
              contentBlocks?: typeof parsed.contentBlocks;
            } = { content: accumulatedText };
            if (parsed.contentBlocks) {
              patch.contentBlocks = parsed.contentBlocks;
            }
            if (!safeUpdateMessage(assistantMessageId, patch)) {
              done = true;
              break;
            }
            continue;
          }
          if (typeof parsed.delta === 'string') {
            accumulatedText += parsed.delta;
            if (
              !safeUpdateMessage(assistantMessageId, {
                content: accumulatedText,
              })
            ) {
              done = true;
              break;
            }
          }
        } catch (err) {
          if (err instanceof SyntaxError) {
            console.warn('Failed to parse SSE line:', dataPart);
          } else {
            throw err;
          }
        }
      }
    }
    safeUpdateMessage(assistantMessageId, {
      status: ac.signal.aborted ? 'cancelled' : 'complete',
      thinking: false,
    });
  };

  /**
   * Consume /api/agent SSE. On waiting_confirm, pause client loading and keep resumeToken.
   * Does NOT re-run the user message from scratch when tools need confirm.
   */
  const consumeAgentSse = useCallback(
    async (
      response: Response,
      assistantMessageId: string,
    ): Promise<{ status: string; finalText: string }> => {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法初始化 Desktop SSE');

      const decoder = new TextDecoder('utf-8');
      let done = false;
      let buffer = '';
      let finalText = '';
      let completeStatus = 'done';
      safeUpdateMessage(assistantMessageId, {
        thinking: false,
        content: '',
        status: 'streaming',
      });

      while (!done) {
        // Race: switched conversation / edited turn / aborted.
        const guard = streamGuardRef.current;
        const st = useChatStore.getState();
        if (
          isStaleStreamWrite({
            expectedConversationId: guard.conversationId,
            activeConversationId: st.activeConversationId,
            expectedTurnId: guard.turnId,
            currentTurnId: st.getActiveConversation()?.currentTurnId ?? null,
            expectedGeneration: guard.generation,
            currentGeneration: streamGenerationRef.current,
            assistantMessageId,
            messages: st.getActiveConversation()?.messages,
          })
        ) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          break;
        }
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (!value) continue;
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const dataPart = trimmed.slice(6).trim();
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(dataPart) as Record<string, unknown>;
          } catch {
            continue;
          }
          const type = data.type as string;
          switch (type) {
            case 'thinking':
              pushDesktopEvent({
                id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                kind: 'thinking',
                content: String(data.content || ''),
              });
              break;
            case 'tool_call': {
              const tc = data.toolCall as {
                id?: string;
                toolName?: string;
                parameters?: Record<string, unknown>;
              };
              pushDesktopEvent({
                id: tc?.id || `tc_${Date.now()}`,
                kind: 'tool_call',
                toolCallId: tc?.id,
                toolName: tc?.toolName,
                parameters: tc?.parameters,
                content: `调用 ${tc?.toolName || 'tool'}`,
              });
              break;
            }
            case 'tool_call_update': {
              const tc = data.toolCall as {
                id?: string;
                toolName?: string;
                result?: string;
              };
              pushDesktopEvent({
                id: `res_${tc?.id || Date.now()}`,
                kind: 'tool_result',
                toolCallId: tc?.id,
                toolName: tc?.toolName,
                result: tc?.result,
                content: tc?.result?.slice(0, 200),
              });
              break;
            }
            case 'execution_step': {
              const step = data.step as ExecutionStep;
              if (step?.id) {
                setExecSteps((prev) => {
                  const idx = prev.findIndex((s) => s.id === step.id);
                  if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = step;
                    return next;
                  }
                  return [...prev, step];
                });
              }
              break;
            }
            case 'pending_tool_confirm':
            case 'pending_tool_call': {
              const pending = (data.pending || data) as {
                toolCallId?: string;
                toolName?: string;
                parameters?: Record<string, unknown>;
                content?: string;
                confirmReason?: string;
                reasonLabel?: string;
                riskLabel?: string;
                whatChanges?: string;
                resumeToken?: string;
              };
              const token =
                pending.resumeToken ||
                (typeof data.resumeToken === 'string' ? data.resumeToken : '');
              if (token) {
                const card: PendingToolConfirm = {
                  toolCallId: pending.toolCallId || 'unknown',
                  toolName: pending.toolName || 'tool',
                  parameters: pending.parameters || {},
                  confirmReason: pending.confirmReason || 'dangerous_tool',
                  reasonLabel: pending.reasonLabel,
                  riskLabel: pending.riskLabel,
                  whatChanges: pending.whatChanges,
                  content: pending.content,
                  resumeToken: token,
                };
                setPendingHitl(card);
                setWaitingConfirm(true);
                setIsLoading(false);
              }
              const evt: DesktopEvent = {
                id: pending.toolCallId || `confirm_${Date.now()}`,
                kind: 'pending_tool_confirm',
                toolCallId: pending.toolCallId,
                toolName: pending.toolName,
                parameters: pending.parameters,
                content: pending.content || `确认工具 ${pending.toolName}`,
                confirmReason: pending.confirmReason,
                resumeToken: token || undefined,
                reasonLabel: pending.reasonLabel,
                riskLabel: pending.riskLabel,
                whatChanges: pending.whatChanges,
              };
              pushDesktopEvent(evt);
              break;
            }
            case 'waiting_confirm': {
              setWaitingConfirm(true);
              setIsLoading(false);
              break;
            }
            case 'final':
              finalText = String(data.content || '');
              safeUpdateMessage(assistantMessageId, {
                content: finalText,
                thinking: false,
              });
              break;
            case 'complete':
              completeStatus = String(data.status || 'done');
              if (completeStatus === 'waiting_confirm') {
                setWaitingConfirm(true);
                setIsLoading(false);
              }
              break;
            case 'error':
              throw new Error(String(data.message || 'Desktop agent error'));
            default:
              break;
          }
        }
      }

      if (!finalText && completeStatus !== 'waiting_confirm') {
        safeUpdateMessage(assistantMessageId, {
          thinking: false,
          content: finalText || '处理已结束。',
          status: 'complete',
        });
      } else if (completeStatus === 'waiting_confirm' && !finalText) {
        safeUpdateMessage(assistantMessageId, {
          thinking: false,
          content: '等待你的确认后继续…',
        });
      }

      return { status: completeStatus, finalText };
    },
    [pushDesktopEvent, safeUpdateMessage],
  );

  const runDesktopLoop = useCallback(
    async (
      userInput: string,
      assistantMessageId: string,
      opts?: { trustConfirmed?: boolean },
    ) => {
      setExecSteps([]);
      setPendingHitl(null);
      setWaitingConfirm(false);
      activeAssistantIdRef.current = assistantMessageId;

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      beginStreamGuard(assistantMessageId, { reuseIfSameAssistant: true });

      const activeConv = useChatStore.getState().getActiveConversation();
      const history = (activeConv?.messages || [])
        .filter((m) => m.id !== assistantMessageId)
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        }));

      const wantsLocal =
        opts?.trustConfirmed ||
        trustForNextDesktop ||
        settings.executionEnvironment === 'local' ||
        settings.executionMode === 'trust' ||
        settings.approvalPolicy === 'full_auto';
      const requestedExecutionMode = wantsLocal ? 'trust' : 'sandbox';
      const trustConfirmed =
        opts?.trustConfirmed === true ||
        trustForNextDesktop ||
        settings.approvalPolicy === 'full_auto';

      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run',
          userMessage: userInput,
          chatHistory: history,
          providerId: settings.providerId,
          chatId: activeConv?.id || 'home',
          requestedExecutionMode,
          trustConfirmed:
            requestedExecutionMode === 'trust' ? trustConfirmed : false,
          // Never conflate trust elevation with global dangerousConfirmed
          dangerousConfirmed: false,
          approvalPolicy: settings.approvalPolicy,
          executionEnvironment: settings.executionEnvironment,
          autonomyGrant: settings.autonomyGrant,
          sessionCategoryApprovals,
        }),
        signal: ac.signal,
      });

      if (!response.ok) {
        let errorMessage = `HTTP Error ${response.status}`;
        try {
          const errData = await response.json();
          if (errData?.error) errorMessage = errData.error;
        } catch {
          /* ignore */
        }
        throw new Error(errorMessage);
      }

      await consumeAgentSse(response, assistantMessageId);
    },
    [
      beginStreamGuard,
      consumeAgentSse,
      settings.executionMode,
      settings.executionEnvironment,
      settings.approvalPolicy,
      settings.autonomyGrant,
      settings.providerId,
      trustForNextDesktop,
      sessionCategoryApprovals,
    ],
  );

  /**
   * Resume single pending tool — POST action=resume with resumeToken.
   * Forbidden: re-running the entire user message as the only path.
   */
  const resumeFromHitl = useCallback(
    async (decision: HitlUiDecision) => {
      const pending = pendingHitl;
      if (!pending?.resumeToken) {
        showToast('没有可恢复的确认令牌');
        return;
      }

      if (decision.action === 'approve_category') {
        // Mirror server session category for subsequent runs in this browser session
        const tool = pending.toolName;
        const params = pending.parameters || {};
        let cat: AutonomyCat | null = null;
        if (tool === 'web_search') cat = 'web_search';
        else if (tool === 'code_executor' || tool === 'data_analyzer') cat = 'code_run';
        else if (tool === 'file_manager') {
          const action = params.action;
          if (action === 'write' || action === 'delete') cat = 'artifacts_write';
        }
        // package_install often comes from yellow code_executor — keep code_run
        if (pending.confirmReason === 'package_install') cat = 'package_install';
        if (cat) {
          setSessionCategoryApprovals((prev) =>
            prev.includes(cat) ? prev : [...prev, cat],
          );
        }
      }

      if (decision.action === 'approve_once' || decision.action === 'approve_category') {
        if (pending.confirmReason === 'trust_elevation') {
          setTrustForNextDesktop(true);
          confirmTrustElevation();
        }
      }

      // Fail-closed: never resume an invalidated token.
      if (invalidatedHitlTokensRef.current.has(pending.resumeToken)) {
        showToast('确认已失效，请重新发起操作');
        setPendingHitl(null);
        setWaitingConfirm(false);
        return;
      }

      setHitlBusy(true);
      setIsLoading(true);
      setWaitingConfirm(false);
      const token = pending.resumeToken;
      setPendingHitl(null);

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const assistantMessageId =
        activeAssistantIdRef.current || `msg_ast_${Date.now()}`;
      if (!activeAssistantIdRef.current) {
        activeAssistantIdRef.current = assistantMessageId;
        addMessage({
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          thinking: true,
        });
      } else {
        safeUpdateMessage(assistantMessageId, {
          thinking: true,
          content: '正在按你的决定继续…',
        });
      }
      beginStreamGuard(assistantMessageId, { reuseIfSameAssistant: true });

      try {
        const activeConv = useChatStore.getState().getActiveConversation();
        const response = await fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'resume',
            resumeToken: token,
            decision: {
              action: decision.action,
              answerText:
                decision.action === 'answer' ? decision.answerText : undefined,
            },
            providerId: settings.providerId,
            chatId: activeConv?.id || 'home',
            approvalPolicy: settings.approvalPolicy,
            executionEnvironment: settings.executionEnvironment,
            autonomyGrant: settings.autonomyGrant,
            sessionCategoryApprovals,
          }),
          signal: ac.signal,
        });

        if (!response.ok) {
          let errorMessage = `HTTP Error ${response.status}`;
          try {
            const errData = await response.json();
            if (errData?.error) errorMessage = errData.error;
          } catch {
            /* ignore */
          }
          throw new Error(errorMessage);
        }

        const { status } = await consumeAgentSse(response, assistantMessageId);
        if (status !== 'waiting_confirm') {
          setIsLoading(false);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          safeUpdateMessage(assistantMessageId, {
            thinking: false,
            content: '⏹️ 任务已取消',
            status: 'cancelled',
          });
          return;
        }
        showToast(err instanceof Error ? err.message : '恢复失败');
        safeUpdateMessage(assistantMessageId, {
          thinking: false,
          content: `⚠️ 恢复失败: ${err instanceof Error ? err.message : '未知错误'}`,
          status: 'error',
        });
        setIsLoading(false);
      } finally {
        setHitlBusy(false);
      }
    },
    [
      beginStreamGuard,
      pendingHitl,
      safeUpdateMessage,
      settings.providerId,
      settings.approvalPolicy,
      settings.executionEnvironment,
      settings.autonomyGrant,
      sessionCategoryApprovals,
      consumeAgentSse,
      addMessage,
      confirmTrustElevation,
    ],
  );

  const handleCancelTask = useCallback(async () => {
    invalidatePendingHitlAndAbort({ reason: 'user_cancel' });
    setIsLoading(false);
    const aid = activeAssistantIdRef.current;
    if (aid) {
      // Bypass stream guard — intentional user cancel on active assistant.
      updateMessage(aid, {
        thinking: false,
        content: '⏹️ 任务已取消',
        status: 'cancelled',
      });
    }
    pushDesktopEvent({
      id: `cancel_${Date.now()}`,
      kind: 'thinking',
      content: '用户取消任务',
    });
  }, [invalidatePendingHitlAndAbort, updateMessage, pushDesktopEvent]);

  const handleHitlDecision = useCallback(
    (decision: HitlUiDecision) => {
      if (decision.action === 'cancel') {
        void handleCancelTask();
        return;
      }
      void resumeFromHitl(decision);
    },
    [handleCancelTask, resumeFromHitl],
  );

  // UX07: chat surface only shows 需要确认 / 已授权 (tiers live in Settings).

  const handleQuickDowngrade = () => {
    setSafetyLevel('supervised');
    void fetch('/api/settings/safety', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save',
        approvalPolicy: 'supervised',
        executionEnvironment: 'sandbox',
        autonomyGrant: null,
      }),
    }).catch(() => {
      /* non-blocking */
    });
    setSafetyMenuOpen(false);
  };

  const handleQuickRevoke = () => {
    revokeAutonomy();
    void fetch('/api/settings/safety', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revoke' }),
    }).catch(() => {
      /* non-blocking */
    });
    setSafetyMenuOpen(false);
  };

  useEffect(() => {
    if (!desktopResume || !pendingDesktopMessage || isLoading || waitingConfirm) {
      return;
    }
    const { trustConfirmed } = desktopResume;
    const message = pendingDesktopMessage;
    clearDesktopResume();
    // Trust elevation only — never auto-set dangerousConfirmed for all tools
    // Defer state writes to satisfy react-hooks/set-state-in-effect.
    queueMicrotask(() => {
      setTrustForNextDesktop(trustConfirmed);
      setIsLoading(true);
      const assistantMessageId = `msg_ast_${Date.now()}`;
      addMessage({
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        thinking: true,
      });
      void (async () => {
        try {
          await runDesktopLoop(message, assistantMessageId, {
            trustConfirmed,
          });
        } catch (err) {
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            showToast(err instanceof Error ? err.message : 'Desktop 启动失败');
          }
        } finally {
          setIsLoading(false);
        }
      })();
    });
  }, [
    desktopResume,
    pendingDesktopMessage,
    isLoading,
    waitingConfirm,
    clearDesktopResume,
    addMessage,
    runDesktopLoop,
  ]);

  /** Batch-07: Chat→Calendar constraint collection (conversation-scoped, no schedule write). */
  const runCalendarPlanningBranch = async (input: {
    userInput: string;
    assistantMessageId: string;
    turnMeta: { turnId: string; conversationId: string | null };
    planning: ReturnType<typeof calendarPlanningFromSnapshot>;
    convId: string | null;
    experience: import('@/types/agent').ConversationExperienceSnapshot | null | undefined;
    answerKey?: PlanningConstraintKey;
  }): Promise<boolean> => {
    await loadLearning();
    const learningState = useLearningStore.getState();
    const requestedCourseId = input.experience?.courseId;
    const courseId =
      (requestedCourseId && learningState.data.courses.some((course) => course.id === requestedCourseId)
        ? requestedCourseId
        : null) ||
      learningState.selectedCourseId ||
      learningState.data.courses[0]?.id;
    if (!courseId) {
      safeUpdateMessage(input.assistantMessageId, {
        thinking: false,
        content: '请先在资料库创建课程，再安排学习日历。',
        status: 'error',
      });
      return true;
    }

    let step = advanceCalendarPlanning({
      planning: input.planning,
      userMessage: input.userInput,
      courseId,
      answerKey: input.answerKey,
    });

    // Persist every accepted constraint answer before proposal I/O so a failed
    // planner call never loses the final answer.
    setExperienceSnapshot(
      input.convId,
      snapshotFromCalendarPlanning(input.experience, step.planning),
    );

    if (step.kind === 'propose_ready') {
      try {
        const proposal = {
          ...(await proposePlan(
            courseId,
            undefined,
            constraintsToPlanHints(step.planning.constraints),
          )),
          sourceConversationId: input.convId ?? undefined,
        };
        step = calendarPlanningWithProposal(step.planning, proposal);
        setCalendarProposalPreview(proposal);
      } catch (err) {
        safeUpdateMessage(input.assistantMessageId, {
          thinking: false,
          content:
            err instanceof Error ? err.message : '暂时无法生成日历草案，请稍后再试。',
          status: 'error',
        });
        return true;
      }
      appNavigate(APP_PATHS.calendar);
      setActiveAppView('calendar', { fromRoute: true });
    }

    setExperienceSnapshot(
      input.convId,
      snapshotFromCalendarPlanning(input.experience, step.planning),
    );

    const gated = gateArtifactsCopy(step.artifacts);
    useLearnFlowStore.getState().applyOrchestratorResult(
      {
        route: 'learn_calibrate',
        artifacts: gated,
        streamChat: false,
        nextStage: 'idle',
        experiencePlan: {
          mode: 'calendar',
          requiredSteps: ['calendar_plan'],
          optionalSteps: [],
          skippedSteps: [],
          surface: 'chat',
          nextAction: 'calendar_propose',
          commitPolicy: 'propose_only',
          confidence: 0.8,
        },
      },
      { expectedConversationId: input.turnMeta.conversationId },
    );

    const turnArts = learnArtifactsToMessage(gated);
    setMessageTurnArtifacts(input.assistantMessageId, turnArts, 'complete');
    safeUpdateMessage(input.assistantMessageId, {
      thinking: false,
      content: step.assistantText,
      status: 'complete',
      turnId: input.turnMeta.turnId,
    });
    return true;
  };

  const calendarPlanningHandlerRef = useRef<
    ((answer: string, key?: PlanningConstraintKey) => Promise<void>) | null
  >(null);

  useEffect(() => {
    calendarPlanningHandlerRef.current = async (answer, key) => {
      const conv = useChatStore.getState().getActiveConversation();
      const assistantMessageId = [...(conv?.messages ?? [])]
        .reverse()
        .find((m) => m.role === 'assistant' && (m.thinking || m.status === 'pending'))
        ?.id;
      if (!assistantMessageId) return;
      const turnMeta = {
        turnId: conv?.currentTurnId ?? `turn_${Date.now()}`,
        conversationId: conv?.id ?? null,
      };
      await runCalendarPlanningBranch({
        userInput: answer,
        assistantMessageId,
        turnMeta,
        planning: calendarPlanningFromSnapshot(conv?.experience),
        convId: conv?.id ?? null,
        experience: conv?.experience,
        answerKey: key,
      });
    };
  });

  useEffect(() => {
    registerCalendarPlanningHandler(async (answer, key) => {
      await calendarPlanningHandlerRef.current?.(answer, key);
    });
    return () => registerCalendarPlanningHandler(null);
  }, []);

  /**
   * Core turn runner — form submit and chip "发送" both call this.
   * Chip edit mode only fills the composer (applySuggestionEdit).
   * Edit path: invalidate HITL → truncate subsequent turns → regenerate.
   */
  const runUserTurn = async (
    raw: string,
    opts?: { skipLoadingGuard?: boolean; forceRegenerate?: boolean },
  ) => {
    if (!raw.trim()) return;
    if (isLoading && !opts?.skipLoadingGuard) return;

    const userInput = raw.trim();
    const editedMessageId = editingMessageId;
    setInput('');
    setChipEditMode(false);
    setEditingMessageId(null);
    setIsLoading(true);
    lastFailedInputRef.current = null;

    // Always cancel pending HITL before a new / edited turn (single surface).
    invalidatePendingHitlAndAbort({ reason: 'new_turn' });

    const userMessageId = nextClientMessageId('msg_usr');
    const assistantMessageId = nextClientMessageId('msg_ast');

    try {
      // Freeze previous interactive turn artifacts onto its message before leaving.
      const priorConv = useChatStore.getState().getActiveConversation();
      if (priorConv && !editedMessageId) {
        const priorInteractive = resolveInteractiveAssistantId(
          priorConv.messages,
          priorConv.currentTurnId,
        );
        if (priorInteractive) {
          const freeze = learnArtifactsToMessage(
            useLearnFlowStore.getState().artifacts,
          );
          if (freeze.length > 0) {
            setMessageTurnArtifacts(priorInteractive, freeze, 'complete');
          }
        }
      }

      if (editedMessageId) {
        const editResult = editUserMessage(editedMessageId, userInput);
        if (!editResult.ok) {
          throw new Error('这条消息已无法编辑，请重新发送。');
        }
        if (editResult.sideEffectNotice) {
          showToast(editResult.sideEffectNotice, 'info');
        }
      } else {
        const userMessage: Message = {
          id: userMessageId,
          role: 'user',
          content: userInput,
          timestamp: new Date(),
          status: 'complete',
        };
        addMessage(userMessage);
      }

      const turnMeta = beginStreamGuard(assistantMessageId);
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        thinking: true,
        turnId: turnMeta.turnId,
        status: 'pending',
        artifacts: [],
      };
      addMessage(assistantMessage);
      activeAssistantIdRef.current = assistantMessageId;

      const activeConv = useChatStore.getState().getActiveConversation();
      const planningState = calendarPlanningFromSnapshot(activeConv?.experience);
      const currentMessages = activeConv?.messages || [];
      const payloadMessages = currentMessages
        .filter((m) => m.id !== assistantMessageId)
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      if (planningState.active) {
        const handled = await runCalendarPlanningBranch({
          userInput,
          assistantMessageId,
          turnMeta,
          planning: planningState,
          convId: activeConv?.id ?? null,
          experience: activeConv?.experience,
        });
        if (handled) return;
      }

      const orch = await considerUserMessage(
        userInput,
        settings.providerId,
        payloadMessages,
        settings.executionMode,
        {
          userModePreference:
            userModePreference === 'deep' ? 'deep' : userModePreference === 'normal' ? 'normal' : null,
          surface: 'chat',
        },
      );

      // Stale after orchestrator? (user switched mid-flight)
      if (
        isStaleStreamWrite({
          expectedConversationId: turnMeta.conversationId,
          activeConversationId: useChatStore.getState().activeConversationId,
          expectedTurnId: turnMeta.turnId,
          currentTurnId:
            useChatStore.getState().getActiveConversation()?.currentTurnId ??
            null,
          expectedGeneration: turnMeta.generation,
          currentGeneration: streamGenerationRef.current,
          assistantMessageId,
          messages: useChatStore.getState().getActiveConversation()?.messages,
        })
      ) {
        return;
      }

      if (
        shouldStartCalendarPlanning({
          experienceMode: orch.experiencePlan?.mode ?? learnExperienceMode,
          message: userInput,
          planning: planningState,
        })
      ) {
        const handled = await runCalendarPlanningBranch({
          userInput,
          assistantMessageId,
          turnMeta,
          planning: {
            active: true,
            constraints: planningState.constraints,
            pendingKey: planningState.pendingKey,
            proposalPreviewId: null,
          },
          convId: activeConv?.id ?? null,
          experience: activeConv?.experience,
        });
        if (handled) return;
      }

      // Bind artifacts to this assistant Turn only (not a global footer).
      const turnArts = learnArtifactsToMessage(
        gateArtifactsCopy(orch.artifacts ?? []),
      );
      setMessageTurnArtifacts(
        assistantMessageId,
        turnArts,
        orch.streamChat || orch.runDesktop ? 'streaming' : 'complete',
      );
      updateMessage(assistantMessageId, { turnId: turnMeta.turnId });

      // Regenerate defaults: no tool replay. Desktop tools still require policy/HITL.
      void opts?.forceRegenerate;
      void regenerateAssistantPolicy();

      if (orch.runDesktop) {
        await runDesktopLoop(userInput, assistantMessageId);
        return;
      }

      if (orch.route === 'desktop' && !orch.runDesktop) {
        safeUpdateMessage(assistantMessageId, {
          thinking: false,
          content: '需要你确认后才会使用本机更高权限；默认在安全环境中运行。',
          status: 'complete',
        });
        return;
      }

      if (
        orch.route.startsWith('learn_') ||
        orch.artifacts.some((a) => a.kind === 'confirm_gate')
      ) {
        // Prefer natural plain_assistant (no fence dual-write). Outline is card-only.
        const fallbackPlain = orch.artifacts.find(
          (a) => a.kind === 'plain_assistant',
        )?.content;
        safeUpdateMessage(assistantMessageId, {
          thinking: false,
          content:
            fallbackPlain ||
            '已生成学习编排卡片，请在消息内确认或继续。',
          status: 'complete',
        });
        return;
      }

      if (!orch.streamChat && orch.artifacts.some((a) => a.kind === 'plain_assistant')) {
        const plain = orch.artifacts.find((a) => a.kind === 'plain_assistant')?.content;
        safeUpdateMessage(assistantMessageId, {
          thinking: false,
          content: plain || '请按当前学习卡片继续操作。',
          status: 'complete',
        });
        return;
      }

      await streamChat(assistantMessageId, payloadMessages);
      const after = useChatStore.getState().getActiveConversation();
      maybeExtractMemory(
        (after?.messages || []).map((m) => ({ role: m.role, content: m.content })),
      );
    } catch (err: unknown) {
      console.error('Home chat error:', err);
      lastFailedInputRef.current = userInput;
      const toastMsg = friendlyErrorToast(err);
      showToast(toastMsg, 'error', () => {
        const retry = lastFailedInputRef.current;
        if (retry) void runUserTurn(retry);
      });

      const activeConv = useChatStore.getState().getActiveConversation();
      if (activeConv) {
        const assistantMsg = activeConv.messages.find(
          (message) => message.id === assistantMessageId,
        );
        if (assistantMsg) {
          const hadPartial = Boolean(assistantMsg.content?.trim());
          // UX03: never append raw [连接中断:…] into message body
          safeUpdateMessage(assistantMessageId, {
            thinking: false,
            content: hadPartial
              ? `${assistantMsg.content}\n\n${friendlyErrorMessageBody(err, { hadPartialContent: true })}`
              : friendlyErrorMessageBody(err),
            status: 'error',
          });
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyAssistant = useCallback(async (messageId: string, content: string) => {
    const policy = copyAssistantContentPolicy();
    if (!policy.allowed) return;
    try {
      await navigator.clipboard.writeText(content || '');
      setCopiedMessageId(messageId);
      window.setTimeout(() => {
        setCopiedMessageId((cur) => (cur === messageId ? null : cur));
      }, 1500);
    } catch {
      showToast('复制失败，请手动选择文本', 'error');
    }
  }, []);

  /**
   * Assistant regenerate: truncate from this assistant, re-run preceding user text.
   * No direct content edit; tools re-enter policy/HITL (no tool result replay).
   */
  const handleRegenerateAssistant = useCallback(
    async (assistantMessageId: string) => {
      if (isLoading) return;
      const policy = regenerateAssistantPolicy();
      if (!policy.allowed || policy.replayTools) {
        // Hard guard: never regenerate with silent tool replay.
        if (policy.replayTools) {
          showToast('重新生成不会重放工具结果，请确认后继续', 'info');
        }
        return;
      }
      invalidatePendingHitlAndAbort({ reason: 'regenerate' });
      const prepared = prepareAssistantRegenerate(assistantMessageId);
      if (!prepared.ok || !prepared.userContent) {
        showToast('无法重新生成这条回答', 'error');
        return;
      }
      if (prepared.sideEffectNotice) {
        showToast(prepared.sideEffectNotice, 'info');
      }
      await runUserTurn(prepared.userContent, {
        skipLoadingGuard: true,
        forceRegenerate: true,
      });
    },
    // runUserTurn is stable enough for this batch (defined in component body).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLoading, invalidatePendingHitlAndAbort, prepareAssistantRegenerate],
  );

  const handleSuggestionClick = (s: HomeSuggestion, mode: HomeSuggestionClickMode) => {
    if (mode === 'edit') {
      applySuggestionEdit(s);
      return;
    }
    void runUserTurn(s.prompt);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void runUserTurn(input);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runUserTurn(input);
  };

  const formatMessageContent = (content: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      if (part.startsWith('```')) {
        const match = part.match(/```(\w*)\n([\s\S]*?)```/);
        const language = match ? match[1] : '';
        const code = match ? match[2] : part.slice(3, -3);
        return (
          <div
            key={index}
            className="my-4 border border-[var(--border)] bg-[var(--code-bg)] text-[var(--code-text)] font-tech text-xs overflow-hidden"
          >
            {language && (
              <div className="bg-[var(--code-header-bg)] px-4 py-1.5 border-b border-[var(--border-20)] text-[var(--text-muted)] flex justify-between items-center select-none font-bold uppercase tracking-wider">
                <span>{language}</span>
              </div>
            )}
            <pre className="p-4 overflow-x-auto whitespace-pre-wrap break-all">
              <code>{code}</code>
            </pre>
          </div>
        );
      }

      const lines = part.split('\n');
      return (
        <div key={index} className="space-y-1.5">
          {lines.map((line, lineIndex) => {
            const boldParts = line.split(/(\*\*.*?\*\*)/g);
            const renderedLine = boldParts.map((bp, bpIdx) => {
              if (bp.startsWith('**') && bp.endsWith('**')) {
                return (
                  <strong key={bpIdx} className="font-bold text-[var(--text-primary)]">
                    {bp.slice(2, -2)}
                  </strong>
                );
              }
              return bp;
            });

            if (line.trim().startsWith('- ')) {
              return (
                <ul key={lineIndex} className="list-disc pl-5 my-1 text-[var(--text-secondary)]">
                  <li className="pl-1">{line.trim().substring(2)}</li>
                </ul>
              );
            }
            if (line.trim().startsWith('* ')) {
              return (
                <ul key={lineIndex} className="list-disc pl-5 my-1 text-[var(--text-secondary)]">
                  <li className="pl-1">{line.trim().substring(2)}</li>
                </ul>
              );
            }
            const numMatch = line.trim().match(/^(\d+)\.\s(.*)/);
            if (numMatch) {
              return (
                <ol key={lineIndex} className="list-decimal pl-5 my-1 text-[var(--text-secondary)]">
                  <li className="pl-1">{numMatch[2]}</li>
                </ol>
              );
            }

            if (line.trim() === '') {
              return <div key={lineIndex} className="h-2" />;
            }

            return (
              <p
                key={lineIndex}
                className="leading-relaxed text-[var(--text-secondary)] font-zh text-sm font-medium"
              >
                {renderedLine}
              </p>
            );
          })}
        </div>
      );
    });
  };

  const renderAssistantContent = (
    content: string,
    contentBlocks?: Array<{
      kind: 'summary' | 'key' | 'tip' | 'definition' | 'section' | 'prose';
      title?: string;
      body: string;
    }>,
  ) => (
    <AssistantRichContent
      content={content}
      contentBlocks={contentBlocks}
      fallback={formatMessageContent}
    />
  );

  // UX08: Home LearnProgressRail quarantined — no second visible progress chrome.
  // Deep Course progress is the left Unit tree on `/course/[id]` only.

  return (
    <div className="flex-1 flex min-h-0 bg-[var(--bg-secondary)] relative">
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 shadow-lg animate-fade-in font-zh text-sm font-bold max-w-[min(92vw,420px)] ${
            toast.type === 'info' || toast.type === 'success'
              ? 'bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)]'
              : 'bg-[var(--error-bg)] border border-[var(--error-border)] text-[var(--error)]'
          }`}
          role="status"
          data-testid={
            toast.type === 'info' || toast.type === 'success'
              ? 'home-info-toast'
              : 'home-error-toast'
          }
        >
          <span aria-hidden>
            {toast.type === 'info' || toast.type === 'success' ? 'ℹ️' : '⚠️'}
          </span>
          <span className="flex-1 text-left font-medium">{toast.message}</span>
          {toast.onRetry && (
            <button
              type="button"
              onClick={() => {
                const fn = toast.onRetry;
                setToast(null);
                fn?.();
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 border border-[var(--error-border)] font-zh text-xs hover:opacity-90"
              data-testid="home-error-retry"
            >
              <RotateCcw className="w-3 h-3" aria-hidden />
              重试
            </button>
          )}
          <button onClick={() => setToast(null)} className="ml-1 hover:opacity-85 text-lg cursor-pointer" aria-label="关闭">
            &times;
          </button>
        </div>
      )}

      <div
        ref={messagesScrollRef}
        onScroll={handleMessagesScroll}
        className="flex-1 overflow-y-auto min-h-0 flex flex-col"
      >
        {messages.length === 0 ? (
          <div
            className="flex-1 flex flex-col items-center justify-end px-6 pt-8 pb-5 max-w-3xl mx-auto w-full select-none text-center animate-fade-in relative overflow-hidden"
            data-testid="home-empty"
          >
            <div className="relative z-10 flex flex-col items-center w-full">
              <MinusLogo
                variant="hero"
                size={88}
                className="mb-5"
                label="Minus"
                data-testid="home-logo"
              />
              <h1
                className="font-zh text-2xl md:text-3xl font-bold tracking-wide text-[var(--text-primary)] mb-3"
                data-testid="home-greeting"
              >
                今天想了解什么？
              </h1>
              <p className="font-zh text-xs text-[var(--text-muted)] mb-4 max-w-md">
                {neutralOnly
                  ? '随便问一个问题，或点下面试试。'
                  : '可以继续上次的学习，或开始新的问题。'}
              </p>

              {(homeLearningSnapshot.items.length > 0 ||
                homeLearningSnapshot.pendingCount > 0) && (
                <section
                  className="surface-card mb-4 w-full max-w-xl p-3 text-left"
                  aria-label="今日学习"
                  data-testid="home-learning-snapshot"
                >
                  <div className="mb-2 flex items-center justify-between gap-3 px-1">
                    <div className="flex items-center gap-2">
                      <Clock3 className="h-4 w-4 text-[var(--accent)]" aria-hidden />
                      <h2 className="font-zh text-sm font-bold text-[var(--text-primary)]">
                        今日学习
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveAppView('calendar')}
                      className="min-h-[32px] rounded-lg px-2 font-zh text-xs text-[var(--accent)] hover:bg-[var(--accent-soft)]"
                    >
                      查看日历
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {homeLearningSnapshot.items.map(({ task, courseTitle, reason }) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => void handleOpenLearningTask(task.id)}
                        className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-zh text-sm font-bold text-[var(--text-primary)]">
                            {task.title}
                          </span>
                          <span className="mt-0.5 block truncate font-zh text-[11px] text-[var(--text-muted)]">
                            {courseTitle} · {reason}
                          </span>
                        </span>
                        <span className="shrink-0 font-zh text-xs font-bold text-[var(--accent)]">
                          继续
                        </span>
                      </button>
                    ))}
                    {homeLearningSnapshot.pendingCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveAppView('calendar')}
                        className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl bg-amber-50 px-3 py-2"
                      >
                        <span className="font-zh text-xs text-amber-900">
                          有 {homeLearningSnapshot.pendingCount} 项学习建议等待你确认
                        </span>
                        <span className="shrink-0 font-zh text-xs font-bold text-amber-800">
                          去处理
                        </span>
                      </button>
                    )}
                  </div>
                </section>
              )}

              <div className="flex flex-wrap justify-center gap-2 w-full max-w-xl">
                {homeSuggestions.map((s) => {
                  const SuggestionIcon = suggestionIcon(s.source);
                  const primaryMode = s.defaultMode;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={isLoading}
                      onClick={() => handleSuggestionClick(s, primaryMode)}
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-[var(--border-20)] bg-[var(--surface)] px-3.5 py-2 shadow-sm hover:border-[var(--accent)] hover:-translate-y-0.5 transition-all font-zh text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                      aria-label={
                        primaryMode === 'send'
                          ? `发送：${s.title}`
                          : `编辑后发送：${s.title}`
                      }
                      data-testid={`home-chip-${s.source}`}
                    >
                      <SuggestionIcon className="w-3.5 h-3.5 shrink-0 opacity-70" aria-hidden />
                      <span className="font-medium leading-snug">{s.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-3 space-y-2">
            {(homeLearningSnapshot.items.length > 0 ||
              homeLearningSnapshot.pendingCount > 0) && (
              <div
                className="surface-card mb-3 flex flex-wrap items-center justify-between gap-3 px-3.5 py-3"
                data-testid="home-learning-snapshot-compact"
              >
                <div className="min-w-0">
                  <p className="font-zh text-[11px] font-bold text-[var(--accent)]">
                    今日学习
                  </p>
                  <p className="truncate font-zh text-sm font-bold text-[var(--text-primary)]">
                    {homeLearningSnapshot.items[0]?.task.title ||
                      `${homeLearningSnapshot.pendingCount} 项建议待确认`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {homeLearningSnapshot.items[0] && (
                    <button
                      type="button"
                      onClick={() =>
                        void handleOpenLearningTask(
                          homeLearningSnapshot.items[0]!.task.id,
                        )
                      }
                      className="min-h-[36px] rounded-lg bg-[var(--user-bubble-bg)] px-3 font-zh text-xs font-bold text-[var(--user-bubble-text)]"
                    >
                      继续
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveAppView('calendar')}
                    className="min-h-[36px] rounded-lg px-3 font-zh text-xs text-[var(--accent)] hover:bg-[var(--accent-soft)]"
                  >
                    查看全部
                  </button>
                </div>
              </div>
            )}
            {messages.map((msg) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="flex justify-end w-full py-3">
                    <div className="max-w-[85%] flex flex-col items-end gap-1">
                      <div className="bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] px-4 py-3 rounded-2xl shadow-sm font-zh text-sm select-text whitespace-pre-wrap leading-relaxed font-medium">
                        {msg.content}
                      </div>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-zh text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-40"
                        disabled={isLoading || waitingConfirm}
                        onClick={() => {
                          // Prefill only — HITL cancel happens on actual re-send.
                          setEditingMessageId(msg.id);
                          setInput(msg.content);
                          setChipEditMode(true);
                          requestAnimationFrame(() => textareaRef.current?.focus());
                        }}
                        data-testid={`edit-message-${msg.id}`}
                      >
                        <Pencil className="w-3 h-3" aria-hidden />
                        编辑并重新生成
                      </button>
                    </div>
                  </div>
                );
              }

              if (msg.role === 'tool') {
                return null;
              }

              const interactiveAssistantId = resolveInteractiveAssistantId(
                messages,
                activeConversation?.currentTurnId,
              );
              const isInteractiveTurn = msg.id === interactiveAssistantId;
              const snapshotArts = messageArtifactsToLearn(msg.artifacts);
              const showTurnCards =
                isInteractiveTurn ||
                (Array.isArray(msg.artifacts) && msg.artifacts.length > 0);

              return (
                <div
                  key={msg.id}
                  className="flex gap-3 w-full py-3"
                  data-testid={`assistant-turn-${msg.id}`}
                  data-turn-id={msg.turnId || undefined}
                >
                  <div className="w-9 h-9 rounded-md bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent)] shrink-0 select-none">
                    <MinusMark size={18} className="text-[var(--accent)]" />
                  </div>
                  <div className="flex-1 min-w-0 select-text surface-card px-4 py-3.5 sm:px-5 sm:py-4">
                    <div className="flex items-center justify-end mb-1 gap-2 min-h-[20px]">
                      <span className="sr-only">Minus 回答</span>
                      {!msg.thinking && msg.content?.trim() && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-zh text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                            onClick={() => void handleCopyAssistant(msg.id, msg.content)}
                            data-testid={`copy-assistant-${msg.id}`}
                            aria-label="复制回答"
                          >
                            {copiedMessageId === msg.id ? (
                              <Check className="w-3 h-3" aria-hidden />
                            ) : (
                              <Copy className="w-3 h-3" aria-hidden />
                            )}
                            {copiedMessageId === msg.id ? '已复制' : '复制'}
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-zh text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-40"
                            disabled={isLoading || waitingConfirm}
                            onClick={() => void handleRegenerateAssistant(msg.id)}
                            data-testid={`regenerate-assistant-${msg.id}`}
                            aria-label="重新生成回答"
                            title="重新生成不会重放工具结果；涉及工具时会再次请你确认"
                          >
                            <RotateCcw className="w-3 h-3" aria-hidden />
                            重新生成
                          </button>
                        </div>
                      )}
                    </div>
                    {msg.thinking ? (
                      <div
                        className="flex items-center gap-2 text-[var(--text-muted)] text-sm py-2"
                        data-testid={`turn-loading-${msg.id}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-ping" />
                        <span className="font-zh animate-thinking-glow font-medium text-xs">正在整理回答…</span>
                      </div>
                    ) : (
                      <div className="prose prose-sm max-w-none text-[var(--text-secondary)]">
                        {renderAssistantContent(msg.content, msg.contentBlocks)}
                        {/* Batch-03: upgrade only from chat/normal — hidden in deep_planning/deep_course */}
                        {modeUi.showUpgradeCta &&
                          canUpgradeToDeep(experienceMode) &&
                          !msg.thinking &&
                          msg.content.trim().length > 40 &&
                          isInteractiveTurn && (
                            <div className="mt-3 pt-2 border-t border-[var(--border-20)]">
                              <button
                                type="button"
                                className="font-zh text-xs text-[var(--accent)] hover:underline"
                                data-testid="upgrade-to-deep"
                                onClick={() => {
                                  setUserModePreference('deep');
                                  void runUserTurn(
                                    `我想系统深入学习刚才的主题，请帮我规划学习大纲。`,
                                  );
                                }}
                              >
                                想系统学？开始深入学习
                              </button>
                            </div>
                          )}
                      </div>
                    )}
                    {/* Batch-04: Turn-scoped LearnFlowCards (not global footer). */}
                    {showTurnCards && (
                      <LearnFlowCards
                        turnId={msg.turnId}
                        interactive={isInteractiveTurn}
                        showLiveStatus={isInteractiveTurn}
                        suppressTrustUi={Boolean(pendingHitl)}
                        artifactsOverride={
                          isInteractiveTurn ? null : snapshotArts
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}

        {hasUnreadContent && (
          <div className="sticky bottom-3 z-20 flex justify-center pointer-events-none">
            <button
              type="button"
              onClick={() => scrollToBottom()}
              className="pointer-events-auto min-h-[40px] rounded-full border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-2 font-zh text-xs font-bold text-[var(--text-primary)] shadow-lg hover:border-[var(--accent)]"
              data-testid="home-view-new-content"
            >
              查看新内容
            </button>
          </div>
        )}

        <DesktopToolTimeline
          events={desktopEvents}
          steps={execSteps}
          pendingConfirm={pendingHitl}
          hitlBusy={hitlBusy}
          onHitlDecision={handleHitlDecision}
          onCancelTask={
            isLoading || waitingConfirm || pendingHitl
              ? () => void handleCancelTask()
              : undefined
          }
        />
      </div>

      <div className="bg-gradient-to-t from-[var(--bg-secondary)] via-[var(--bg-secondary)] to-transparent px-3 pb-4 pt-2 sm:px-5 sticky bottom-0 z-30">
        <div className="max-w-3xl mx-auto w-full relative">
          <form
            onSubmit={handleSubmit}
            className="composer-shell flex flex-col focus-within:border-[var(--accent)] focus-within:ring-4 focus-within:ring-[var(--accent)]/10 transition-all duration-200 p-3"
            data-testid="home-main-input"
          >
            {providerReady === false && (
              <div className="mx-1 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2.5">
                <span className="font-zh text-xs text-amber-900">
                  模型尚未就绪，配置后才能发送回答。
                </span>
                <button
                  type="button"
                  onClick={() => openSettings('model')}
                  className="min-h-[32px] rounded-lg px-2.5 font-zh text-xs font-bold text-amber-900 hover:bg-amber-100"
                >
                  打开模型设置
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
              <div className="flex flex-wrap items-center gap-2">
                {modeUi.showToggle && (
                  <div
                    className="inline-flex rounded-xl bg-[var(--surface-soft)] p-1"
                    role="group"
                    aria-label="回答模式"
                    data-testid="home-mode-toggle"
                  >
                    <button
                      type="button"
                      onClick={() => setUserModePreference('normal')}
                      className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-3 font-zh text-xs transition-all ${
                        userModePreference === 'normal'
                          ? 'bg-[var(--surface-elevated)] text-[var(--text-primary)] font-bold shadow-sm'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                      aria-pressed={userModePreference === 'normal'}
                      data-testid="mode-normal"
                    >
                      <MessageCircle className="w-3.5 h-3.5" aria-hidden />
                      普通
                    </button>
                    <button
                      type="button"
                      onClick={() => setUserModePreference('deep')}
                      className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-3 font-zh text-xs transition-all ${
                        userModePreference === 'deep'
                          ? 'bg-[var(--surface-elevated)] text-[var(--text-primary)] font-bold shadow-sm'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                      aria-pressed={userModePreference === 'deep'}
                      data-testid="mode-deep"
                    >
                      <BookOpen className="w-3.5 h-3.5" aria-hidden />
                      {modeUi.deepToggleLabel}
                    </button>
                  </div>
                )}
                {modeUi.showDeepStatus && (
                  <div
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-3 font-zh text-xs font-bold text-[var(--accent-strong)]"
                    data-testid="home-deep-status"
                    role="status"
                  >
                    <BookOpen className="w-3.5 h-3.5" aria-hidden />
                    {modeUi.deepStatusLabel}
                  </div>
                )}

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setToolsMenuOpen((open) => !open)}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 font-zh text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]"
                    aria-expanded={toolsMenuOpen}
                    data-testid="home-tools-menu"
                  >
                    <Wrench className="w-3.5 h-3.5" aria-hidden />
                    工具
                    <ChevronDown className="w-3.5 h-3.5" aria-hidden />
                  </button>
                  {toolsMenuOpen && (
                    <div className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-2xl border border-[var(--border-20)] bg-[var(--surface-elevated)] p-2 shadow-[var(--shadow-md)]">
                      <button
                        type="button"
                        onClick={() => {
                          setUserModePreference('deep');
                          setInput('请帮我围绕这个主题制定一份可执行的深入学习计划：');
                          setChipEditMode(true);
                          setToolsMenuOpen(false);
                          requestAnimationFrame(() => textareaRef.current?.focus());
                        }}
                        className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--surface-soft)]"
                      >
                        <CalendarPlus className="mt-0.5 h-4 w-4 text-[var(--accent)]" aria-hidden />
                        <span>
                          <span className="block font-zh text-xs font-bold text-[var(--text-primary)]">学习计划</span>
                          <span className="mt-0.5 block font-zh text-[11px] text-[var(--text-muted)]">澄清目标后生成可确认的课程与日程</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setUserModePreference('normal');
                          setInput('请在本机工作区中帮我完成：');
                          setChipEditMode(true);
                          setToolsMenuOpen(false);
                          requestAnimationFrame(() => textareaRef.current?.focus());
                        }}
                        className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--surface-soft)]"
                      >
                        <Wrench className="mt-0.5 h-4 w-4 text-[var(--accent)]" aria-hidden />
                        <span>
                          <span className="block font-zh text-xs font-bold text-[var(--text-primary)]">本机任务</span>
                          <span className="mt-0.5 block font-zh text-[11px] text-[var(--text-muted)]">执行前展示步骤，危险操作仍需确认</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          setActiveAppView('library');
                        }}
                        className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--surface-soft)]"
                      >
                        <FolderOpen className="mt-0.5 h-4 w-4 text-[var(--accent)]" aria-hidden />
                        <span>
                          <span className="block font-zh text-xs font-bold text-[var(--text-primary)]">资料问答</span>
                          <span className="mt-0.5 block font-zh text-[11px] text-[var(--text-muted)]">从本地资料开始提问或深入学习</span>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <span className="hidden sm:inline font-zh text-[11px] text-[var(--text-muted)]">
                Enter 发送 · Shift+Enter 换行
              </span>
            </div>
            {chipEditMode && input.trim() && (
              <p className="mx-1 mb-1 rounded-lg bg-amber-50 px-2.5 py-1.5 font-zh text-[11px] text-amber-700 flex items-center gap-1.5">
                <Pencil className="w-3 h-3" aria-hidden />
                {editingMessageId
                  ? '正在编辑历史消息；发送后将截断其后内容并重新生成（已提交的课程/日程不会自动撤销）。'
                  : '已填入建议，修改后发送。'}
              </p>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (chipEditMode && !e.target.value.trim()) setChipEditMode(false);
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                experienceMode === 'deep_planning' || userModePreference === 'deep'
                  ? '描述你想系统学习的主题…'
                  : '今天想了解什么？直接提问即可'
              }
              className="w-full bg-transparent border-0 outline-none text-[var(--text-primary)] font-zh text-[15px] placeholder:text-[var(--text-muted-40)] resize-none min-h-[56px] max-h-[180px] px-2 py-2.5 leading-relaxed font-medium"
              rows={1}
              disabled={isLoading}
              aria-label="主输入框"
            />
            <div className="flex items-center justify-between border-t border-[var(--border-20)] pt-2.5 px-1">
              <div className="flex items-center gap-2 select-none relative">
                <button
                  type="button"
                  onClick={() => setSafetyMenuOpen((o) => !o)}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 font-zh text-[11px] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                    waitingConfirm || pendingHitl
                      ? 'text-amber-700 bg-amber-500/10 font-bold'
                      : settings.approvalPolicy === 'full_auto' ||
                          settings.approvalPolicy === 'bounded_auto'
                        ? 'text-sky-700 bg-sky-500/10 font-bold'
                        : 'text-[var(--text-muted)] hover:bg-[var(--surface-soft)]'
                  }`}
                  title="安全状态 — 点击打开设置或降级"
                  aria-label={
                    waitingConfirm || pendingHitl
                      ? '需要确认'
                      : settings.approvalPolicy === 'full_auto' ||
                          settings.approvalPolicy === 'bounded_auto'
                        ? '已授权'
                        : '需要确认'
                  }
                  data-testid="chat-safety-surface"
                >
                  {(waitingConfirm || pendingHitl) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 motion-safe:animate-pulse" />
                  )}
                  {!waitingConfirm &&
                    !pendingHitl &&
                    (settings.approvalPolicy === 'bounded_auto' ||
                      settings.approvalPolicy === 'full_auto') && (
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                    )}
                  <span>
                    {waitingConfirm || pendingHitl
                      ? '需要确认'
                      : settings.approvalPolicy === 'full_auto' ||
                          settings.approvalPolicy === 'bounded_auto'
                        ? '已授权'
                        : '需要确认'}
                  </span>
                </button>
                {safetyMenuOpen && (
                  <div className="absolute bottom-full left-0 mb-1 z-50 min-w-[160px] border border-[var(--border)] bg-[var(--bg-primary)] shadow-lg py-1">
                    <button
                      type="button"
                      className="w-full text-left px-3 py-1.5 text-xs font-zh text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                      onClick={() => {
                        openSettings('safety');
                        setSafetyMenuOpen(false);
                      }}
                    >
                      打开执行与安全…
                    </button>
                    {settings.approvalPolicy !== 'supervised' &&
                      settings.approvalPolicy !== 'chat_only' && (
                        <button
                          type="button"
                          className="w-full text-left px-3 py-1.5 text-xs font-zh text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                          onClick={handleQuickDowngrade}
                        >
                          降级为监督模式
                        </button>
                      )}
                    {(settings.approvalPolicy === 'bounded_auto' ||
                      settings.approvalPolicy === 'full_auto') && (
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-xs font-zh text-[var(--error)] hover:bg-[var(--error)]/10"
                        onClick={handleQuickRevoke}
                      >
                        立即撤销授权
                      </button>
                    )}
                  </div>
                )}
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={clearMessages}
                  className="icon-button !min-h-[36px] !min-w-[36px] text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--error-bg)] transition-colors cursor-pointer"
                    title="清空当前对话"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {(isLoading || waitingConfirm) && (
                  <button
                    type="button"
                    onClick={() => void handleCancelTask()}
                    className="min-h-[36px] rounded-lg px-3 font-zh text-xs text-[var(--text-muted)] hover:bg-[var(--error-bg)] hover:text-[var(--error)]"
                    title="取消当前 Desktop 任务"
                  >
                    取消
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading || waitingConfirm}
                  className={`flex items-center justify-center w-11 h-11 rounded-xl transition-all ${
                    input.trim() && !isLoading && !waitingConfirm
                      ? 'bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] shadow-sm hover:opacity-90 hover:-translate-y-0.5 cursor-pointer'
                      : 'bg-[var(--surface-soft)] text-[var(--text-muted)] cursor-not-allowed'
                  }`}
                  title="发送 (Enter)"
                >
                  <Send
                    size={18}
                    className={isLoading ? 'animate-pulse' : ''}
                  />
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
      </div>
    </div>
  );
}

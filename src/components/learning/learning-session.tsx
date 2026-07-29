'use client';

/**
 * UX04 — Deep Course page (`/course/[id]`).
 * Layout: global nav (AppShell) + ~250px left Unit tree + flexible main + bottom follow-up.
 * No Home LearnProgressRail; no pass/partial/fail primary labels.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Brain,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Pause,
  RotateCcw,
} from 'lucide-react';
import PixelIcon from '@/components/icons/PixelIcon';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { AssistantRichContent } from '@/components/chat/learn-content-blocks';
import { iconSizes } from '@/lib/icons';
import { useLearningStore } from '@/store/learning-store';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';
import type { InteractionTurn, SessionSection, WebSearchMode } from '@/types/learning';
import {
  EmptyState,
  ErrorBanner,
  PrimaryButton,
  SecondaryButton,
} from './shared';
import { CourseUnitTreePanel } from './course-unit-tree-panel';
import {
  buildUnitTreeFromCourseUnits,
  buildUnitTreeFromSections,
} from '@/lib/learning/course-unit-tree';
import {
  masteryFeedbackLabel,
  masteryFeedbackSentence,
  sectionPhaseNaturalLabel,
} from '@/lib/learning/mastery-copy';
import {
  decideCourseAdvance,
  decideCourseFollowUp,
} from '@/lib/learning/course-follow-up';
import { requestEntitySelection } from '@/lib/navigation/entity-selection';
import { useFocusTrap } from '@/lib/ui/use-focus-trap';



function CourseSkeleton() {
  return (
    <div
      className="flex-1 flex min-h-0 animate-pulse"
      data-testid="course-skeleton"
      aria-busy="true"
      aria-label="正在准备课程…"
    >
      <div className="hidden min-[1200px]:block w-[250px] shrink-0 border-r border-[var(--border-20)] p-3 space-y-3">
        <div className="h-3 w-20 bg-[var(--bg-tertiary)] rounded" />
        <div className="h-1.5 w-full bg-[var(--bg-tertiary)] rounded" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 bg-[var(--bg-tertiary)]/80 rounded" />
        ))}
      </div>
      <div className="flex-1 p-6 space-y-4">
        <div className="h-5 w-48 bg-[var(--bg-tertiary)] rounded" />
        <div className="h-24 bg-[var(--bg-tertiary)]/60 rounded-xl" />
        <div className="h-24 bg-[var(--bg-tertiary)]/40 rounded-xl" />
        <p className="font-zh text-xs text-[var(--text-muted)]">正在准备课程…</p>
      </div>
    </div>
  );
}

function displayCourseTurn(content: string, sectionTitle?: string): string {
  if (/^Now close the materials and explain\b/i.test(content.trim())) {
    return `请暂时离开材料，用自己的话解释「${sectionTitle || '这一节'}」的核心概念、概念之间的关系，以及一个具体例子。`;
  }
  if (/^Read the course materials for\b/i.test(content.trim())) {
    return `本节围绕「${sectionTitle || '当前主题'}」展开。请先梳理核心概念与它们之间的关系；模型知识是主要讲解基础，本地资料仅用于补充和引用。`;
  }
  return content;
}

function isLegacyLowQualityTurn(turn: InteractionTurn, section: SessionSection): boolean {
  if (turn.role !== 'assistant' || turn.qualityStatus === 'substantive') return false;
  if (turn.qualityStatus === 'legacy_low_quality') return true;
  const raw = turn.content.trim();
  if (/^Read the course materials for\b/i.test(raw)) return true;
  if (/模型服务可用时，?Minus 会进一步生成完整讲解|当前模型服务暂不可用，因此我不会编造具体结论/.test(raw)) return true;
  const compact = raw.replace(/\[cite:[^\]]+\]/g, '').replace(/\s|[，。！？；：,.!?;:()（）「」【】]/g, '');
  const description = (section.description || '').replace(/\s|[，。！？；：,.!?;:()（）「」【】]/g, '');
  return compact.length < 48 || Boolean(description && compact.includes(description) && compact.length <= description.length + 24);
}

export function LearningSessionView() {
  const data = useLearningStore((s) => s.data);
  const loading = useLearningStore((s) => s.loading);
  const error = useLearningStore((s) => s.error);
  const clearError = useLearningStore((s) => s.clearError);
  const activeSession = useLearningStore((s) => s.activeSession);
  const activeTaskId = useLearningStore((s) => s.activeTaskId);
  const setActiveTaskId = useLearningStore((s) => s.setActiveTaskId);
  const selectedCourseId = useLearningStore((s) => s.selectedCourseId);
  const setSelectedCourseId = useLearningStore((s) => s.setSelectedCourseId);
  const lastSearchHits = useLearningStore((s) => s.lastSearchHits);
  const search = useLearningStore((s) => s.search);
  const completeTask = useLearningStore((s) => s.completeTask);
  const endSession = useLearningStore((s) => s.endSession);
  const clearSearchHits = useLearningStore((s) => s.clearSearchHits);
  const sessionTeach = useLearningStore((s) => s.sessionTeach);
  const sessionReteach = useLearningStore((s) => s.sessionReteach);
  const sessionOpenSection = useLearningStore((s) => s.sessionOpenSection);
  const sessionSetWebSearchMode = useLearningStore((s) => s.sessionSetWebSearchMode);
  const sessionStartRecall = useLearningStore((s) => s.sessionStartRecall);
  const sessionSubmitRecall = useLearningStore((s) => s.sessionSubmitRecall);
  const sessionAssess = useLearningStore((s) => s.sessionAssess);
  const sessionFollowUp = useLearningStore((s) => s.sessionFollowUp);
  const saveSessionReflection = useLearningStore((s) => s.saveSessionReflection);
  const setActiveSession = useLearningStore((s) => s.setActiveSession);
  const setActiveAppView = useUIStore((s) => s.setActiveAppView);
  const providerId = useSettingsStore((s) => s.settings.providerId);
  const userSystemPrompt = useSettingsStore((s) => s.settings.systemPrompt);

  const [treeDrawerOpen, setTreeDrawerOpen] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [followUp, setFollowUp] = useState('');
  const [recallAnswer, setRecallAnswer] = useState('');
  const [reflection, setReflection] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [completionDialogOpen, setCompletionDialogOpen] = useState(false);
  const [lockedSectionRequest, setLockedSectionRequest] = useState<SessionSection | null>(null);
  const completionDialogRef = useRef<HTMLElement>(null);
  useFocusTrap(completionDialogRef, {
    enabled: completionDialogOpen,
    onEscape: () => setCompletionDialogOpen(false),
  });
  /** Focus override when user picks「下一节」or tree node without engine unlock. */
  const [focusSectionId, setFocusSectionId] = useState<string | null>(null);

  const courseId =
    activeSession?.courseId || selectedCourseId || data.courses[0]?.id || null;

  const course = useMemo(() => {
    if (!courseId) return null;
    return data.courses.find((c) => c.id === courseId) || null;
  }, [data.courses, courseId]);

  const units = useMemo(() => {
    if (!courseId) return [];
    return data.units
      .filter((u) => u.courseId === courseId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [data.units, courseId]);

  const tasks = useMemo(() => {
    if (!courseId) return [];
    return data.tasks.filter((t) => t.courseId === courseId);
  }, [data.tasks, courseId]);

  const activeTask = useMemo(
    () => tasks.find((t) => t.id === activeTaskId) || tasks.find((t) => t.status !== 'completed'),
    [tasks, activeTaskId],
  );

  const activeUnit = useMemo(() => {
    if (activeTask?.unitId) {
      return units.find((u) => u.id === activeTask.unitId) || null;
    }
    return units[0] || null;
  }, [activeTask, units]);

  const currentSection = useMemo(() => {
    if (!activeSession) return undefined;
    const want =
      focusSectionId ||
      activeSession.currentSectionId ||
      activeSession.sections.find((s) => s.status === 'open')?.id;
    return (
      activeSession.sections.find((s) => s.id === want) ||
      activeSession.sections.find((s) => s.status === 'open')
    );
  }, [activeSession, focusSectionId]);
  const webSearchMode = activeSession?.webSearchMode ?? 'auto';

  const unitTree = useMemo(() => {
    if (activeSession?.sections?.length) {
      return buildUnitTreeFromSections(
        activeSession.sections,
        currentSection?.id ?? activeSession.currentSectionId,
      );
    }
    return buildUnitTreeFromCourseUnits(units, activeUnit?.id);
  }, [activeSession, currentSection?.id, units, activeUnit?.id]);

  const courseDocs = useMemo(
    () => (courseId ? data.documents.filter((d) => d.courseId === courseId) : []),
    [data.documents, courseId],
  );

  // Route restoration: wait for load + optional session hydrate.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setRestoring(true);
      try {
        await useLearningStore.getState().load();
      } catch {
        /* store error */
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  // Auto-search materials for the current section; matching sources are user-visible below.
  useEffect(() => {
    if (!courseId || courseDocs.length === 0) return;
    const q = currentSection?.title || activeUnit?.title;
    if (!q?.trim()) return;
    void search(courseId, q, 10).catch(() => undefined);
  }, [courseId, currentSection?.id, activeUnit?.id, courseDocs.length, currentSection?.title, activeUnit?.title, search]);

  const handleCompleteAndEnd = useCallback(async () => {
    if (!courseId) return;
    setActionError(null);
    try {
      const sections = activeSession?.sections ?? [];
      const completedCount = sections.filter((section) => section.phase === 'done').length;
      const needsReview = sections.filter(
        (section) =>
          section.assessment?.result === 'partial' ||
          section.assessment?.result === 'fail',
      );
      const allSectionsComplete =
        sections.length > 0 && completedCount === sections.length;
      if (activeSession && !activeSession.endedAt) {
        const summary = [
          '[Minus 学习总结]',
          `完成单元：${completedCount}/${sections.length}`,
          needsReview.length > 0
            ? `建议复习：${needsReview.map((section) => section.title || '未命名单元').join('、')}`
            : '建议复习：当前没有标记为薄弱项的单元',
          reflection.trim() ? `学习者心得：${reflection.trim()}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        await saveSessionReflection(activeSession.id, summary);
        await endSession(activeSession.id);
      }
      if (
        allSectionsComplete &&
        activeTask &&
        activeTask.status !== 'completed'
      ) {
        await completeTask(activeTask.id);
      }
      clearSearchHits();
      setCompletionDialogOpen(false);
      setActiveAppView('history');
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : '暂时无法完成课程，请重试。',
      );
    }
  }, [
    courseId,
    activeSession,
    activeTask,
    reflection,
    saveSessionReflection,
    endSession,
    completeTask,
    clearSearchHits,
    setActiveAppView,
  ]);

  const handleTeach = async () => {
    if (!activeSession || !currentSection || !courseId) return;
    setActionError(null);
    try {
      await sessionTeach(
        activeSession.id,
        currentSection.id,
        courseId,
        lastSearchHits,
        { providerId, webSearchMode, systemPrompt: userSystemPrompt },
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '讲解生成失败，请重试。');
    }
  };

  const handleReteach = async () => {
    if (!activeSession || !currentSection || !courseId) return;
    setActionError(null);
    try {
      await sessionReteach(activeSession.id, currentSection.id, courseId, lastSearchHits, {
        providerId,
        webSearchMode,
        systemPrompt: userSystemPrompt,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '重新讲解失败，历史内容已保留。');
    }
  };

  const handleWebSearchModeChange = (mode: WebSearchMode) => {
    if (!activeSession) return;
    const previousMode = activeSession.webSearchMode ?? 'auto';
    setActiveSession({ ...activeSession, webSearchMode: mode });
    void sessionSetWebSearchMode(activeSession.id, mode).catch((err: unknown) => {
      setActiveSession({ ...activeSession, webSearchMode: previousMode });
      setActionError(err instanceof Error ? err.message : '联网策略保存失败。');
    });
  };

  const handleStartRecall = async () => {
    if (!activeSession || !currentSection) return;
    setActionError(null);
    try {
      await sessionStartRecall(activeSession.id, currentSection.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '暂时无法开始练习。');
    }
  };

  const handleSubmitRecall = async () => {
    if (!activeSession || !currentSection || !recallAnswer.trim()) return;
    setActionError(null);
    try {
      await sessionSubmitRecall(activeSession.id, currentSection.id, recallAnswer.trim());
      setRecallAnswer('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '答案提交失败，内容已为你保留。');
    }
  };

  const handleAssess = async () => {
    if (!activeSession || !currentSection || !courseId) return;
    setActionError(null);
    try {
      await sessionAssess(activeSession.id, currentSection.id, courseId, providerId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '暂时无法生成掌握度反馈。');
    }
  };

  /** 「下一节」— content advance only, no side-effect confirm. */
  const handleNextSection = useCallback(() => {
    if (!activeSession) return;
    const decision = decideCourseAdvance(
      activeSession.sections,
      currentSection?.id,
    );
    if (decision.kind === 'complete_course') {
      setCompletionDialogOpen(true);
      return;
    }
    if (decision.kind === 'advance' && decision.toSectionId) {
      setFocusSectionId(decision.toSectionId);
      // Prefer engine current when already unlocked
      if (activeSession.currentSectionId !== decision.toSectionId) {
        const nextSec = activeSession.sections.find((s) => s.id === decision.toSectionId);
        if (nextSec && nextSec.status !== 'locked') {
          setActiveSession({
            ...activeSession,
            currentSectionId: decision.toSectionId,
          });
        }
      }
    }
  }, [activeSession, currentSection?.id, setActiveSession]);

  /**
   * Bottom follow-up: stays on current unit; never IntentJudge.
   * Records local Q&A in-unit (no re-entry to experience planner).
   */
  const handleFollowUp = useCallback(() => {
    const text = followUp.trim();
    if (!text || !activeSession || !currentSection) return;
    const decision = decideCourseFollowUp(text, currentSection.id);
    if (decision.kind !== 'follow_up' || decision.reenterIntent) return;
    const unitTitle = currentSection.title || activeUnit?.title || '这一节';
    setActionError(null);
    void sessionFollowUp(
      activeSession.id,
      currentSection.id,
      text,
      unitTitle,
      {
        providerId,
        webSearchMode,
        systemPrompt: userSystemPrompt,
        hits: lastSearchHits,
      },
    )
      .then(() => setFollowUp(''))
      .catch((err: unknown) => {
        setActionError(
          err instanceof Error ? err.message : '追问发送失败，内容已为你保留。',
        );
      });
  }, [
    followUp,
    activeSession,
    currentSection,
    activeUnit?.title,
    providerId,
    webSearchMode,
    userSystemPrompt,
    lastSearchHits,
    sessionFollowUp,
  ]);

  const handleSelectTreeNode = (nodeId: string) => {
    if (!activeSession) {
      const unit = units.find((u) => u.id === nodeId);
      if (unit) {
        const t = tasks.find((x) => x.unitId === unit.id);
        if (t) setActiveTaskId(t.id);
      }
      return;
    }
    const sec = activeSession.sections.find((s) => s.id === nodeId);
    if (!sec) return;
    if (sec.status === 'locked') {
      setLockedSectionRequest(sec);
      return;
    }
    setFocusSectionId(nodeId);
  };

  const handleOpenLockedSection = async () => {
    if (!activeSession || !lockedSectionRequest) return;
    setActionError(null);
    try {
      const session = await sessionOpenSection(
        activeSession.id,
        lockedSectionRequest.id,
        'flexible',
      );
      setActiveSession(session);
      setFocusSectionId(lockedSectionRequest.id);
      setLockedSectionRequest(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '暂时无法打开该单元。');
    }
  };

  const sessionFinished = activeSession?.endedAt != null;
  const currentTurns = currentSection?.turns || [];
  const hasLegacyLowQualityTurn = useMemo(
    () => Boolean(currentSection?.turns?.some((turn) => isLegacyLowQualityTurn(turn, currentSection))),
    [currentSection],
  );
  const completionStats = useMemo(() => {
    const sections = activeSession?.sections ?? [];
    const completed = sections.filter((section) => section.phase === 'done');
    const needsReview = sections.filter(
      (section) =>
        section.assessment?.result === 'partial' ||
        section.assessment?.result === 'fail',
    );
    return {
      total: sections.length,
      completed: completed.length,
      needsReview,
    };
  }, [activeSession?.sections]);

  const sortedVisibleSections = useMemo(() => {
    if (!activeSession) return [] as SessionSection[];
    return [...activeSession.sections]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .filter((s) => s.status !== 'locked' || s.id === currentSection?.id);
  }, [activeSession, currentSection?.id]);

  if (restoring && loading) {
    return <CourseSkeleton />;
  }

  if (!courseId) {
    return (
      <div className="flex-1 overflow-y-auto">
        <EmptyState
          icon={<BookOpen size={iconSizes['2xl']} aria-hidden />}
          title="无可用课程"
          description="请先在主页确认学习路径，或到资料库创建课程并导入材料，再开始学习。"
          action={
            <div className="flex flex-wrap gap-2 justify-center">
              <PrimaryButton onClick={() => setActiveAppView('home')}>前往主页</PrimaryButton>
              <SecondaryButton onClick={() => setActiveAppView('library')}>
                前往资料库
              </SecondaryButton>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col min-h-0 bg-[var(--bg-primary)]"
      data-testid="course-session-layout"
    >
      {/* Top bar within course (global nav is AppShell) */}
      <div className="shrink-0 px-3 sm:px-4 py-2.5 border-b border-[var(--border-20)] bg-[var(--bg-primary)]/90 backdrop-blur-sm flex flex-wrap items-center justify-between gap-2 sm:flex-nowrap z-20">
        <div className="flex flex-1 items-center gap-2 min-w-0">
          <SecondaryButton
            onClick={() => {
              clearSearchHits();
              setActiveAppView('home');
            }}
            aria-label="返回主页"
            className="shrink-0"
          >
            <ArrowLeft size={14} aria-hidden />
            <span className="hidden sm:inline">返回</span>
          </SecondaryButton>
          <button
            type="button"
            className="min-[1200px]:hidden min-h-[44px] px-3 py-1.5 border border-[var(--border-20)] font-zh text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            onClick={() => setTreeDrawerOpen(true)}
            aria-label="打开单元列表"
            data-testid="open-unit-tree-drawer"
          >
            单元
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="font-zh text-sm font-bold text-[var(--text-primary)] truncate">
              {course?.title || '课程'}
            </h1>
            {(currentSection || activeUnit) && (
              <p className="font-zh text-[10px] text-[var(--text-muted)] truncate">
                {currentSection?.title || activeUnit?.title}
              </p>
            )}
          </div>
        </div>
        <div className="flex w-full items-center justify-end gap-2 border-t border-[var(--border-20)] pt-2 sm:w-auto sm:shrink-0 sm:border-t-0 sm:pt-0">
          <SecondaryButton
            onClick={() => {
              clearSearchHits();
              setActiveAppView('history');
            }}
            disabled={loading}
            className="py-1.5 px-3 text-xs"
            aria-label="暂停并返回历史"
          >
            <Pause size={14} aria-hidden />
            暂停返回
          </SecondaryButton>
          <PrimaryButton
            onClick={() => setCompletionDialogOpen(true)}
            disabled={loading}
            className="py-1.5 px-3 text-xs"
            aria-label="查看完成总结"
          >
            <CheckCircle2 size={14} aria-hidden />
            {completionStats.total > 0 &&
            completionStats.completed < completionStats.total
              ? '结束本次'
              : '完成课程'}
          </PrimaryButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* Desktop unit tree ~250px */}
        <CourseUnitTreePanel
          model={unitTree}
          open
          onClose={() => undefined}
          onSelectNode={handleSelectTreeNode}
          variant="rail"
        />

        {/* Narrow drawer */}
        {treeDrawerOpen && (
          <CourseUnitTreePanel
            model={unitTree}
            open={treeDrawerOpen}
            onClose={() => setTreeDrawerOpen(false)}
            onSelectNode={handleSelectTreeNode}
            variant="drawer"
          />
        )}

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-5 space-y-5 pb-36">
              {error && <ErrorBanner message={error} onDismiss={clearError} />}
              {actionError && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--error-border)] bg-[var(--error-bg)] px-4 py-3">
                  <p className="font-zh text-xs text-[var(--error)]">{actionError}</p>
                  <button
                    type="button"
                    onClick={() => setActionError(null)}
                    className="min-h-[36px] rounded-lg px-3 font-zh text-xs text-[var(--text-muted)] hover:bg-white/60"
                  >
                    关闭
                  </button>
                </div>
              )}

              {restoring && !activeSession && <CourseSkeleton />}

              {activeSession &&
                sortedVisibleSections.map((section) => {
                  const isCurrent = section.id === currentSection?.id;
                  const turns = section.turns || [];
                  return (
                    <div
                      key={section.id}
                      className={`space-y-4 ${isCurrent ? '' : 'opacity-70'}`}
                      data-section-id={section.id}
                    >
                      <div className="flex items-center justify-center my-4">
                        <div className="h-px bg-[var(--border-20)] flex-1" />
                        <span className="mx-3 px-3 py-1 text-xs font-zh bg-[var(--bg-tertiary)]/60 text-[var(--text-secondary)] border border-[var(--border-20)] rounded-full">
                          {section.title || '单元'} · {sectionPhaseNaturalLabel(section.phase)}
                        </span>
                        <div className="h-px bg-[var(--border-20)] flex-1" />
                      </div>

                      {turns.map((turn) => {
                        const isAssistant = turn.role === 'assistant';
                        return (
                          <div
                            key={turn.id}
                            className={isAssistant ? 'w-full' : 'ml-auto flex max-w-[90%] flex-row-reverse gap-3 sm:max-w-[80%]'}
                          >
                            {!isAssistant && (
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border-20)] bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)]">
                                <BookOpen size={14} aria-hidden />
                              </div>
                            )}
                            <div
                              className={`min-w-0 flex-1 ${
                                isAssistant
                                  ? 'py-1 font-zh text-[var(--text-primary)]'
                                  : 'rounded-2xl rounded-tr-none bg-[var(--user-bubble-bg)] p-3.5 font-zh text-sm leading-relaxed text-[var(--user-bubble-text)]'
                              }`}
                            >
                              {isAssistant ? (
                                <AssistantRichContent
                                  content={displayCourseTurn(turn.content, section.title)}
                                  fallback={(c) => (
                                    <MarkdownContent content={c} variant="lesson" />
                                  )}
                                />
                              ) : (
                                <p className="whitespace-pre-wrap">
                                  {displayCourseTurn(turn.content, section.title)}
                                </p>
                              )}
                              {isAssistant && turn.sourceStatus && (
                                <p className="mt-2 flex flex-wrap gap-x-2 gap-y-1 font-zh text-[10px] text-[var(--text-muted)]">
                                  <span>模型知识</span>
                                  {turn.sourceStatus.local === 'used' && <span>已引用本地资料</span>}
                                  {turn.sourceStatus.web === 'used' && <span>已联网核验</span>}
                                  {turn.sourceStatus.web === 'reused' && <span>复用本节来源</span>}
                                </p>
                              )}
                              {turn.assessment && (
                                <div className="mt-2">
                                  <span
                                    className="inline-flex items-center px-2 py-0.5 border rounded-full text-[11px] font-zh border-[var(--border-20)] bg-[var(--bg-tertiary)]/40 text-[var(--text-secondary)]"
                                    data-testid="mastery-feedback"
                                  >
                                    {masteryFeedbackLabel(turn.assessment.result)}
                                  </span>
                                </div>
                              )}
                              {isAssistant && turn.webSources && turn.webSources.length > 0 && (
                                <div className="mt-3 border-t border-[var(--border-20)] pt-2.5">
                                  <p className="mb-1.5 flex items-center gap-1.5 font-zh text-[11px] font-bold text-[var(--text-secondary)]">
                                    <Globe2 size={12} aria-hidden />
                                    联网参考
                                  </p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {turn.webSources.slice(0, 5).map((source) => (
                                      <a
                                        key={source.url}
                                        href={source.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex min-h-[32px] max-w-full items-center gap-1 rounded-lg border border-[var(--border-20)] bg-[var(--surface-soft)] px-2.5 py-1 font-zh text-[11px] text-[var(--accent)] hover:border-[var(--accent)]"
                                      >
                                        <span className="truncate">{source.title}</span>
                                        <ExternalLink size={11} className="shrink-0" aria-hidden />
                                      </a>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {isAssistant && turn.webSearchStatus === 'unavailable' && (
                                <p className="mt-2 border-t border-[var(--border-20)] pt-2 font-zh text-[11px] text-[var(--text-muted)]">
                                  联网资料暂不可用，本次内容使用模型知识与可用的本地资料。
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {isCurrent && lastSearchHits.length > 0 && (
                        <details
                          className="surface-card ml-11 max-w-[calc(100%-2.75rem)] overflow-hidden"
                          data-testid="course-sources"
                        >
                          <summary className="cursor-pointer px-4 py-3 font-zh text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-soft)]">
                            本节参考来源 · {lastSearchHits.length}
                          </summary>
                          <div className="border-t border-[var(--border-20)] p-3 space-y-2">
                            {lastSearchHits.slice(0, 4).map((hit, index) => (
                              <button
                                key={`${hit.documentId}-${index}`}
                                type="button"
                                onClick={() => {
                                  setSelectedCourseId(courseId);
                                  requestEntitySelection({
                                    kind: 'document',
                                    id: hit.documentId,
                                  });
                                  setActiveAppView('library');
                                }}
                                className="soft-card block w-full px-3 py-2.5 text-left hover:ring-1 hover:ring-[var(--accent)]"
                              >
                                <p className="font-zh text-xs font-bold text-[var(--text-primary)]">
                                  {hit.title}
                                </p>
                                <p className="mt-1 line-clamp-2 font-zh text-[11px] leading-relaxed text-[var(--text-muted)]">
                                  {hit.snippet}
                                </p>
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCourseId(courseId);
                                setActiveAppView('library');
                              }}
                              className="min-h-[36px] rounded-lg px-3 font-zh text-xs font-bold text-[var(--accent)] hover:bg-[var(--accent-soft)]"
                            >
                              在资料库查看来源
                            </button>
                          </div>
                        </details>
                      )}

                      {isCurrent && (
                        <div className="space-y-3">
                          {section.phase === 'teach' && (
                            <CoachBubble>
                              {turns.length > 0
                                ? '讲解已准备好。有疑问可以在下方追问；准备好了就开始练习。'
                                : '点击「开始讲解」，我们一起看这一节。'}
                            </CoachBubble>
                          )}
                          {section.phase === 'active_recall' && (
                            <CoachBubble>请用自己的话复述这一节的关键概念。</CoachBubble>
                          )}
                          {section.phase === 'assess' && (
                            <CoachBubble>
                              已收到你的回答。点「看看掌握得怎样」获取反馈。
                            </CoachBubble>
                          )}
                          {section.phase === 'remediate' && (
                            <CoachBubble>
                              {masteryFeedbackSentence(
                                section.assessment?.result || 'fail',
                              )}
                            </CoachBubble>
                          )}
                          {section.phase === 'done' && (
                            <CoachBubble success>
                              {masteryFeedbackSentence('pass', { canAdvance: true })}
                              {section.assessment?.notes &&
                                !/\b(pass|partial|fail)\b/i.test(section.assessment.notes) && (
                                  <span className="block mt-1 text-[var(--text-secondary)] text-xs">
                                    {section.assessment.notes}
                                  </span>
                                )}
                            </CoachBubble>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

              {!activeSession && !restoring && (
                <div className="border border-[var(--border-20)] bg-[var(--bg-secondary)]/30 p-5 rounded-2xl space-y-3">
                  <h2 className="font-zh text-base font-bold text-[var(--text-primary)]">
                    {activeUnit?.title || '当前单元'}
                  </h2>
                  {activeUnit?.description && (
                    <p className="font-zh text-sm text-[var(--text-secondary)] leading-relaxed">
                      {activeUnit.description}
                    </p>
                  )}
                  {activeUnit?.knowledgePoints && activeUnit.knowledgePoints.length > 0 && (
                    <ul className="list-disc pl-5 font-zh text-sm text-[var(--text-secondary)] space-y-1">
                      {activeUnit.knowledgePoints.map((kp, i) => (
                        <li key={i}>{kp}</li>
                      ))}
                    </ul>
                  )}
                  <p className="font-zh text-xs text-[var(--text-muted)]">
                    从主页「开始学习」创建会话后，即可在此逐步学习。
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Bottom: phase CTAs + follow-up input */}
          <div className="shrink-0 border-t border-[var(--border-20)] bg-[var(--bg-primary)]/95 backdrop-blur-md px-4 sm:px-6 py-3 z-20 space-y-2">
            <div className="max-w-3xl mx-auto w-full space-y-2">
              {activeSession && currentSection && !sessionFinished && (
                <>
                  <div
                    className="flex min-h-[36px] flex-wrap items-center justify-between gap-2 px-1"
                    data-testid="course-knowledge-sources"
                  >
                    <div className="flex flex-wrap items-center gap-2 font-zh text-[11px] text-[var(--text-muted)]">
                      <span className="inline-flex items-center gap-1.5 font-bold text-[var(--text-secondary)]">
                        <Brain size={13} aria-hidden />
                        模型知识
                      </span>
                      {courseDocs.length > 0 && (
                        <span>本地资料 · {courseDocs.length}</span>
                      )}
                    </div>
                    <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-20)] bg-[var(--surface-soft)] p-0.5" aria-label="课程联网策略">
                      <Globe2 size={13} className="ml-1 text-[var(--text-muted)]" aria-hidden />
                      {([
                        ['auto', '智能'],
                        ['always', '每次'],
                        ['off', '关闭'],
                      ] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={webSearchMode === mode}
                          onClick={() => handleWebSearchModeChange(mode)}
                          disabled={loading}
                          className={`min-h-[28px] rounded-md px-2 font-zh text-[10px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${webSearchMode === mode ? 'bg-[var(--surface)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-muted)]'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {currentSection.phase === 'teach' && (
                    <div className="flex flex-wrap gap-2">
                      {currentTurns.length === 0 ? (
                        <PrimaryButton
                          onClick={handleTeach}
                          disabled={loading}
                          className="flex-1 py-2.5 justify-center text-sm rounded-xl"
                        >
                          开始讲解
                        </PrimaryButton>
                      ) : hasLegacyLowQualityTurn ? (
                        <PrimaryButton
                          onClick={handleReteach}
                          disabled={loading}
                          className="flex-1 py-2.5 justify-center text-sm rounded-xl"
                        >
                          <RotateCcw size={14} aria-hidden />
                          重新讲解本节
                        </PrimaryButton>
                      ) : (
                        <div className="flex flex-1 gap-2">
                          <SecondaryButton
                            onClick={handleReteach}
                            disabled={loading}
                            className="shrink-0 py-2.5 px-3 justify-center text-sm rounded-xl"
                          >
                            <RotateCcw size={14} aria-hidden />
                            重新讲解
                          </SecondaryButton>
                          <PrimaryButton
                            onClick={handleStartRecall}
                            disabled={loading}
                            className="flex-1 py-2.5 justify-center text-sm rounded-xl"
                          >
                            开始练习
                          </PrimaryButton>
                        </div>
                      )}
                    </div>
                  )}

                  {currentSection.phase === 'active_recall' && (
                    <div className="border border-[var(--border-40)] rounded-xl overflow-hidden">
                      <textarea
                        value={recallAnswer}
                        onChange={(e) => setRecallAnswer(e.target.value)}
                        placeholder="用自己的话复述…"
                        rows={2}
                        className="w-full p-3 bg-transparent font-zh text-sm focus:outline-none resize-none"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (recallAnswer.trim() && !loading) void handleSubmitRecall();
                          }
                        }}
                      />
                      <div className="flex justify-end px-3 py-2 border-t border-[var(--border-20)]">
                        <PrimaryButton
                          onClick={handleSubmitRecall}
                          disabled={loading || !recallAnswer.trim()}
                          className="py-1 px-3 text-xs rounded-lg"
                        >
                          提交
                        </PrimaryButton>
                      </div>
                    </div>
                  )}

                  {currentSection.phase === 'assess' && (
                    <PrimaryButton
                      onClick={handleAssess}
                      disabled={loading}
                      className="w-full py-2.5 justify-center text-sm rounded-xl"
                    >
                      看看掌握得怎样
                    </PrimaryButton>
                  )}

                  {currentSection.phase === 'remediate' && (
                    <div className="flex gap-2">
                      <PrimaryButton
                        onClick={handleTeach}
                        disabled={loading}
                        className="flex-1 py-2.5 justify-center text-sm rounded-xl"
                      >
                        再讲一遍
                      </PrimaryButton>
                      <PrimaryButton
                        onClick={handleStartRecall}
                        disabled={loading}
                        className="flex-1 py-2.5 justify-center text-sm rounded-xl"
                      >
                        再练一下
                      </PrimaryButton>
                    </div>
                  )}

                  {currentSection.phase === 'done' && (
                    <PrimaryButton
                      onClick={handleNextSection}
                      disabled={loading}
                      className="w-full py-2.5 justify-center text-sm rounded-xl"
                      data-testid="next-section-cta"
                    >
                      <PixelIcon name="action-play" size={16} className="mr-1.5" aria-hidden />
                      下一节
                    </PrimaryButton>
                  )}
                </>
              )}

              {/* Follow-up always available on course (current unit) */}
              {activeSession && !sessionFinished && (
                <div
                  className="flex items-end gap-2 border border-[var(--border-20)] rounded-xl bg-[var(--bg-secondary)]/60 px-3 py-2"
                  data-testid="course-follow-up"
                >
                  <textarea
                    value={followUp}
                    onChange={(e) => setFollowUp(e.target.value)}
                    placeholder="对这一节有疑问？"
                    rows={1}
                    className="flex-1 min-h-[40px] max-h-[100px] bg-transparent font-zh text-sm resize-none focus:outline-none py-2"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleFollowUp();
                      }
                    }}
                    aria-label="对这一节有疑问"
                  />
                  <button
                    type="button"
                    onClick={handleFollowUp}
                    disabled={!followUp.trim()}
                    className="shrink-0 px-3 py-2 bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] font-zh text-xs font-bold border border-[var(--border)] disabled:opacity-40 rounded-lg"
                  >
                    发送
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {completionDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCompletionDialogOpen(false);
          }}
        >
          <section
            ref={completionDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="course-completion-title"
            className="surface-card w-full max-w-lg p-5 sm:p-6 space-y-5"
          >
            <div>
              <p className="font-zh text-xs font-bold text-[var(--accent)]">学习总结</p>
              <h2
                id="course-completion-title"
                className="mt-1 font-zh text-xl font-bold text-[var(--text-primary)]"
              >
                {completionStats.total > 0 &&
                completionStats.completed < completionStats.total
                  ? '要提前结束本次学习吗？'
                  : '要完成这门课程吗？'}
              </h2>
              <p className="mt-2 font-zh text-sm leading-relaxed text-[var(--text-secondary)]">
                已完成 {completionStats.completed}/{completionStats.total || 0} 个单元。
                {completionStats.completed < completionStats.total
                  ? ' 提前结束会保存本次总结，但不会把任务标记为已完成。'
                  : ' 确认后会保存总结，并把当前任务标记为完成。'}
              </p>
            </div>

            {completionStats.needsReview.length > 0 ? (
              <div className="soft-card p-4">
                <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">
                  建议之后再复习
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {completionStats.needsReview.slice(0, 4).map((section) => (
                    <li key={section.id} className="font-zh text-xs text-[var(--text-secondary)]">
                      · {section.title || '未命名单元'}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="soft-card p-4 font-zh text-sm text-[var(--text-secondary)]">
                当前没有被标记为薄弱项的单元。完成后可在历史中继续回顾。
              </div>
            )}

            {completionStats.completed < completionStats.total && (
              <p className="rounded-xl bg-amber-50 px-3 py-2.5 font-zh text-xs text-amber-800">
                仍有未完成单元。你也可以先暂停返回，之后从历史继续。
              </p>
            )}

            <label className="block space-y-2">
              <span className="font-zh text-sm font-bold text-[var(--text-primary)]">
                本次心得（可选）
              </span>
              <textarea
                value={reflection}
                onChange={(event) => setReflection(event.target.value)}
                rows={3}
                placeholder="记录掌握点、疑问或下次想继续的内容…"
                className="w-full resize-none rounded-xl border border-[var(--border-20)] bg-[var(--surface-soft)] px-3 py-2.5 font-zh text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>

            {actionError && (
              <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <SecondaryButton onClick={() => setCompletionDialogOpen(false)}>
                继续学习
              </SecondaryButton>
              <SecondaryButton
                onClick={() => {
                  clearSearchHits();
                  setCompletionDialogOpen(false);
                  setActiveAppView('history');
                }}
              >
                暂停并返回
              </SecondaryButton>
              <PrimaryButton onClick={() => void handleCompleteAndEnd()} disabled={loading}>
                {loading
                  ? '正在保存…'
                  : completionStats.completed < completionStats.total
                    ? '保存总结并结束本次'
                    : '保存总结并完成'}
              </PrimaryButton>
            </div>
          </section>
        </div>
      )}

      {lockedSectionRequest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLockedSectionRequest(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="open-section-title"
            className="surface-card w-full max-w-md p-5 space-y-4"
          >
            <div>
              <p className="font-zh text-xs font-bold text-[var(--accent)]">学习顺序</p>
              <h2 id="open-section-title" className="mt-1 font-zh text-lg font-bold text-[var(--text-primary)]">
                提前打开「{lockedSectionRequest.title || '这个单元'}」？
              </h2>
              <p className="mt-2 font-zh text-sm leading-relaxed text-[var(--text-secondary)]">
                可以直接学习这一节，前序单元仍会保留未完成状态，不会被自动标记完成。
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <SecondaryButton onClick={() => setLockedSectionRequest(null)}>
                按计划学习
              </SecondaryButton>
              <PrimaryButton onClick={() => void handleOpenLockedSection()} disabled={loading}>
                提前打开
              </PrimaryButton>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function CoachBubble({
  children,
  success,
}: {
  children: ReactNode;
  success?: boolean;
}) {
  return (
    <div className="flex gap-3 max-w-[90%] sm:max-w-[80%] mr-auto">
      <div className="w-8 h-8 rounded-full border border-[var(--border-20)] bg-[var(--bg-tertiary)] text-[var(--accent)] flex items-center justify-center shrink-0">
        <BookOpen size={14} aria-hidden />
      </div>
      <div
        className={`p-3.5 bg-[var(--bg-secondary)]/55 border border-[var(--border-20)] rounded-2xl rounded-tl-none text-sm font-zh leading-relaxed ${
          success ? 'text-[var(--success)]' : 'text-[var(--text-secondary)]'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

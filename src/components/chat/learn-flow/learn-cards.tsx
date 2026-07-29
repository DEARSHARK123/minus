'use client';

import { useMemo, useState } from 'react';
import PixelIcon from '@/components/icons/PixelIcon';
import { useLearnFlowStore } from '@/store/learn-flow-store';
import { useLearningStore } from '@/store/learning-store';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';
import { useChatStore } from '@/store/chat-store';
import type { LearnArtifact, OutlineUnitArtifact } from '@/lib/agents/types';
import type { Message } from '@/types/agent';
import { hasLearnContentMarkup } from '@/lib/chat/learn-content';
import { filterVisibleArtifacts } from '@/lib/chat/artifact-visibility';
import { EditableOutline } from '@/components/chat/learn-flow/editable-outline';
import { canCommitCourseStart, courseCommitNavigation } from '@/lib/learning/course-commit';
import { isPlaceholderGoal } from '@/lib/agents/control-plane/clarification-spec';
import { submitCalendarConstraint } from '@/lib/chat/calendar-planning-bridge';
import type { PlanningConstraintKey } from '@/lib/learning/planning-constraints';

let learnCardMsgSeq = 0;
function nextLearnCardMsgId(prefix: string): string {
  learnCardMsgSeq += 1;
  return `${prefix}_${Date.now()}_${learnCardMsgSeq}`;
}

/**
 * Push a real user message into the active conversation stream, then run `fn`.
 * Keeps clarify choices visible as chat turns (batch-03).
 */
async function withUserMessageTurn(
  answer: string,
  fn: () => Promise<void>,
): Promise<void> {
  const text = answer.trim();
  if (!text) return;
  const addMessage = useChatStore.getState().addMessage;
  const updateMessage = useChatStore.getState().updateMessage;
  const userMessage: Message = {
    id: nextLearnCardMsgId('msg_usr'),
    role: 'user',
    content: text,
    timestamp: new Date(),
  };
  addMessage(userMessage);
  const assistantId = nextLearnCardMsgId('msg_ast');
  const assistantMessage: Message = {
    id: assistantId,
    role: 'assistant',
    content: '',
    timestamp: new Date(),
    thinking: true,
  };
  addMessage(assistantMessage);
  try {
    await fn();
    const arts = useLearnFlowStore.getState().artifacts;
    const plain =
      arts.find((a) => a.kind === 'plain_assistant')?.content ||
      arts.find((a) => a.content)?.content ||
      '';
    const hasOutline = arts.some((a) => a.kind === 'outline_card');
    updateMessage(assistantId, {
      thinking: false,
      content:
        plain ||
        (hasOutline
          ? '已根据你的选择更新学习规划，请查看下方卡片。'
          : '已记录你的选择，请继续。'),
    });
  } catch (err) {
    updateMessage(assistantId, {
      thinking: false,
      content: err instanceof Error ? err.message : '处理选择时出错，请重试。',
    });
  }
}

function ArtifactCard({
  artifact,
  stage,
  calibrationSelected,
  calibrationSelectedIndices,
  onConfirmIntent,
  onRejectIntent,
  onContinueMemory,
  onSelectCalibration,
  onToggleMulti,
  onSubmitMulti,
  onCustomClarify,
  onAdvanceResources,
  onStartSession,
  starting,
  startError,
  outlineUnits,
  onOutlineChange,
}: {
  artifact: LearnArtifact;
  stage: string;
  calibrationSelected: number | null;
  calibrationSelectedIndices: number[];
  onConfirmIntent: () => void;
  onRejectIntent: () => void;
  onContinueMemory: () => void;
  onSelectCalibration: (i: number) => void;
  onToggleMulti: (i: number) => void;
  onSubmitMulti: () => void;
  onCustomClarify: (text: string) => void;
  onAdvanceResources: () => void;
  onStartSession: () => void;
  starting: boolean;
  startError: string | null;
  outlineUnits: OutlineUnitArtifact[];
  onOutlineChange: (units: OutlineUnitArtifact[]) => void;
}) {
  const [customText, setCustomText] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const allowCustom = artifact.clarification?.allowCustom === true;
  switch (artifact.kind) {
    case 'confirm_gate':
      return (
        <section className="border border-[var(--accent)]/40 bg-[var(--bg-primary)]/90 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <PixelIcon name="plan-propose" size={16} aria-hidden />
            <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">
              {artifact.title || '确认学习目标'}
            </h3>
          </div>
          <p className="font-zh text-xs leading-relaxed text-[var(--text-muted)]">
            确认后才会进入学习计划；你随时可以改。
          </p>
          <p className="font-zh text-sm leading-relaxed text-[var(--text-secondary)] border border-[var(--border-20)] bg-[var(--bg-secondary)]/50 px-3 py-2 whitespace-pre-wrap">
            {artifact.content || artifact.proposal}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirmIntent}
              className="px-3 py-1.5 bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] font-zh text-xs font-bold border border-[var(--border)]"
            >
              确认目标
            </button>
            <button
              type="button"
              onClick={onRejectIntent}
              className="px-3 py-1.5 border border-[var(--border)] text-[var(--text-secondary)] font-zh text-xs hover:bg-[var(--bg-tertiary)]"
            >
              重新输入
            </button>
          </div>
        </section>
      );

    case 'memory_card':
      return (
        <section className="border border-[var(--border)] bg-[var(--bg-primary)]/80 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <PixelIcon name="session-open" size={16} aria-hidden />
            <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">
              {artifact.title || '你的学习背景'}
            </h3>
          </div>
          {artifact.content && (
            <p className="font-zh text-xs text-[var(--text-muted)]">{artifact.content}</p>
          )}
          <ul className="list-disc pl-5 font-zh text-sm text-[var(--text-secondary)] space-y-1">
            {(artifact.memoryEntries || []).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          {(stage === 'goal_clarification' || stage === 'memory') && (
            <button
              type="button"
              onClick={onContinueMemory}
              className="mt-1 px-3 py-1.5 border border-[var(--border)] font-zh text-xs hover:bg-[var(--bg-tertiary)]"
            >
              继续
            </button>
          )}
        </section>
      );

    case 'calendar_constraint': {
      return (
        <section
          className="border border-[var(--border)] bg-[var(--bg-primary)]/80 p-4 space-y-3"
          data-testid="calendar-constraint-card"
        >
          <div className="flex items-center gap-2">
            <PixelIcon name="plan-goal" size={16} aria-hidden />
            <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">
              学习时间偏好
            </h3>
          </div>
          <p className="font-zh text-sm text-[var(--text-secondary)]">{artifact.content}</p>
          <ul className="space-y-2" role="radiogroup" aria-label="单选（选后自动继续）">
            {(artifact.options || []).map((opt, i) => (
              <li key={i}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={false}
                  onClick={() =>
                    void withUserMessageTurn(opt, () =>
                      submitCalendarConstraint(
                        opt,
                        (artifact.topic || '') as PlanningConstraintKey,
                      ),
                    )
                  }
                  className="w-full text-left px-3 py-2 border font-zh text-sm transition-colors border-[var(--border-20)] text-[var(--text-secondary)] hover:border-[var(--border)]"
                  data-testid={`calendar-constraint-${i}`}
                >
                  {opt}
                </button>
              </li>
            ))}
          </ul>
        </section>
      );
    }

    case 'single_choice': {
      const locked = calibrationSelected !== null;
      const field = artifact.clarification?.field;
      return (
        <section
          className="border border-[var(--border)] bg-[var(--bg-primary)]/80 p-4 space-y-3"
          data-testid="inline-single-choice"
          data-clarify-field={field || undefined}
        >
          <div className="flex items-center gap-2">
            <PixelIcon name="plan-diagnose" size={16} aria-hidden />
            <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">
              {artifact.title || '快速选择'}
            </h3>
          </div>
          <p className="font-zh text-sm text-[var(--text-secondary)]">{artifact.content}</p>
          <ul className="space-y-2" role="radiogroup" aria-label="单选（选后自动继续）">
            {(artifact.options || []).map((opt, i) => {
              const selected = calibrationSelected === i;
              return (
                <li key={i}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={locked && !selected}
                    onClick={() => onSelectCalibration(i)}
                    className={`w-full text-left px-3 py-2 border font-zh text-sm transition-colors ${
                      selected
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text-primary)]'
                        : 'border-[var(--border-20)] text-[var(--text-secondary)] hover:border-[var(--border)]'
                    } ${locked && !selected ? 'opacity-50 cursor-not-allowed' : ''}`}
                    data-testid={`clarify-option-${i}`}
                  >
                    {opt}
                  </button>
                </li>
              );
            })}
          </ul>
          {allowCustom && !locked && (
            <div className="flex gap-2 items-center pt-1">
              <input
                type="text"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder={
                  field === 'topic' || field === 'goal'
                    ? '或自己写主题/目标…'
                    : '或其他说明…'
                }
                className="flex-1 min-h-[40px] px-3 py-2 border border-[var(--border-20)] bg-[var(--bg-secondary)] font-zh text-sm text-[var(--text-primary)]"
                data-testid="clarify-custom-input"
                aria-label="自定义回答"
              />
              <button
                type="button"
                className="min-h-[40px] px-3 py-1.5 bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] font-zh text-xs font-bold border border-[var(--border)] disabled:opacity-50"
                data-testid="clarify-custom-submit"
                disabled={!customText.trim()}
                onClick={() => {
                  const t = customText.trim();
                  if (!t) return;
                  if (
                    (field === 'topic' || field === 'goal') &&
                    isPlaceholderGoal(t)
                  ) {
                    setCustomError(
                      '请写一个具体主题（不要用「一个主题」「某领域」这类占位说法）。',
                    );
                    return;
                  }
                  setCustomError(null);
                  onCustomClarify(t);
                  setCustomText('');
                }}
              >
                继续
              </button>
            </div>
          )}
          {customError && (
            <p className="font-zh text-xs text-amber-700" data-testid="clarify-placeholder-error">
              {customError}
            </p>
          )}
          <p className="font-zh text-[10px] text-[var(--text-muted)]">
            {allowCustom
              ? '点选建议后自动继续；也可自己输入后点「继续」'
              : '点选后自动继续'}
          </p>
        </section>
      );
    }

    case 'multi_choice': {
      const selectedSet = new Set(calibrationSelectedIndices);
      const locked =
        calibrationSelectedIndices.length > 0 && calibrationSelected !== null;
      const hasSelection = calibrationSelectedIndices.length > 0;
      return (
        <section
          className="border border-[var(--border)] bg-[var(--bg-primary)]/80 p-4 space-y-3"
          data-testid="inline-multi-choice"
        >
          <div className="flex items-center gap-2">
            <PixelIcon name="plan-diagnose" size={16} aria-hidden />
            <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">
              {artifact.title || '多选'}
            </h3>
          </div>
          <p className="font-zh text-sm text-[var(--text-secondary)]">{artifact.content}</p>
          <ul className="space-y-2" role="group" aria-label="多选（勾选后点继续）">
            {(artifact.options || []).map((opt, i) => {
              const selected = selectedSet.has(i);
              return (
                <li key={i}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    disabled={locked}
                    onClick={() => onToggleMulti(i)}
                    className={`w-full text-left px-3 py-2 border font-zh text-sm transition-colors ${
                      selected
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text-primary)]'
                        : 'border-[var(--border-20)] text-[var(--text-secondary)] hover:border-[var(--border)]'
                    } ${locked ? 'opacity-70 cursor-not-allowed' : ''}`}
                    data-testid={`clarify-multi-option-${i}`}
                  >
                    <span className="mr-2 font-tech text-[10px]">{selected ? '☑' : '☐'}</span>
                    {opt}
                  </button>
                </li>
              );
            })}
          </ul>
          {!locked && (
            <button
              type="button"
              onClick={onSubmitMulti}
              disabled={!hasSelection}
              className="min-h-[40px] px-3 py-1.5 bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] font-zh text-xs font-bold border border-[var(--border)] disabled:opacity-50"
              data-testid="clarify-multi-continue"
            >
              继续
            </button>
          )}
          <p className="font-zh text-[10px] text-[var(--text-muted)]">
            可多选；勾选完成后点「继续」提交
          </p>
        </section>
      );
    }

    case 'free_text':
      return (
        <section
          className="border border-[var(--border)] bg-[var(--bg-primary)]/80 p-4 space-y-2"
          data-testid="inline-free-text"
        >
          <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">
            {artifact.title || '说说你的想法'}
          </h3>
          <p className="font-zh text-sm text-[var(--text-secondary)]">{artifact.content}</p>
          {allowCustom ? (
            <div className="flex gap-2 items-center pt-1">
              <input
                type="text"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="用一句话回答…"
                className="flex-1 min-h-[40px] px-3 py-2 border border-[var(--border-20)] bg-[var(--bg-secondary)] font-zh text-sm text-[var(--text-primary)]"
                data-testid="clarify-free-input"
              />
              <button
                type="button"
                className="min-h-[40px] px-3 py-1.5 bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] font-zh text-xs font-bold border border-[var(--border)] disabled:opacity-50"
                disabled={!customText.trim()}
                data-testid="clarify-free-submit"
                onClick={() => {
                  const t = customText.trim();
                  if (!t) return;
                  onCustomClarify(t);
                  setCustomText('');
                }}
              >
                继续
              </button>
            </div>
          ) : (
            <p className="font-zh text-xs text-[var(--text-muted)]">
              在下方输入框写完后发送即可继续。
            </p>
          )}
        </section>
      );

    case 'resource_list':
      return (
        <section className="border border-[var(--border)] bg-[var(--bg-primary)]/80 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <PixelIcon name="sources" size={16} aria-hidden />
            <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">
              {artifact.title || '推荐资源'}
            </h3>
          </div>
          <ul className="space-y-2">
            {(artifact.resources || []).map((r, i) => (
              <li
                key={i}
                className="border border-[var(--border-20)] bg-[var(--bg-secondary)]/40 px-3 py-2"
              >
                <p className="font-zh text-sm font-bold text-[var(--text-primary)]">{r.title}</p>
                <p className="font-zh text-xs text-[var(--text-muted)] mt-0.5">{r.reason}</p>
              </li>
            ))}
          </ul>
          {(stage === 'outline' || stage === 'resources') && (
            <button
              type="button"
              onClick={onAdvanceResources}
              className="px-3 py-1.5 bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] font-zh text-xs font-bold border border-[var(--border)]"
            >
              查看大纲
            </button>
          )}
        </section>
      );

    case 'outline_card': {
      // Prefer live preview units (edits); fall back to artifact snapshot.
      const liveUnits =
        outlineUnits.length > 0 ? outlineUnits : artifact.units || [];
      const showCta =
        stage === 'outline' || stage === 'ready' || stage === 'resources';
      return (
        <div className="space-y-2">
          {(stage === 'outline' || stage === 'ready') && (
            <p className="rounded-lg border border-dashed border-[var(--border-20)] bg-[var(--surface-soft)] px-3 py-2 font-zh text-[11px] text-[var(--text-muted)]">
              本地资料未导入（可选）。课程会以模型知识为主要讲解来源，并可按联网策略补充可验证资料。
            </p>
          )}
          <EditableOutline
            units={liveUnits}
            onChange={onOutlineChange}
            starting={starting}
            startError={startError}
            onStartSession={onStartSession}
            showStartCta={showCta && (stage === 'outline' || stage === 'ready')}
          />
        </div>
      );
    }

    case 'progress_update':
      // UX03: pure progress_update hidden by filterVisibleArtifacts; keep null fallback
      return null;

    case 'plain_assistant':
      return (
        <section className="border border-[var(--border-20)] bg-[var(--bg-primary)]/80 p-3 space-y-2">
          {artifact.title && (
            <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">{artifact.title}</h3>
          )}
          {/* Outline/planning plain text only — teach fences should not appear here. */}
          <p className="font-zh text-sm text-[var(--text-secondary)] whitespace-pre-wrap">
            {artifact.content && hasLearnContentMarkup(artifact.content)
              ? artifact.content.replace(/:::(summary|key|tip|definition|重点|摘要|提示|定义)(?=\s|$)/gi, '').replace(/:::/g, '').trim()
              : artifact.content}
          </p>
        </section>
      );

    default: {
      const _exhaustive: never = artifact.kind;
      return _exhaustive;
    }
  }
}

export type LearnFlowCardsProps = {
  /**
   * When set, render these artifacts instead of the live store list
   * (historical Turn snapshot — non-sticky).
   */
  artifactsOverride?: LearnArtifact[] | null;
  /**
   * Interactive controls (choices, outline edit, start) only on the owning Turn.
   * Historical snapshots are read-only.
   */
  interactive?: boolean;
  /**
   * When true, suppress in-card trust elevation UI so HITL stays a single surface
   * (DesktopToolTimeline / ToolConfirmDialog).
   */
  suppressTrustUi?: boolean;
  /** Optional turn id for test anchors / debugging. */
  turnId?: string | null;
  /**
   * When true, force-hide loading/error from store (stale Turn after edit).
   * Default: only interactive turn may show live loading.
   */
  showLiveStatus?: boolean;
};

/**
 * Learn-flow cards bound to a Turn (assistant message).
 * Batch-04: no longer a global footer strip — mount inside the owning assistant bubble.
 */
export function LearnFlowCards({
  artifactsOverride = null,
  interactive = true,
  suppressTrustUi = false,
  turnId = null,
  showLiveStatus,
}: LearnFlowCardsProps = {}) {
  const stage = useLearnFlowStore((s) => s.stage);
  const proposal = useLearnFlowStore((s) => s.proposal);
  const topic = useLearnFlowStore((s) => s.topic);
  const storeArtifacts = useLearnFlowStore((s) => s.artifacts);
  const experienceMode = useLearnFlowStore((s) => s.experienceMode);
  const outlineUnits = useLearnFlowStore((s) => s.outlineUnits);
  const calibrationSelected = useLearnFlowStore((s) => s.calibrationSelected);
  const calibrationSelectedIndices = useLearnFlowStore((s) => s.calibrationSelectedIndices);
  const midFlowHint = useLearnFlowStore((s) => s.midFlowHint);
  const desktopEvents = useLearnFlowStore((s) => s.desktopEvents);
  const loading = useLearnFlowStore((s) => s.loading);
  const storeError = useLearnFlowStore((s) => s.error);
  const confirmIntent = useLearnFlowStore((s) => s.confirmIntent);
  const rejectIntent = useLearnFlowStore((s) => s.rejectIntent);
  const continueFromMemory = useLearnFlowStore((s) => s.continueFromMemory);
  const selectCalibration = useLearnFlowStore((s) => s.selectCalibration);
  const toggleCalibrationOption = useLearnFlowStore((s) => s.toggleCalibrationOption);
  const submitMultiCalibration = useLearnFlowStore((s) => s.submitMultiCalibration);
  const callOrchestrator = useLearnFlowStore((s) => s.callOrchestrator);
  const advanceFromResources = useLearnFlowStore((s) => s.advanceFromResources);
  const confirmTrustElevation = useLearnFlowStore((s) => s.confirmTrustElevation);
  const rejectTrustElevation = useLearnFlowStore((s) => s.rejectTrustElevation);
  const setCourseAndSession = useLearnFlowStore((s) => s.setCourseAndSession);
  const setOutlineUnitsPreview = useLearnFlowStore((s) => s.setOutlineUnitsPreview);
  const reset = useLearnFlowStore((s) => s.reset);

  const providerId = useSettingsStore((s) => s.settings.providerId);
  const createCourse = useLearningStore((s) => s.createCourse);
  const createLearningPathFromOutline = useLearningStore((s) => s.createLearningPathFromOutline);
  const createSession = useLearningStore((s) => s.createSession);
  const setActiveSession = useLearningStore((s) => s.setActiveSession);
  const setActiveAppView = useUIStore((s) => s.setActiveAppView);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const liveStatus = showLiveStatus ?? interactive;
  const artifacts =
    artifactsOverride != null ? artifactsOverride : storeArtifacts;
  const pendingTrust = desktopEvents.filter((e) => e.kind === 'pending_tool_confirm').slice(-1)[0];
  const showTrust =
    interactive &&
    !suppressTrustUi &&
    Boolean(pendingTrust && stage === 'desktop_pending_trust');

  const mode =
    experienceMode ||
    (stage === 'idle' || stage === 'rejected' ? 'chat' : 'deep_planning');

  const visibleArtifacts = useMemo(
    () => filterVisibleArtifacts(artifacts, { experienceMode: mode }),
    [artifacts, mode],
  );

  /** Sole course commit:「开始学习」only — outline edits never persist. */
  const handleStartSession = async () => {
    if (!interactive) return;
    setStarting(true);
    setStartError(null);
    try {
      const gate = canCommitCourseStart({
        stage,
        outlineUnits,
        confirmed: true,
      });
      if (!gate.ok) {
        throw new Error(gate.reason);
      }
      await useLearningStore.getState().load();
      const course = await createCourse(
        `${topic} 学习`,
        `由对话确认的学习计划：${proposal.slice(0, 120)}`,
      );
      await createLearningPathFromOutline({
        courseId: course.id,
        goalTitle: `掌握 ${topic}`,
        goalDescription: proposal.slice(0, 200),
        units: outlineUnits,
      });
      const data = useLearningStore.getState().data;
      // Prefer a non-suggestion task; never auto-confirm pending_suggestion here.
      // Calendar schedule writes require their own explicit confirm (batch-05).
      const task =
        data.tasks.find(
          (t) =>
            t.courseId === course.id &&
            t.status !== 'done' &&
            t.status !== 'completed' &&
            t.status !== 'pending_suggestion',
        ) ??
        data.tasks.find(
          (t) =>
            t.courseId === course.id && t.status !== 'pending_suggestion',
        );

      const session = await createSession({
        courseId: course.id,
        taskId: task?.id,
        notes: `开始学习: ${topic}`,
      });
      setActiveSession(session);
      setCourseAndSession(course.id, session.id);
      const nav = courseCommitNavigation(course.id, session.id);
      setActiveAppView('session', {
        courseId: nav.courseId,
        sessionId: session.id,
      });
      reset();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : '无法开始学习');
    } finally {
      setStarting(false);
    }
  };

  const noop = () => {
    /* historical turn — not interactive */
  };

  if (stage === 'idle' || stage === 'rejected') {
    if (
      !showTrust &&
      !(interactive && desktopEvents.length > 0) &&
      visibleArtifacts.length === 0
    ) {
      if (!(liveStatus && loading) && !(liveStatus && storeError)) {
        if (visibleArtifacts.length === 0) return null;
      }
    }
  }

  if (
    visibleArtifacts.length === 0 &&
    !(liveStatus && loading) &&
    !(liveStatus && midFlowHint) &&
    !(liveStatus && storeError) &&
    !showTrust
  ) {
    return null;
  }

  return (
    <div
      className="space-y-3 w-full mt-3"
      data-testid="learn-flow-cards"
      data-turn-id={turnId || undefined}
      data-interactive={interactive ? 'true' : 'false'}
    >
      {liveStatus && loading && (
        <p className="font-zh text-xs text-[var(--text-muted)] animate-pulse">正在准备…</p>
      )}
      {liveStatus && storeError && (
        <p
          className="font-zh text-xs text-[var(--error)] border border-[var(--error-border)] bg-[var(--error-bg)] px-3 py-2"
          data-testid="turn-learn-error"
        >
          {storeError}
        </p>
      )}
      {liveStatus && midFlowHint && (
        <p className="font-zh text-xs text-amber-700 border border-amber-500/40 bg-amber-50/80 px-3 py-2">
          {midFlowHint}
        </p>
      )}

      {showTrust && pendingTrust && (
        <section className="border border-amber-500/40 bg-[var(--bg-primary)]/90 p-4 space-y-3">
          <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">
            Minus 想访问本机权限
          </h3>
          <p className="font-zh text-xs text-[var(--text-secondary)] whitespace-pre-wrap">
            {pendingTrust.content ||
              '需要你确认后才会使用本机更高权限；之后的敏感操作仍会单独请你确认。'}
          </p>
          <p className="font-zh text-[10px] text-[var(--text-muted)]">
            允许本机权限不会自动批准全部危险操作。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmTrustElevation}
              className="min-h-[44px] px-3 py-1.5 bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] font-zh text-xs font-bold border border-[var(--border)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              允许一次
            </button>
            <button
              type="button"
              onClick={rejectTrustElevation}
              className="min-h-[44px] px-3 py-1.5 border border-[var(--border)] font-zh text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              不允许
            </button>
          </div>
        </section>
      )}

      {visibleArtifacts.map((artifact) => (
        <ArtifactCard
          key={artifact.id}
          artifact={artifact}
          stage={interactive ? stage : 'idle'}
          calibrationSelected={interactive ? calibrationSelected : null}
          calibrationSelectedIndices={
            interactive ? calibrationSelectedIndices : []
          }
          onConfirmIntent={
            interactive ? () => void confirmIntent(providerId) : noop
          }
          onRejectIntent={
            interactive ? () => void rejectIntent(providerId) : noop
          }
          onContinueMemory={
            interactive ? () => void continueFromMemory(providerId) : noop
          }
          onSelectCalibration={(i) => {
            if (!interactive) return;
            const opt = (artifact.options || [])[i];
            if (!opt) return;
            // Multi is handled by onToggleMulti — single auto-continues with real user msg.
            if (artifact.kind === 'multi_choice') {
              toggleCalibrationOption(i);
              return;
            }
            void withUserMessageTurn(opt, () => selectCalibration(i, providerId));
          }}
          onToggleMulti={(i) => {
            if (!interactive) return;
            toggleCalibrationOption(i);
          }}
          onSubmitMulti={() => {
            if (!interactive) return;
            const opts = artifact.options || [];
            const answers = calibrationSelectedIndices
              .map((i) => opts[i])
              .filter((x): x is string => Boolean(x));
            const answer = answers.join('；');
            if (!answer) return;
            void withUserMessageTurn(answer, () =>
              submitMultiCalibration(providerId),
            );
          }}
          onCustomClarify={(text) => {
            if (!interactive) return;
            if (isPlaceholderGoal(text) &&
              (artifact.clarification?.field === 'topic' ||
                artifact.clarification?.field === 'goal')) {
              return;
            }
            void withUserMessageTurn(text, async () => {
              const clarifyField = artifact.clarification?.field;
              const lf = useLearnFlowStore.getState();
              if (clarifyField === 'topic' || clarifyField === 'goal') {
                lf.setModePreference(lf.modePreference || 'deep');
                await callOrchestrator(text, 'intent', providerId, {
                  userModePreference: 'deep',
                  knownGoal: text,
                });
                return;
              }
              if (clarifyField === 'level') {
                await callOrchestrator(text, 'select_calibration', providerId, {
                  calibrationAnswer: text,
                  knownLevel: text,
                  knownGoal: lf.topic || undefined,
                  userModePreference: 'deep',
                });
                return;
              }
              await callOrchestrator(text, 'intent', providerId, {
                userModePreference: lf.modePreference,
              });
            });
          }}
          onAdvanceResources={
            interactive
              ? () => void advanceFromResources(providerId)
              : noop
          }
          onStartSession={
            interactive ? () => void handleStartSession() : noop
          }
          starting={interactive ? starting : false}
          startError={interactive ? startError : null}
          outlineUnits={
            interactive
              ? outlineUnits
              : artifact.units || []
          }
          onOutlineChange={
            interactive ? setOutlineUnitsPreview : () => undefined
          }
        />
      ))}
    </div>
  );
}

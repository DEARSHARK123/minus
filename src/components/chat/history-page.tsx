'use client';

/**
 * UX06 — Dual-tab history: chat goals + learning sessions.
 * Titles = user goals; short outcomes + unfinished.
 * Resume is context-only — never auto-replays tools.
 * No message counts / Session IDs / repetitive safety essays on primary UI.
 */

import { useEffect, useMemo, useState } from 'react';
import { useLearningStore } from '@/store/learning-store';
import { useChatStore } from '@/store/chat-store';
import { useUIStore } from '@/store/ui-store';
import { LearningHistory } from '@/components/learning/history';
import { ErrorBanner } from '@/components/learning/shared';
import { EntityActionsMenu } from '@/components/ui/entity-actions-menu';
import {
  assertSafeResume,
  buildChatIntelligence,
  buildSafeResumePayload,
} from '@/lib/chat/history-intelligence';
import {
  selectContinuation,
  type ContinuationContext,
} from '@/lib/chat/continuation-selector';
import { appNavigate, chatPath } from '@/lib/navigation';

type HistoryTab = 'chat' | 'learning';

export function HistoryPage() {
  const [tab, setTab] = useState<HistoryTab>('chat');
  const [resumeError, setResumeError] = useState<string | null>(null);
  const load = useLearningStore((s) => s.load);
  const error = useLearningStore((s) => s.error);
  const clearError = useLearningStore((s) => s.clearError);
  const learningData = useLearningStore((s) => s.data);
  const setActiveSession = useLearningStore((s) => s.setActiveSession);
  const setActiveTaskId = useLearningStore((s) => s.setActiveTaskId);
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeConversationId);
  const switchConversation = useChatStore((s) => s.switchConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const openDraft = useChatStore((s) => s.openDraft);
  const setActiveAppView = useUIStore((s) => s.setActiveAppView);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedChats = useMemo(
    () =>
      [...conversations]
        .filter((c) => c.messages.length > 0)
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
    [conversations],
  );

  const chatIntel = useMemo(
    () => sortedChats.map((c) => buildChatIntelligence(c)),
    [sortedChats],
  );

  const continuationCtx: ContinuationContext = useMemo(
    () => ({
      sessions: learningData.sessions.map((s) => ({
        id: s.id,
        courseId: s.courseId,
        taskId: s.taskId,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
      })),
    }),
    [learningData.sessions],
  );

  const primaryContinuation = useMemo(
    () => selectContinuation(learningData.tasks, 'history', continuationCtx),
    [learningData.tasks, continuationCtx],
  );

  const handleOpenChat = (conversationId: string) => {
    const intel = chatIntel.find((i) => i.id === conversationId);
    setResumeError(null);
    try {
      if (intel) {
        assertSafeResume(intel);
        const payload = buildSafeResumePayload(intel);
        if (payload.autoReplayTools !== false) {
          throw new Error('恢复策略不安全');
        }
        if (intel.title && intel.title !== '新对话' && intel.title !== '未命名对话') {
          const conv = conversations.find((c) => c.id === conversationId);
          if (conv && (!conv.title || conv.title === '新对话')) {
            renameConversation(conversationId, intel.title);
          }
        }
      }
    } catch {
      setResumeError('无法安全恢复这段对话。历史内容仍保留，请稍后重试。');
      return;
    }
    // Context-only: switch conversation + go home. No tool / agent replay.
    switchConversation(conversationId);
    appNavigate(chatPath(conversationId));
    setActiveAppView('home', { conversationId, fromRoute: true });
  };

  const handlePrimaryContinue = () => {
    if (!primaryContinuation) {
      setTab('learning');
      return;
    }
    const link = primaryContinuation.deepLink;
    if (link.courseId) {
      appNavigate(link.href);
      setActiveAppView('session', {
        courseId: link.courseId,
        sessionId: link.sessionId ?? null,
        fromRoute: true,
      });
      if (link.sessionId) {
        const session = learningData.sessions.find((s) => s.id === link.sessionId);
        if (session) {
          setActiveSession(session);
          setActiveTaskId(session.taskId ?? link.taskId ?? null);
        }
      }
      return;
    }
    setActiveAppView('home');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b border-[var(--border-20)] bg-[var(--surface)]/80 px-4 py-3 flex items-center justify-center gap-2">
        <div className="flex rounded-xl bg-[var(--surface-soft)] p-1">
          <button
            type="button"
            onClick={() => setTab('chat')}
            className={`min-h-[36px] rounded-lg px-4 py-1.5 font-zh text-xs ${
              tab === 'chat'
                ? 'bg-[var(--surface-elevated)] text-[var(--text-primary)] font-bold shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            对话
          </button>
          <button
            type="button"
            onClick={() => setTab('learning')}
            className={`min-h-[36px] rounded-lg px-4 py-1.5 font-zh text-xs ${
              tab === 'learning'
                ? 'bg-[var(--surface-elevated)] text-[var(--text-primary)] font-bold shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            学习
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {error && (
          <div className="p-4">
            <ErrorBanner message={error} onDismiss={clearError} />
          </div>
        )}
        {resumeError && (
          <div className="px-4 pt-4 max-w-3xl mx-auto w-full">
            <ErrorBanner message={resumeError} onDismiss={() => setResumeError(null)} />
          </div>
        )}

        {tab === 'chat' ? (
          <div className="p-4 sm:p-6 space-y-4 max-w-4xl mx-auto w-full">
            {primaryContinuation && (
              <div
                className="surface-card flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
                data-testid="history-chat-continue"
              >
                <p className="font-zh text-sm font-bold text-[var(--text-primary)] truncate">
                  {primaryContinuation.label}
                </p>
                <button
                  type="button"
                  onClick={handlePrimaryContinue}
                  className="min-h-[40px] rounded-lg bg-[var(--user-bubble-bg)] px-4 py-2 font-zh text-xs font-bold text-[var(--user-bubble-text)] hover:opacity-90"
                >
                  继续学习
                </button>
              </div>
            )}

            {sortedChats.length === 0 ? (
              <div className="space-y-3">
                <p className="soft-card font-zh text-sm text-[var(--text-muted)] px-4 py-10 text-center">
                  暂无对话记录
                </p>
                <div className="flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveAppView('home')}
                    className="px-3 py-1.5 font-zh text-xs border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                  >
                    前往主页
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveAppView('library')}
                    className="px-3 py-1.5 font-zh text-xs border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                  >
                    前往资料库
                  </button>
                </div>
              </div>
            ) : (
              <ul className="space-y-3" data-testid="history-chat-list">
                {chatIntel.map((intel) => {
                  const active = intel.id === activeId;
                  return (
                    <li key={intel.id} className="surface-card flex items-stretch gap-1 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => handleOpenChat(intel.id)}
                        className={`flex-1 text-left px-4 py-4 transition-colors min-h-[72px] ${
                          active
                            ? 'bg-[var(--accent-soft)]'
                            : 'hover:bg-[var(--surface-soft)]'
                        }`}
                      >
                        <p className="font-zh text-sm font-bold text-[var(--text-primary)] truncate">
                          {intel.title}
                        </p>
                        <p className="font-zh text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">
                          {intel.summary}
                        </p>
                        {(intel.decisions.length > 0 ||
                          intel.incomplete.length > 0) && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {intel.incomplete.slice(0, 2).map((item, index) => (
                              <span
                                key={`${intel.id}-incomplete-${index}-${item.label}`}
                                className="font-zh text-[10px] px-1.5 py-0.5 border border-amber-500/40 text-amber-600"
                              >
                                {item.label}
                              </span>
                            ))}
                            {intel.decisions.slice(0, 2).map((d, index) => (
                              <span
                                key={`${intel.id}-decision-${index}-${d.label}`}
                                className="font-zh text-[10px] px-1.5 py-0.5 border border-[var(--border-20)] text-[var(--text-muted)]"
                              >
                                {d.label}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                      <EntityActionsMenu
                        label={intel.title}
                        onRename={() => {
                          const next = window.prompt('新的对话名称', intel.title)?.trim();
                          if (next) renameConversation(intel.id, next);
                        }}
                        onDelete={() => {
                          if (window.confirm(`删除「${intel.title}」？此操作不可撤销。`)) {
                            const wasActive = intel.id === activeId;
                            deleteConversation(intel.id);
                            // Batch-06: deleting current → unpersisted /chat draft.
                            if (wasActive) {
                              openDraft();
                              appNavigate(chatPath());
                              setActiveAppView('home', { fromRoute: true });
                            }
                          }
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <LearningHistory />
        )}
      </div>
    </div>
  );
}

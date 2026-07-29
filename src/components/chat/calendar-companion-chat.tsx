'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, Send, Trash2 } from 'lucide-react';
import type { CalendarAssistantResult } from '@/lib/learning/calendar-assistant';
import type { ModelFailureCode } from '@/lib/llm/errors';
import { useSettingsStore } from '@/store/settings-store';
import type { ApiResponse, PlanProposal } from '@/types/learning';

type CalendarChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type FailedRequest = {
  input: string;
  messages: CalendarChatMessage[];
};

type CalendarCompanionChatProps = {
  courseId: string | null;
  courseTitle?: string;
  proposal: PlanProposal | null;
  onProposalChange: (proposal: PlanProposal) => void;
};

const STORAGE_PREFIX = 'minus.calendar-companion-chat.v1';
const MAX_STORED_MESSAGES = 60;
const MAX_CONTEXT_MESSAGES = 12;
const DEFAULT_SUGGESTIONS = [
  '这周只安排在工作日晚上',
  '每天控制在 60 分钟内',
  '把当前草案安排得更均匀',
] as const;

type CalendarAssistantFailureCode = ModelFailureCode | 'MODEL_TIMEOUT';

const CALENDAR_ASSISTANT_ERROR_COPY: Record<CalendarAssistantFailureCode, string> = {
  MODEL_NETWORK_ERROR: '暂时无法连接模型服务，请检查网络或代理后重试。',
  MODEL_AUTH_ERROR: '模型认证失败，请检查设置中的 API Key。',
  MODEL_RATE_LIMIT: '模型请求过多或额度暂不可用，请稍后重试或切换模型。',
  MODEL_UNAVAILABLE: '模型服务暂时不可用，请稍后重试或切换模型。',
  MODEL_INVALID_RESPONSE: '模型返回格式不符合要求，请重试或切换模型。',
  MODEL_TIMEOUT: '学习伴侣响应超时，请重试或切换模型。',
};

function calendarAssistantErrorMessage(response: ApiResponse<unknown>): string {
  if (response.success) return '暂时无法调整安排，请稍后重试。';
  const details = response.details;
  const code =
    details && typeof details === 'object' && 'code' in details
      ? (details as { code?: unknown }).code
      : undefined;
  if (typeof code === 'string' && code in CALENDAR_ASSISTANT_ERROR_COPY) {
    return CALENDAR_ASSISTANT_ERROR_COPY[code as CalendarAssistantFailureCode];
  }
  return '暂时无法调整安排，请稍后重试。';
}

function storageKey(courseId: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(courseId)}`;
}

function newMessageId(role: CalendarChatMessage['role']): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `calendar_${role}_${suffix}`;
}

function readStoredMessages(courseId: string | null): CalendarChatMessage[] {
  if (!courseId || typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(storageKey(courseId)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (message): message is CalendarChatMessage =>
          Boolean(message) &&
          typeof message.id === 'string' &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string' &&
          message.content.trim().length > 0,
      )
      .slice(-MAX_STORED_MESSAGES);
  } catch {
    return [];
  }
}

function assistantSuggestions(input: unknown): string[] {
  const dynamic = Array.isArray(input)
    ? input.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    : [];
  return [...new Set([...dynamic.map((item) => item.trim()), ...DEFAULT_SUGGESTIONS])].slice(
    0,
    3,
  );
}

export function CalendarCompanionChat({
  courseId,
  courseTitle,
  proposal,
  onProposalChange,
}: CalendarCompanionChatProps) {
  const providerId = useSettingsStore((state) => state.settings.providerId);
  const systemPrompt = useSettingsStore((state) => state.settings.systemPrompt);
  const [loadedCourseId, setLoadedCourseId] = useState<string | null>(courseId);
  const [messages, setMessages] = useState<CalendarChatMessage[]>(() =>
    readStoredMessages(courseId),
  );
  const [suggestions, setSuggestions] = useState<string[]>([...DEFAULT_SUGGESTIONS]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [failedRequest, setFailedRequest] = useState<FailedRequest | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (loadedCourseId === courseId) return;
    abortRef.current?.abort();
    generationRef.current += 1;
    const nextMessages = readStoredMessages(courseId);
    queueMicrotask(() => {
      setLoadedCourseId(courseId);
      setMessages(nextMessages);
      setSuggestions([...DEFAULT_SUGGESTIONS]);
      setInput('');
      setBusy(false);
      setError(null);
      setDraftNotice(null);
      setFailedRequest(null);
    });
  }, [courseId, loadedCourseId]);

  useEffect(() => {
    if (!courseId || loadedCourseId !== courseId || typeof window === 'undefined') return;
    window.sessionStorage.setItem(
      storageKey(courseId),
      JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)),
    );
  }, [courseId, loadedCourseId, messages]);

  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [busy, messages]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      abortRef.current?.abort();
    },
    [],
  );

  const requestAssistant = useCallback(
    async (requestMessages: CalendarChatMessage[], originalInput: string) => {
      if (!courseId) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      setBusy(true);
      setError(null);
      setDraftNotice(null);
      setFailedRequest(null);

      try {
        const response = await fetch('/api/learning', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'calendarAssistant',
            payload: {
              courseId,
              providerId,
              systemPrompt,
              messages: requestMessages.slice(-MAX_CONTEXT_MESSAGES).map(({ role, content }) => ({
                role,
                content,
              })),
              proposal,
            },
          }),
          signal: controller.signal,
        });

        let json: ApiResponse<CalendarAssistantResult>;
        try {
          json = (await response.json()) as ApiResponse<CalendarAssistantResult>;
        } catch {
          throw new Error('学习伴侣返回异常，请稍后重试。');
        }
        if (!json.success) {
          throw new Error(calendarAssistantErrorMessage(json));
        }
        if (!response.ok || !json.data) {
          throw new Error('学习伴侣暂时不可用，请稍后重试。');
        }
        if (generationRef.current !== generation || controller.signal.aborted) return;

        const result = json.data;
        const reply = result.reply?.trim() || '我已查看当前安排，但还需要更具体的调整要求。';
        const assistantMessage: CalendarChatMessage = {
          id: newMessageId('assistant'),
          role: 'assistant',
          content: reply,
        };
        setMessages((current) => [...current, assistantMessage].slice(-MAX_STORED_MESSAGES));
        setSuggestions(assistantSuggestions(result.suggestions));
        if (result.proposal) {
          onProposalChange(result.proposal);
          setDraftNotice(
            result.issues.length > 0
              ? `草案已更新，仍有 ${result.issues.length} 项冲突需要处理。`
              : result.action === 'replan' && proposal
                ? '已按新要求重建草案，确认前不会写入日历。'
                : '草案已更新，确认前不会写入日历。',
          );
        }
        setInput((current) => (current.trim() === originalInput.trim() ? '' : current));
      } catch (requestError) {
        if (
          controller.signal.aborted ||
          generationRef.current !== generation ||
          (requestError instanceof DOMException && requestError.name === 'AbortError')
        ) {
          return;
        }
        const message =
          requestError instanceof Error ? requestError.message : '暂时无法调整安排，请稍后重试。';
        setError(message);
        setFailedRequest({ input: originalInput, messages: requestMessages });
      } finally {
        if (generationRef.current === generation) {
          setBusy(false);
          if (abortRef.current === controller) abortRef.current = null;
        }
      }
    },
    [courseId, onProposalChange, proposal, providerId, systemPrompt],
  );

  const submitText = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!courseId || !text || busy) return;
      const userMessage: CalendarChatMessage = {
        id: newMessageId('user'),
        role: 'user',
        content: text,
      };
      const nextMessages = [...messages, userMessage].slice(-MAX_STORED_MESSAGES);
      setMessages(nextMessages);
      setInput((current) => (current.trim() === text ? '' : current));
      setError(null);
      setFailedRequest(null);
      void requestAssistant(nextMessages, text);
    },
    [busy, courseId, messages, requestAssistant],
  );

  const failedInput = failedRequest?.input.trim();
  const visibleSuggestions = suggestions
    .filter((suggestion) => suggestion.trim() !== failedInput)
    .slice(0, 3);

  const clearConversation = () => {
    abortRef.current?.abort();
    generationRef.current += 1;
    setMessages([]);
    setSuggestions([...DEFAULT_SUGGESTIONS]);
    setInput('');
    setBusy(false);
    setError(null);
    setDraftNotice(null);
    setFailedRequest(null);
    if (courseId && typeof window !== 'undefined') {
      window.sessionStorage.removeItem(storageKey(courseId));
    }
  };

  return (
    <section
      className="min-w-0 border-t border-[var(--border-20)] pt-3 font-zh"
      aria-label="与学习伴侣对话调整日程"
      data-testid="calendar-companion-chat"
    >
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-[var(--text-primary)]">对话调整</h3>
          <p className="truncate text-[10px] text-[var(--text-muted)]">
            {courseId
              ? `${courseTitle || '当前课程'} · 待确认草案`
              : '请先选择要规划的课程'}
          </p>
        </div>
        <button
          type="button"
          onClick={clearConversation}
          disabled={messages.length === 0 && !input && !error}
          className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          aria-label="清空学习伴侣对话"
          title="清空对话"
          data-testid="calendar-assistant-clear"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div
        ref={messagesViewportRef}
        className="max-h-56 space-y-2 overflow-y-auto overscroll-contain pr-1"
        aria-live="polite"
        data-testid="calendar-assistant-messages"
      >
        {messages.length === 0 && (
          <p className="py-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            今天想怎么调整学习安排？
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === 'user'
                ? 'ml-5 rounded-lg bg-[var(--accent-soft)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--text-primary)]'
                : 'mr-2 border-l-2 border-[var(--accent)]/50 py-1 pl-2.5 text-[11px] leading-relaxed text-[var(--text-secondary)]'
            }
            data-testid={`calendar-assistant-message-${message.role}`}
          >
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.content}</p>
          </div>
        ))}
        {busy && (
          <div
            className="flex items-center gap-2 py-1 text-[11px] text-[var(--text-muted)]"
            role="status"
            data-testid="calendar-assistant-loading"
          >
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
            正在查看当前安排…
          </div>
        )}
      </div>

      {error && (
        <div
          className="mt-2 border-l-2 border-[var(--error)] bg-[var(--error-bg)] px-2.5 py-2"
          role="alert"
          data-testid="calendar-assistant-error"
        >
          <p className="text-[11px] leading-relaxed text-[var(--error)]">{error}</p>
          {failedRequest && (
            <button
              type="button"
              onClick={() => void requestAssistant(failedRequest.messages, failedRequest.input)}
              disabled={busy}
              className="mt-1 min-h-8 rounded-md px-2 text-[11px] font-bold text-[var(--error)] underline underline-offset-2 hover:bg-white/40 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              data-testid="calendar-assistant-retry"
            >
              重试这次调整
            </button>
          )}
        </div>
      )}

      {draftNotice && (
        <p
          className="mt-2 border-l-2 border-[var(--success)] bg-[var(--success-bg)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]"
          role="status"
          data-testid="calendar-assistant-draft-notice"
        >
          {draftNotice}
        </p>
      )}

      <div
        className="mt-2 flex flex-col gap-1.5"
        aria-label="快捷调整"
        data-testid="calendar-assistant-suggestions"
      >
        {visibleSuggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => submitText(suggestion)}
            disabled={!courseId || busy}
            className="min-h-9 w-full rounded-lg border border-[var(--border-20)] px-2.5 py-1.5 text-left text-[11px] leading-4 text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/50 hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <form
        className="mt-2 flex min-w-0 items-end gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          submitText(input);
        }}
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submitText(input);
            }
          }}
          disabled={!courseId || busy}
          rows={2}
          maxLength={1200}
          placeholder={courseId ? '例如：周三不要安排，改到周五晚上' : '请先选择课程'}
          aria-label="告诉学习伴侣如何调整日程"
          className="min-h-[64px] min-w-0 flex-1 resize-y rounded-lg border border-[var(--border-20)] bg-[var(--surface)] px-2.5 py-2 text-[12px] leading-5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="calendar-assistant-input"
        />
        <button
          type="submit"
          disabled={!courseId || busy || !input.trim()}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
          aria-label={busy ? '正在调整日程' : '发送调整要求'}
          data-testid="calendar-assistant-send"
        >
          {busy ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
        </button>
      </form>
    </section>
  );
}

'use client';

import { useState, useRef, useEffect, useMemo, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Sidebar } from './sidebar';
import { SettingsModal } from '../settings/settings-modal';
import { useUIStore } from '@/store/ui-store';
import { useChatStore } from '@/store/chat-store';
import { useLearningStore } from '@/store/learning-store';
import { PanelLeft, User, Search, MessageSquare, BookOpen, FileText, CalendarDays } from 'lucide-react';
import { iconSizes } from '@/lib/icons';
import {
  bindAppRouter,
  unbindAppRouter,
  parseAppPath,
  chatPath,
  coursePath,
  conversationHasContent,
} from '@/lib/navigation';
import {
  navAsDrawer,
  shellLayoutMode,
  type ShellLayoutMode,
} from '@/lib/ui/layout-breakpoints';
import { requestEntitySelection } from '@/lib/navigation/entity-selection';
import { useFocusTrap } from '@/lib/ui/use-focus-trap';

/**
 * Product chrome: sidebar + header + main.
 * Visible page content comes from App Router `children` (URL is SoT).
 * activeAppView is kept as a compatibility mirror only.
 *
 * UX07 responsive:
 * ≥1200 full nav | 768–1199 collapsible | <768 drawer overlay
 */
export function AppShell({ children }: { children: ReactNode }) {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const showSettings = useUIStore((s) => s.showSettings);
  const activeAppView = useUIStore((s) => s.activeAppView);
  const syncActiveAppViewFromRoute = useUIStore((s) => s.syncActiveAppViewFromRoute);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const openSettings = useUIStore((s) => s.openSettings);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const learningData = useLearningStore((s) => s.data);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;

  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [layoutMode, setLayoutMode] = useState<ShellLayoutMode>('desktop');
  /** Open only while token matches current route — route change auto-closes (no effect). */
  const [mobileNavRouteToken, setMobileNavRouteToken] = useState<string | null>(
    null,
  );
  const [expandedInlineNavRouteToken, setExpandedInlineNavRouteToken] = useState<
    string | null
  >(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const commandDialogRef = useRef<HTMLElement>(null);
  useFocusTrap(commandDialogRef, {
    enabled: commandOpen,
    onEscape: () => setCommandOpen(false),
  });

  useEffect(() => {
    const update = () => {
      const w = typeof window !== 'undefined' ? window.innerWidth : 1440;
      setLayoutMode(shellLayoutMode(w));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
      } else if (event.key === 'Escape') {
        setCommandOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!commandOpen) return;
    requestAnimationFrame(() => commandInputRef.current?.focus());
  }, [commandOpen]);

  const isMobileDrawer = navAsDrawer(layoutMode);
  const mobileNavOpen = mobileNavRouteToken === routeKey;
  const inlineNavDefaultsCollapsed =
    layoutMode === 'tablet' ||
    activeAppView === 'session' ||
    activeAppView === 'calendar';
  const inlineNavExpanded = expandedInlineNavRouteToken === routeKey;
  const effectiveSidebarCollapsed = inlineNavDefaultsCollapsed
    ? !inlineNavExpanded
    : sidebarCollapsed;
  const setMobileNavOpen = (open: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof open === 'function' ? open(mobileNavOpen) : open;
    setMobileNavRouteToken(next ? routeKey : null);
  };

  // Bind imperative navigation for setActiveAppView adapter.
  useEffect(() => {
    bindAppRouter({
      push: (href) => router.push(href),
      replace: (href) => router.replace(href),
    });
    return () => unbindAppRouter();
  }, [router]);

  /**
   * URL → store + restore conversation/course.
   * Depends only on routeKey so first-send store updates cannot wipe draft intent
   * or fight URL pinning (back/forward stays correct).
   */
  useEffect(() => {
    const route = parseAppPath(pathname, searchParams);
    syncActiveAppViewFromRoute(route.view);

    if (route.view === 'home') {
      const wantId = route.conversationId;
      if (!wantId) {
        // Draft URL is SoT: clear active selection without creating a conversation.
        useChatStore.getState().openDraft();
        return;
      }
      const { conversations, activeConversationId: activeId, switchConversation, openDraft } =
        useChatStore.getState();
      const exists = conversations.some(
        (c) => c.id === wantId && conversationHasContent(c),
      );
      if (exists) {
        if (activeId !== wantId) {
          switchConversation(wantId);
        }
      } else {
        openDraft();
        router.replace(chatPath());
      }
      return;
    }

    if (route.view === 'session') {
      void (async () => {
        await useLearningStore.getState().load();
        const { data, setActiveSession, setActiveTaskId, setSelectedCourseId } =
          useLearningStore.getState();
        const courseExists = data.courses.some((c) => c.id === route.courseId);
        if (!courseExists) {
          // Keep the deep link visible so the route can show its generic
          // course title and empty state instead of silently changing context.
          setSelectedCourseId(route.courseId);
          setActiveSession(null);
          setActiveTaskId(null);
          return;
        }
        const session =
          (route.sessionId
            ? data.sessions.find((s) => s.id === route.sessionId)
            : undefined) ??
          data.sessions
            .filter((s) => s.courseId === route.courseId)
            .sort(
              (a, b) =>
                Date.parse(b.startedAt) - Date.parse(a.startedAt),
            )[0] ??
          null;

        if (session) {
          setSelectedCourseId(route.courseId);
          setActiveSession(session);
          setActiveTaskId(session.taskId ?? null);
        } else {
          setSelectedCourseId(route.courseId);
          setActiveSession(null);
          setActiveTaskId(null);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- routeKey encodes pathname + search
  }, [routeKey, router, syncActiveAppViewFromRoute]);

  /**
   * After first message on draft, pin conversation id into URL (replace).
   * Only upgrades bare /chat → /chat?c=id (never fights an explicit other c=).
   */
  useEffect(() => {
    const route = parseAppPath(pathname, searchParams);
    if (route.view !== 'home') return;
    if (!activeConversationId) return;
    if (route.conversationId === activeConversationId) return;
    if (route.conversationId) return;
    const conv = useChatStore
      .getState()
      .conversations.find((c) => c.id === activeConversationId);
    if (!conversationHasContent(conv)) return;
    router.replace(chatPath(activeConversationId));
  }, [activeConversationId, pathname, searchParams, router]);

  const viewMeta: Record<string, { title: string; subtitle: string }> = {
    home: { title: '对话', subtitle: '提问、深入学习或调用本机工具' },
    library: { title: '资料库', subtitle: '整理资料并从内容开始学习' },
    calendar: { title: '学习日历', subtitle: '查看建议，确认后再写入安排' },
    video: { title: '视频', subtitle: '学习媒体' },
    history: { title: '历史', subtitle: '恢复对话与学习进度' },
    session: { title: '专注学习', subtitle: '按自己的节奏完成当前内容' },
  };
  const currentViewMeta = viewMeta[activeAppView] ?? {
    title: '工作台',
    subtitle: '本地智能学习器',
  };

  const commandResults = useMemo(() => {
    const query = commandQuery.trim().toLocaleLowerCase('zh-CN');
    if (!query) return [];
    const includes = (...values: Array<string | undefined>) =>
      values.some((value) => value?.toLocaleLowerCase('zh-CN').includes(query));

    const results: Array<{
      id: string;
      kind: 'chat' | 'course' | 'document' | 'task';
      title: string;
      detail: string;
    }> = [];
    conversations
      .filter((conversation) =>
        includes(
          conversation.title,
          conversation.messages.at(-1)?.content,
        ),
      )
      .slice(0, 4)
      .forEach((conversation) =>
        results.push({
          id: conversation.id,
          kind: 'chat',
          title: conversation.title || '未命名对话',
          detail: '对话',
        }),
      );
    learningData.courses
      .filter((course) => includes(course.title, course.description))
      .slice(0, 4)
      .forEach((course) =>
        results.push({
          id: course.id,
          kind: 'course',
          title: course.title,
          detail: '课程',
        }),
      );
    learningData.documents
      .filter((document) =>
        includes(document.title, document.summary, document.content.slice(0, 600)),
      )
      .slice(0, 4)
      .forEach((document) =>
        results.push({
          id: document.id,
          kind: 'document',
          title: document.title,
          detail:
            learningData.courses.find((course) => course.id === document.courseId)
              ?.title || '资料',
        }),
      );
    learningData.tasks
      .filter((task) => includes(task.title, task.description))
      .slice(0, 4)
      .forEach((task) =>
        results.push({
          id: task.id,
          kind: 'task',
          title: task.title,
          detail: '学习任务',
        }),
      );
    return results.slice(0, 10);
  }, [commandQuery, conversations, learningData]);

  const openCommandResult = (result: (typeof commandResults)[number]) => {
    setCommandOpen(false);
    setCommandQuery('');
    if (result.kind === 'chat') {
      useChatStore.getState().switchConversation(result.id);
      router.push(chatPath(result.id));
      return;
    }
    if (result.kind === 'course') {
      const session = [...learningData.sessions]
        .filter((item) => item.courseId === result.id)
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
      if (session) {
        useLearningStore.getState().setActiveSession(session);
        useLearningStore.getState().setActiveTaskId(session.taskId ?? null);
        router.push(coursePath(result.id, session.id));
      } else {
        useLearningStore.getState().setSelectedCourseId(result.id);
        requestEntitySelection({ kind: 'course', id: result.id });
        useUIStore.getState().setActiveAppView('library');
      }
      return;
    }
    if (result.kind === 'document') {
      const document = learningData.documents.find((item) => item.id === result.id);
      useLearningStore.getState().setSelectedCourseId(document?.courseId ?? null);
      requestEntitySelection({ kind: 'document', id: result.id });
      useUIStore.getState().setActiveAppView('library');
      return;
    }
    const task = learningData.tasks.find((item) => item.id === result.id);
    useLearningStore.getState().setSelectedCourseId(task?.courseId ?? null);
    requestEntitySelection({ kind: 'task', id: result.id });
    useUIStore.getState().setActiveAppView('calendar');
  };

  const handleNavToggle = () => {
    if (isMobileDrawer) {
      setMobileNavOpen((o) => !o);
    } else if (inlineNavDefaultsCollapsed) {
      setExpandedInlineNavRouteToken(inlineNavExpanded ? null : routeKey);
    } else {
      toggleSidebar();
    }
  };

  const navExpandedLabel = isMobileDrawer
    ? mobileNavOpen
      ? '关闭导航'
      : '打开导航'
    : effectiveSidebarCollapsed
      ? '展开侧栏'
      : '收起侧栏';

  return (
    <div
      className="flex h-screen bg-[var(--bg-secondary)]"
      data-layout={layoutMode}
      data-testid="app-shell"
    >
      {/* Desktop / tablet: inline sidebar */}
      {!isMobileDrawer && (
        <Sidebar collapsed={effectiveSidebarCollapsed} onToggle={handleNavToggle} />
      )}

      {/* Mobile: drawer overlay */}
      {isMobileDrawer && mobileNavOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden
            data-testid="nav-drawer-overlay"
          />
          <div
            className="fixed inset-y-0 left-0 z-50 shadow-xl"
            data-testid="nav-drawer"
          >
            <Sidebar
              collapsed={false}
              onToggle={() => setMobileNavOpen(false)}
            />
          </div>
        </>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 flex items-center justify-between px-3 sm:px-5 border-b border-[var(--border-20)] bg-[var(--surface)]">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleNavToggle}
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label={navExpandedLabel}
              aria-expanded={isMobileDrawer ? mobileNavOpen : !effectiveSidebarCollapsed}
              title={navExpandedLabel}
            >
              <PanelLeft size={iconSizes.md} aria-hidden />
            </button>

            <div className="min-w-0 flex flex-col">
              <span className="font-zh text-sm font-bold text-[var(--text-primary)] truncate">
                {currentViewMeta.title}
              </span>
              <span className="hidden sm:block font-zh text-xs text-[var(--text-muted)] truncate">
                {currentViewMeta.subtitle}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md px-3 text-[var(--text-muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]"
              aria-label="搜索对话、课程、资料和任务"
              title="搜索（Ctrl/⌘ K）"
            >
              <Search size={17} aria-hidden />
              <span className="hidden lg:inline font-zh text-xs">搜索</span>
              <kbd className="hidden xl:inline rounded-md border border-[var(--border-20)] bg-[var(--surface-soft)] px-1.5 py-0.5 font-tech text-[10px]">
                Ctrl K
              </kbd>
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => openSettings('model')}
                className="w-8 h-8 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-40)] transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                aria-label="打开设置"
              >
                <User size={iconSizes.sm} aria-hidden />
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 flex min-h-0">
          <main
            className="flex-1 flex flex-col bg-[var(--bg-secondary)] min-w-0 relative"
            aria-label="主内容"
            id="main-content"
          >
            <div className="relative flex-1 flex flex-col min-h-0">
              {children}
            </div>
          </main>
        </div>
      </div>

      {commandOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCommandOpen(false);
          }}
        >
          <section
            ref={commandDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="全局搜索"
            className="surface-card w-full max-w-2xl overflow-hidden"
          >
            <div className="flex items-center gap-3 border-b border-[var(--border-20)] px-4 py-3">
              <Search size={18} className="text-[var(--accent)]" aria-hidden />
              <input
                ref={commandInputRef}
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder="搜索对话、课程、资料或任务…"
                className="min-h-[44px] flex-1 bg-transparent font-zh text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                aria-label="搜索关键词"
              />
              <button
                type="button"
                onClick={() => setCommandOpen(false)}
                className="rounded-lg px-2 py-1 font-tech text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-soft)]"
              >
                ESC
              </button>
            </div>
            <div className="max-h-[52vh] overflow-y-auto p-2">
              {!commandQuery.trim() ? (
                <p className="px-4 py-8 text-center font-zh text-sm text-[var(--text-muted)]">
                  输入关键词，快速回到你的对话、课程和资料。
                </p>
              ) : commandResults.length === 0 ? (
                <p className="px-4 py-8 text-center font-zh text-sm text-[var(--text-muted)]">
                  没有找到匹配内容
                </p>
              ) : (
                <ul className="space-y-1" role="listbox" aria-label="搜索结果">
                  {commandResults.map((result) => {
                    const ResultIcon =
                      result.kind === 'chat'
                        ? MessageSquare
                        : result.kind === 'course'
                          ? BookOpen
                          : result.kind === 'document'
                            ? FileText
                            : CalendarDays;
                    return (
                      <li key={`${result.kind}-${result.id}`}>
                        <button
                          type="button"
                          onClick={() => openCommandResult(result)}
                          className="flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-[var(--surface-soft)] focus:bg-[var(--surface-soft)]"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                            <ResultIcon size={16} aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-zh text-sm font-bold text-[var(--text-primary)]">
                              {result.title}
                            </span>
                            <span className="mt-0.5 block truncate font-zh text-[11px] text-[var(--text-muted)]">
                              {result.detail}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}

      {showSettings && <SettingsModal />}
    </div>
  );
}

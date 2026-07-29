'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History as HistoryIcon,
  Home,
  LibraryBig,
  MessageSquare,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';
import { useUIStore, type AppView } from '@/store/ui-store';
import { useChatStore } from '@/store/chat-store';
import { useLearningStore } from '@/store/learning-store';
import { iconSizes } from '@/lib/icons';
import { MinusLogo } from '@/components/brand/minus-logo';
import { EntityActionsMenu } from '@/components/ui/entity-actions-menu';
import { appNavigate, chatPath, coursePath } from '@/lib/navigation';
import {
  SIDEBAR_RECENT_CAP,
  capSidebarConversations,
  capSidebarCourses,
  courseSidebarLabel,
} from '@/lib/chat/sidebar-recent';
import { latestSessionForCourse } from '@/lib/learning/entity-actions';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * B07: primary nav only promises shipped capability.
 * Video is hidden until a real player ships; metadata-only VideoPage is not primary.
 */
const NAV_ITEMS: Array<{
  id: Exclude<AppView, 'session' | 'video'>;
  label: string;
  icon: LucideIcon;
  description: string;
}> = [
  {
    id: 'home',
    label: '主页',
    icon: Home,
    description: '今天想了解什么',
  },
  {
    id: 'library',
    label: '资料库',
    icon: LibraryBig,
    description: '文件与资料',
  },
  {
    id: 'calendar',
    label: '日历',
    icon: CalendarDays,
    description: '学习安排',
  },
  {
    id: 'history',
    label: '历史',
    icon: HistoryIcon,
    description: '对话与进度',
  },
];

function truncateLabel(text: string, max = 22): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function CollapsibleSection({
  title,
  icon,
  open,
  onToggle,
  emptyHint,
  children,
  itemCount,
}: {
  title: string;
  icon: LucideIcon;
  open: boolean;
  onToggle: () => void;
  emptyHint: string;
  children: ReactNode;
  itemCount: number;
}) {
  const SectionIcon = icon;
  return (
    <div className="mt-3 pt-3 border-t border-[var(--border-20)]">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
        aria-expanded={open}
      >
        <SectionIcon size={16} className="opacity-70 shrink-0" aria-hidden />
        <span className="font-zh text-xs font-bold flex-1 text-left tracking-wide">
          {title}
        </span>
        {open ? (
          <ChevronDown size={14} className="opacity-60 shrink-0" aria-hidden />
        ) : (
          <ChevronRight size={14} className="opacity-60 shrink-0" aria-hidden />
        )}
      </button>
      {open && (
        <div className="mt-1 space-y-0.5" role="list">
          {itemCount === 0 ? (
            <p className="px-3 py-2 font-zh text-[11px] text-[var(--text-muted)] leading-relaxed">
              {emptyHint}
            </p>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const activeAppView = useUIStore((s) => s.activeAppView);
  const setActiveAppView = useUIStore((s) => s.setActiveAppView);
  const openSettings = useUIStore((s) => s.openSettings);

  const openDraft = useChatStore((s) => s.openDraft);
  const getRecentConversations = useChatStore((s) => s.getRecentConversations);
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const switchConversation = useChatStore((s) => s.switchConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  const loadLearning = useLearningStore((s) => s.load);
  const learningData = useLearningStore((s) => s.data);
  const activeSession = useLearningStore((s) => s.activeSession);
  const setActiveSession = useLearningStore((s) => s.setActiveSession);
  const setActiveTaskId = useLearningStore((s) => s.setActiveTaskId);
  const renameCourse = useLearningStore((s) => s.renameCourse);
  const archiveCourse = useLearningStore((s) => s.archiveCourse);
  const deleteCourse = useLearningStore((s) => s.deleteCourse);

  const [conversationsOpen, setConversationsOpen] = useState(true);
  const [coursesOpen, setCoursesOpen] = useState(false);

  useEffect(() => {
    void loadLearning();
  }, [loadLearning]);

  const selectedNav: Exclude<AppView, 'session' | 'video'> =
    activeAppView === 'session' || activeAppView === 'video'
      ? 'home'
      : activeAppView;

  // UX06: max 5 conversations + 查看全部; contentful only.
  const recentConversations = useMemo(() => {
    const capped = capSidebarConversations(conversations, SIDEBAR_RECENT_CAP);
    return capped;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, getRecentConversations]);

  const recentCourses = useMemo(() => {
    const sorted = [...learningData.courses].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    return capSidebarCourses(sorted, SIDEBAR_RECENT_CAP);
  }, [learningData.courses]);

  useEffect(() => {
    if (recentCourses.items.length === 0) return;
    queueMicrotask(() => setCoursesOpen(true));
  }, [recentCourses.items.length]);

  /** 主页 → unpersisted blank draft; never createConversation. */
  const handleOpenHome = () => {
    openDraft();
    appNavigate(chatPath());
    setActiveAppView('home', { fromRoute: true });
  };

  const handleOpenConversation = (id: string) => {
    switchConversation(id);
    appNavigate(chatPath(id));
    setActiveAppView('home', { fromRoute: true });
  };

  const handleDeleteConversation = (id: string) => {
    const wasActive = activeConversationId === id;
    deleteConversation(id);
    // Batch-06: deleting the current conversation → unpersisted /chat draft.
    if (wasActive) {
      openDraft();
      appNavigate(chatPath());
      setActiveAppView('home', { fromRoute: true });
    }
  };

  const handleOpenSession = (sessionId: string) => {
    const session = learningData.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    setActiveSession(session);
    setActiveTaskId(session.taskId ?? null);
    appNavigate(coursePath(session.courseId, session.id));
    setActiveAppView('session', {
      courseId: session.courseId,
      sessionId: session.id,
      fromRoute: true,
    });
  };

  /** Deep-link to latest Session for a real Course entity. */
  const handleOpenCourse = (courseId: string) => {
    const session = latestSessionForCourse(learningData.sessions, courseId);
    if (session) {
      handleOpenSession(session.id);
      return;
    }
    // No session yet — open history learning tab rather than inventing labels.
    setActiveAppView('history', { fromRoute: true });
  };

  const handleRenameCourse = async (courseId: string, currentTitle: string) => {
    const next = window.prompt('新的课程名称', currentTitle)?.trim();
    if (!next || next === currentTitle) return;
    try {
      await renameCourse(courseId, next);
    } catch {
      /* store error */
    }
  };

  const handleArchiveCourse = async (courseId: string, title: string) => {
    if (!window.confirm(`归档「${title}」？归档后可从资料库管理，侧栏将不再显示。`)) {
      return;
    }
    try {
      await archiveCourse(courseId, true);
    } catch {
      /* store error */
    }
  };

  const handleDeleteCourse = async (courseId: string, title: string) => {
    // Secondary confirmation for cascade delete (shared schema requires confirmCascade).
    if (!window.confirm(`删除课程「${title}」？`)) return;
    if (
      !window.confirm(
        `将一并删除该课程下的文档、任务与学习记录，且不可撤销。确认删除？`,
      )
    ) {
      return;
    }
    try {
      await deleteCourse(courseId, { confirmCascade: true });
      if (activeSession?.courseId === courseId) {
        openDraft();
        appNavigate(chatPath());
        setActiveAppView('home', { fromRoute: true });
      }
    } catch {
      /* store error */
    }
  };

  return (
    <aside
      className={`bg-[var(--surface)] border-r border-[var(--border-20)] flex flex-col transition-all duration-300 ease-[var(--ease-out)] relative ${
        collapsed ? 'w-16' : 'w-[248px]'
      }`}
      aria-label="主导航"
      data-testid="app-sidebar"
    >
      <div className="h-16 px-3 flex items-center border-b border-[var(--border-20)]">
        <button
          type="button"
          onClick={handleOpenHome}
          className={`flex items-center min-h-10 rounded-md text-left transition-colors hover:bg-[var(--surface-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${collapsed ? 'justify-center w-full' : 'gap-3 px-1.5'}`}
          aria-label="返回主页"
          title="返回主页"
        >
          <MinusLogo variant="mark" size={32} className="shrink-0" label="Minus" />
          {!collapsed && (
            <span className="min-w-0">
              <span className="block minus-wordmark text-base text-[var(--text-primary)]">Minus</span>
              <span className="block font-zh text-[11px] text-[var(--text-muted)] truncate">
                本地智能学习器
              </span>
            </span>
          )}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2.5" aria-label="应用页面">
        <ul className="space-y-1.5" role="list">
          {NAV_ITEMS.map((item) => {
            const active = selectedNav === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (item.id === 'home') {
                      handleOpenHome();
                    } else {
                      setActiveAppView(item.id);
                    }
                  }}
                  className={`w-full min-h-[44px] rounded-xl flex items-center gap-3 px-3 py-2.5 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
                    active
                      ? 'bg-[var(--accent-soft)] text-[var(--accent-strong)] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]'
                  } ${collapsed ? 'justify-center px-0' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  aria-label={item.label}
                  title={collapsed ? item.label : item.description}
                >
                <item.icon
                  size={17}
                  className={active ? 'opacity-100' : 'opacity-70'}
                  aria-hidden
                />
                  {!collapsed && (
                    <span className="font-zh text-sm text-left min-w-0">
                      <span className="block font-bold">{item.label}</span>
                      <span className="block font-zh text-[11px] text-[var(--text-muted)]">
                        {item.description}
                      </span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {!collapsed && (
          <>
            <CollapsibleSection
              title="近期对话"
              icon={MessageSquare}
              open={conversationsOpen}
              onToggle={() => setConversationsOpen((v) => !v)}
              emptyHint="暂无近期对话，点击「主页」开始新对话。"
              itemCount={recentConversations.items.length}
            >
              {recentConversations.items.map((c) => {
                const active =
                  c.id === activeConversationId && activeAppView === 'home';
                const title = c.title || '未命名对话';
                return (
                  <div
                    key={c.id}
                    role="listitem"
                    className={`group flex items-center gap-0.5 ${
                      active
                        ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/40 hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenConversation(c.id)}
                      className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                      title={title}
                    >
                      <span className="font-zh text-xs truncate block w-full">
                        {truncateLabel(title)}
                      </span>
                    </button>
                    <EntityActionsMenu
                      label={title}
                      onRename={() => {
                        const next = window.prompt('新的对话名称', title)?.trim();
                        if (next) renameConversation(c.id, next);
                      }}
                      onDelete={() => {
                        if (
                          window.confirm(`删除「${title}」？此操作不可撤销。`)
                        ) {
                          handleDeleteConversation(c.id);
                        }
                      }}
                    />
                  </div>
                );
              })}
              {recentConversations.hasMore && (
                <button
                  type="button"
                  role="listitem"
                  onClick={() => setActiveAppView('history')}
                  className="w-full px-3 py-1.5 text-left font-zh text-[11px] text-[var(--accent)] hover:bg-[var(--bg-tertiary)]/40"
                  data-testid="sidebar-conversations-view-all"
                >
                  查看全部
                </button>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="学习课程"
              icon={BookOpen}
              open={coursesOpen}
              onToggle={() => setCoursesOpen((v) => !v)}
              emptyHint="暂无学习课程，可从主页开始制定学习计划。"
              itemCount={recentCourses.items.length}
            >
              {recentCourses.items.map((course) => {
                const displayTitle = courseSidebarLabel(course);
                const active =
                  activeSession?.courseId === course.id &&
                  activeAppView === 'session';
                return (
                  <div
                    key={course.id}
                    role="listitem"
                    className={`group flex items-center gap-0.5 ${
                      active
                        ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/40 hover:text-[var(--text-primary)]'
                    }`}
                    data-testid={`sidebar-course-${course.id}`}
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenCourse(course.id)}
                      className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                      title={displayTitle}
                    >
                      <span className="font-zh text-xs truncate block w-full">
                        {truncateLabel(displayTitle)}
                      </span>
                    </button>
                    <EntityActionsMenu
                      label={displayTitle}
                      onRename={() =>
                        void handleRenameCourse(course.id, displayTitle)
                      }
                      onArchive={() =>
                        void handleArchiveCourse(course.id, displayTitle)
                      }
                      onDelete={() =>
                        void handleDeleteCourse(course.id, displayTitle)
                      }
                    />
                  </div>
                );
              })}
              {recentCourses.hasMore && (
                <button
                  type="button"
                  role="listitem"
                  onClick={() => setActiveAppView('history')}
                  className="w-full px-3 py-1.5 text-left font-zh text-[11px] text-[var(--accent)] hover:bg-[var(--bg-tertiary)]/40"
                  data-testid="sidebar-courses-view-all"
                >
                  查看全部
                </button>
              )}
            </CollapsibleSection>
          </>
        )}
      </nav>

      <div className="p-2.5 border-t border-[var(--border-20)]">
        <button
          type="button"
          onClick={() => openSettings('model')}
          className={`w-full min-h-[44px] rounded-xl flex items-center gap-3 px-3 py-2.5 transition-colors duration-200 text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
            collapsed ? 'justify-center px-0' : ''
          }`}
          title={collapsed ? '设置' : '打开设置菜单'}
        >
          <SettingsIcon size={16} className="opacity-70 hover:opacity-100" aria-hidden />
          {!collapsed && (
            <span className="font-zh text-sm text-left">
              <span className="block font-bold">设置</span>
              <span className="block font-zh text-[11px] text-[var(--text-muted)]">
                模型 · 安全 · 记忆 · 审计
              </span>
            </span>
          )}
        </button>
      </div>

      <button
        type="button"
        onClick={onToggle}
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-7 h-7 rounded-full bg-[var(--surface-elevated)] border border-[var(--border)] shadow-sm flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors duration-200 z-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight size={iconSizes.xs} aria-hidden />
        ) : (
          <ChevronLeft size={iconSizes.xs} aria-hidden />
        )}
      </button>
    </aside>
  );
}

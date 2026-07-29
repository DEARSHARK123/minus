/**
 * UX01 — App Router path ↔ AppView mapping.
 * URL is the visible page source of truth; store mirrors for compatibility.
 */

/** Mirror of UI store AppView — kept local to avoid circular imports. */
export type RouteAppView =
  | 'home'
  | 'library'
  | 'calendar'
  | 'video'
  | 'history'
  | 'session';

/** Primary product routes (shareable / refreshable). */
export const APP_PATHS = {
  chat: '/chat',
  calendar: '/calendar',
  library: '/library',
  history: '/history',
  course: '/course',
} as const;

/** Query key for active conversation on /chat. */
export const CHAT_CONVERSATION_QUERY = 'c';

/** Query key for active learning session on /course/[id]. */
export const COURSE_SESSION_QUERY = 's';

export type ParsedAppRoute =
  | { view: 'home'; pathname: typeof APP_PATHS.chat; conversationId: string | null }
  | { view: 'library'; pathname: typeof APP_PATHS.library }
  | { view: 'calendar'; pathname: typeof APP_PATHS.calendar }
  | { view: 'history'; pathname: typeof APP_PATHS.history }
  | { view: 'session'; pathname: string; courseId: string; sessionId: string | null }
  | { view: 'video'; pathname: string }
  | { view: 'home'; pathname: string; conversationId: null; unknown: true };

/**
 * Map AppView to a navigable pathname (without query).
 * Session requires courseId; falls back to /chat when missing.
 */
export function appViewToPath(
  view: RouteAppView,
  opts?: { courseId?: string | null },
): string {
  switch (view) {
    case 'home':
      return APP_PATHS.chat;
    case 'library':
      return APP_PATHS.library;
    case 'calendar':
      return APP_PATHS.calendar;
    case 'history':
      return APP_PATHS.history;
    case 'session': {
      const id = opts?.courseId?.trim();
      if (id) return `${APP_PATHS.course}/${encodeURIComponent(id)}`;
      return APP_PATHS.chat;
    }
    case 'video':
      // Video is not a primary nav surface; keep a stable path for deep links.
      return '/video';
    default: {
      const _exhaustive: never = view;
      return _exhaustive;
    }
  }
}

/** Build /chat URL, optionally pinning an active conversation. */
export function chatPath(conversationId?: string | null): string {
  if (conversationId && conversationId.trim()) {
    const q = new URLSearchParams({
      [CHAT_CONVERSATION_QUERY]: conversationId.trim(),
    });
    return `${APP_PATHS.chat}?${q.toString()}`;
  }
  return APP_PATHS.chat;
}

/** Build /course/[id] URL, optionally pinning a session. */
export function coursePath(
  courseId: string,
  sessionId?: string | null,
): string {
  const base = `${APP_PATHS.course}/${encodeURIComponent(courseId)}`;
  if (sessionId && sessionId.trim()) {
    const q = new URLSearchParams({
      [COURSE_SESSION_QUERY]: sessionId.trim(),
    });
    return `${base}?${q.toString()}`;
  }
  return base;
}

/**
 * Parse pathname (+ optional search) into a structured route.
 * Root `/` is treated as chat draft (callers should redirect).
 */
export function parseAppPath(
  pathname: string,
  searchParams?: URLSearchParams | { get(name: string): string | null } | null,
): ParsedAppRoute {
  const path = normalizePathname(pathname);
  const get = (key: string): string | null => {
    if (!searchParams) return null;
    return searchParams.get(key);
  };

  if (path === '/' || path === APP_PATHS.chat) {
    const conversationId = get(CHAT_CONVERSATION_QUERY);
    return {
      view: 'home',
      pathname: APP_PATHS.chat,
      conversationId: conversationId && conversationId.trim() ? conversationId.trim() : null,
    };
  }

  if (path === APP_PATHS.library) {
    return { view: 'library', pathname: APP_PATHS.library };
  }
  if (path === APP_PATHS.calendar) {
    return { view: 'calendar', pathname: APP_PATHS.calendar };
  }
  if (path === APP_PATHS.history) {
    return { view: 'history', pathname: APP_PATHS.history };
  }
  if (path === '/video') {
    return { view: 'video', pathname: '/video' };
  }

  const courseMatch = path.match(/^\/course\/([^/]+)\/?$/);
  if (courseMatch) {
    let courseId = courseMatch[1];
    try {
      courseId = decodeURIComponent(courseId);
    } catch {
      /* keep raw */
    }
    const sessionId = get(COURSE_SESSION_QUERY);
    return {
      view: 'session',
      pathname: path,
      courseId,
      sessionId: sessionId && sessionId.trim() ? sessionId.trim() : null,
    };
  }

  return {
    view: 'home',
    pathname: path,
    conversationId: null,
    unknown: true,
  };
}

/** AppView derived from pathname (ignores query). */
export function pathToAppView(pathname: string): RouteAppView {
  return parseAppPath(pathname).view;
}

/** Whether this path is the blank draft home (no conversation query). */
export function isChatDraftPath(
  pathname: string,
  searchParams?: URLSearchParams | { get(name: string): string | null } | null,
): boolean {
  const route = parseAppPath(pathname, searchParams);
  return route.view === 'home' && !('conversationId' in route && route.conversationId);
}

export function normalizePathname(pathname: string): string {
  if (!pathname) return '/';
  const trimmed = pathname.split('?')[0].split('#')[0];
  if (trimmed.length > 1 && trimmed.endsWith('/')) {
    return trimmed.slice(0, -1);
  }
  return trimmed || '/';
}

/** Root `/` must redirect to /chat (documented product rule). */
export const ROOT_REDIRECT_TARGET = APP_PATHS.chat;

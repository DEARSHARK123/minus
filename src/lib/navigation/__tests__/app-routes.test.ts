import { describe, expect, it } from 'vitest';
import {
  APP_PATHS,
  ROOT_REDIRECT_TARGET,
  appViewToPath,
  chatPath,
  coursePath,
  isChatDraftPath,
  normalizePathname,
  parseAppPath,
  pathToAppView,
} from '../app-routes';

describe('app-routes (UX01)', () => {
  describe('root redirect target', () => {
    it('maps / to /chat', () => {
      expect(ROOT_REDIRECT_TARGET).toBe('/chat');
      expect(APP_PATHS.chat).toBe('/chat');
    });
  });

  describe('appViewToPath / pathToAppView', () => {
    it('round-trips primary views', () => {
      const cases: Array<{ view: Parameters<typeof appViewToPath>[0]; path: string }> = [
        { view: 'home', path: '/chat' },
        { view: 'library', path: '/library' },
        { view: 'calendar', path: '/calendar' },
        { view: 'history', path: '/history' },
      ];
      for (const { view, path } of cases) {
        expect(appViewToPath(view)).toBe(path);
        expect(pathToAppView(path)).toBe(view);
      }
    });

    it('maps session to /course/[id] when courseId present', () => {
      expect(appViewToPath('session', { courseId: 'course_abc' })).toBe(
        '/course/course_abc',
      );
      expect(pathToAppView('/course/course_abc')).toBe('session');
    });

    it('session without courseId falls back to /chat', () => {
      expect(appViewToPath('session')).toBe('/chat');
      expect(appViewToPath('session', { courseId: null })).toBe('/chat');
      expect(appViewToPath('session', { courseId: '  ' })).toBe('/chat');
    });
  });

  describe('parseAppPath', () => {
    it('parses /chat draft without conversation', () => {
      const route = parseAppPath('/chat');
      expect(route.view).toBe('home');
      if (route.view === 'home') {
        expect(route.conversationId).toBeNull();
      }
    });

    it('parses /chat?c=conv_1', () => {
      const route = parseAppPath('/chat', new URLSearchParams('c=conv_1'));
      expect(route.view).toBe('home');
      if (route.view === 'home') {
        expect(route.conversationId).toBe('conv_1');
      }
    });

    it('treats root as home draft', () => {
      const route = parseAppPath('/');
      expect(route.view).toBe('home');
    });

    it('parses course with optional session query', () => {
      const route = parseAppPath(
        '/course/c1',
        new URLSearchParams('s=sess_9'),
      );
      expect(route.view).toBe('session');
      if (route.view === 'session') {
        expect(route.courseId).toBe('c1');
        expect(route.sessionId).toBe('sess_9');
      }
    });

    it('parses calendar, library, history', () => {
      expect(parseAppPath('/calendar').view).toBe('calendar');
      expect(parseAppPath('/library').view).toBe('library');
      expect(parseAppPath('/history').view).toBe('history');
    });

    it('normalizes trailing slashes', () => {
      expect(normalizePathname('/chat/')).toBe('/chat');
      expect(pathToAppView('/library/')).toBe('library');
    });
  });

  describe('chatPath / coursePath', () => {
    it('builds draft and pinned chat URLs', () => {
      expect(chatPath()).toBe('/chat');
      expect(chatPath(null)).toBe('/chat');
      expect(chatPath('conv_x')).toBe('/chat?c=conv_x');
    });

    it('builds course URLs with optional session', () => {
      expect(coursePath('c1')).toBe('/course/c1');
      expect(coursePath('c1', 's1')).toBe('/course/c1?s=s1');
    });
  });

  describe('isChatDraftPath', () => {
    it('true only for /chat without c=', () => {
      expect(isChatDraftPath('/chat')).toBe(true);
      expect(isChatDraftPath('/chat', new URLSearchParams())).toBe(true);
      expect(isChatDraftPath('/chat', new URLSearchParams('c=x'))).toBe(false);
      expect(isChatDraftPath('/library')).toBe(false);
    });
  });

  describe('back/forward-safe restoration mapping', () => {
    it('preserves conversation id from history-like search params', () => {
      const forward = parseAppPath('/chat', new URLSearchParams('c=conv_restored'));
      expect(forward.view).toBe('home');
      if (forward.view === 'home') {
        expect(forward.conversationId).toBe('conv_restored');
      }
      const backToDraft = parseAppPath('/chat');
      if (backToDraft.view === 'home') {
        expect(backToDraft.conversationId).toBeNull();
      }
    });

    it('preserves course + session across path parse', () => {
      const href = coursePath('course_42', 'session_7');
      const [path, qs] = href.split('?');
      const route = parseAppPath(path, new URLSearchParams(qs));
      expect(route.view).toBe('session');
      if (route.view === 'session') {
        expect(route.courseId).toBe('course_42');
        expect(route.sessionId).toBe('session_7');
      }
    });
  });
});

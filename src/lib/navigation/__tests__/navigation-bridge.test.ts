import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appNavigate,
  bindAppRouter,
  isAppRouterBound,
  unbindAppRouter,
} from '../navigation-bridge';
import { appViewToPath, chatPath, coursePath, parseAppPath } from '../app-routes';

describe('navigation-bridge + restore mapping (UX01)', () => {
  afterEach(() => {
    unbindAppRouter();
  });

  it('bound router receives push/replace', () => {
    const push = vi.fn();
    const replace = vi.fn();
    bindAppRouter({ push, replace });
    expect(isAppRouterBound()).toBe(true);
    appNavigate('/library');
    expect(push).toHaveBeenCalledWith('/library');
    appNavigate('/chat', { replace: true });
    expect(replace).toHaveBeenCalledWith('/chat');
  });

  it('unbind stops using previous router', () => {
    const push = vi.fn();
    bindAppRouter({ push, replace: vi.fn() });
    unbindAppRouter();
    expect(isAppRouterBound()).toBe(false);
  });

  it('back/forward-safe: view+ids reconstruct from path helpers', () => {
    // Simulate history stack entries
    const stack = [
      chatPath(),
      chatPath('conv_a'),
      coursePath('course_1', 'sess_1'),
      appViewToPath('calendar'),
      appViewToPath('library'),
      appViewToPath('history'),
    ];

    const parsed = stack.map((href) => {
      const [path, qs] = href.split('?');
      return parseAppPath(path, qs ? new URLSearchParams(qs) : null);
    });

    expect(parsed[0].view).toBe('home');
    if (parsed[0].view === 'home') expect(parsed[0].conversationId).toBeNull();

    expect(parsed[1].view).toBe('home');
    if (parsed[1].view === 'home') expect(parsed[1].conversationId).toBe('conv_a');

    expect(parsed[2].view).toBe('session');
    if (parsed[2].view === 'session') {
      expect(parsed[2].courseId).toBe('course_1');
      expect(parsed[2].sessionId).toBe('sess_1');
    }

    expect(parsed[3].view).toBe('calendar');
    expect(parsed[4].view).toBe('library');
    expect(parsed[5].view).toBe('history');
  });
});

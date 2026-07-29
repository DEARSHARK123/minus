import { create } from 'zustand';
import {
  appNavigate,
  appViewToPath,
  chatPath,
  coursePath,
} from '@/lib/navigation';

/** B07 Settings IA tabs. */
export type SettingsTab =
  | 'model'
  | 'safety'
  | 'memory'
  | 'skills'
  | 'automations'
  | 'data'
  | 'audit'
  | 'about'
  /** @deprecated use 'memory' */
  | 'personalization';

/** Legacy view type for compatibility. */
export type LearningView = 'feed' | 'knowledge' | 'history' | 'session';

/** Primary navigation views. Default active: 'home'. */
export type AppView = 'home' | 'library' | 'calendar' | 'video' | 'history' | 'session';

export type SetActiveAppViewOptions = {
  /** Required for session → /course/[id]. */
  courseId?: string | null;
  sessionId?: string | null;
  /**
   * Optional conversation pin for home → /chat?c=.
   * Omit / null for blank draft 主页.
   */
  conversationId?: string | null;
  /** Skip router push (URL → store sync only). */
  fromRoute?: boolean;
  replace?: boolean;
};

interface UIStore {
  sidebarCollapsed: boolean;
  showSettings: boolean;
  settingsInitialTab: SettingsTab;
  /**
   * Mirror of the current URL view for legacy callers.
   * Visible navigation is driven by the App Router path — do not treat this
   * as an independent source of truth for what is on screen.
   */
  activeAppView: AppView;
  /** Legacy active learning view. Default: feed. */
  activeLearningView: LearningView;
  toggleSidebar: () => void;
  toggleSettings: () => void;
  openSettings: (tab?: SettingsTab) => void;
  /**
   * Compatibility adapter: navigates to the matching App Router path and
   * mirrors `activeAppView`. When `fromRoute` is true, only mirrors store
   * (used by route → store sync so URL remains SoT).
   */
  setActiveAppView: (view: AppView, opts?: SetActiveAppViewOptions) => void;
  setActiveLearningView: (view: LearningView) => void;
  /** URL → store only (no navigation). */
  syncActiveAppViewFromRoute: (view: AppView) => void;
}

function legacyFromAppView(view: AppView): LearningView {
  if (view === 'library') return 'knowledge';
  if (view === 'history') return 'history';
  if (view === 'session') return 'session';
  return 'feed';
}

function appViewFromLegacy(view: LearningView): AppView {
  if (view === 'knowledge') return 'library';
  if (view === 'history') return 'history';
  if (view === 'session') return 'session';
  return 'home';
}

export const useUIStore = create<UIStore>((set, get) => ({
  sidebarCollapsed: false,
  showSettings: false,
  settingsInitialTab: 'model',
  activeAppView: 'home',
  activeLearningView: 'feed',

  toggleSidebar: () =>
    set((store) => ({
      sidebarCollapsed: !store.sidebarCollapsed,
    })),

  toggleSettings: () =>
    set((store) => ({
      showSettings: !store.showSettings,
    })),

  openSettings: (tab) => {
    let next: SettingsTab = tab || 'model';
    if (next === 'personalization') next = 'memory';
    set({
      showSettings: true,
      settingsInitialTab: next,
    });
  },

  syncActiveAppViewFromRoute: (view) => {
    set({
      activeAppView: view,
      activeLearningView: legacyFromAppView(view),
    });
  },

  setActiveAppView: (view, opts) => {
    const fromRoute = opts?.fromRoute === true;
    const nextLegacy = legacyFromAppView(view);

    // Always mirror for compatibility readers.
    if (get().activeAppView !== view || get().activeLearningView !== nextLegacy) {
      set({
        activeAppView: view,
        activeLearningView: nextLegacy,
      });
    }

    if (fromRoute) return;

    // Navigate — URL is the visible SoT.
    let href: string;
    if (view === 'session') {
      const courseId = opts?.courseId;
      if (courseId) {
        href = coursePath(courseId, opts?.sessionId);
      } else {
        href = appViewToPath('session', { courseId: null });
      }
    } else if (view === 'home') {
      href = chatPath(opts?.conversationId);
    } else {
      href = appViewToPath(view);
    }
    appNavigate(href, { replace: opts?.replace });
  },

  setActiveLearningView: (view) => {
    const appView = appViewFromLegacy(view);
    // Delegate to setActiveAppView so navigation stays single-path.
    get().setActiveAppView(appView);
  },
}));

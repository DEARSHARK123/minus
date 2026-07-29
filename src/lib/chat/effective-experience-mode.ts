/**
 * Batch-03: single source for visible experience mode.
 * Conversation preference + live learn-flow experience + route/surface.
 * Home must not keep a parallel local userModePreference truth.
 */

import type {
  ConversationExperienceSnapshot,
  UserModePreference,
} from '@/types/agent';
import type { ExperienceMode } from '@/lib/agents/control-plane/experience-plan';

export type EffectiveExperienceMode = ExperienceMode;

/** Minimal conversation shape for mode selection (avoids store import cycle). */
export interface ConversationModeSource {
  modePreference?: UserModePreference | null;
  experience?: ConversationExperienceSnapshot | null;
}

export interface EffectiveExperienceModeInput {
  /** Active conversation (modePreference + experience snapshot). */
  conversation?: ConversationModeSource | null;
  /** Current pathname or surface key (e.g. /chat, /course/x, course). */
  route?: string | null;
  /** Live learn-flow experienceMode when bound to this conversation. */
  experienceMode?: string | null;
  /** Live learn-flow modePreference. */
  modePreference?: UserModePreference;
  /** Live learn-flow stage (optional refinement). */
  stage?: string | null;
}

function normalizeRoute(route?: string | null): string {
  const s = (route || '').trim().toLowerCase();
  if (!s || s === '/' || s === '/chat' || s === 'home' || s === 'chat') {
    return 'chat';
  }
  if (s.startsWith('/course') || s === 'course' || s === 'session') {
    return 'course';
  }
  if (s.startsWith('/calendar') || s === 'calendar') return 'calendar';
  if (s.startsWith('/library') || s === 'library') return 'library';
  if (s.startsWith('/history') || s === 'history') return 'history';
  if (s === 'desktop' || s.startsWith('/desktop')) return 'desktop';
  if (s === 'settings' || s.startsWith('/settings')) return 'settings';
  return s.replace(/^\//, '') || 'chat';
}

const KNOWN_MODES = new Set<string>([
  'chat',
  'normal',
  'deep_planning',
  'deep_course',
  'calendar',
  'library',
  'desktop',
]);

function asMode(raw: string | null | undefined): EffectiveExperienceMode | null {
  if (!raw) return null;
  return KNOWN_MODES.has(raw) ? (raw as EffectiveExperienceMode) : null;
}

/**
 * Resolve the single effective experience mode for UI + planner preference.
 * Priority: course route → live experienceMode → conversation experience →
 * modePreference deep → normal/chat default.
 */
export function effectiveExperienceMode(
  input: EffectiveExperienceModeInput,
): EffectiveExperienceMode {
  const surface = normalizeRoute(input.route);

  if (surface === 'course') return 'deep_course';
  if (surface === 'calendar') return 'calendar';
  if (surface === 'library') return 'library';
  if (surface === 'desktop') return 'desktop';

  const live = asMode(input.experienceMode);
  if (live === 'deep_course' || live === 'deep_planning') return live;
  if (live === 'normal' || live === 'chat') {
    // Live plan mode wins for chat/normal unless preference forces deep upgrade path.
    const pref =
      input.modePreference ??
      input.conversation?.modePreference ??
      input.conversation?.experience?.modePreference ??
      null;
    if (pref === 'deep' && live === 'chat') {
      // Preference deep with no planning yet: still deep_planning for UI status
      // only when already past idle planning stages.
      const stage = (input.stage || '').toLowerCase();
      if (
        stage &&
        stage !== 'idle' &&
        stage !== 'rejected' &&
        stage !== 'intent_proposed'
      ) {
        return 'deep_planning';
      }
    }
    return live;
  }
  if (live) return live;

  const snapMode = asMode(input.conversation?.experience?.experienceMode ?? null);
  if (snapMode === 'deep_course' || snapMode === 'deep_planning') return snapMode;
  if (snapMode === 'normal') return 'normal';

  const pref =
    input.modePreference ??
    input.conversation?.modePreference ??
    input.conversation?.experience?.modePreference ??
    null;

  if (pref === 'deep') return 'deep_planning';
  if (pref === 'normal') return 'normal';

  return 'chat';
}

/** User-facing preference for orchestrator (normal | deep | null). */
export function modePreferenceFromEffective(
  mode: EffectiveExperienceMode,
): UserModePreference {
  if (mode === 'deep_planning' || mode === 'deep_course') return 'deep';
  if (mode === 'normal') return 'normal';
  return null;
}

/**
 * Whether the segmented 普通 / 深入学习 control may be shown.
 * deep_course: never. deep_planning: status only (not a switch into deep).
 */
export function canShowModeToggle(mode: EffectiveExperienceMode): boolean {
  return mode === 'chat' || mode === 'normal';
}

/** Only Chat/Normal surfaces may upgrade into Deep. */
export function canUpgradeToDeep(mode: EffectiveExperienceMode): boolean {
  return mode === 'chat' || mode === 'normal';
}

/** True when already in a Deep planning/course experience. */
export function isDeepExperience(mode: EffectiveExperienceMode): boolean {
  return mode === 'deep_planning' || mode === 'deep_course';
}

export interface ModeToggleUiState {
  /** Segmented toggle (普通 / 深入学习) for chat/normal only. */
  showToggle: boolean;
  /** Status chip while deep_planning (not an "enter deep" CTA). */
  showDeepStatus: boolean;
  /** Upgrade CTA under Normal answers. */
  showUpgradeCta: boolean;
  /** Label for deep side of toggle (only when showToggle). */
  deepToggleLabel: string;
  /** Status label when showDeepStatus. */
  deepStatusLabel: string;
  /** Which preference is active for toggle pressed state. */
  activePreference: 'normal' | 'deep';
  /** Whether selecting Deep on the toggle is allowed. */
  allowSelectDeep: boolean;
}

/**
 * UI flags for Home mode control + upgrade button visibility.
 */
export function modeToggleUiState(
  mode: EffectiveExperienceMode,
): ModeToggleUiState {
  if (mode === 'deep_course') {
    return {
      showToggle: false,
      showDeepStatus: false,
      showUpgradeCta: false,
      deepToggleLabel: '深入学习',
      deepStatusLabel: '课程学习中',
      activePreference: 'deep',
      allowSelectDeep: false,
    };
  }
  if (mode === 'deep_planning') {
    return {
      showToggle: false,
      showDeepStatus: true,
      showUpgradeCta: false,
      deepToggleLabel: '深入学习',
      deepStatusLabel: '深入学习规划中',
      activePreference: 'deep',
      allowSelectDeep: false,
    };
  }
  // chat / normal / other non-deep surfaces on chat home
  const isNormal = mode === 'normal';
  return {
    showToggle: mode === 'chat' || mode === 'normal',
    showDeepStatus: false,
    showUpgradeCta: mode === 'chat' || mode === 'normal',
    deepToggleLabel: '深入学习',
    deepStatusLabel: '',
    activePreference: isNormal ? 'normal' : mode === 'chat' ? 'normal' : 'normal',
    allowSelectDeep: true,
  };
}

/**
 * Resolve pressed preference for toggle UI from mode + stored preference.
 */
export function resolveTogglePreference(
  mode: EffectiveExperienceMode,
  stored: UserModePreference,
): 'normal' | 'deep' {
  if (mode === 'deep_planning' || mode === 'deep_course') return 'deep';
  if (stored === 'deep') return 'deep';
  if (stored === 'normal') return 'normal';
  if (mode === 'normal') return 'normal';
  return 'normal';
}

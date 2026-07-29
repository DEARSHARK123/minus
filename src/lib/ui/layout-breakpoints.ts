/**
 * UX07 — Responsive layout breakpoints aligned with visual contract.
 * ≥1200 desktop | 768–1199 tablet | <768 mobile
 */

export type ShellLayoutMode = 'desktop' | 'tablet' | 'mobile';

export const BREAKPOINT_DESKTOP = 1200;
export const BREAKPOINT_TABLET = 768;

export function shellLayoutMode(widthPx: number): ShellLayoutMode {
  if (widthPx >= BREAKPOINT_DESKTOP) return 'desktop';
  if (widthPx >= BREAKPOINT_TABLET) return 'tablet';
  return 'mobile';
}

/** Full sidebar rail (≥1200). */
export function navFullByDefault(mode: ShellLayoutMode): boolean {
  return mode === 'desktop';
}

/** Collapsible nav / tree / companion (768–1199). */
export function navCollapsible(mode: ShellLayoutMode): boolean {
  return mode === 'tablet';
}

/** Drawer navigation (<768). */
export function navAsDrawer(mode: ShellLayoutMode): boolean {
  return mode === 'mobile';
}

/** Course unit tree: full rail on desktop, collapsible tablet, drawer mobile. */
export function courseTreeVariant(
  mode: ShellLayoutMode,
): 'rail' | 'collapsible' | 'drawer' {
  if (mode === 'desktop') return 'rail';
  if (mode === 'tablet') return 'collapsible';
  return 'drawer';
}

export function courseTreeVisibleByDefault(mode: ShellLayoutMode): boolean {
  return mode === 'desktop';
}

/** Keyboard focus order: nav → main → input/CTA (documented for tests). */
export const FOCUS_ORDER = ['navigation', 'main', 'composer'] as const;

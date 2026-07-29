/**
 * UX01 — Imperative navigation bridge.
 * Lets store-level setActiveAppView (and non-React helpers) push real App Router URLs
 * without maintaining a second visible navigation state.
 */

type NavigateOptions = {
  replace?: boolean;
};

type RouterLike = {
  push: (href: string) => void;
  replace: (href: string) => void;
};

let boundRouter: RouterLike | null = null;

/** Called from AppShell on mount so store adapters can navigate. */
export function bindAppRouter(router: RouterLike): void {
  boundRouter = router;
}

export function unbindAppRouter(): void {
  boundRouter = null;
}

/**
 * Navigate to an in-app href. Prefers Next.js router when bound;
 * falls back to location assignment for tests / edge cases.
 */
export function appNavigate(href: string, opts?: NavigateOptions): void {
  if (!href) return;
  if (boundRouter) {
    if (opts?.replace) boundRouter.replace(href);
    else boundRouter.push(href);
    return;
  }
  if (typeof window !== 'undefined') {
    if (opts?.replace) window.location.replace(href);
    else window.location.assign(href);
  }
}

/** Test helper: is a router currently bound? */
export function isAppRouterBound(): boolean {
  return boundRouter !== null;
}

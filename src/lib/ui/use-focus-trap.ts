'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export type FocusTrapOptions = {
  enabled?: boolean;
  /** Return focus here on close / unmount. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
};

/**
 * Trap Tab within container; Esc calls onEscape; restores focus on disable/unmount.
 */
export function useFocusTrap<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  options: FocusTrapOptions = {},
): void {
  const { enabled = true, restoreFocusRef, onEscape } = options;
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    previousFocusRef.current =
      (document.activeElement as HTMLElement | null) ?? null;
    const restoreFocusTarget =
      restoreFocusRef?.current ?? previousFocusRef.current;

    const root = containerRef.current;
    const focusables = () =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
      );

    const t = requestAnimationFrame(() => {
      const items = focusables();
      (items[0] ?? root).focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    root.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(t);
      root.removeEventListener('keydown', onKeyDown);
      if (
        restoreFocusTarget &&
        typeof restoreFocusTarget.focus === 'function'
      ) {
        requestAnimationFrame(() => restoreFocusTarget.focus());
      }
    };
  }, [enabled, containerRef, restoreFocusRef, onEscape]);
}

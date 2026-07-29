/**
 * UX06 — Cross-route composer prefill (Library → Home).
 * One-shot: take() clears so refresh does not re-apply.
 */

export type ComposerPrefill = {
  text: string;
  /** Home mode toggle when set. */
  mode?: 'normal' | 'deep' | null;
  /** Optional source label for debugging only (not rendered). */
  source?: string;
};

let pending: ComposerPrefill | null = null;

export function setComposerPrefill(prefill: ComposerPrefill): void {
  const text = (prefill.text || '').trim();
  if (!text) {
    pending = null;
    return;
  }
  pending = {
    text,
    mode: prefill.mode ?? null,
    source: prefill.source,
  };
}

/** Read and clear pending prefill. */
export function takeComposerPrefill(): ComposerPrefill | null {
  const cur = pending;
  pending = null;
  return cur;
}

/** Peek without clearing (tests). */
export function peekComposerPrefill(): ComposerPrefill | null {
  return pending;
}

export function clearComposerPrefill(): void {
  pending = null;
}

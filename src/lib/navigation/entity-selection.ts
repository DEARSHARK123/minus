export type EntitySelection =
  | { kind: 'document'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'course'; id: string };

const EVENT_NAME = 'minus:entity-selection';
let pendingSelection: EntitySelection | null = null;

/** One-shot cross-route selection plus live delivery when the target is mounted. */
export function requestEntitySelection(selection: EntitySelection): void {
  pendingSelection = selection;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<EntitySelection>(EVENT_NAME, { detail: selection }),
    );
  }
}

export function takeEntitySelection(
  kind: EntitySelection['kind'],
): EntitySelection | null {
  if (!pendingSelection || pendingSelection.kind !== kind) return null;
  const selection = pendingSelection;
  pendingSelection = null;
  return selection;
}

export function peekEntitySelection(
  kind: EntitySelection['kind'],
): EntitySelection | null {
  return pendingSelection?.kind === kind ? pendingSelection : null;
}

export function clearEntitySelection(selection: EntitySelection): void {
  if (
    pendingSelection?.kind === selection.kind &&
    pendingSelection.id === selection.id
  ) {
    pendingSelection = null;
  }
}

export function subscribeEntitySelection(
  handler: (selection: EntitySelection) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (event: Event) => {
    const selection = (event as CustomEvent<EntitySelection>).detail;
    if (selection) handler(selection);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

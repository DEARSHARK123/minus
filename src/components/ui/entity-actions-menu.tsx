'use client';

/**
 * Batch-06 — Reusable entity actions menu.
 * Keyboard (Esc / arrows / Enter), touch-friendly targets, focus-visible rings.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

export type EntityMenuAction = {
  id: string;
  label: string;
  onSelect: () => void;
  /** Destructive styling (delete). */
  danger?: boolean;
};

export function EntityActionsMenu({
  label,
  onRename,
  onDelete,
  onArchive,
  actions,
}: {
  /** Accessible name of the entity (e.g. course title). */
  label: string;
  onRename?: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  /** Optional fully custom items; when set, overrides rename/archive/delete. */
  actions?: EntityMenuAction[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  const items: EntityMenuAction[] =
    actions ??
    [
      onRename
        ? { id: 'rename', label: '重命名', onSelect: onRename }
        : null,
      onArchive
        ? { id: 'archive', label: '归档', onSelect: onArchive }
        : null,
      onDelete
        ? { id: 'delete', label: '删除', onSelect: onDelete, danger: true }
        : null,
    ].filter(Boolean) as EntityMenuAction[];

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        close();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    // Focus first item when opened via keyboard/pointer for roving focus.
    const t = window.setTimeout(() => {
      itemRefs.current[0]?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const runItem = (item: EntityMenuAction) => {
    close();
    item.onSelect();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    const count = items.length;
    if (count === 0) return;
    const current = itemRefs.current.findIndex(
      (el) => el === document.activeElement,
    );
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      rootRef.current?.querySelector<HTMLButtonElement>('[data-entity-menu-trigger]')?.focus();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = current < 0 ? 0 : (current + 1) % count;
      itemRefs.current[next]?.focus();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = current < 0 ? count - 1 : (current - 1 + count) % count;
      itemRefs.current[next]?.focus();
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      itemRefs.current[0]?.focus();
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      itemRefs.current[count - 1]?.focus();
    }
  };

  if (items.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onKeyDown={onMenuKeyDown}
      data-testid="entity-actions-menu"
    >
      <button
        type="button"
        data-entity-menu-trigger
        aria-label={`${label}操作`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
          if (
            (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') &&
            !open
          ) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] px-2 font-zh text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        ⋯
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={`${label}操作菜单`}
          className="absolute right-0 top-full z-20 min-w-[132px] border border-[var(--border)] bg-[var(--bg-primary)] shadow-lg"
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              onClick={(e) => {
                e.stopPropagation();
                runItem(item);
              }}
              className={`w-full min-h-[44px] sm:min-h-[36px] px-3 py-2 text-left font-zh text-xs touch-manipulation hover:bg-[var(--bg-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
                item.danger
                  ? 'text-[var(--error)] hover:bg-[var(--error)]/10'
                  : 'text-[var(--text-primary)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

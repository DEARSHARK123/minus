'use client';

/**
 * UX04 — Left ~250px unit tree for /course/[id].
 * Desktop: fixed rail; narrow: drawer with overlay.
 */

import PixelIcon from '@/components/icons/PixelIcon';
import {
  type UnitTreeModel,
  type UnitTreeNode,
  unitTreeStatusLabel,
} from '@/lib/learning/course-unit-tree';

export type CourseUnitTreePanelProps = {
  model: UnitTreeModel;
  open: boolean;
  onClose: () => void;
  onSelectNode?: (nodeId: string, status: UnitTreeNode['status']) => void;
  /** Desktop always shows rail; mobile uses drawer when open. */
  variant?: 'rail' | 'drawer';
};

function statusIcon(status: UnitTreeNode['status']) {
  switch (status) {
    case 'completed':
      return <PixelIcon name="session-done" size={16} className="shrink-0" aria-hidden />;
    case 'current':
      return <PixelIcon name="session-open" size={16} className="shrink-0" aria-hidden />;
    case 'locked':
      return <PixelIcon name="session-lock" size={16} className="shrink-0" aria-hidden />;
    default:
      return <PixelIcon name="session-open" size={16} className="shrink-0 opacity-60" aria-hidden />;
  }
}

export function CourseUnitTreePanel({
  model,
  open,
  onClose,
  onSelectNode,
  variant = 'rail',
}: CourseUnitTreePanelProps) {
  const isDrawer = variant === 'drawer';

  if (isDrawer && !open) return null;

  const panel = (
    <aside
      className={
        isDrawer
          ? 'absolute inset-y-0 left-0 z-40 w-[250px] max-w-[85vw] border-r border-[var(--border-20)] bg-[var(--bg-secondary)]/98 shadow-xl overflow-y-auto'
          : 'hidden min-[1200px]:flex w-[250px] shrink-0 border-r border-[var(--border-20)] bg-[var(--bg-secondary)]/80 flex-col overflow-y-auto'
      }
      aria-label="课程单元"
      data-testid="course-unit-tree"
      data-variant={variant}
    >
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-zh text-xs font-bold text-[var(--text-primary)]">学习进度</p>
            <p className="font-zh text-[10px] text-[var(--text-muted)] mt-0.5">
              已完成 {model.completedCount}/{model.totalCount} · {model.overallPercent}%
            </p>
          </div>
          {isDrawer && (
            <button
              type="button"
              onClick={onClose}
              className="px-2 py-1 border border-[var(--border-20)] font-zh text-[10px]"
              aria-label="关闭单元列表"
            >
              关闭
            </button>
          )}
        </div>

        <div
          className="h-1.5 rounded-full bg-[var(--border-20)] overflow-hidden"
          role="progressbar"
          aria-valuenow={model.overallPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="整体进度"
        >
          <div
            className="h-full bg-[var(--accent)] transition-all"
            style={{ width: `${model.overallPercent}%` }}
          />
        </div>

        <nav className="flex flex-col gap-1" aria-label="单元列表">
          {model.nodes.length === 0 ? (
            <p className="font-zh text-xs text-[var(--text-muted)] px-1 py-2">暂无单元</p>
          ) : (
            model.nodes.map((node) => {
              const selected = node.id === model.currentId;
              const locked = node.status === 'locked';
              return (
                <div key={node.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectNode?.(node.id, node.status);
                      if (isDrawer) onClose();
                    }}
                    className={`w-full text-left px-2.5 py-2 border transition-colors rounded-md ${
                      selected
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text-primary)] font-semibold'
                      : locked
                          ? 'border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]/50'
                          : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/50'
                    }`}
                    aria-current={selected ? 'true' : undefined}
                    data-status={node.status}
                    data-testid={`unit-tree-node-${node.id}`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {statusIcon(node.status)}
                      <span className="font-zh text-sm truncate flex-1">{node.title}</span>
                    </span>
                    <span className="font-zh text-[10px] text-[var(--text-muted)] block ml-6">
                      {locked ? '未解锁 · 可提前打开' : unitTreeStatusLabel(node.status)}
                    </span>
                  </button>
                  {node.children && node.children.length > 0 && (
                    <ul className={`ml-6 mt-0.5 mb-1 space-y-0.5 border-l border-[var(--border-20)] pl-2 ${locked ? 'opacity-55' : ''}`}>
                      {node.children.map((ch) => (
                        <li
                          key={ch.id}
                          className="flex items-center gap-1.5 font-zh text-[11px] text-[var(--text-muted)] truncate py-0.5"
                        >
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ch.status === 'completed' ? 'bg-[var(--success)]' : ch.status === 'current' ? 'bg-[var(--accent)]' : 'border border-current'}`} />
                          {ch.title}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })
          )}
        </nav>
      </div>
    </aside>
  );

  if (isDrawer) {
    return (
      <>
        <div
          className="absolute inset-0 z-30 bg-black/40"
          onClick={onClose}
          aria-hidden
          data-testid="unit-tree-drawer-overlay"
        />
        {panel}
      </>
    );
  }

  return panel;
}

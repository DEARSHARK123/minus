/**
 * UX04 — Course unit/section tree model for left rail (~250px).
 * States: current | completed | locked + overall percentage.
 */

export type UnitTreeNodeStatus = 'current' | 'completed' | 'locked' | 'open';

export type UnitTreeNode = {
  id: string;
  title: string;
  status: UnitTreeNodeStatus;
  order: number;
  /** Optional nested KP / child labels (display only). */
  children?: Array<{ id: string; title: string; status: UnitTreeNodeStatus }>;
};

export type UnitTreeModel = {
  nodes: UnitTreeNode[];
  overallPercent: number;
  completedCount: number;
  totalCount: number;
  currentId: string | null;
};

export type SessionSectionLike = {
  id: string;
  title?: string;
  status: 'open' | 'locked' | 'done' | string;
  order?: number;
  knowledgePoints?: string[];
};

/**
 * Build unit tree from SessionEngine sections.
 * - done → completed
 * - open (and current or first open) → current when matches currentSectionId
 * - locked → locked
 * - open but not current → open (unlocked, not focused)
 */
export function buildUnitTreeFromSections(
  sections: SessionSectionLike[],
  currentSectionId?: string | null,
): UnitTreeModel {
  const sorted = [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const totalCount = sorted.length;
  const completedCount = sorted.filter((s) => s.status === 'done').length;
  const overallPercent =
    totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  const resolvedCurrent =
    currentSectionId ||
    sorted.find((s) => s.status === 'open')?.id ||
    null;

  const nodes: UnitTreeNode[] = sorted.map((s) => {
    let status: UnitTreeNodeStatus;
    if (s.status === 'done') status = 'completed';
    else if (s.status === 'locked') status = 'locked';
    else if (s.id === resolvedCurrent) status = 'current';
    else status = 'open';

    const children = (s.knowledgePoints ?? []).map((kp, i) => ({
      id: `${s.id}_kp_${i}`,
      title: kp,
      status: status === 'completed' ? ('completed' as const) : status,
    }));

    return {
      id: s.id,
      title: s.title || `单元 ${(s.order ?? 0) + 1}`,
      status,
      order: s.order ?? 0,
      children: children.length > 0 ? children : undefined,
    };
  });

  return {
    nodes,
    overallPercent,
    completedCount,
    totalCount,
    currentId: resolvedCurrent,
  };
}

/** Fallback tree from course units when no session yet. */
export function buildUnitTreeFromCourseUnits(
  units: Array<{ id: string; title: string; order?: number; knowledgePoints?: string[] }>,
  activeUnitId?: string | null,
): UnitTreeModel {
  const sorted = [...units].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const totalCount = sorted.length;
  const nodes: UnitTreeNode[] = sorted.map((u, i) => {
    const isCurrent = activeUnitId ? u.id === activeUnitId : i === 0;
    const status: UnitTreeNodeStatus = isCurrent
      ? 'current'
      : i < (sorted.findIndex((x) => x.id === activeUnitId) || 0)
        ? 'completed'
        : i === 0
          ? 'current'
          : 'locked';
    return {
      id: u.id,
      title: u.title,
      status: isCurrent ? 'current' : status,
      order: u.order ?? i,
      children: (u.knowledgePoints ?? []).map((kp, j) => ({
        id: `${u.id}_kp_${j}`,
        title: kp,
        status: isCurrent ? 'current' : status,
      })),
    };
  });
  // First unit open by default when no active
  if (!activeUnitId && nodes[0]) {
    nodes[0] = { ...nodes[0], status: 'current' };
    for (let i = 1; i < nodes.length; i++) {
      nodes[i] = { ...nodes[i]!, status: 'locked' };
    }
  }
  const completedCount = nodes.filter((n) => n.status === 'completed').length;
  return {
    nodes,
    overallPercent: totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100),
    completedCount,
    totalCount,
    currentId: nodes.find((n) => n.status === 'current')?.id ?? null,
  };
}

export function unitTreeStatusLabel(status: UnitTreeNodeStatus): string {
  switch (status) {
    case 'current':
      return '当前';
    case 'completed':
      return '已完成';
    case 'locked':
      return '未解锁';
    case 'open':
      return '可学习';
    default:
      return '';
  }
}

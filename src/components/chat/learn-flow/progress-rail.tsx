'use client';

/**
 * QUARANTINED (UX08) — Home LearnProgressRail.
 *
 * Production must not mount this component. Deep Course progress is the left
 * Unit tree on `/course/[id]`; Normal has no rail; Deep Planning uses inline
 * outline cards. Kept for offline demos / reference only — never a second
 * visible product state machine on Home.
 *
 * @deprecated Do not import from production Home / App Router pages.
 */

import PixelIcon from '@/components/icons/PixelIcon';
import { useLearnFlowStore, type LearnFlowStage } from '@/store/learn-flow-store';
import {
  buildProgressStepsFromStage,
  isLearnFlowActive,
  normalizeLearnStage,
} from '@/lib/agents/learn-state-machine';

/**
 * @deprecated UX08 quarantine — do not mount from production pages.
 * Home no longer imports this; component kept for reference only.
 */
export function LearnProgressRail() {
  const stage = useLearnFlowStore((s) => s.stage);
  const memoryEntries = useLearnFlowStore((s) => s.memoryEntries);
  const resources = useLearnFlowStore((s) => s.resources);
  const topic = useLearnFlowStore((s) => s.topic);
  const artifacts = useLearnFlowStore((s) => s.artifacts);

  const normalized = normalizeLearnStage(stage);
  if (!isLearnFlowActive(normalized) && normalized !== 'completed') {
    return null;
  }

  const latestProgress = [...artifacts]
    .reverse()
    .find((a) => a.kind === 'progress_update');

  const steps =
    latestProgress?.progressSteps && latestProgress.progressSteps.length > 0
      ? latestProgress.progressSteps
      : buildProgressStepsFromStage(normalized);

  const title = latestProgress?.title || '进度';
  const caption = latestProgress?.content;

  return (
    <aside
      className="w-[200px] shrink-0 border-l border-[var(--border)] bg-[var(--bg-primary)]/70 p-3 flex flex-col gap-3 overflow-y-auto"
      aria-label="进度"
    >
      <div className="flex items-center gap-2">
        <PixelIcon name="plan-goal" size={16} aria-hidden />
        <h2 className="font-classic text-xs tracking-widest uppercase text-[var(--text-primary)]">
          {title}
        </h2>
      </div>
      {topic && (
        <p className="font-zh text-xs text-[var(--text-muted)] leading-snug truncate" title={topic}>
          {topic}
        </p>
      )}
      {caption && (
        <p className="font-zh text-[10px] text-[var(--text-muted)] leading-snug">{caption}</p>
      )}
      <ol className="space-y-2">
        {steps.map((step) => {
          const active = step.status === 'active';
          const done = step.status === 'done';
          return (
            <li
              key={step.id}
              className={`flex items-center gap-2 px-2 py-1.5 border text-xs font-zh ${
                active
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text-primary)]'
                  : done
                    ? 'border-[var(--border-20)] text-[var(--text-secondary)]'
                    : 'border-transparent text-[var(--text-muted)]'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  active ? 'bg-[var(--accent)]' : done ? 'bg-[var(--success)]' : 'bg-[var(--border)]'
                }`}
              />
              {step.label}
            </li>
          );
        })}
      </ol>
      <div className="mt-auto pt-2 border-t border-[var(--border-20)] space-y-1 font-tech text-xs text-[var(--text-muted)]">
        <p>阶段 {stageLabel(normalized)}</p>
        <p>记忆 {memoryEntries.length}</p>
        <p>资源 {resources.length}</p>
        <p className="text-[9px] opacity-70">进度由会话仓库持有 · 旁白仅解释</p>
      </div>
    </aside>
  );
}

function stageLabel(stage: LearnFlowStage): string {
  switch (stage) {
    case 'idle':
      return '空闲';
    case 'intent_proposed':
      return '意图';
    case 'goal_clarification':
      return '目标';
    case 'calibration':
      return '校准';
    case 'outline':
      return '大纲';
    case 'ready':
      return '就绪';
    case 'teaching':
      return '教学';
    case 'recall':
      return '回忆';
    case 'assessment':
      return '评估';
    case 'remediation':
      return '补救';
    case 'completed':
      return '完成';
    case 'rejected':
      return '已取消';
    case 'desktop_pending_trust':
      return '权限确认';
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

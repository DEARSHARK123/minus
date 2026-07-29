'use client';

import type { ExecutionStep } from '@/types/agent';
import { StatusIcon, iconSizes } from '@/lib/icons';
import { ListOrdered } from 'lucide-react';

const STATUS_COLORS: Record<ExecutionStep['status'], string> = {
  pending: 'text-[var(--text-tertiary)]',
  running: 'text-blue-500',
  completed: 'text-[var(--success)]',
  failed: 'text-red-500',
  waiting: 'text-amber-500',
};

const TYPE_LABELS: Record<ExecutionStep['type'], string> = {
  plan: '规划',
  tool_call: '操作',
  tool_result: '结果',
  review: '检查',
  error: '错误',
  human_input: '等待确认',
};

export function ExecutionTimeline({ steps }: { steps: ExecutionStep[] }) {
  if (!steps || steps.length === 0) return null;

  return (
    <div className="w-full py-2">
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] mb-2 px-1">
        <ListOrdered size={iconSizes.xs} aria-hidden />
        执行步骤
      </div>
      <div className="space-y-0.5">
        {steps.map((step, i) => (
          <div
            key={step.id}
            className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-secondary)] transition-colors group"
          >
            <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
              <StatusIcon
                status={step.status}
                size={iconSizes.xs}
                className={`leading-none ${STATUS_COLORS[step.status]}`}
                aria-hidden
              />
              {i < steps.length - 1 && (
                <div className="w-px h-3 bg-[var(--border-primary)] mt-1" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                  {step.title}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] flex-shrink-0">
                  {TYPE_LABELS[step.type]}
                </span>
              </div>
              {step.detail && (
                <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                  {step.detail}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

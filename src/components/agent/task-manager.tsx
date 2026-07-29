'use client';

import { CheckCircle2, Circle, Loader2, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { TaskStep } from '@/types/agent';
import { useState } from 'react';
import { iconSizes } from '@/lib/icons';

interface TaskManagerProps {
  steps: TaskStep[];
  currentStep: number;
  status: 'idle' | 'thinking' | 'executing' | 'done' | 'error';
}

export function TaskManager({ steps, currentStep, status }: TaskManagerProps) {
  const [expanded, setExpanded] = useState(true);

  if (steps.length === 0) return null;

  const completedCount = steps.filter(s => s.status === 'completed').length;

  return (
    <div className="border border-[var(--border)] bg-[var(--bg-primary)]/80 backdrop-blur-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-tertiary)]/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          {status === 'thinking' || status === 'executing' ? (
            <Loader2 size={iconSizes.md} className="text-[var(--accent)] animate-spin" aria-hidden />
          ) : status === 'done' ? (
            <CheckCircle2 size={iconSizes.md} className="text-[var(--success)]" aria-hidden />
          ) : status === 'error' ? (
            <XCircle size={iconSizes.md} className="text-[var(--error)]" aria-hidden />
          ) : (
            <Circle size={iconSizes.md} className="text-[var(--accent)]" aria-hidden />
          )}
          <span className="font-tech text-xs tracking-wider text-[var(--text-secondary)] uppercase">
            Task Progress
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-tech text-xs text-[var(--accent)]">
            {completedCount}/{steps.length}
          </span>
          {expanded ? <ChevronDown size={iconSizes.sm} className="text-[var(--accent)]" aria-hidden /> : <ChevronRight size={iconSizes.sm} className="text-[var(--accent)]" aria-hidden />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border-20)] px-4 py-2 space-y-1">
          {steps.map((step, index) => (
            <StepItem key={step.id} step={step} isActive={index === currentStep} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepItem({ step, isActive }: { step: TaskStep; isActive: boolean }) {
  return (
    <div
      className={`flex items-start gap-3 py-2 px-2 rounded transition-colors ${
        isActive ? 'bg-[var(--accent)]/10' : ''
      }`}
    >
      <div className="mt-0.5 shrink-0">
        {step.status === 'completed' ? (
          <CheckCircle2 size={iconSizes.md} className="text-[var(--success)]" aria-hidden />
        ) : step.status === 'in_progress' ? (
          <Loader2 size={iconSizes.md} className="text-[var(--accent)] animate-spin" aria-hidden />
        ) : step.status === 'failed' ? (
          <XCircle size={iconSizes.md} className="text-[var(--error)]" aria-hidden />
        ) : (
          <Circle size={iconSizes.md} className="text-[var(--text-muted)]/40" aria-hidden />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span
          className={`font-zh text-sm ${
            step.status === 'completed'
              ? 'text-[var(--text-muted)] line-through'
              : step.status === 'in_progress'
              ? 'text-[var(--text-primary)] font-bold'
              : step.status === 'failed'
              ? 'text-[var(--error)]'
              : 'text-[var(--text-secondary)]'
          }`}
        >
          {step.title}
        </span>
        {step.description && isActive && (
          <p className="font-tech text-xs text-[var(--text-muted)] mt-1">{step.description}</p>
        )}
        {step.result && step.status === 'completed' && (
          <p className="font-tech text-xs text-[var(--success)] mt-1">{step.result}</p>
        )}
      </div>
    </div>
  );
}

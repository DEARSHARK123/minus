'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Brain, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, X, Circle } from 'lucide-react';
import { TaskStep } from '@/types/agent';
import { iconSizes } from '@/lib/icons';
import { MinusMark } from '@/components/brand/minus-mark';

type ThinkingStatus = 'thinking' | 'executing' | 'done' | 'error';

interface ThinkingStatusBarProps {
  status?: ThinkingStatus;
  steps?: TaskStep[];
  currentStep?: number;
  onCancel?: () => void;
}

const statusTextMap: Record<ThinkingStatus, string[]> = {
  thinking: ['正在整理回答…', '正在分析…', '梳理信息中…'],
  executing: ['正在处理…', '执行操作中…'],
  done: ['已完成'],
  error: ['出了点问题'],
};

const statusConfig: Record<ThinkingStatus, {
  colorVar: string;
  bgVar: string;
  borderVar: string;
  icon: typeof Brain;
}> = {
  thinking: {
    colorVar: 'var(--state-thinking)',
    bgVar: 'var(--state-thinking-bg)',
    borderVar: 'var(--state-thinking-border)',
    icon: Brain,
  },
  executing: {
    colorVar: 'var(--state-executing)',
    bgVar: 'var(--state-executing-bg)',
    borderVar: 'var(--state-executing-border)',
    icon: Loader2,
  },
  done: {
    colorVar: 'var(--state-done)',
    bgVar: 'var(--state-done-bg)',
    borderVar: 'var(--state-done-border)',
    icon: CheckCircle2,
  },
  error: {
    colorVar: 'var(--state-error)',
    bgVar: 'var(--state-error-bg)',
    borderVar: 'var(--state-error-border)',
    icon: XCircle,
  },
};

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}分钟` : `${m}分${s}秒`;
}

function StatusIcon({ status, color }: { status: ThinkingStatus; color: string }) {
  const config = statusConfig[status];
  const Icon = config.icon;

  if (status === 'executing') {
    return <Loader2 size={iconSizes.sm} className="animate-spin" style={{ color }} aria-hidden />;
  }
  if (status === 'thinking') {
    return <Brain size={iconSizes.sm} className="animate-thinking-glow" style={{ color }} aria-hidden />;
  }
  return <Icon size={iconSizes.sm} style={{ color }} aria-hidden />;
}

function StepItem({ step, isActive }: { step: TaskStep; isActive: boolean }) {
  return (
    <div
      className={`flex items-start gap-2.5 py-1.5 px-2 rounded transition-colors duration-200 ${
        isActive ? 'bg-[var(--accent)]/5' : ''
      }`}
    >
      <div className="mt-0.5 shrink-0">
        {step.status === 'completed' ? (
          <CheckCircle2 size={iconSizes.sm} style={{ color: 'var(--state-done)' }} aria-hidden />
        ) : step.status === 'in_progress' ? (
          <Loader2 size={iconSizes.sm} className="animate-spin" style={{ color: 'var(--state-executing)' }} aria-hidden />
        ) : step.status === 'failed' ? (
          <XCircle size={iconSizes.sm} style={{ color: 'var(--state-error)' }} aria-hidden />
        ) : (
          <Circle size={iconSizes.sm} className="text-[var(--text-muted)]/30" aria-hidden />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span
          className={`font-zh text-xs leading-tight ${
            step.status === 'completed'
              ? 'text-[var(--text-muted)] line-through'
              : step.status === 'in_progress'
              ? 'text-[var(--text-primary)] font-medium'
              : step.status === 'failed'
              ? 'text-[var(--state-error)]'
              : 'text-[var(--text-secondary)]'
          }`}
        >
          {step.title}
        </span>
        {step.description && isActive && (
          <p className="font-tech text-[11px] text-[var(--text-muted)] mt-0.5 truncate">{step.description}</p>
        )}
      </div>
    </div>
  );
}

export function ThinkingStatusBar({
  status = 'thinking',
  steps = [],
  currentStep = 0,
  onCancel,
}: ThinkingStatusBarProps) {
  const [elapsed, setElapsed] = useState(0);
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [textIndex, setTextIndex] = useState(0);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isTerminal = status === 'done' || status === 'error';

  useEffect(() => {
    if (isTerminal) {
      if (timerRef.current) clearInterval(timerRef.current);
      if (textTimerRef.current) clearInterval(textTimerRef.current);
      return;
    }

    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTerminal]);

  useEffect(() => {
    if (isTerminal) return;

    const texts = statusTextMap[status];
    if (texts.length <= 1) return;

    textTimerRef.current = setInterval(() => {
      setTextIndex(prev => (prev + 1) % texts.length);
    }, 3000);

    return () => {
      if (textTimerRef.current) clearInterval(textTimerRef.current);
    };
  }, [status, isTerminal]);

  const config = statusConfig[status];
  const currentTexts = statusTextMap[status];
  const displayText = currentTexts[textIndex % currentTexts.length];
  const hasSteps = steps.length > 0;
  const completedCount = steps.filter(s => s.status === 'completed').length;

  if (isTerminal) {
    return (
      <div
        className="flex items-center gap-2 animate-state-enter"
        role="status"
        aria-live="polite"
      >
        <StatusIcon status={status} color={config.colorVar} />
        <span className="font-tech text-[12px]" style={{ color: config.colorVar }}>
          {status === 'done' ? `已思考 ${formatElapsed(elapsed)}` : displayText}
        </span>
        {status === 'error' && (
          <span className="font-tech text-[11px] text-[var(--text-muted)] ml-1">
            {formatElapsed(elapsed)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-3 animate-state-enter"
      role="status"
      aria-live="polite"
      aria-label={status === 'thinking' ? '正在整理回答' : '正在处理'}
    >
      <div className="w-6 h-6 flex items-center justify-center bg-[var(--bg-tertiary)] border border-[var(--border)] shrink-0">
        <MinusMark size={24} animated className="text-[var(--accent)]" />
      </div>

      <div className="max-w-[85%] min-w-0 flex-1">
        <div
          className="border backdrop-blur-sm overflow-hidden transition-all duration-300"
          style={{
            backgroundColor: config.bgVar,
            borderColor: config.borderVar,
          }}
        >
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="shrink-0">
              <StatusIcon status={status} color={config.colorVar} />
            </div>

            <div className="flex-1 min-w-0">
              <span
                className="font-tech text-[13px] font-medium"
                style={{ color: config.colorVar }}
              >
                {displayText}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {hasSteps && (
                <span className="font-tech text-[11px] text-[var(--text-muted)]">
                  {completedCount}/{steps.length}
                </span>
              )}

              <span className="font-tech text-[11px] tabular-nums text-[var(--text-muted)]">
                {formatElapsed(elapsed)}
              </span>

              {onCancel && (
                <button
                  onClick={onCancel}
                  className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  aria-label="停止生成"
                  title="停止生成"
                >
                  <X size={iconSizes.sm} aria-hidden />
                </button>
              )}
            </div>
          </div>

          <div className="h-[2px] overflow-hidden" style={{ backgroundColor: config.borderVar }}>
            <div
              className="h-full animate-status-progress"
              style={{ backgroundColor: config.colorVar }}
            />
          </div>

          {hasSteps && (
            <div className="border-t" style={{ borderColor: config.borderVar }}>
              <button
                onClick={() => setStepsExpanded(!stepsExpanded)}
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--bg-tertiary)]/20 transition-colors"
              >
                <span className="font-zh text-[11px] tracking-wide text-[var(--text-muted)]">
                  处理步骤
                </span>
                {stepsExpanded && !isTerminal ? (
                  <ChevronDown size={iconSizes.xs} className="text-[var(--text-muted)]" aria-hidden />
                ) : (
                  <ChevronRight size={iconSizes.xs} className="text-[var(--text-muted)]" aria-hidden />
                )}
              </button>

              {stepsExpanded && !isTerminal && (
                <div className="px-2 pb-1.5 max-h-[200px] overflow-y-auto space-y-0.5">
                  {steps.map((step, index) => (
                    <StepItem key={step.id} step={step} isActive={index === currentStep} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-1.5">
          <span className="font-tech text-xs text-[var(--text-muted)]">Minus</span>
        </div>
      </div>
    </div>
  );
}

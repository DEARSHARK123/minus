'use client';

import React from 'react';
import { MinusMark } from '@/components/brand/minus-mark';

type ThinkingStatus = 'thinking' | 'executing' | 'done' | 'error';
type IndicatorSize = 'sm' | 'md' | 'lg';

interface ThinkingIndicatorProps {
  status?: ThinkingStatus;
  text?: string;
  size?: IndicatorSize;
  showIcon?: boolean;
  showText?: boolean;
  animated?: boolean;
  className?: string;
}

const statusConfig: Record<ThinkingStatus, { text: string; colorVar: string }> = {
  thinking: {
    text: '正在准备回答…',
    colorVar: 'var(--state-thinking)',
  },
  executing: {
    text: '正在处理…',
    colorVar: 'var(--state-executing)',
  },
  done: {
    text: '已完成',
    colorVar: 'var(--state-done)',
  },
  error: {
    text: '出现错误',
    colorVar: 'var(--state-error)',
  },
};

const sizeConfig: Record<IndicatorSize, { iconSize: string; textSize: string; padding: string }> = {
  sm: {
    iconSize: 'w-4 h-4',
    textSize: 'text-xs',
    padding: 'px-2 py-1',
  },
  md: {
    iconSize: 'w-5 h-5',
    textSize: 'text-sm',
    padding: 'px-3 py-1.5',
  },
  lg: {
    iconSize: 'w-6 h-6',
    textSize: 'text-base',
    padding: 'px-4 py-2',
  },
};

export function ThinkingIndicator({
  status = 'thinking',
  text,
  size = 'md',
  showIcon = true,
  showText = true,
  animated = true,
  className = '',
}: ThinkingIndicatorProps) {
  const config = statusConfig[status];
  const sizeConf = sizeConfig[size];
  const displayText = text || config.text;

  return (
    <div
      className={`
        inline-flex items-center gap-2
        border backdrop-blur-sm
        ${sizeConf.padding}
        transition-all duration-300
        ${className}
      `}
      style={{
        borderColor: `color-mix(in srgb, ${config.colorVar} 20%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${config.colorVar} 8%, transparent)`,
      }}
    >
      {showIcon && (
        <div className={`${sizeConf.iconSize} flex-shrink-0`}>
          {animated ? (
            <MinusMark size={24} animated className="w-full h-full" />
          ) : (
            <MinusMark size={24} className="w-full h-full" />
          )}
        </div>
      )}

      {showText && (
        <span
          className={`font-tech ${sizeConf.textSize} animate-pulse`}
          style={{ color: config.colorVar }}
        >
          {displayText}
        </span>
      )}
    </div>
  );
}

export function ThinkingIndicatorMinimal({
  status = 'thinking',
  text,
  className = '',
}: Omit<ThinkingIndicatorProps, 'size' | 'showIcon' | 'showText' | 'animated'>) {
  const config = statusConfig[status];
  const displayText = text || config.text;

  return (
    <div
      className={`inline-flex items-center gap-2 ${className}`}
    >
      <div className="flex space-x-1">
        <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: config.colorVar, animationDelay: '0ms' }} />
        <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: config.colorVar, animationDelay: '150ms' }} />
        <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: config.colorVar, animationDelay: '300ms' }} />
      </div>

      <span className="font-tech text-xs animate-pulse" style={{ color: config.colorVar }}>
        {displayText}
      </span>
    </div>
  );
}

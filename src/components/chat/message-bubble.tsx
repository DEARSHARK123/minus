'use client';

import { useSettingsStore } from '@/store/settings-store';
import { useAgentStore } from '@/store/agent-store';
import { ToolIcon, iconSizes } from '@/lib/icons';
import { ThinkingStatusBar } from './thinking-status-bar';
import { AssistantRichContent } from '@/components/chat/learn-content-blocks';
import { MinusMark } from '@/components/brand/minus-mark';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  thinking?: boolean;
  thinkingStatus?: 'thinking' | 'executing' | 'done' | 'error';
  contentBlocks?: Array<{
    kind: 'summary' | 'key' | 'tip' | 'definition' | 'section' | 'prose';
    title?: string;
    body: string;
  }>;
}

interface MessageBubbleProps {
  message: Message;
  onCancel?: () => void;
}

export function MessageBubble({ message, onCancel }: MessageBubbleProps) {
  const chatFontSize = useSettingsStore(s => s.settings.chatFontSize);

  const agentPlan = useAgentStore(s => s.state.plan);
  const agentCurrentStep = useAgentStore(s => s.state.currentStep);

  const isThinkingActive = message.thinking && (message.thinkingStatus === 'thinking' || message.thinkingStatus === 'executing');
  const isThinkingTerminal = message.thinking && (message.thinkingStatus === 'done' || message.thinkingStatus === 'error');

  if (message.role === 'user') {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[70%]">
          <div className="px-4 py-3 bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] shadow-md">
            <p className="leading-relaxed whitespace-pre-wrap font-zh" style={{ fontSize: `${chatFontSize}px` }}>{message.content}</p>
          </div>
          <div className="flex items-center justify-end gap-2 mt-1.5">
            <span className="font-zh text-xs text-[var(--text-muted)]">你</span>
          </div>
        </div>
      </div>
    );
  }

  if (message.role === 'tool') {
    return (
      <div className="flex items-start gap-3 animate-fade-in">
        <div className="w-6 h-6 flex items-center justify-center bg-[var(--bg-tertiary)] border border-[var(--border)] shrink-0">
          <ToolIcon tool={message.toolName} size={iconSizes.xs} className="text-[var(--text-muted)]" aria-hidden />
        </div>
        <div className="max-w-[80%] min-w-0">
          <div className="px-4 py-3 bg-[var(--bg-tertiary)] border border-[var(--border-20)]">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-tech text-xs text-[var(--accent)] uppercase tracking-wider">{message.toolName || 'Tool'}</span>
            </div>
            <p className="text-[var(--text-secondary)] font-tech leading-relaxed" style={{ fontSize: `${chatFontSize}px` }}>{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  if (isThinkingActive) {
    return (
      <ThinkingStatusBar
        status={message.thinkingStatus}
        steps={agentPlan}
        currentStep={agentCurrentStep}
        onCancel={onCancel}
      />
    );
  }

  if (isThinkingTerminal) {
    return (
      <ThinkingStatusBar
        status={message.thinkingStatus}
        steps={agentPlan}
        currentStep={agentCurrentStep}
      />
    );
  }

  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <div className="w-6 h-6 flex items-center justify-center bg-[var(--bg-tertiary)] border border-[var(--border)] shrink-0">
        <MinusMark size={24} className="text-[var(--accent)]" />
      </div>
      <div className="max-w-[80%] min-w-0">
        <div className="px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-20)] shadow-sm">
          <div className="text-[var(--text-primary)] leading-relaxed font-zh" style={{ fontSize: `${chatFontSize}px` }}>
            <AssistantRichContent
              content={message.content}
              contentBlocks={message.contentBlocks}
              fallback={(c) => <p className="whitespace-pre-wrap">{c}</p>}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="font-tech text-xs text-[var(--text-muted)]">Minus</span>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useRef, useEffect } from 'react';
import { Paperclip, Send, ChevronDown, Loader2 } from 'lucide-react';
import { PlaybookSelector } from '../playbook/playbook-selector';
import { useChatStore } from '@/store/chat-store';
import { playbookRegistry } from '@/lib/playbooks';
import { Playbook } from '@/types/playbook';
import { iconSizes } from '@/lib/icons';

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  initialPrompt?: string;
  onPlaybookSelect?: (playbook: Playbook) => void;
}

export function ChatInput({ onSend, disabled, initialPrompt, onPlaybookSelect }: ChatInputProps) {
  const [message, setMessage] = useState(initialPrompt || '');
  const [showPlaybookSelector, setShowPlaybookSelector] = useState(false);
  const [playbooks, setPlaybooks] = useState<Playbook[]>(() => playbookRegistry.getAll());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeConversationId = useChatStore(s => s.activeConversationId);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/customization')
      .then((response) => response.json())
      .then((json) => {
        if (cancelled || !json.success || !Array.isArray(json.data?.playbooks)) return;
        setPlaybooks(
          json.data.playbooks
            .filter((item: { enabled?: boolean }) => item.enabled !== false)
            .map((item: Record<string, unknown>) => ({
              id: String(item.id),
              name: String(item.name || item.id),
              description: String(item.description || ''),
              category: 'featured' as const,
              icon: 'bookOpen' as const,
              tags: [],
              prompt: String(item.prompt || ''),
              tools: Array.isArray(item.tools) ? item.tools.map(String) : [],
              steps: Array.isArray(item.steps) ? item.steps : [],
              createdAt: new Date(0),
              updatedAt: new Date(String(item.updatedAt || 0)),
              usageCount: 0,
              rating: 0,
            })) as Playbook[],
        );
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (initialPrompt) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [initialPrompt]);

  const handleSubmit = () => {
    if (message.trim() && !disabled) {
      onSend(message.trim());
      setMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        160
      )}px`;
    }
  }, [message]);

  const handlePlaybookSelect = (playbook: Playbook) => {
    if (activeConversationId) {
      useChatStore.getState().renameConversation(
        activeConversationId,
        playbook.name
      );
    }
    setMessage(playbook.prompt);
    onPlaybookSelect?.(playbook);
    setShowPlaybookSelector(false);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
  };

  return (
    <>
      <div className="relative z-10 border-t border-[var(--border)] p-4 bg-[var(--bg-primary)]/80 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            title="附件（即将支持）"
            aria-label="附件（即将支持）"
          >
            <Paperclip size={iconSizes.sm} aria-hidden />
            <span className="font-zh">附件</span>
          </button>

          <button
            type="button"
            onClick={() => setShowPlaybookSelector(true)}
            className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            aria-label="选择工作流"
          >
            <span className="font-zh">工作流</span>
            <ChevronDown size={iconSizes.xs} aria-hidden />
          </button>
        </div>

        <div className="flex items-end gap-3">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled
                ? '正在处理…'
                : '输入问题，Enter 发送，Shift+Enter 换行…'
            }
            disabled={disabled}
            aria-label="主输入框"
            className="flex-1 min-h-[44px] max-h-[160px] px-4 py-3 bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted-40)] resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:border-[var(--accent)] transition-colors duration-200 font-zh disabled:opacity-50"
            rows={1}
          />

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!message.trim() || disabled}
            aria-label={disabled ? '正在处理' : '发送'}
            className="min-h-[44px] min-w-[44px] px-4 py-3 bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] font-classic tracking-wider text-sm hover:opacity-90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {disabled ? (
              <Loader2 size={iconSizes.md} className="animate-spin" aria-hidden />
            ) : (
              <Send size={iconSizes.md} aria-hidden />
            )}
          </button>
        </div>
      </div>

      {showPlaybookSelector && (
        <PlaybookSelector
          playbooks={playbooks}
          onSelect={handlePlaybookSelect}
          onClose={() => setShowPlaybookSelector(false)}
        />
      )}
    </>
  );
}

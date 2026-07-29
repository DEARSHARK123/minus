'use client';

import { useEffect, useRef } from 'react';
import { MessageBubble } from './message-bubble';
import { useSettingsStore } from '@/store/settings-store';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  thinking?: boolean;
  thinkingStatus?: 'thinking' | 'executing' | 'done' | 'error';
}

interface ChatMessagesProps {
  messages: Message[];
  onCancel?: () => void;
}

export function ChatMessages({ messages, onCancel }: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const showToolUse = useSettingsStore(s => s.settings.showToolUse);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const visibleMessages = showToolUse ? messages : messages.filter(m => m.role !== 'tool');

  return (
    <div className="relative z-10 flex-1 overflow-y-auto p-6 space-y-6">
      {visibleMessages.map((message) => (
        <MessageBubble key={message.id} message={message} onCancel={onCancel} />
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Playbook } from '@/types/playbook';
import { PlaybookList } from './playbook-list';
import { PlaybookIcon } from './playbook-icon';
import { X } from 'lucide-react';
import { iconSizes } from '@/lib/icons';

interface PlaybookSelectorProps {
  playbooks: Playbook[];
  onSelect: (playbook: Playbook) => void;
  onClose: () => void;
}

export function PlaybookSelector({ playbooks, onSelect, onClose }: PlaybookSelectorProps) {
  const [selectedPlaybook, setSelectedPlaybook] = useState<Playbook | null>(null);

  const handleSelect = (playbook: Playbook) => {
    setSelectedPlaybook(playbook);
  };

  const handleConfirm = () => {
    if (selectedPlaybook) {
      onSelect(selectedPlaybook);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[80vh] bg-[var(--bg-primary)] border border-[var(--border)] shadow-2xl flex flex-col animate-fade-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-20)]">
          <div>
            <h2 className="font-classic text-lg font-bold tracking-widest text-[var(--text-primary)] uppercase">
              选择 Playbook
            </h2>
            <p className="font-zh text-sm text-[var(--text-secondary)] mt-1">
              选择一个预设的工作流程来开始任务
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50 transition-colors duration-200"
            aria-label="Close playbook selector"
          >
            <X size={iconSizes.lg} aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <PlaybookList playbooks={playbooks} onSelect={handleSelect} />
        </div>

        <div className="px-6 py-4 border-t border-[var(--border-20)] flex items-center justify-between">
          <div className="font-zh text-sm text-[var(--text-secondary)]">
            {selectedPlaybook ? (
              <span className="inline-flex items-center gap-2">
                已选择:
                <PlaybookIcon name={selectedPlaybook.icon} size={iconSizes.md} className="text-[var(--accent)]" aria-hidden />
                <span className="text-[var(--text-primary)] font-bold">{selectedPlaybook.name}</span>
              </span>
            ) : (
              <span>请选择一个 Playbook</span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50 transition-colors duration-200"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedPlaybook}
              className="px-4 py-2 bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] font-classic tracking-wider text-sm hover:opacity-90 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
            >
              确认选择
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

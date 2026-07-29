'use client';

import { Playbook } from '@/types/playbook';
import { PlaybookIcon } from './playbook-icon';
import { iconSizes } from '@/lib/icons';

interface PlaybookCardProps {
  playbook: Playbook;
  onSelect: (playbook: Playbook) => void;
}

export function PlaybookCard({ playbook, onSelect }: PlaybookCardProps) {
  return (
    <div
      onClick={() => onSelect(playbook)}
      className="p-4 bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--accent)] hover:shadow-xl cursor-pointer transition-all duration-200 animate-fade-in relative overflow-hidden group"
    >
      <div className="absolute top-0 right-0 w-12 h-12 bg-[var(--accent)]/10 rounded-bl-full -z-10 group-hover:scale-150 transition-transform"></div>
      
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 bg-[var(--bg-tertiary)] flex items-center justify-center border border-[var(--border)]">
          <PlaybookIcon name={playbook.icon} size={iconSizes.lg} className="text-[var(--accent)]" aria-hidden />
        </div>
        <div>
          <h3 className="font-zh font-bold text-[var(--text-primary)] text-sm">
            {playbook.name}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="font-tech text-xs text-[var(--text-secondary)]">
              {playbook.usageCount} 次使用
            </span>
            {playbook.rating > 0 && (
              <span className="font-tech text-xs text-[var(--warning)]">
                ★ {playbook.rating.toFixed(1)}
              </span>
            )}
          </div>
        </div>
      </div>

      <p className="font-zh text-[var(--text-secondary)] text-xs leading-relaxed mb-3 line-clamp-2">
        {playbook.description}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {playbook.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="px-2 py-1 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] font-tech text-xs border border-[var(--border-20)]"
          >
            {tag}
          </span>
        ))}
        {playbook.tags.length > 3 && (
          <span className="px-2 py-1 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] font-tech text-xs border border-[var(--border-20)]">
            +{playbook.tags.length - 3}
          </span>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-[var(--border-20)]">
        <div className="flex items-center justify-between font-tech text-xs text-[var(--text-muted)]">
          <span>{playbook.steps.length} 个步骤</span>
          <span>{playbook.tools.length} 个工具</span>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { Playbook, PlaybookCategory } from '@/types/playbook';
import { iconSizes } from '@/lib/icons';
import { PlaybookCard } from './playbook-card';

interface PlaybookListProps {
  playbooks: Playbook[];
  onSelect: (playbook: Playbook) => void;
}

const categories: { id: PlaybookCategory; label: string }[] = [
  { id: 'featured', label: '精选' },
  { id: 'business', label: '商业' },
  { id: 'creative', label: '创意' },
  { id: 'sales_marketing', label: '销售和营销' },
  { id: 'education', label: '教育' },
  { id: 'life', label: '欢乐与生活' },
];

export function PlaybookList({ playbooks, onSelect }: PlaybookListProps) {
  const [activeCategory, setActiveCategory] = useState<PlaybookCategory>('featured');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPlaybooks = playbooks.filter((pb) => {
    const matchesCategory = activeCategory === 'featured' || pb.category === activeCategory;
    const matchesSearch = searchQuery === '' || 
      pb.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pb.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pb.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-[var(--border-20)]">
        <input
          type="text"
          placeholder="搜索 Playbook..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted-40)] focus:outline-none focus:border-[var(--accent)] transition-colors duration-200 font-zh"
        />
      </div>

      <div className="px-4 py-3 border-b border-[var(--border-20)] overflow-x-auto">
        <div className="flex gap-2">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setActiveCategory(category.id)}
              className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors duration-200 ${
                activeCategory === category.id
                  ? 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--border)] font-bold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50'
              }`}
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-3">
          {filteredPlaybooks.map((playbook) => (
            <PlaybookCard
              key={playbook.id}
              playbook={playbook}
              onSelect={onSelect}
            />
          ))}
          
          {filteredPlaybooks.length === 0 && (
            <div className="text-center py-8 text-[var(--text-muted)]">
              <Inbox size={iconSizes['2xl']} className="mx-auto mb-2 text-[var(--text-muted)]/40" aria-hidden />
              <div className="text-sm font-zh">未找到匹配的 Playbook</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

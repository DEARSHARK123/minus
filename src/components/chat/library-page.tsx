'use client';

import { useEffect } from 'react';
import { KnowledgeBase } from '@/components/learning/knowledge-base';
import { useLearningStore } from '@/store/learning-store';

/** Mounts legacy KnowledgeBase into chat-shell nav. */
export function LibraryPage() {
  const load = useLearningStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0">
        <KnowledgeBase />
      </div>
    </div>
  );
}

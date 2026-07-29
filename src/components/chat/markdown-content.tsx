'use client';

import type { ReactNode } from 'react';
import { parseMarkdownBlocks } from '@/lib/chat/markdown-content';

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function safeLink(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function InlineMarkdown({ text }: { text: string }): ReactNode {
  return text.split(INLINE_RE).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-[var(--accent-strong)]">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-tech text-[0.9em] text-[var(--accent-strong)]">{part.slice(1, -1)}</code>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    const href = link ? safeLink(link[2]!) : null;
    if (link && href) {
      return <a key={index} href={href} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline underline-offset-2 hover:text-[var(--accent-strong)]">{link[1]}</a>;
    }
    return <span key={index}>{part}</span>;
  });
}

export function MarkdownContent({
  content,
  variant = 'chat',
}: {
  content: string;
  variant?: 'chat' | 'lesson';
}) {
  const blocks = parseMarkdownBlocks(content);
  const isLesson = variant === 'lesson';
  return (
    <div
      className={`course-markdown min-w-0 max-w-full font-zh text-[var(--text-primary)] [overflow-wrap:anywhere] ${
        isLesson ? 'space-y-5 text-[15px] leading-8 sm:text-base' : 'space-y-3 text-sm leading-7'
      }`}
      data-testid="course-markdown"
      data-variant={variant}
    >
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            const className = block.level <= 2
              ? `${isLesson ? 'pt-6 text-xl leading-8' : 'pt-3 text-lg leading-7'} font-classic font-bold text-[var(--text-primary)]`
              : `${isLesson ? 'pt-4 text-lg leading-7' : 'pt-2 text-base leading-6'} font-classic font-bold text-[var(--text-primary)]`;
            return block.level <= 2
              ? <h2 key={index} className={className}><InlineMarkdown text={block.text} /></h2>
              : <h3 key={index} className={className}><InlineMarkdown text={block.text} /></h3>;
          }
          case 'paragraph':
            return <p key={index} className={isLesson ? 'leading-8 text-[var(--text-secondary)]' : 'leading-7'}><InlineMarkdown text={block.text} /></p>;
          case 'unordered_list':
            return <ul key={index} className={`list-disc pl-5 marker:text-[var(--accent)] ${isLesson ? 'space-y-2.5 leading-8 text-[var(--text-secondary)]' : 'space-y-1.5'}`}>{block.items.map((item, itemIndex) => <li key={itemIndex} className="pl-1"><InlineMarkdown text={item} /></li>)}</ul>;
          case 'ordered_list':
            return <ol key={index} className={`list-decimal pl-5 marker:font-semibold marker:text-[var(--accent)] ${isLesson ? 'space-y-2.5 leading-8 text-[var(--text-secondary)]' : 'space-y-1.5'}`}>{block.items.map((item, itemIndex) => <li key={itemIndex} className="pl-1"><InlineMarkdown text={item} /></li>)}</ol>;
          case 'quote':
            return <blockquote key={index} className={`border-l-[3px] border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-secondary)] ${isLesson ? 'px-5 py-4 leading-8' : 'px-4 py-2.5'}`}><InlineMarkdown text={block.text} /></blockquote>;
          case 'code':
            return <div key={index} className="min-w-0 max-w-full overflow-hidden rounded-lg border border-[var(--border-20)] bg-[var(--code-bg,#1f2328)]"><div className="border-b border-white/10 px-3 py-1.5 font-tech text-[10px] text-white/60">{block.language || 'code'}</div><pre className="max-w-full overflow-x-auto p-3 text-[12px] leading-6 text-[var(--code-text,#f3f4f6)]"><code>{block.code}</code></pre></div>;
          case 'table':
            return <div key={index} className="overflow-x-auto rounded-lg border border-[var(--border-20)]"><table className="w-full min-w-[420px] border-collapse text-left text-xs"><thead className="bg-[var(--bg-tertiary)]"><tr>{block.headers.map((cell, cellIndex) => <th key={cellIndex} className="border-b border-[var(--border-20)] px-3 py-2 font-semibold"><InlineMarkdown text={cell} /></th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-[var(--border-20)] last:border-b-0">{block.headers.map((_, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top text-[var(--text-secondary)]"><InlineMarkdown text={row[cellIndex] || ''} /></td>)}</tr>)}</tbody></table></div>;
          case 'rule':
            return <hr key={index} className={`${isLesson ? 'hidden' : 'my-5'} border-0 border-t border-[var(--border-20)]`} />;
          default: {
            const exhaustive: never = block;
            return exhaustive;
          }
        }
      })}
    </div>
  );
}

'use client';

import type { ReactNode } from 'react';
import {
  hasLearnContentMarkup,
  parseLearnContent,
  type LearnContentBlock,
} from '@/lib/chat/learn-content';

function renderInlineBold(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold text-inherit">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function renderBodyLines(body: string): ReactNode {
  const lines = body.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1.5" />;
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <ul key={i} className="list-disc pl-5">
              <li className="pl-0.5">{renderInlineBold(trimmed.slice(2))}</li>
            </ul>
          );
        }
        const num = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (num) {
          return (
            <ol key={i} className="list-decimal pl-5">
              <li className="pl-0.5">{renderInlineBold(num[2]!)}</li>
            </ol>
          );
        }
        return (
          <p key={i} className="leading-relaxed">
            {renderInlineBold(line)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Semantic colored learn card: 4px solid left accent in the title color,
 * soft tinted background, thin border in the matching border color.
 */
function SemanticLearnCard({
  block,
  tone,
  label,
  fallbackTitle,
}: {
  block: LearnContentBlock;
  tone: 'key' | 'tip' | 'definition';
  label: string;
  fallbackTitle: string;
}) {
  return (
    <section
      className="my-3 rounded-xl border-l-4 px-4 py-3"
      style={{
        border: `1px solid var(--card-${tone}-border)`,
        borderLeft: `4px solid var(--card-${tone}-title)`,
        background: `var(--card-${tone}-bg)`,
      }}
      data-learn-block={tone}
      aria-label={label}
    >
      <h4
        className="font-classic text-xs font-bold mb-1.5"
        style={{ color: `var(--card-${tone}-title)` }}
      >
        {block.title || fallbackTitle}
      </h4>
      <div className="font-zh text-sm text-[var(--text-secondary)] leading-relaxed">
        {renderBodyLines(block.body)}
      </div>
    </section>
  );
}

function LearnBlockView({ block }: { block: LearnContentBlock }) {
  switch (block.kind) {
    case 'summary':
      return (
        <section
          className="my-3 rounded-xl border-l-4 border-[var(--border-20)] bg-[var(--accent-soft)] px-4 py-3"
          data-learn-block="summary"
          aria-label="摘要"
        >
          <h4 className="font-classic text-xs font-bold text-[var(--accent-strong)] mb-1.5">
            {block.title || '摘要'}
          </h4>
          <div className="font-zh text-sm text-[var(--text-secondary)] leading-relaxed">
            {renderBodyLines(block.body)}
          </div>
        </section>
      );
    case 'key':
      return (
        <SemanticLearnCard
          block={block}
          tone="key"
          label="重点"
          fallbackTitle="重点"
        />
      );
    case 'tip':
      return (
        <SemanticLearnCard
          block={block}
          tone="tip"
          label="提示"
          fallbackTitle="提示"
        />
      );
    case 'definition':
      return (
        <SemanticLearnCard
          block={block}
          tone="definition"
          label="定义"
          fallbackTitle="定义"
        />
      );
    case 'section':
      return (
        <section className="my-3 space-y-1.5" data-learn-block="section">
          {block.title && (
            <h3 className="font-classic text-sm font-bold text-[var(--text-primary)]">
              {block.title}
            </h3>
          )}
          {block.body ? (
            <div className="font-zh text-sm text-[var(--text-secondary)] leading-relaxed">
              {renderBodyLines(block.body)}
            </div>
          ) : null}
        </section>
      );
    case 'prose':
      return (
        <div
          className="my-1.5 font-zh text-sm text-[var(--text-secondary)] leading-relaxed"
          data-learn-block="prose"
        >
          {renderBodyLines(block.body)}
        </div>
      );
    default: {
      const _exhaustive: never = block.kind;
      return _exhaustive;
    }
  }
}

/**
 * Renders assistant learning content with semantic colored cards:
 * 重点 orange, 提示 green, 定义 blue, 摘要 keeps the neutral accent style.
 * Colors come from theme CSS variables so light/dark themes both read well.
 * Prefer server-provided typed `blocks` (batch-05); fall back to legacy parse.
 */
export function LearnContentBlocks({
  content,
  blocks: blocksProp,
}: {
  content?: string;
  /** Server-parsed blocks — preferred over client fence parsing. */
  blocks?: LearnContentBlock[];
}) {
  const blocks =
    blocksProp && blocksProp.length > 0
      ? blocksProp
      : content
        ? parseLearnContent(content)
        : [];
  if (blocks.length === 0) return null;

  // Prefer this renderer when we have at least one typed box or section title
  const hasTyped = blocks.some(
    (b) =>
      b.kind === 'summary' ||
      b.kind === 'key' ||
      b.kind === 'tip' ||
      b.kind === 'definition' ||
      b.kind === 'section',
  );
  if (
    !hasTyped &&
    !(content && hasLearnContentMarkup(content)) &&
    !(blocksProp && blocksProp.length > 0)
  ) {
    return null;
  }

  return (
    <div className="space-y-1 learn-content-blocks" data-testid="learn-content-blocks">
      {blocks.map((block, i) => (
        <LearnBlockView key={`${block.kind}-${i}`} block={block} />
      ))}
    </div>
  );
}

export function AssistantRichContent({
  content,
  contentBlocks,
  fallback,
}: {
  content: string;
  /** Typed blocks from server — never require raw fences in content. */
  contentBlocks?: LearnContentBlock[];
  fallback: (content: string) => ReactNode;
}) {
  if (contentBlocks && contentBlocks.length > 0) {
    return <LearnContentBlocks blocks={contentBlocks} content={content} />;
  }
  // Legacy only: parse fences if still present in historical messages
  if (hasLearnContentMarkup(content)) {
    return <LearnContentBlocks content={content} />;
  }
  return <>{fallback(content)}</>;
}

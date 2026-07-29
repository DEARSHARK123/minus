'use client';

/**
 * UX04 — Natural editable outline for Deep Planning (preview only).
 * Rename / add / remove / reorder units; expand knowledge points.
 * Does not persist course until「开始学习」.
 */

import { useState } from 'react';
import PixelIcon from '@/components/icons/PixelIcon';
import type { OutlineUnitArtifact } from '@/lib/agents/types';
import {
  addOutlineKnowledgePoint,
  addOutlineUnit,
  removeOutlineKnowledgePoint,
  removeOutlineUnit,
  renameOutlineUnit,
  reorderOutlineUnit,
  setOutlineUnitKnowledgePoints,
} from '@/lib/learning/outline-preview';

export type EditableOutlineProps = {
  units: OutlineUnitArtifact[];
  onChange: (units: OutlineUnitArtifact[]) => void;
  starting?: boolean;
  startError?: string | null;
  onStartSession?: () => void;
  showStartCta?: boolean;
};

export function EditableOutline({
  units,
  onChange,
  starting = false,
  startError = null,
  onStartSession,
  showStartCta = true,
}: EditableOutlineProps) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [editingTitle, setEditingTitle] = useState<number | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [kpDraft, setKpDraft] = useState<Record<number, string>>({});

  const toggleExpand = (i: number) => {
    setExpanded((prev) => ({ ...prev, [i]: !prev[i] }));
  };

  const beginRename = (i: number) => {
    setEditingTitle(i);
    setTitleDraft(units[i]?.title || '');
  };

  const commitRename = (i: number) => {
    onChange(renameOutlineUnit(units, i, titleDraft));
    setEditingTitle(null);
  };

  return (
    <section
      className="border border-[var(--border)] bg-[var(--bg-primary)]/80 p-4 space-y-3"
      data-testid="editable-outline"
      aria-label="学习大纲"
    >
      <div className="flex items-center gap-2">
        <PixelIcon name="outline" size={16} aria-hidden />
        <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">学习大纲</h3>
      </div>
      <p className="font-zh text-xs text-[var(--text-muted)]">
        可调整单元与知识点；确认「开始学习」后才会创建课程。
      </p>

      <ol className="space-y-3" data-testid="outline-unit-list">
        {units.map((unit, i) => {
          const isOpen = expanded[i] ?? true;
          return (
            <li
              key={`unit-${i}-${unit.title}`}
              className="border border-[var(--border-20)] px-3 py-2 space-y-2"
              data-testid={`outline-unit-${i}`}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => toggleExpand(i)}
                  className="mt-0.5 shrink-0 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  aria-expanded={isOpen}
                  aria-label={isOpen ? '收起知识点' : '展开知识点'}
                >
                  <span className="font-tech text-[10px]">{isOpen ? '▼' : '▶'}</span>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-tech text-[10px] text-[var(--text-muted)] mb-0.5">
                    单元 {i + 1}
                  </p>
                  {editingTitle === i ? (
                    <input
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onBlur={() => commitRename(i)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitRename(i);
                        }
                        if (e.key === 'Escape') setEditingTitle(null);
                      }}
                      className="w-full px-2 py-1 border border-[var(--accent)] bg-[var(--bg-secondary)] font-zh text-sm text-[var(--text-primary)] focus:outline-none"
                      aria-label={`重命名单元 ${i + 1}`}
                      data-testid={`outline-rename-${i}`}
                      autoFocus
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => beginRename(i)}
                      className="font-zh text-sm font-bold text-[var(--text-primary)] text-left hover:underline"
                      data-testid={`outline-title-${i}`}
                    >
                      {unit.title}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => onChange(reorderOutlineUnit(units, i, i - 1))}
                    className="px-1.5 py-0.5 border border-[var(--border-20)] font-tech text-[10px] disabled:opacity-30"
                    aria-label="上移"
                    data-testid={`outline-up-${i}`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={i >= units.length - 1}
                    onClick={() => onChange(reorderOutlineUnit(units, i, i + 1))}
                    className="px-1.5 py-0.5 border border-[var(--border-20)] font-tech text-[10px] disabled:opacity-30"
                    aria-label="下移"
                    data-testid={`outline-down-${i}`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={units.length <= 1}
                    onClick={() => onChange(removeOutlineUnit(units, i))}
                    className="px-1.5 py-0.5 border border-[var(--border-20)] font-zh text-[10px] text-[var(--error)] disabled:opacity-30"
                    aria-label="删除单元"
                    data-testid={`outline-remove-${i}`}
                  >
                    删
                  </button>
                </div>
              </div>

              {unit.description && (
                <p className="font-zh text-xs text-[var(--text-secondary)] pl-5 leading-relaxed">
                  {unit.description}
                </p>
              )}

              {isOpen && (
                <div className="pl-5 space-y-1.5" data-testid={`outline-kps-${i}`}>
                  <p className="font-zh text-[10px] font-bold text-[var(--text-muted)]">知识点</p>
                  <ul className="space-y-1">
                    {(unit.knowledgePoints ?? []).map((kp, j) => (
                      <li key={j} className="flex items-center gap-2 group">
                        <span className="font-zh text-xs text-[var(--text-secondary)] flex-1">
                          {kp}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            onChange(removeOutlineKnowledgePoint(units, i, j))
                          }
                          className="opacity-0 group-hover:opacity-100 px-1 font-tech text-[10px] text-[var(--text-muted)] hover:text-[var(--error)]"
                          aria-label="删除知识点"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-1 pt-1">
                    <input
                      value={kpDraft[i] || ''}
                      onChange={(e) =>
                        setKpDraft((prev) => ({ ...prev, [i]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const text = (kpDraft[i] || '').trim();
                          if (!text) return;
                          onChange(addOutlineKnowledgePoint(units, i, text));
                          setKpDraft((prev) => ({ ...prev, [i]: '' }));
                        }
                      }}
                      placeholder="添加知识点…"
                      className="flex-1 px-2 py-1 border border-[var(--border-20)] bg-[var(--bg-secondary)]/50 font-zh text-xs focus:outline-none focus:border-[var(--accent)]"
                      data-testid={`outline-kp-input-${i}`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const text = (kpDraft[i] || '').trim();
                        if (!text) return;
                        onChange(addOutlineKnowledgePoint(units, i, text));
                        setKpDraft((prev) => ({ ...prev, [i]: '' }));
                      }}
                      className="px-2 py-1 border border-[var(--border-20)] font-zh text-[10px] hover:bg-[var(--bg-tertiary)]"
                    >
                      添加
                    </button>
                  </div>
                  {(unit.knowledgePoints?.length ?? 0) === 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        onChange(
                          setOutlineUnitKnowledgePoints(units, i, ['核心概念']),
                        )
                      }
                      className="font-zh text-[10px] text-[var(--accent)]"
                    >
                      展开默认知识点
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={() => onChange(addOutlineUnit(units))}
        className="w-full px-3 py-2 border border-dashed border-[var(--border)] font-zh text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/40"
        data-testid="outline-add-unit"
      >
        + 添加单元
      </button>

      {showStartCta && (
        <div className="pt-1 space-y-2">
          {startError && (
            <p className="font-zh text-xs text-[var(--error)]" role="alert">
              {startError}
            </p>
          )}
          <button
            type="button"
            disabled={starting || units.length === 0}
            onClick={onStartSession}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] font-zh text-sm font-bold border border-[var(--border)] disabled:opacity-50"
            data-testid="start-learning-cta"
          >
            <PixelIcon name="action-play" size={16} aria-hidden />
            {starting ? '正在创建…' : '开始学习'}
          </button>
        </div>
      )}
    </section>
  );
}

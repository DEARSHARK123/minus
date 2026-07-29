'use client';

import { useEffect, useMemo } from 'react';
import PixelIcon from '@/components/icons/PixelIcon';
import { useLearningStore } from '@/store/learning-store';
import { useUIStore } from '@/store/ui-store';

/**
 * B07 Video honesty:
 * - Not a full player (INTENT-ANCHOR forbids full video player).
 * - No hardcoded fake courses.
 * - Only lists library-imported items that look like video metadata/transcripts
 *   (title/tags/content markers). Everything else → honest empty + link to 资料库.
 */
function isVideoRelatedDoc(doc: {
  title: string;
  content: string;
  tags?: string[];
  summary?: string;
}): boolean {
  const blob = [
    doc.title,
    doc.summary || '',
    ...(doc.tags || []),
    doc.content.slice(0, 400),
  ]
    .join(' ')
    .toLowerCase();
  return (
    /视频|video|transcript|字幕|网课|录像|录播|bilibili|youtube|vtt|srt/.test(blob)
  );
}

export function VideoPage() {
  const data = useLearningStore((s) => s.data);
  const load = useLearningStore((s) => s.load);
  const setActiveAppView = useUIStore((s) => s.setActiveAppView);

  useEffect(() => {
    void load();
  }, [load]);

  const videoDocs = useMemo(
    () => data.documents.filter(isVideoRelatedDoc),
    [data.documents],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="border-b border-[var(--border)] bg-[var(--bg-primary)]/80 px-4 py-2 flex items-center gap-2">
        <PixelIcon name="action-play" size={16} aria-hidden />
        <h2 className="font-classic text-xs tracking-widest uppercase text-[var(--text-primary)]">
          视频（元数据）
        </h2>
      </div>

      <div className="p-6 max-w-2xl mx-auto w-full space-y-4">
        <p className="font-zh text-sm text-[var(--text-secondary)] leading-relaxed border border-[var(--border-20)] bg-[var(--bg-primary)]/70 px-4 py-3">
          当前<strong>没有内置视频播放器</strong>。本页仅展示从资料库识别到的视频相关元数据 / 字幕文本，不会伪造网课列表。
        </p>

        {videoDocs.length === 0 ? (
          <div className="border border-dashed border-[var(--border-20)] px-4 py-10 text-center space-y-3">
            <p className="font-zh text-sm text-[var(--text-muted)]">
              暂无已导入的视频元数据或字幕文稿。
            </p>
            <p className="font-zh text-xs text-[var(--text-muted)]">
              请在「资料库」导入含「视频 / transcript / 字幕」等标记的 .md/.txt 文稿。
            </p>
            <button
              type="button"
              onClick={() => setActiveAppView('library')}
              className="px-4 py-2 font-zh text-xs border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            >
              前往资料库
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {videoDocs.map((doc) => {
              const course = data.courses.find((c) => c.id === doc.courseId);
              return (
                <li
                  key={doc.id}
                  className="border border-[var(--border)] bg-[var(--bg-primary)]/80 p-4 flex gap-4 items-start"
                >
                  <div className="w-20 h-14 shrink-0 border border-[var(--border-20)] bg-[var(--bg-tertiary)] flex items-center justify-center">
                    <PixelIcon name="action-play" size={32} aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-zh text-sm font-bold text-[var(--text-primary)]">
                      {doc.title}
                    </p>
                    <p className="font-zh text-xs text-[var(--text-muted)] mt-1">
                      {course?.title || doc.courseId}
                      {doc.contentType ? ` · ${doc.contentType}` : ''}
                      {doc.tags && doc.tags.length > 0
                        ? ` · ${doc.tags.slice(0, 4).join('、')}`
                        : ''}
                    </p>
                    {(doc.summary || doc.content) && (
                      <p className="font-zh text-xs text-[var(--text-secondary)] mt-2 line-clamp-3">
                        {doc.summary || doc.content.slice(0, 160)}
                      </p>
                    )}
                    <p className="font-tech text-[10px] text-[var(--text-muted)] mt-2">
                      仅元数据 / 文本 · 无播放器
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * UX06 — Library empty/actions/background status; history safe resume;
 * sidebar caps/dedupe; continuation identity + deep links.
 */

import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_PRIMARY_ACTIONS,
  assertPrimaryLibraryPayload,
  buildAdvancedDocumentDetail,
  buildDocumentActionPrompt,
  buildLibraryEmptyState,
  filterDocumentsBySearch,
  isAdvancedLibraryField,
  isEmptyLibrary,
  parsePhaseLabel,
  phaseFromImportAnalysis,
  shouldInterruptForBackground,
  successToastMessage,
  toLibraryListItem,
} from '../library-ui';
import {
  assertSafeResume,
  buildChatIntelligence,
  buildSafeResumePayload,
  buildSessionIntelligence,
  deriveChatSummary,
  isForbiddenHistoryPrimaryCopy,
} from '@/lib/chat/history-intelligence';
import {
  continuationIdentity,
  excludeHomeOwnedContinuation,
  resolveContinuationDeepLink,
  sameContinuationIdentity,
  selectContinuation,
  selectHomeContinuation,
} from '@/lib/chat/continuation-selector';
import {
  SIDEBAR_RECENT_CAP,
  capAndDedupeSidebarSessions,
  capSidebarConversations,
} from '@/lib/chat/sidebar-recent';
import {
  clearComposerPrefill,
  peekComposerPrefill,
  setComposerPrefill,
  takeComposerPrefill,
} from '@/lib/chat/composer-prefill';

describe('UX06 library empty state', () => {
  it('empty library only allows upload/create entry points', () => {
    const empty = buildLibraryEmptyState({ courses: [], documents: [] });
    expect(empty.isEmpty).toBe(true);
    expect(empty.allowedEntryPoints).toEqual(['upload', 'create']);
    expect(empty.title).toMatch(/还没有资料/);
    expect(isEmptyLibrary({ courses: [], documents: [] })).toBe(true);
  });

  it('non-empty library is not empty state', () => {
    const s = buildLibraryEmptyState({
      courses: [{ id: 'c1', title: '线性代数' }],
      documents: [],
    });
    expect(s.isEmpty).toBe(false);
  });
});

describe('UX06 document list / actions', () => {
  const doc = {
    id: 'd1',
    courseId: 'c1',
    title: '特征值笔记',
    format: 'markdown' as const,
    content: '特征值与特征向量……',
    chunks: [{ id: 'ch1' }, { id: 'ch2' }],
    summary: '介绍特征值',
    sourceQuality: 0.88,
    duplicateOfDocumentId: 'd0',
    contentType: 'notes',
    createdAt: '2026-07-13T10:00:00.000Z',
    updatedAt: '2026-07-13T11:00:00.000Z',
  };

  it('primary list item hides chunks / sourceQuality / duplicateId', () => {
    const item = toLibraryListItem(doc);
    expect(item.title).toBe('特征值笔记');
    expect(item.primaryFields).not.toHaveProperty('chunks');
    expect(item.primaryFields).not.toHaveProperty('sourceQuality');
    expect(item.primaryFields).not.toHaveProperty('duplicateId');
    expect(JSON.stringify(item)).not.toMatch(/sourceQuality|duplicateOf|chunks/);
    expect(() =>
      assertPrimaryLibraryPayload({ ...item.primaryFields }),
    ).not.toThrow();
  });

  it('marks advanced fields correctly', () => {
    expect(isAdvancedLibraryField('chunks')).toBe(true);
    expect(isAdvancedLibraryField('sourceQuality')).toBe(true);
    expect(isAdvancedLibraryField('File.text')).toBe(true);
    expect(isAdvancedLibraryField('title')).toBe(false);
    expect(() =>
      assertPrimaryLibraryPayload({ chunks: 2 } as Record<string, unknown>),
    ).toThrow(/chunks/);
  });

  it('exposes only four primary document actions', () => {
    expect(DOCUMENT_PRIMARY_ACTIONS.map((a) => a.id)).toEqual([
      'ask',
      'summarize',
      'use_normal',
      'deep_outline',
    ]);
    expect(DOCUMENT_PRIMARY_ACTIONS.map((a) => a.label)).toEqual([
      '提问',
      '总结',
      '用于普通学习',
      '生成深入大纲',
    ]);
    const deep = buildDocumentActionPrompt('deep_outline', doc);
    expect(deep).toMatch(/深入学习大纲|大纲/);
    expect(deep).toMatch(/特征值笔记/);
    const normal = buildDocumentActionPrompt('use_normal', doc);
    expect(normal).toMatch(/普通学习/);
  });

  it('advanced detail still available behind the fold', () => {
    const adv = buildAdvancedDocumentDetail(doc);
    expect(adv.chunkCount).toBe(2);
    expect(adv.sourceQualityPct).toBe(88);
    expect(adv.duplicateOfDocumentId).toBe('d0');
  });

  it('search filters by title/summary', () => {
    const list = filterDocumentsBySearch(
      [doc, { ...doc, id: 'd2', title: '概率论', summary: '贝叶斯' }],
      '特征',
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('d1');
  });
});

describe('UX06 background parse status', () => {
  it('short Chinese status labels', () => {
    expect(parsePhaseLabel('processing')).toBe('正在处理…');
    expect(parsePhaseLabel('uploading')).toBe('正在上传…');
    expect(successToastMessage('document')).toMatch(/已添加/);
  });

  it('interrupts only for conflict or decision', () => {
    expect(shouldInterruptForBackground('processing')).toBe(false);
    expect(shouldInterruptForBackground('success')).toBe(false);
    expect(shouldInterruptForBackground('conflict')).toBe(true);
    expect(shouldInterruptForBackground('decision_needed')).toBe(true);
  });

  it('maps analysis to phase', () => {
    expect(phaseFromImportAnalysis({ isDuplicate: true })).toBe('conflict');
    expect(phaseFromImportAnalysis({ pendingSuggestionCount: 2 })).toBe(
      'decision_needed',
    );
    expect(phaseFromImportAnalysis({})).toBe('success');
  });
});

describe('UX06 safe history restore', () => {
  it('chat summary avoids message counts; safe resume never replays tools', () => {
    const intel = buildChatIntelligence({
      id: 'conv_1',
      title: '新对话',
      messages: [
        { role: 'user', content: '帮我学线性代数特征值' },
        {
          role: 'assistant',
          content: '等待你的确认后继续…',
        },
      ],
    });
    expect(intel.title).toMatch(/线性代数|特征值/);
    expect(intel.summary).not.toMatch(/\d+\s*条.*消息/);
    expect(isForbiddenHistoryPrimaryCopy(intel.summary)).toBe(false);
    expect(intel.safeResume.autoReplayTools).toBe(false);
    expect(intel.safeResume.mode).toBe('context_only');
    expect(intel.hideFromPrimary.messageCount).toBe(true);
    expect(intel.hideFromPrimary.sessionId).toBe(true);
    const payload = buildSafeResumePayload(intel);
    expect(payload.autoReplayTools).toBe(false);
    expect(payload.mode).toBe('context_only');
    expect(() => assertSafeResume(intel)).not.toThrow();
  });

  it('deriveChatSummary never emits N 条消息', () => {
    const s = deriveChatSummary([
      { role: 'user', content: '解释闭包' },
      { role: 'assistant', content: '闭包是函数与其词法环境的组合。' },
    ]);
    expect(s).not.toMatch(/条消息/);
    expect(s.length).toBeGreaterThan(0);
  });

  it('session title is goal; no session id as title; resume context only', () => {
    const intel = buildSessionIntelligence(
      {
        id: 'sess_secret_xyz',
        courseId: 'c1',
        taskId: 't1',
        startedAt: '2026-07-13T10:00:00.000Z',
        sections: [
          { id: 's1', status: 'done', title: '引入', assessment: { result: 'pass' } },
          { id: 's2', status: 'open', title: '核心' },
        ],
      },
      { courseTitle: '微积分', taskTitle: '极限与连续' },
    );
    expect(intel.title).toBe('极限与连续');
    expect(intel.title).not.toContain('sess_');
    expect(intel.summary).toMatch(/未完成|已完成/);
    expect(intel.incomplete.length).toBeGreaterThan(0);
    expect(intel.safeResume.autoReplayTools).toBe(false);
    expect(intel.safeResume.courseId).toBe('c1');
    const payload = buildSafeResumePayload(intel);
    expect(payload).not.toHaveProperty('tools');
    expect(payload.autoReplayTools).toBe(false);
  });

  it('forbidden primary copy detector', () => {
    expect(isForbiddenHistoryPrimaryCopy('Session ID: abc')).toBe(true);
    expect(isForbiddenHistoryPrimaryCopy('3 条用户消息 · 2 条回复')).toBe(true);
    expect(
      isForbiddenHistoryPrimaryCopy(
        '安全恢复：仅恢复对话上下文，不会自动重放工具或 Desktop 循环。',
      ),
    ).toBe(true);
    expect(isForbiddenHistoryPrimaryCopy('上次停在待你确认')).toBe(false);
  });
});

describe('UX06 sidebar caps and deduplication', () => {
  it('caps conversations at 5 and reports hasMore', () => {
    const convs = Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`,
      title: `对话 ${i}`,
      messages: [{ role: 'user', content: 'hi' }],
      updatedAt: new Date(2026, 6, 13, i).toISOString(),
    }));
    const { items, total, hasMore } = capSidebarConversations(
      convs,
      SIDEBAR_RECENT_CAP,
    );
    expect(items).toHaveLength(5);
    expect(total).toBe(8);
    expect(hasMore).toBe(true);
  });

  it('dedupes sessions by course+task then caps at 5', () => {
    const sessions = [
      {
        id: 's1',
        courseId: 'c1',
        taskId: 't1',
        startedAt: '2026-07-13T12:00:00.000Z',
      },
      {
        id: 's2',
        courseId: 'c1',
        taskId: 't1',
        startedAt: '2026-07-13T10:00:00.000Z',
      },
      {
        id: 's3',
        courseId: 'c1',
        taskId: 't2',
        startedAt: '2026-07-13T11:00:00.000Z',
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `sx${i}`,
        courseId: `cx${i}`,
        taskId: `tx${i}`,
        startedAt: `2026-07-1${i}T09:00:00.000Z`,
      })),
    ];
    const { items, totalUnique, hasMore } = capAndDedupeSidebarSessions(
      sessions,
      {
        courses: [
          { id: 'c1', title: '线性代数' },
          ...Array.from({ length: 6 }, (_, i) => ({
            id: `cx${i}`,
            title: `课 ${i}`,
          })),
        ],
        tasks: [
          { id: 't1', title: '特征值' },
          { id: 't2', title: '行列式' },
          ...Array.from({ length: 6 }, (_, i) => ({
            id: `tx${i}`,
            title: `任务 ${i}`,
          })),
        ],
        cap: 5,
      },
    );
    // s1 and s2 same course+task → one
    expect(items.every((r) => r.sessionId !== 's2')).toBe(true);
    expect(items.some((r) => r.sessionId === 's1')).toBe(true);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(totalUnique).toBeGreaterThan(5);
    expect(hasMore).toBe(true);
    expect(items[0]?.label).not.toMatch(/^sess_|学习会话 [a-z0-9]+$/i);
  });
});

describe('UX06 continuation identity and deep links', () => {
  const sample = [
    {
      id: 'primary',
      title: '线性代数',
      status: 'in_progress' as const,
      courseId: 'c1',
      unitId: 'u1',
      updatedAt: '2026-07-13T12:00:00.000Z',
    },
    {
      id: 'secondary',
      title: '概率论',
      status: 'confirmed' as const,
      courseId: 'c2',
      updatedAt: '2026-07-13T10:00:00.000Z',
    },
  ];

  const sessions = [
    {
      id: 'sess_p',
      courseId: 'c1',
      taskId: 'primary',
      startedAt: '2026-07-13T11:00:00.000Z',
    },
  ];

  it('one primary continuation shared across surfaces', () => {
    const home = selectContinuation(sample, 'home', { sessions });
    const hist = selectContinuation(sample, 'history', { sessions });
    const cal = selectContinuation(sample, 'calendar', { sessions });
    expect(home).not.toBeNull();
    expect(home!.identity).toBe(continuationIdentity(sample[0]!));
    expect(sameContinuationIdentity(home!, hist!)).toBe(true);
    expect(sameContinuationIdentity(home!, cal!)).toBe(true);
    expect(home!.task.id).toBe('primary');
  });

  it('deep-links to real course/session', () => {
    const link = resolveContinuationDeepLink(sample[0]!, { sessions });
    expect(link.kind).toBe('session');
    expect(link.href).toContain('/course/c1');
    expect(link.href).toContain('sess_p');
    expect(link.courseId).toBe('c1');
    expect(link.sessionId).toBe('sess_p');
    expect(link.taskId).toBe('primary');
  });

  it('deep-links to course when no session', () => {
    const link = resolveContinuationDeepLink(sample[1]!, { sessions: [] });
    expect(link.kind).toBe('course');
    expect(link.href).toBe('/course/c2');
  });

  it('excludes home-owned primary from other surfaces’ continue lists', () => {
    const forHistory = excludeHomeOwnedContinuation(sample, 'history');
    expect(forHistory.map((t) => t.id)).toEqual(['secondary']);
  });

  it('selectHomeContinuation includes identity + deepLink', () => {
    const entry = selectHomeContinuation(sample, { sessions });
    expect(entry!.identity).toMatch(/^task:primary$/);
    expect(entry!.deepLink.href).toContain('/course/');
  });
});

describe('UX06 composer prefill (library → home)', () => {
  it('set/take is one-shot', () => {
    clearComposerPrefill();
    setComposerPrefill({
      text: '请总结资料「A」',
      mode: 'normal',
      source: 'library',
    });
    expect(peekComposerPrefill()?.mode).toBe('normal');
    const once = takeComposerPrefill();
    expect(once?.text).toMatch(/总结/);
    expect(takeComposerPrefill()).toBeNull();
  });
});

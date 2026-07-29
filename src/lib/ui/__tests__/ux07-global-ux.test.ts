/**
 * UX07 — Global copy, HITL confirm, loading, responsive, a11y helpers.
 * Forbidden terms in primary-copy sources fail; internal/audit paths allowed.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  HITL_UI_BUTTONS,
  LOADING_COPY,
  chatSafetySurfaceLabel,
  chatSafetySurfaceState,
  hasForbiddenPrimaryCopy,
  hitlConfirmSummary,
  hitlConfirmTitle,
  resolveHitlActionKind,
  sanitizePrimaryCopy,
} from '@/lib/ui/natural-copy';
import {
  BREAKPOINT_DESKTOP,
  BREAKPOINT_TABLET,
  FOCUS_ORDER,
  courseTreeVariant,
  courseTreeVisibleByDefault,
  navAsDrawer,
  navCollapsible,
  navFullByDefault,
  shellLayoutMode,
} from '@/lib/ui/layout-breakpoints';
import {
  ERROR_UI,
  presentRecoverableError,
  containsRawDisconnectText,
} from '@/lib/ui/error-presentation';
import { isEmptyMemoryArtifact } from '@/lib/chat/artifact-visibility';
import { calendarLayoutMode } from '@/lib/learning/calendar-grid';
import { masteryFeedbackLabel } from '@/lib/learning/mastery-copy';

const ROOT = path.resolve(__dirname, '../../..');

/** Primary UI component files to scan for forbidden user-visible strings. */
const PRIMARY_UI_GLOBS = [
  'components/ui/tool-confirm-dialog.tsx',
  'components/chat/desktop-tool-timeline.tsx',
  'components/chat/thinking-status-bar.tsx',
  'components/chat/chat-input.tsx',
  'components/chat/home-chat.tsx',
  'components/chat/message-bubble.tsx',
  'components/chat/learn-flow/learn-cards.tsx',
  'components/chat/learn-flow/editable-outline.tsx',
  'components/layout/app-shell.tsx',
  'components/layout/sidebar.tsx',
  'components/layout/main-panel.tsx',
  'components/settings/settings-modal.tsx',
  'components/learning/learning-session.tsx',
  'components/learning/course-unit-tree-panel.tsx',
  'lib/ui/natural-copy.ts',
  'lib/learning/calendar-copy.ts',
  'lib/learning/mastery-copy.ts',
];

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

/**
 * Extract approximate user-visible string literals from TSX/TS
 * (quoted strings that look like JSX text / labels — not import paths).
 */
function extractStringLiterals(source: string): string[] {
  const out: string[] = [];
  // Strip block comments
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, '');
  // Strip line comments
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  const re = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noLine)) !== null) {
    const s = m[2]
      .replace(/\\n/g, '\n')
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\`/g, '`');
    // Skip pure identifiers, paths, urls, short codes
    if (s.length < 3) continue;
    if (/^[@./\\a-zA-Z0-9_-]+$/.test(s) && !/\s/.test(s) && s.length < 40) {
      // keep known forbidden bare tokens
      if (!/^(IntentJudge|OutlineAgent|ContextPack|HITL|AUTONOMOUS|sandbox)$/i.test(s)) {
        continue;
      }
    }
    if (s.includes('node_modules') || s.startsWith('http')) continue;
    out.push(s);
  }
  return out;
}

describe('UX07 forbidden primary copy scan', () => {
  it('PRIMARY_UI files exist', () => {
    for (const rel of PRIMARY_UI_GLOBS) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
    }
  });

  it('user-visible strings in primary surfaces avoid forbidden terms', () => {
    const leaks: string[] = [];
    // Files that define forbidden-term allowlists / detectors (not user-facing).
    const definitionFiles = new Set([
      'lib/ui/natural-copy.ts',
      'lib/learning/calendar-copy.ts',
    ]);
    for (const rel of PRIMARY_UI_GLOBS) {
      if (definitionFiles.has(rel)) continue;
      const source = readSrc(rel);
      const strings = extractStringLiterals(source);
      for (const s of strings) {
        // Technical enum/env values (not rendered as primary product copy)
        if (/^(sandbox|trust|local|supervised|full_auto|bounded_auto|chat_only)$/.test(s)) {
          continue;
        }
        // Code identifier fragments (HITL_UI_BUTTONS etc.) — not rendered text
        if (/HITL_UI_|_HITL|hitlBusy|pendingHitl|HitlUi/.test(s)) continue;
        if (s.includes('HITL_UI_BUTTONS')) continue;
        if (hasForbiddenPrimaryCopy(s)) {
          leaks.push(`${rel}: ${s.slice(0, 80)}`);
        }
      }
    }
    expect(leaks, leaks.join('\n')).toEqual([]);
  });

  it('hasForbiddenPrimaryCopy detects key terms', () => {
    expect(hasForbiddenPrimaryCopy('Agent is thinking')).toBe(true);
    expect(hasForbiddenPrimaryCopy('Loading skills')).toBe(true);
    expect(hasForbiddenPrimaryCopy('Start Session')).toBe(true);
    expect(hasForbiddenPrimaryCopy('AUTONOMOUS')).toBe(true);
    expect(hasForbiddenPrimaryCopy('IntentJudge routed')).toBe(true);
    expect(hasForbiddenPrimaryCopy('今天想了解什么？')).toBe(false);
    expect(hasForbiddenPrimaryCopy('需要确认')).toBe(false);
    expect(hasForbiddenPrimaryCopy('正在处理')).toBe(false);
  });

  it('sanitizePrimaryCopy rewrites common leaks', () => {
    expect(sanitizePrimaryCopy('Agent is thinking')).toBe(LOADING_COPY.preparingAnswer);
    expect(sanitizePrimaryCopy('Start Session now')).toContain('开始学习');
    expect(sanitizePrimaryCopy('AUTONOMOUS')).toContain('本机完全自主');
  });
});

describe('UX07 HITL natural confirm', () => {
  it('titles map to Minus 想… forms', () => {
    expect(hitlConfirmTitle({ toolName: 'code_executor', confirmReason: 'dangerous_tool' })).toBe(
      'Minus 想运行命令',
    );
    expect(hitlConfirmTitle({ toolName: 'file_manager', confirmReason: 'workspace_write' })).toBe(
      'Minus 想修改文件',
    );
    expect(hitlConfirmTitle({ toolName: 'web_search', confirmReason: 'network_access' })).toBe(
      'Minus 想访问网络',
    );
    expect(hitlConfirmTitle({ confirmReason: 'trust_elevation' })).toBe('Minus 想访问本机权限');
    expect(hitlConfirmTitle({ confirmReason: 'human_question' })).toBe('需要你回答');
  });

  it('buttons are 允许一次 / 本次会话记住 / 不允许', () => {
    expect(HITL_UI_BUTTONS.allowOnce).toBe('允许一次');
    expect(HITL_UI_BUTTONS.rememberSession).toBe('本次会话记住');
    expect(HITL_UI_BUTTONS.deny).toBe('不允许');
    expect(HITL_UI_BUTTONS.viewDetails).toBe('查看详情');
  });

  it('summary prefers whatChanges and never requires raw JSON', () => {
    const s = hitlConfirmSummary({
      toolName: 'code_executor',
      confirmReason: 'dangerous_tool',
      whatChanges: '运行 npm test',
      parameters: { command: 'npm test', nested: { a: 1 } },
    });
    expect(s).toContain('npm test');
    expect(s).not.toMatch(/\{/);
  });

  it('resolveHitlActionKind covers taxonomy', () => {
    expect(resolveHitlActionKind({ confirmReason: 'network_access' })).toBe('network');
    expect(resolveHitlActionKind({ confirmReason: 'package_install' })).toBe('package');
    expect(resolveHitlActionKind({ toolName: 'ask_human' })).toBe('question');
  });

  it('tool-confirm-dialog uses natural-copy buttons; details collapsed by default', () => {
    const src = readSrc('components/ui/tool-confirm-dialog.tsx');
    expect(src).toContain('HITL_UI_BUTTONS');
    expect(src).toContain('hitlConfirmTitle');
    expect(src).toMatch(/useState\(false\)/); // details collapsed
    expect(src).not.toContain('工具调用确认');
    expect(src).not.toContain('批准一次');
    expect(src).not.toContain('批准本类');
    // Labels live in natural-copy (single source of truth)
    expect(HITL_UI_BUTTONS.allowOnce).toBe('允许一次');
    expect(HITL_UI_BUTTONS.rememberSession).toBe('本次会话记住');
    expect(HITL_UI_BUTTONS.deny).toBe('不允许');
    expect(HITL_UI_BUTTONS.viewDetails).toBe('查看详情');
  });
});

describe('UX07 chat safety surface vs Settings', () => {
  it('chat only shows 需要确认 / 已授权', () => {
    expect(chatSafetySurfaceLabel('supervised')).toBe('需要确认');
    expect(chatSafetySurfaceLabel('chat_only')).toBe('需要确认');
    expect(chatSafetySurfaceLabel('full_auto')).toBe('已授权');
    expect(chatSafetySurfaceLabel('bounded_auto')).toBe('已授权');
    expect(chatSafetySurfaceLabel('full_auto', { waitingConfirm: true })).toBe('需要确认');
    expect(chatSafetySurfaceState('bounded_auto')).toBe('authorized');
  });

  it('home-chat chip does not render AUTONOMOUS', () => {
    const src = readSrc('components/chat/home-chat.tsx');
    expect(src).not.toMatch(/AUTONOMOUS/);
    expect(src).toContain('需要确认');
    expect(src).toContain('已授权');
  });

  it('Settings retains full safety level titles', () => {
    const src = readSrc('components/settings/settings-modal.tsx');
    expect(src).toContain('监督模式');
    expect(src).toContain('本机完全自主');
    expect(src).toContain('有界自主');
    expect(src).not.toMatch(/AUTONOMOUS/);
    expect(src).not.toContain('多 Agent');
    expect(src).not.toContain('LLM Desktop');
  });
});

describe('UX07 loading / empty memory / errors', () => {
  it('loading copy has no Agent is thinking / Loading skills', () => {
    expect(LOADING_COPY.processing).toBe('正在处理');
    expect(hasForbiddenPrimaryCopy(LOADING_COPY.preparingAnswer)).toBe(false);
    const timeline = readSrc('components/chat/desktop-tool-timeline.tsx');
    expect(timeline).toContain('正在处理');
    expect(timeline).not.toContain('Agent is thinking');
    const thinking = readSrc('components/chat/thinking-status-bar.tsx');
    expect(thinking).not.toContain('Agent is thinking');
    expect(thinking).not.toContain('Task Steps');
    expect(thinking).toContain('处理步骤');
  });

  it('empty memory silently filtered', () => {
    expect(
      isEmptyMemoryArtifact({
        id: 'm1',
        kind: 'memory_card',
        content: 'no relevant memory',
        memoryEntries: [],
      }),
    ).toBe(true);
    expect(
      isEmptyMemoryArtifact({
        id: 'm2',
        kind: 'memory_card',
        content: '暂无长期记忆',
        memoryEntries: [],
      }),
    ).toBe(true);
    expect(
      isEmptyMemoryArtifact({
        id: 'm3',
        kind: 'memory_card',
        content: '',
        memoryEntries: ['喜欢可视化'],
      }),
    ).toBe(false);
  });

  it('errors: recoverable primary + 查看详情; no raw disconnect in primary', () => {
    const presented = presentRecoverableError(new Error('[连接中断: HTTP 500] boom'));
    expect(presented.toast).toMatch(/网络|重试/);
    expect(presented.primary).not.toMatch(/连接中断|HTTP 500/);
    expect(containsRawDisconnectText(presented.primary)).toBe(false);
    expect(ERROR_UI.viewDetails).toBe('查看详情');
  });

  it('timeline defaults collapsed unless confirm', () => {
    const src = readSrc('components/chat/desktop-tool-timeline.tsx');
    expect(src).toContain('useState(false)');
    expect(src).toContain('needsConfirm');
    expect(src).toContain('正在处理');
  });
});

describe('UX07 responsive breakpoints', () => {
  it('shell: ≥1200 desktop, 768–1199 tablet, <768 mobile', () => {
    expect(shellLayoutMode(1440)).toBe('desktop');
    expect(shellLayoutMode(BREAKPOINT_DESKTOP)).toBe('desktop');
    expect(shellLayoutMode(1199)).toBe('tablet');
    expect(shellLayoutMode(1024)).toBe('tablet');
    expect(shellLayoutMode(BREAKPOINT_TABLET)).toBe('tablet');
    expect(shellLayoutMode(767)).toBe('mobile');
  });

  it('nav/tree/companion modes', () => {
    expect(navFullByDefault('desktop')).toBe(true);
    expect(navCollapsible('tablet')).toBe(true);
    expect(navAsDrawer('mobile')).toBe(true);
    expect(courseTreeVariant('desktop')).toBe('rail');
    expect(courseTreeVariant('tablet')).toBe('collapsible');
    expect(courseTreeVariant('mobile')).toBe('drawer');
    expect(courseTreeVisibleByDefault('desktop')).toBe(true);
    expect(courseTreeVisibleByDefault('tablet')).toBe(false);
  });

  it('calendar modes stay aligned with same breakpoints', () => {
    expect(calendarLayoutMode(1200)).toBe('desktop');
    expect(calendarLayoutMode(1024)).toBe('tablet');
    expect(calendarLayoutMode(767)).toBe('mobile');
  });

  it('app-shell wires mobile drawer', () => {
    const src = readSrc('components/layout/app-shell.tsx');
    expect(src).toContain('nav-drawer');
    expect(src).toContain('shellLayoutMode');
    expect(src).toContain('打开导航');
    const sidebar = readSrc('components/layout/sidebar.tsx');
    expect(sidebar).toContain('主导航');
  });

  it('course tree uses 1200px rail breakpoint', () => {
    const panel = readSrc('components/learning/course-unit-tree-panel.tsx');
    expect(panel).toContain('min-[1200px]');
    const session = readSrc('components/learning/learning-session.tsx');
    expect(session).toContain('min-[1200px]:hidden');
  });
});

describe('UX07 a11y contracts', () => {
  it('focus order documented', () => {
    expect(FOCUS_ORDER).toEqual(['navigation', 'main', 'composer']);
  });

  it('globals.css has focus-visible and reduced-motion', () => {
    const css = fs.readFileSync(path.join(ROOT, 'app/globals.css'), 'utf-8');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('prefers-reduced-motion');
  });

  it('key dialogs and icons have aria labels', () => {
    const confirm = readSrc('components/ui/tool-confirm-dialog.tsx');
    expect(confirm).toContain('role="dialog"');
    expect(confirm).toContain('aria-labelledby');
    const shell = readSrc('components/layout/app-shell.tsx');
    expect(shell).toContain('aria-label');
    expect(shell).toContain('主内容');
  });

  it('mastery labels stay Chinese (no bare pass/fail)', () => {
    expect(masteryFeedbackLabel('pass')).toBe('掌握得不错');
    expect(masteryFeedbackLabel('fail')).toBe('再练一下');
    expect(masteryFeedbackLabel('partial')).toBe('部分掌握');
    expect(hasForbiddenPrimaryCopy(masteryFeedbackLabel('pass'))).toBe(false);
  });
});

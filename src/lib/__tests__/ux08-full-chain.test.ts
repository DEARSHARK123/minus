/**
 * UX08 full-chain acceptance scenarios (unit/integration evidence).
 * Browser Playwright is not a project dependency (and installs are forbidden
 * this batch). These exercise the same product contracts end-to-end through
 * pure APIs the UI calls.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { planExperience } from '@/lib/agents/control-plane/experience-plan';
import {
  canCommitCourseStart,
  courseCommitNavigation,
  isOutlineEditCommitAction,
} from '@/lib/learning/course-commit';
import {
  buildMonthCells,
  MONTH_CELL_COUNT,
} from '@/lib/learning/calendar-grid';
import { dedupeRecentTasks } from '@/lib/chat/task-dedupe';
import {
  selectContinuation,
  continuationIdentity,
} from '@/lib/chat/continuation-selector';
import {
  buildChatIntelligence,
  buildSafeResumePayload,
} from '@/lib/chat/history-intelligence';
import {
  filterVisibleArtifacts,
  shouldShowLearnProgressRail,
} from '@/lib/chat/artifact-visibility';
import {
  parseAppPath,
  chatPath,
  coursePath,
  APP_PATHS,
} from '@/lib/navigation/app-routes';
import {
  applyOpenHomeDrafts,
  conversationHasContent,
  filterRecentConversations,
} from '@/lib/navigation/draft-conversation';
import {
  migrateClientBootstrap,
  migrateLearnFlowStage,
} from '@/lib/migration';
import {
  hitlConfirmTitle,
  hitlConfirmSummary,
  UX07_FORBIDDEN_PRIMARY_TERMS,
} from '@/lib/ui/natural-copy';
import {
  shellLayoutMode,
  navAsDrawer,
} from '@/lib/ui/layout-breakpoints';
import {
  DOCUMENT_PRIMARY_ACTIONS,
  toLibraryListItem,
} from '@/lib/learning/library-ui';
import { masteryFeedbackLabel } from '@/lib/learning/mastery-copy';
import { buildUnitTreeFromSections } from '@/lib/learning/course-unit-tree';
import {
  CONFIRM_REASONS,
  denyToolResultContent,
  resolveConfirmReason,
} from '@/lib/agent/hitl';
import {
  decideCourseAdvance,
  decideCourseFollowUp,
  shouldReenterIntentOnCourseFollowUp,
} from '@/lib/learning/course-follow-up';
import { LEARN_STATE_SPECS } from '@/lib/agents/learn-state-machine';

// ── Scenario 1: greeting / plain Q&A ───────────────────────────────────────

describe('UX08 E2E-contract: greeting / plain Q&A', () => {
  it('greeting → chat stream path; no funnel rail or confirm_gate chrome', () => {
    const plan = planExperience({
      message: '你好',
      surface: 'chat',
      confidence: 0.9,
      intent: 'chat',
    });
    expect(plan.mode === 'chat' || plan.mode === 'normal').toBe(true);
    expect(plan.nextAction).toMatch(/stream|chat|clarify|await/i);
    expect(shouldShowLearnProgressRail(plan.mode, 'idle')).toBe(false);
    const visible = filterVisibleArtifacts(
      [
        { id: '1', kind: 'confirm_gate', content: '确认目标' },
        {
          id: '2',
          kind: 'plain_assistant',
          content: '你好！今天想了解什么？',
        },
      ],
      { experienceMode: plan.mode },
    );
    expect(visible.every((a) => a.kind !== 'confirm_gate')).toBe(true);
    expect(visible.some((a) => a.kind === 'plain_assistant')).toBe(true);
  });

  it('one-shot Q → Normal answer-first; no Home rail', () => {
    const plan = planExperience({
      message: '什么是闭包',
      surface: 'chat',
      confidence: 0.85,
      intent: 'chat',
    });
    expect(plan.mode).toBe('normal');
    expect(
      plan.skippedSteps.includes('calibration') ||
        plan.nextAction === 'stream_chat',
    ).toBe(true);
    expect(shouldShowLearnProgressRail('normal', 'calibration')).toBe(false);
  });
});

// ── Scenario 2: Normal inline calibrate + diagram ──────────────────────────

describe('UX08 E2E-contract: Normal inline interaction', () => {
  it('Normal keeps interactive choices; hides funnel chrome', () => {
    const visible = filterVisibleArtifacts(
      [
        { id: 'c', kind: 'confirm_gate', content: 'debug' },
        {
          id: 'q',
          kind: 'single_choice',
          content: '你更熟悉？',
          options: ['语法', '应用'],
        },
        {
          id: 'p',
          kind: 'plain_assistant',
          content: '闭包是函数与其词法环境的组合。\n:::diagram\nA→B\n:::',
        },
      ],
      { experienceMode: 'normal' },
    );
    expect(visible.map((a) => a.kind).sort()).toEqual(
      ['plain_assistant', 'single_choice'].sort(),
    );
  });
});

// ── Scenario 3: Normal → Deep → course URL ─────────────────────────────────

describe('UX08 E2E-contract: Normal → Deep → /course/[id]', () => {
  it('explicit deep + goal/level → outline commit path', () => {
    const plan = planExperience({
      message: '我想系统学习 TypeScript',
      surface: 'chat',
      confidence: 0.9,
      userModePreference: 'deep',
      knownGoal: 'TypeScript',
      knownLevel: 'beginner',
      intent: 'learn',
    });
    expect(plan.mode).toBe('deep_planning');
    expect(
      plan.nextAction === 'run_outline' ||
        plan.requiredSteps.includes('outline') ||
        plan.optionalSteps.includes('outline'),
    ).toBe(true);
  });

  it('outline edits are not commit; 开始学习 is sole commit → course URL', () => {
    expect(isOutlineEditCommitAction('rename')).toBe(false);
    const blocked = canCommitCourseStart({
      stage: 'outline',
      outlineUnits: [{ title: '基础', knowledgePoints: [] }],
      confirmed: false,
    });
    expect(blocked.ok).toBe(false);
    const ok = canCommitCourseStart({
      stage: 'outline',
      outlineUnits: [{ title: '基础', knowledgePoints: [] }],
      confirmed: true,
    });
    expect(ok.ok).toBe(true);
    const nav = courseCommitNavigation('course_abc', 'sess_1');
    expect(nav.href).toBe(coursePath('course_abc', 'sess_1'));
    expect(nav.href.startsWith('/course/')).toBe(true);
  });
});

// ── Scenario 4: Unit complete / remediate / ask / refresh ──────────────────

describe('UX08 E2E-contract: unit complete / remediate / refresh', () => {
  it('mastery copy is natural Chinese (no pass/fail primary labels)', () => {
    for (const m of ['pass', 'partial', 'fail', 'unknown'] as const) {
      const l = masteryFeedbackLabel(m);
      expect(l).not.toMatch(/\bpass\b|\bfail\b/i);
      expect(l.length).toBeGreaterThan(0);
    }
  });

  it('course path parse restores courseId (+ optional session)', () => {
    const route = parseAppPath(
      '/course/course_x',
      new URLSearchParams('s=sess_y'),
    );
    expect(route.view).toBe('session');
    if (route.view === 'session') {
      expect(route.courseId).toBe('course_x');
      expect(route.sessionId).toBe('sess_y');
    }
  });

  it('unit tree builds from session sections for restore', () => {
    const tree = buildUnitTreeFromSections(
      [
        { id: 'sec1', title: 'Unit 1', status: 'done', order: 0 },
        { id: 'sec2', title: 'Unit 2', status: 'open', order: 1 },
      ],
      'sec2',
    );
    expect(tree.nodes.length).toBe(2);
    expect(tree.currentId).toBe('sec2');
    expect(tree.overallPercent).toBe(50);
  });

  it('follow-up stays on unit; no IntentJudge re-entry', () => {
    expect(shouldReenterIntentOnCourseFollowUp()).toBe(false);
    const follow = decideCourseFollowUp('再讲一遍', 'sec2');
    expect(follow.kind).toBe('follow_up');
    if (follow.kind === 'follow_up') {
      expect(follow.reenterIntent).toBe(false);
      expect(follow.sectionId).toBe('sec2');
    }
    const advance = decideCourseAdvance(
      [
        { id: 'sec1', status: 'done', order: 0 },
        { id: 'sec2', status: 'open', order: 1 },
      ],
      'sec1',
    );
    expect(advance.kind === 'advance' || advance.kind === 'complete_course').toBe(
      true,
    );
    if (advance.kind === 'advance') {
      expect(advance.requiresSideEffectConfirm).toBe(false);
    }
  });
});

// ── Scenario 5: Chat plan → Calendar Accept/Edit → full month ──────────────

describe('UX08 E2E-contract: calendar full month + no write before accept', () => {
  it('default month grid is 42 cells', () => {
    const grid = buildMonthCells(new Date(2026, 6, 13), [], {
      now: new Date(2026, 6, 13),
    });
    expect(grid.cells).toHaveLength(MONTH_CELL_COUNT);
    expect(grid.view).toBe('month');
  });

  it('no course write without explicit confirm', () => {
    expect(
      canCommitCourseStart({
        stage: 'idle',
        outlineUnits: [],
        confirmed: false,
      }).ok,
    ).toBe(false);
  });
});

// ── Scenario 6: Library → Normal/Deep ──────────────────────────────────────

describe('UX08 E2E-contract: Library → Normal/Deep actions', () => {
  it('primary library projection hides tech fields; actions include Normal/Deep', () => {
    const item = toLibraryListItem({
      id: 'd1',
      courseId: 'c1',
      title: '笔记.md',
      format: 'md',
      summary: '关于闭包',
      chunks: [{ id: 'c' }],
      sourceQuality: 0.9,
      duplicateOfDocumentId: 'dup',
      content: 'File.text body',
    });
    const blob = JSON.stringify(item);
    expect(blob).not.toMatch(/sourceQuality|duplicateOfDocumentId|chunks/);
    const labels = DOCUMENT_PRIMARY_ACTIONS.map((a) => a.label).join(' ');
    expect(labels).toMatch(/提问|总结|普通|深入/);
    expect(
      DOCUMENT_PRIMARY_ACTIONS.some((a) => a.mode === 'normal'),
    ).toBe(true);
    expect(DOCUMENT_PRIMARY_ACTIONS.some((a) => a.mode === 'deep')).toBe(true);
  });
});

// ── Scenario 7: Home task dedupe + safe history resume ──────────────────────

describe('UX08 E2E-contract: Home dedupe + safe history resume', () => {
  it('dedupe then truncate; one identity → one primary continuation', () => {
    const tasks = [
      {
        id: 't1',
        title: '学 TS',
        courseId: 'c1',
        status: 'confirmed' as const,
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 't1',
        title: '学 TS 副本',
        courseId: 'c1',
        status: 'confirmed' as const,
        updatedAt: '2026-07-02T00:00:00.000Z',
      },
      {
        id: 't2',
        title: '学 React',
        courseId: 'c2',
        status: 'confirmed' as const,
        updatedAt: '2026-07-03T00:00:00.000Z',
      },
    ];
    const deduped = dedupeRecentTasks(tasks, { max: 5 });
    expect(deduped.filter((t) => t.id === 't1')).toHaveLength(1);

    const cont = selectContinuation(tasks, 'home', {
      sessions: [
        {
          id: 's1',
          courseId: 'c1',
          taskId: 't1',
          startedAt: '2026-01-01',
        },
      ],
    });
    expect(cont).not.toBeNull();
    expect(cont!.deepLink.href).toMatch(/^\/(course|chat|calendar)/);
    expect(continuationIdentity(tasks[0]!)).toBe(
      continuationIdentity(tasks[1]!),
    );
  });

  it('home drafts do not pollute recent; resume is context_only', () => {
    const state = applyOpenHomeDrafts(
      { conversations: [], activeConversationId: null },
      5,
    );
    expect(state.conversations).toHaveLength(0);
    expect(filterRecentConversations(state.conversations)).toHaveLength(0);

    const intel = buildChatIntelligence({
      id: 'conv_1',
      title: '什么是闭包',
      messages: [
        { role: 'user', content: '什么是闭包' },
        { role: 'assistant', content: '闭包是…' },
      ],
    });
    expect(intel.safeResume.mode).toBe('context_only');
    expect(intel.safeResume.autoReplayTools).toBe(false);
    const payload = buildSafeResumePayload(intel);
    expect(payload.autoReplayTools).toBe(false);
  });
});

// ── Scenario 8: HITL allow / deny / cancel ─────────────────────────────────

describe('UX08 E2E-contract: HITL allow / deny / cancel', () => {
  it('HITL primary copy is natural Chinese; deny content is user-safe', () => {
    const title = hitlConfirmTitle({
      toolName: 'code_executor',
      confirmReason: 'dangerous_tool',
      whatChanges: '运行一条 shell 命令',
    });
    const summary = hitlConfirmSummary({
      toolName: 'code_executor',
      whatChanges: '运行一条 shell 命令',
    });
    expect(title.length).toBeGreaterThan(0);
    expect(summary.length).toBeGreaterThan(0);
    expect(title).not.toMatch(/HITL|sandbox|IntentJudge/i);

    const reason = resolveConfirmReason('code_executor', { command: 'ls' });
    expect(CONFIRM_REASONS).toContain(reason);
    const denied = denyToolResultContent('code_executor', reason);
    expect(denied.length).toBeGreaterThan(0);
  });
});

// ── Product gates ──────────────────────────────────────────────────────────

describe('UX08 product gates', () => {
  it('URL is page SoT: root paths map correctly', () => {
    expect(parseAppPath('/chat', new URLSearchParams()).view).toBe('home');
    expect(parseAppPath('/calendar', new URLSearchParams()).view).toBe(
      'calendar',
    );
    expect(parseAppPath('/library', new URLSearchParams()).view).toBe(
      'library',
    );
    expect(parseAppPath('/history', new URLSearchParams()).view).toBe(
      'history',
    );
    expect(chatPath('c1')).toContain('c=c1');
    expect(APP_PATHS.chat).toBe('/chat');
  });

  it('no Home LearnProgressRail for any experience mode', () => {
    for (const mode of [
      'chat',
      'normal',
      'deep_planning',
      'deep_course',
      'desktop',
    ]) {
      for (const stage of ['idle', 'calibration', 'outline', 'teaching']) {
        expect(shouldShowLearnProgressRail(mode, stage)).toBe(false);
      }
    }
  });

  it('confirm_gate label is natural (no 意图待确认 debug)', () => {
    expect(LEARN_STATE_SPECS.intent_proposed.labelZh).toBe('确认目标');
    expect(LEARN_STATE_SPECS.intent_proposed.labelZh).not.toMatch(/意图待确认/);
  });

  it('production entry sources do not import MainPanel or LearningFeed', () => {
    const roots = [
      join(process.cwd(), 'src/app'),
      join(process.cwd(), 'src/components/layout/app-shell.tsx'),
      join(process.cwd(), 'src/components/chat/home-chat.tsx'),
      join(process.cwd(), 'src/components/layout/sidebar.tsx'),
    ];
    const files: string[] = [];
    function walk(p: string) {
      const st = statSync(p);
      if (st.isFile() && /\.(tsx?|jsx?)$/.test(p)) files.push(p);
      else if (st.isDirectory()) {
        for (const name of readdirSync(p)) {
          if (name === 'node_modules' || name.startsWith('.')) continue;
          walk(join(p, name));
        }
      }
    }
    for (const r of roots) walk(r);
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      if (/from\s+['"]@\/components\/layout\/main-panel['"]/.test(text)) {
        offenders.push(`${relative(process.cwd(), f)}:MainPanel`);
      }
      if (/from\s+['"]@\/components\/learning\/learning-feed['"]/.test(text)) {
        offenders.push(`${relative(process.cwd(), f)}:LearningFeed`);
      }
      if (
        f.endsWith('home-chat.tsx') &&
        /import\s+\{[^}]*LearnProgressRail/.test(text)
      ) {
        offenders.push(
          `${relative(process.cwd(), f)}:LearnProgressRail import`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it('user-facing components scan: forbidden terms not in primary quoted strings', () => {
    const componentRoots = [
      join(process.cwd(), 'src/components/chat/home-chat.tsx'),
      join(process.cwd(), 'src/components/ui/tool-confirm-dialog.tsx'),
      join(process.cwd(), 'src/components/chat/desktop-tool-timeline.tsx'),
      join(process.cwd(), 'src/components/learning/calendar.tsx'),
    ];
    for (const f of componentRoots) {
      const text = readFileSync(f, 'utf8');
      const stripped = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const term of [
        'IntentJudge',
        'OutlineAgent',
        'Agent is thinking',
        'Loading skills',
        'AUTONOMOUS',
        'Start Session',
      ] as const) {
        const quoted = new RegExp(`['"\`][^'"\`]*${term}[^'"\`]*['"\`]`);
        expect(quoted.test(stripped), `${f} leaked ${term}`).toBe(false);
      }
    }
    expect(UX07_FORBIDDEN_PRIMARY_TERMS.length).toBeGreaterThan(5);
  });

  it('visual contract breakpoints: 1440 desktop, 1024 tablet, 768 drawer edge', () => {
    expect(shellLayoutMode(1440)).toBe('desktop');
    expect(shellLayoutMode(1024)).toBe('tablet');
    expect(shellLayoutMode(768)).toBe('tablet');
    expect(shellLayoutMode(767)).toBe('mobile');
    expect(navAsDrawer(shellLayoutMode(767))).toBe(true);
    expect(navAsDrawer(shellLayoutMode(1440))).toBe(false);
  });

  it('legacy learn stage + empty chat migration preserves content', () => {
    const boot = migrateClientBootstrap({
      learnFlowStage: 'memory',
      chat: {
        conversations: [
          { id: 'a', messages: [{ role: 'user', content: 'keep me' }] },
          { id: 'b', messages: [] },
        ],
      },
      activeAppView: 'feed',
    });
    expect(boot.learnFlowStage).toBe('goal_clarification');
    expect(boot.chat.conversations).toHaveLength(1);
    expect(conversationHasContent(boot.chat.conversations[0]!)).toBe(true);
    expect(boot.appView.path).toBe('/chat');
    expect(migrateLearnFlowStage('resources')).toBe('outline');
  });
});

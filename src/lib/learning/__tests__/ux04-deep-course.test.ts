/**
 * UX04 focused tests:
 * - editable outline (rename/add/remove/reorder/expand KP)
 * - no persistence before confirmation
 * - course creation/navigation after confirmation
 * - current-unit follow-up (no IntentJudge)
 * - refresh restoration of course route / current unit
 */

import { describe, expect, it } from 'vitest';
import {
  addOutlineKnowledgePoint,
  addOutlineUnit,
  removeOutlineUnit,
  renameOutlineUnit,
  reorderOutlineUnit,
  setOutlineUnitKnowledgePoints,
} from '../outline-preview';
import {
  canCommitCourseStart,
  courseCommitNavigation,
  describeCourseCommitSteps,
  isOutlineEditCommitAction,
} from '../course-commit';
import {
  decideCourseAdvance,
  decideCourseFollowUp,
  shouldReenterIntentOnCourseFollowUp,
} from '../course-follow-up';
import {
  buildUnitTreeFromSections,
  unitTreeStatusLabel,
} from '../course-unit-tree';
import {
  hasMasteryJargonLeak,
  masteryFeedbackLabel,
  masteryFeedbackSentence,
} from '../mastery-copy';
import { coursePath, parseAppPath } from '@/lib/navigation/app-routes';

const sampleUnits = [
  {
    title: '第一单元：入门',
    knowledgePoints: ['概念 A', '概念 B'],
    description: '简介',
  },
  {
    title: '第二单元：进阶',
    knowledgePoints: ['技巧 1'],
  },
  {
    title: '第三单元：实战',
    knowledgePoints: ['综合练习'],
  },
];

describe('UX04 editable outline (preview only)', () => {
  it('renames, adds, removes, reorders units and expands knowledge points', () => {
    let units = sampleUnits.map((u) => ({
      ...u,
      knowledgePoints: [...u.knowledgePoints],
    }));

    units = renameOutlineUnit(units, 0, '第一单元：基础准备');
    expect(units[0]!.title).toBe('第一单元：基础准备');

    units = addOutlineUnit(units, { title: '第四单元：复盘', knowledgePoints: ['回顾'] });
    expect(units).toHaveLength(4);
    expect(units[3]!.title).toBe('第四单元：复盘');

    units = reorderOutlineUnit(units, 3, 1);
    expect(units[1]!.title).toBe('第四单元：复盘');

    units = setOutlineUnitKnowledgePoints(units, 0, ['术语', '流程', '注意事项']);
    expect(units[0]!.knowledgePoints).toEqual(['术语', '流程', '注意事项']);

    units = addOutlineKnowledgePoint(units, 0, '补充点');
    expect(units[0]!.knowledgePoints).toContain('补充点');

    const beforeRemove = units.length;
    units = removeOutlineUnit(units, 2);
    expect(units.length).toBe(beforeRemove - 1);
  });

  it('refuses to remove the last unit by default', () => {
    let units = [{ title: '仅一节', knowledgePoints: ['点'] }];
    units = removeOutlineUnit(units, 0);
    expect(units).toHaveLength(1);
  });
});

describe('UX04 no persistence before confirmation', () => {
  it('outline edit actions are never commit actions', () => {
    expect(isOutlineEditCommitAction('rename')).toBe(false);
    expect(isOutlineEditCommitAction('add')).toBe(false);
    expect(isOutlineEditCommitAction('remove')).toBe(false);
    expect(isOutlineEditCommitAction('reorder')).toBe(false);
    expect(isOutlineEditCommitAction('expand_kp')).toBe(false);
  });

  it('canCommitCourseStart requires explicit confirmation', () => {
    const denied = canCommitCourseStart({
      stage: 'outline',
      outlineUnits: sampleUnits,
      confirmed: false,
    });
    expect(denied.ok).toBe(false);

    const empty = canCommitCourseStart({
      stage: 'outline',
      outlineUnits: [],
      confirmed: true,
    });
    expect(empty.ok).toBe(false);

    const ok = canCommitCourseStart({
      stage: 'outline',
      outlineUnits: sampleUnits,
      confirmed: true,
    });
    expect(ok.ok).toBe(true);
  });
});

describe('UX04 course creation / navigation after confirmation', () => {
  it('describes sole commit steps and builds /course/[id] navigation', () => {
    const steps = describeCourseCommitSteps();
    expect(steps).toContain('createCourse');
    expect(steps).toContain('createLearningPathFromOutline');
    expect(steps).toContain('createSession');
    expect(steps).toContain('navigateCourse');
    // Batch-05: calendar confirm is a separate surface
    expect(steps).not.toContain('confirmPendingTasks');
    expect(steps).not.toContain('confirmTask');

    const nav = courseCommitNavigation('course_abc', 'sess_1');
    expect(nav.href).toBe(coursePath('course_abc', 'sess_1'));
    expect(nav.href).toContain('/course/course_abc');
    expect(nav.href).toContain('s=sess_1');
  });
});

describe('UX04 current-unit follow-up', () => {
  it('keeps follow-up on current unit and never re-enters IntentJudge', () => {
    const d = decideCourseFollowUp('什么是闭包？', 'sec_open');
    expect(d.kind).toBe('follow_up');
    if (d.kind === 'follow_up') {
      expect(d.sectionId).toBe('sec_open');
      expect(d.reenterIntent).toBe(false);
    }
    expect(shouldReenterIntentOnCourseFollowUp()).toBe(false);
  });

  it('下一节 advances without side-effect confirmation', () => {
    const sections = [
      { id: 's1', status: 'done', order: 0 },
      { id: 's2', status: 'open', order: 1 },
      { id: 's3', status: 'locked', order: 2 },
    ];
    const d = decideCourseAdvance(sections, 's1');
    expect(d.kind).toBe('advance');
    if (d.kind === 'advance') {
      expect(d.toSectionId).toBe('s2');
      expect(d.requiresSideEffectConfirm).toBe(false);
    }
  });
});

describe('UX04 unit tree + mastery copy', () => {
  it('builds current/completed/locked + overall percent', () => {
    const tree = buildUnitTreeFromSections(
      [
        { id: 'a', title: '单元 1', status: 'done', order: 0 },
        { id: 'b', title: '单元 2', status: 'open', order: 1, knowledgePoints: ['KP'] },
        { id: 'c', title: '单元 3', status: 'locked', order: 2 },
      ],
      'b',
    );
    expect(tree.completedCount).toBe(1);
    expect(tree.totalCount).toBe(3);
    expect(tree.overallPercent).toBe(33);
    expect(tree.nodes.map((n) => n.status)).toEqual(['completed', 'current', 'locked']);
    expect(unitTreeStatusLabel('locked')).toBe('未解锁');
    expect(unitTreeStatusLabel('completed')).toBe('已完成');
  });

  it('uses natural Chinese mastery labels without pass/partial/fail', () => {
    expect(masteryFeedbackLabel('pass')).toBe('掌握得不错');
    expect(masteryFeedbackLabel('fail')).toBe('再练一下');
    expect(masteryFeedbackLabel('partial')).toBe('部分掌握');
    const sentence = masteryFeedbackSentence('pass', { canAdvance: true });
    expect(sentence).toContain('掌握得不错');
    expect(hasMasteryJargonLeak(sentence)).toBe(false);
    expect(hasMasteryJargonLeak('判定: pass')).toBe(true);
  });
});

describe('UX04 refresh restoration', () => {
  it('parseAppPath restores course id and optional session from URL', () => {
    const route = parseAppPath('/course/course_xyz', new URLSearchParams('s=sess_99'));
    expect(route.view).toBe('session');
    if (route.view === 'session') {
      expect(route.courseId).toBe('course_xyz');
      expect(route.sessionId).toBe('sess_99');
    }
  });

  it('buildUnitTreeFromSections restores current unit from currentSectionId', () => {
    const tree = buildUnitTreeFromSections(
      [
        { id: 'u1', title: 'A', status: 'done', order: 0 },
        { id: 'u2', title: 'B', status: 'open', order: 1 },
      ],
      'u2',
    );
    expect(tree.currentId).toBe('u2');
    expect(tree.nodes.find((n) => n.id === 'u2')?.status).toBe('current');
  });
});

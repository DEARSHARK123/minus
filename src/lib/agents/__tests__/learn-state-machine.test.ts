import { describe, it, expect } from 'vitest';
import {
  buildProgressStepsFromStage,
  CANONICAL_LEARN_STAGES,
  decideMidFlowRoute,
  isActionAllowedInStage,
  isDeepCourseStage,
  isFixedFunnelDriverStage,
  isPersistProgressOwner,
  LEARN_STATE_SPECS,
  normalizeLearnStage,
  progressRailAllowedForExperienceMode,
  requiresMidFlowOrchestrator,
  sessionPhaseToLearnStage,
} from '@/lib/agents/learn-state-machine';

describe('learn-state-machine', () => {
  it('defines all canonical stages with inputs/skills/artifacts/exits', () => {
    expect(CANONICAL_LEARN_STAGES).toEqual([
      'idle',
      'intent_proposed',
      'goal_clarification',
      'calibration',
      'outline',
      'ready',
      'teaching',
      'recall',
      'assessment',
      'remediation',
      'completed',
    ]);
    for (const stage of CANONICAL_LEARN_STAGES) {
      const spec = LEARN_STATE_SPECS[stage];
      expect(spec.stage).toBe(stage);
      expect(spec.allowedInputs.length).toBeGreaterThan(0);
      expect(Array.isArray(spec.skills)).toBe(true);
      expect(Array.isArray(spec.artifacts)).toBe(true);
      expect(spec.sideEffects.length).toBeGreaterThan(0);
      expect(spec.exits.length).toBeGreaterThan(0);
      expect(spec.exitConditions.length).toBeGreaterThan(0);
    }
  });

  it('normalizes legacy stages to canonical', () => {
    expect(normalizeLearnStage('memory')).toBe('goal_clarification');
    expect(normalizeLearnStage('calibrating')).toBe('calibration');
    expect(normalizeLearnStage('resources')).toBe('outline');
    expect(normalizeLearnStage('calibration')).toBe('calibration');
  });

  it('routes free_text calibration messages to select_calibration (never silent chat)', () => {
    const d = decideMidFlowRoute({
      stage: 'calibration',
      message: '我学过一点线性代数',
      hasFreeTextArtifact: true,
      hasMultiChoiceArtifact: false,
      hasSingleChoiceArtifact: false,
      calibrationPending: true,
    });
    expect(d.kind).toBe('select_calibration');
    if (d.kind === 'select_calibration') {
      expect(d.action).toBe('select_calibration');
      expect(d.message).toContain('线性代数');
    }
  });

  it('routes legacy calibrating free_text the same way', () => {
    const d = decideMidFlowRoute({
      stage: 'calibrating',
      message: '零基础',
      hasFreeTextArtifact: true,
      hasMultiChoiceArtifact: false,
      hasSingleChoiceArtifact: false,
      calibrationPending: true,
    });
    expect(d.kind).toBe('select_calibration');
  });

  it('blocks multi_choice pending to UI (no dumb chat)', () => {
    const d = decideMidFlowRoute({
      stage: 'calibration',
      message: '随便说点',
      hasFreeTextArtifact: false,
      hasMultiChoiceArtifact: true,
      hasSingleChoiceArtifact: false,
      calibrationPending: true,
    });
    expect(d.kind).toBe('blocked_await_ui');
    if (d.kind === 'blocked_await_ui') {
      expect(d.hint).toMatch(/多选|选项/);
    }
  });

  it('blocks intent_proposed free text to confirm gate', () => {
    const d = decideMidFlowRoute({
      stage: 'intent_proposed',
      message: '改主意了',
      hasFreeTextArtifact: false,
      hasMultiChoiceArtifact: false,
      hasSingleChoiceArtifact: false,
      calibrationPending: false,
    });
    expect(d.kind).toBe('blocked_await_ui');
  });

  it('idle routes to orchestrator intent', () => {
    const d = decideMidFlowRoute({
      stage: 'idle',
      message: '你好',
      hasFreeTextArtifact: false,
      hasMultiChoiceArtifact: false,
      hasSingleChoiceArtifact: false,
      calibrationPending: false,
    });
    expect(d.kind).toBe('orchestrator_intent');
  });

  it('requires mid-flow orchestrator for active learn stages', () => {
    expect(requiresMidFlowOrchestrator('calibration')).toBe(true);
    expect(requiresMidFlowOrchestrator('outline')).toBe(true);
    expect(requiresMidFlowOrchestrator('teaching')).toBe(true);
    expect(requiresMidFlowOrchestrator('idle')).toBe(false);
  });

  it('allows confirm_learn only at intent_proposed', () => {
    expect(isActionAllowedInStage('intent_proposed', 'confirm_learn')).toBe(true);
    expect(isActionAllowedInStage('idle', 'confirm_learn')).toBe(false);
    expect(isActionAllowedInStage('calibration', 'select_calibration')).toBe(true);
  });

  it('builds progress steps from stage without hardcoded invent mastery', () => {
    const steps = buildProgressStepsFromStage('calibration');
    expect(steps.length).toBeGreaterThan(3);
    const active = steps.filter((s) => s.status === 'active');
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe('calibration');
    expect(steps.find((s) => s.id === 'intent_proposed')?.status).toBe('done');
  });

  it('maps session phases to learn stages', () => {
    expect(sessionPhaseToLearnStage('teach')).toBe('teaching');
    expect(sessionPhaseToLearnStage('active_recall')).toBe('recall');
    expect(sessionPhaseToLearnStage('assess')).toBe('assessment');
    expect(sessionPhaseToLearnStage('remediate')).toBe('remediation');
    expect(sessionPhaseToLearnStage('done')).toBe('completed');
  });

  it('narrator is not persist progress owner', () => {
    expect(isPersistProgressOwner('narrator')).toBe(false);
    expect(isPersistProgressOwner('session_engine')).toBe(true);
    expect(isPersistProgressOwner('repository')).toBe(true);
  });

  it('UX02: progress rail only for deep modes; Chat/Normal are not funnel drivers', () => {
    expect(progressRailAllowedForExperienceMode('chat')).toBe(false);
    expect(progressRailAllowedForExperienceMode('normal')).toBe(false);
    expect(progressRailAllowedForExperienceMode('deep_planning')).toBe(true);
    expect(progressRailAllowedForExperienceMode('deep_course')).toBe(true);
    expect(isDeepCourseStage('teaching')).toBe(true);
    expect(isDeepCourseStage('idle')).toBe(false);
    expect(isFixedFunnelDriverStage('idle')).toBe(false);
    expect(isFixedFunnelDriverStage('calibration')).toBe(true);
    expect(isFixedFunnelDriverStage('teaching')).toBe(true);
  });
});

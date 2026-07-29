import { describe, expect, it } from 'vitest';
import type { LearnArtifact } from '@/lib/agents/types';
import {
  filterVisibleArtifacts,
  isEmptyMemoryArtifact,
  shouldShowLearnProgressRail,
} from '../artifact-visibility';

function art(partial: Partial<LearnArtifact> & { kind: LearnArtifact['kind'] }): LearnArtifact {
  return {
    id: partial.id || `a_${partial.kind}`,
    kind: partial.kind,
    title: partial.title,
    content: partial.content,
    options: partial.options,
    memoryEntries: partial.memoryEntries,
    progressSteps: partial.progressSteps,
  };
}

describe('artifact-visibility (UX03)', () => {
  it('hides empty memory and pure progress_update', () => {
    const emptyMem = art({
      kind: 'memory_card',
      content: '暂无长期记忆',
      memoryEntries: [],
    });
    const progress = art({
      kind: 'progress_update',
      title: '进度',
      progressSteps: [{ id: '1', label: '校准', status: 'active' }],
    });
    expect(isEmptyMemoryArtifact(emptyMem)).toBe(true);
    const visible = filterVisibleArtifacts(
      [
        emptyMem,
        progress,
        art({ kind: 'plain_assistant', content: '闭包是…' }),
        art({
          kind: 'single_choice',
          content: '你更熟悉？',
          options: ['A', 'B'],
        }),
      ],
      { experienceMode: 'normal' },
    );
    expect(visible.map((a) => a.kind)).toEqual(['plain_assistant', 'single_choice']);
  });

  it('normal mode hides confirm_gate and funnel cards', () => {
    const visible = filterVisibleArtifacts(
      [
        art({ kind: 'confirm_gate', content: '意图待确认' }),
        art({ kind: 'outline_card', title: '大纲' }),
        art({ kind: 'multi_choice', content: '多选', options: ['1', '2'] }),
      ],
      { experienceMode: 'normal' },
    );
    expect(visible.map((a) => a.kind)).toEqual(['multi_choice']);
  });

  it('deep planning may keep outline but still hide empty memory/progress', () => {
    const visible = filterVisibleArtifacts(
      [
        art({ kind: 'outline_card', title: '大纲' }),
        art({ kind: 'memory_card', content: '暂无长期记忆' }),
        art({ kind: 'progress_update', title: '进度' }),
      ],
      { experienceMode: 'deep_planning' },
    );
    expect(visible.map((a) => a.kind)).toEqual(['outline_card']);
  });

  it('UX08: LearnProgressRail never mounts on Home for any mode/stage', () => {
    expect(shouldShowLearnProgressRail('normal', 'calibration')).toBe(false);
    expect(shouldShowLearnProgressRail('chat', 'intent_proposed')).toBe(false);
    expect(shouldShowLearnProgressRail('deep_planning', 'outline')).toBe(false);
    expect(shouldShowLearnProgressRail('deep_planning', 'ready')).toBe(false);
    expect(shouldShowLearnProgressRail('deep_course', 'teaching')).toBe(false);
    expect(shouldShowLearnProgressRail('deep_planning', 'idle')).toBe(false);
    // UX08: even mid deep-planning calibration — no Home rail
    expect(shouldShowLearnProgressRail('deep_planning', 'calibration')).toBe(false);
  });
});

import { describe, expect, it, beforeEach } from 'vitest';
import {
  LEARN_FLOW_DRAFT_KEY,
  applyTurnArtifacts,
  backfillConversationTitle,
  emptyExperienceSnapshot,
  isGenericConversationTitle,
  isStaleConversationWrite,
  learnFlowSliceKey,
  newTurnId,
  resolvePinnedLearningSelection,
  shouldClearTurnArtifacts,
} from '../conversation-aggregate';
import {
  migrateChatPersistToV2,
  migrateGlobalLearnFlowToActiveConversation,
  seedLearnFlowSlicesFromChat,
} from '@/lib/migration/conversation-aggregate-migrate';
import { useLearnFlowStore } from '@/store/learn-flow-store';
import type { OrchestratorResult } from '@/lib/agents/types';

describe('conversation-aggregate pure helpers', () => {
  it('maps null conversation id to draft key', () => {
    expect(learnFlowSliceKey(null)).toBe(LEARN_FLOW_DRAFT_KEY);
    expect(learnFlowSliceKey('conv_a')).toBe('conv_a');
  });

  it('applyTurnArtifacts never sticky-merges empty results', () => {
    const prev = [
      { id: 'a1', kind: 'outline_card', content: 'old outline' },
      { id: 'a2', kind: 'single_choice', content: 'Q?' },
    ];
    expect(applyTurnArtifacts(prev, [])).toEqual([]);
    expect(shouldClearTurnArtifacts([])).toBe(true);
    expect(shouldClearTurnArtifacts(undefined)).toBe(true);
    const next = applyTurnArtifacts(prev, [
      { id: 'b1', kind: 'plain_assistant', content: 'hi' },
    ]);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('b1');
    expect(next.find((a) => a.id === 'a1')).toBeUndefined();
  });

  it('backfills generic 新对话 titles from first user message', () => {
    expect(isGenericConversationTitle('新对话')).toBe(true);
    expect(
      backfillConversationTitle({
        title: '新对话',
        messages: [
          { role: 'user', content: '帮我学闭包' },
          { role: 'assistant', content: '好的' },
        ],
      }),
    ).toBe('帮我学闭包');
  });

  it('keeps custom titles', () => {
    expect(
      backfillConversationTitle({
        title: '我的主题',
        messages: [{ role: 'user', content: 'other' }],
      }),
    ).toBe('我的主题');
  });

  it('race guard detects conversation switch and generation mismatch', () => {
    expect(
      isStaleConversationWrite({
        expectedConversationId: 'conv_a',
        boundConversationId: 'conv_b',
      }),
    ).toBe(true);
    expect(
      isStaleConversationWrite({
        expectedConversationId: 'conv_a',
        boundConversationId: 'conv_a',
        expectedGeneration: 1,
        currentGeneration: 2,
      }),
    ).toBe(true);
    expect(
      isStaleConversationWrite({
        expectedConversationId: null,
        boundConversationId: null,
        expectedGeneration: 3,
        currentGeneration: 3,
      }),
    ).toBe(false);
  });

  it('newTurnId is unique-ish', () => {
    const a = newTurnId();
    const b = newTurnId();
    expect(a).toMatch(/^turn_/);
    expect(a).not.toBe(b);
  });
});

describe('URL pin learning selection', () => {
  const courses = [{ id: 'course_pin' }, { id: 'course_other' }];
  const sessions = [
    {
      id: 'sess_old',
      courseId: 'course_other',
      taskId: 't1',
      startedAt: '2026-07-01T00:00:00.000Z',
      endedAt: null,
    },
    {
      id: 'sess_pin',
      courseId: 'course_pin',
      taskId: 't2',
      startedAt: '2026-07-02T00:00:00.000Z',
      endedAt: null,
    },
  ];

  it('honors URL course+session pin over previous active session', () => {
    const r = resolvePinnedLearningSelection({
      courses,
      sessions,
      pinnedCourseId: 'course_pin',
      pinnedSessionId: 'sess_pin',
      previousSelectedCourseId: 'course_other',
      previousActiveSessionId: 'sess_old',
    });
    expect(r.pinHonored).toBe(true);
    expect(r.selectedCourseId).toBe('course_pin');
    expect(r.activeSession?.id).toBe('sess_pin');
    expect(r.activeTaskId).toBe('t2');
  });

  it('does not pick unrelated course session when only course is pinned', () => {
    const r = resolvePinnedLearningSelection({
      courses,
      sessions,
      pinnedCourseId: 'course_pin',
      pinnedSessionId: null,
      previousActiveSessionId: 'sess_old',
    });
    expect(r.pinHonored).toBe(true);
    expect(r.selectedCourseId).toBe('course_pin');
    expect(r.activeSession?.id).toBe('sess_pin');
  });
});

describe('chat persist schema v2 migration', () => {
  it('upgrades unversioned chat and backfills titles', () => {
    const raw = {
      conversations: [
        {
          id: 'c1',
          title: '新对话',
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: '学习 React hooks',
              timestamp: '2026-01-01T00:00:00.000Z',
            },
          ],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'empty',
          title: '新对话',
          messages: [],
        },
      ],
      activeConversationId: 'c1',
    };
    const result = migrateChatPersistToV2(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.version).toBe(2);
    expect(result.state.conversations).toHaveLength(1);
    expect(result.state.conversations[0].title).toBe('学习 React hooks');
    expect(result.state.conversations[0].experience).toBeDefined();
    // Legacy message without turnId still present
    expect(result.state.conversations[0].messages[0].content).toBe(
      '学习 React hooks',
    );
    expect(result.state.conversations[0].messages[0].turnId).toBeUndefined();
  });

  it('migrates global learn-flow onto active conversation only', () => {
    const base = migrateChatPersistToV2({
      conversations: [
        {
          id: 'active',
          title: 'A',
          messages: [{ id: '1', role: 'user', content: 'a', timestamp: Date.now() }],
        },
        {
          id: 'other',
          title: 'B',
          messages: [{ id: '2', role: 'user', content: 'b', timestamp: Date.now() }],
        },
      ],
      activeConversationId: 'active',
    });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const next = migrateGlobalLearnFlowToActiveConversation(base.state, {
      stage: 'outline',
      topic: 'TypeScript',
      artifacts: [{ id: 'o1', kind: 'outline_card', content: 'units' }],
      experienceMode: 'deep_planning',
      modePreference: 'deep',
    });
    const active = next.conversations.find((c) => c.id === 'active')!;
    const other = next.conversations.find((c) => c.id === 'other')!;
    expect(active.experience?.topic).toBe('TypeScript');
    expect(active.experience?.stage).toBe('outline');
    expect(active.modePreference).toBe('deep');
    expect(other.experience?.topic || '').toBe('');
  });

  it('fail-closed on corrupt conversations array', () => {
    const result = migrateChatPersistToV2({
      conversations: 'not-an-array',
      activeConversationId: 'x',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.preservedRaw).toBe(true);
    expect(result.reason).toMatch(/not an array/i);
  });

  it('fail-closed when all contentful rows are unreadable', () => {
    const result = migrateChatPersistToV2({
      conversations: [
        {
          id: 'bad',
          messages: [{ foo: 1 }, { bar: 2 }],
        },
      ],
      activeConversationId: 'bad',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.preservedRaw).toBe(true);
  });

  it('seeds learn-flow slices per conversation', () => {
    const migrated = migrateChatPersistToV2({
      conversations: [
        {
          id: 'c1',
          title: 't',
          messages: [{ id: 'm', role: 'user', content: 'hi', timestamp: 1 }],
          experience: emptyExperienceSnapshot('normal'),
        },
      ],
      activeConversationId: 'c1',
    });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const seeds = seedLearnFlowSlicesFromChat(migrated.state);
    expect(seeds.c1).toBeDefined();
    expect(seeds.c1.modePreference).toBe('normal');
  });
});

describe('learn-flow conversation isolation + sticky clear + race', () => {
  beforeEach(() => {
    useLearnFlowStore.getState().reset();
  });

  it('draft bind creates fresh slice; switch restores per conversationId', () => {
    const store = useLearnFlowStore.getState();
    store.bindConversation(null, { resetDraft: true });
    store.applyOrchestratorResult({
      route: 'learn_outline',
      artifacts: [
        {
          id: 'outline_a',
          kind: 'outline_card',
          content: 'A outline',
          units: [{ title: 'U1', knowledgePoints: ['k'] }],
        },
      ],
      nextStage: 'outline',
      topic: 'TopicA',
    } as OrchestratorResult);
    expect(useLearnFlowStore.getState().artifacts).toHaveLength(1);
    expect(useLearnFlowStore.getState().topic).toBe('TopicA');

    // Promote as conversation A
    useLearnFlowStore.getState().promoteDraftToConversation('conv_a');
    expect(useLearnFlowStore.getState().boundConversationId).toBe('conv_a');
    expect(useLearnFlowStore.getState().artifacts[0]?.id).toBe('outline_a');

    // Open draft B — fresh, no sticky A cards
    useLearnFlowStore.getState().bindConversation(null, { resetDraft: true });
    expect(useLearnFlowStore.getState().boundConversationId).toBeNull();
    expect(useLearnFlowStore.getState().artifacts).toEqual([]);
    expect(useLearnFlowStore.getState().topic).toBe('');

    // Switch back to A — restore
    useLearnFlowStore.getState().bindConversation('conv_a', {
      createIfMissing: true,
    });
    expect(useLearnFlowStore.getState().artifacts[0]?.id).toBe('outline_a');
    expect(useLearnFlowStore.getState().topic).toBe('TopicA');
  });

  it('empty orchestrator result clears artifacts (no sticky merge)', () => {
    useLearnFlowStore.getState().bindConversation('conv_x', {
      createIfMissing: true,
    });
    useLearnFlowStore.getState().applyOrchestratorResult({
      route: 'learn_outline',
      artifacts: [
        { id: 'keep_me', kind: 'outline_card', content: 'old' },
      ],
      nextStage: 'outline',
      topic: 'X',
    } as OrchestratorResult);
    expect(useLearnFlowStore.getState().artifacts).toHaveLength(1);

    useLearnFlowStore.getState().applyOrchestratorResult({
      route: 'chat',
      artifacts: [],
      streamChat: true,
      nextStage: 'idle',
    } as OrchestratorResult);
    expect(useLearnFlowStore.getState().artifacts).toEqual([]);
    expect(useLearnFlowStore.getState().outlineUnits).toEqual([]);
  });

  it('stale apply after conversation switch is ignored (race)', () => {
    useLearnFlowStore.getState().bindConversation('conv_a', {
      createIfMissing: true,
    });
    useLearnFlowStore.getState().applyOrchestratorResult({
      route: 'learn_outline',
      artifacts: [{ id: 'a_only', kind: 'outline_card', content: 'A' }],
      nextStage: 'outline',
      topic: 'A',
    } as OrchestratorResult);

    // Simulate in-flight for A, then user switches to B
    useLearnFlowStore.getState().bindConversation('conv_b', {
      createIfMissing: true,
      snapshot: emptyExperienceSnapshot(null),
    });
    expect(useLearnFlowStore.getState().artifacts).toEqual([]);

    const applied = useLearnFlowStore.getState().applyOrchestratorResult(
      {
        route: 'learn_outline',
        artifacts: [
          { id: 'stale_a', kind: 'outline_card', content: 'should not land on B' },
        ],
        nextStage: 'outline',
        topic: 'STALE',
      } as OrchestratorResult,
      { expectedConversationId: 'conv_a' },
    );
    expect(applied).toBe(false);
    expect(useLearnFlowStore.getState().boundConversationId).toBe('conv_b');
    expect(useLearnFlowStore.getState().artifacts).toEqual([]);
    expect(useLearnFlowStore.getState().topic).toBe('');

    // A still has original when rebound
    useLearnFlowStore.getState().bindConversation('conv_a');
    expect(useLearnFlowStore.getState().artifacts[0]?.id).toBe('a_only');
  });
});

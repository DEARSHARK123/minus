/**
 * Batch-04 — Turn artifact ownership, edit truncation, copy/regenerate,
 * SSE race, HITL invalidate.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Message } from '@/types/agent';
import {
  COMMITTED_SIDE_EFFECT_NOTICE,
  REGENERATE_POLICY,
  artifactsBelongToTurn,
  committedSideEffectNotice,
  copyAssistantContentPolicy,
  hitlInvalidateRequest,
  isHitlTokenInvalidated,
  isStaleStreamWrite,
  learnArtifactsToMessage,
  messageArtifactsToLearn,
  regenerateAssistantPolicy,
  resolveInteractiveAssistantId,
  truncateForAssistantRegenerate,
  truncateMessagesAfterUserEdit,
} from '../turn-editing';
import { applyTurnArtifacts, newTurnId } from '../conversation-aggregate';
import { useChatStore } from '@/store/chat-store';
import { useLearnFlowStore } from '@/store/learn-flow-store';

function msg(
  partial: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>,
): Message {
  return {
    timestamp: new Date('2026-07-14T00:00:00.000Z'),
    ...partial,
  };
}

describe('turn artifact ownership', () => {
  it('binds artifacts to assistant turn id only', () => {
    const turnA = newTurnId();
    const turnB = newTurnId();
    const assistantA = msg({
      id: 'a1',
      role: 'assistant',
      content: 'outline',
      turnId: turnA,
      artifacts: [{ id: 'art1', kind: 'outline_card', content: 'A' }],
    });
    const assistantB = msg({
      id: 'a2',
      role: 'assistant',
      content: 'choice',
      turnId: turnB,
      artifacts: [{ id: 'art2', kind: 'single_choice', content: 'B?' }],
    });

    expect(artifactsBelongToTurn(assistantA, turnA)).toBe(true);
    expect(artifactsBelongToTurn(assistantA, turnB)).toBe(false);
    expect(artifactsBelongToTurn(assistantB, turnB)).toBe(true);
    expect(artifactsBelongToTurn(assistantB, turnA)).toBe(false);
    expect(
      artifactsBelongToTurn(
        msg({ id: 'u1', role: 'user', content: 'hi', turnId: turnA }),
        turnA,
      ),
    ).toBe(false);
  });

  it('applyTurnArtifacts replaces (no sticky merge) per turn snapshot', () => {
    const prev = [{ id: 'old', kind: 'outline_card', content: 'old' }];
    expect(applyTurnArtifacts(prev, [])).toEqual([]);
    const next = applyTurnArtifacts(prev, [
      { id: 'new', kind: 'single_choice', content: 'Q' },
    ]);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('new');
  });

  it('round-trips learn artifacts ↔ message turn artifacts', () => {
    const learn = [
      {
        id: 'c1',
        kind: 'single_choice' as const,
        content: '水平？',
        options: ['零基础', '进阶'],
        clarification: {
          field: 'level' as const,
          selectionMode: 'single' as const,
          allowCustom: true,
        },
      },
    ];
    const asMsg = learnArtifactsToMessage(learn);
    expect(asMsg[0]?.clarification?.field).toBe('level');
    const back = messageArtifactsToLearn(asMsg);
    expect(back[0]?.kind).toBe('single_choice');
    expect(back[0]?.clarification?.allowCustom).toBe(true);
  });

  it('resolveInteractiveAssistantId prefers currentTurnId then latest assistant', () => {
    const turn = 'turn_active';
    const messages = [
      msg({ id: 'u1', role: 'user', content: 'a' }),
      msg({ id: 'a1', role: 'assistant', content: 'old', turnId: 'turn_old' }),
      msg({ id: 'u2', role: 'user', content: 'b' }),
      msg({
        id: 'a2',
        role: 'assistant',
        content: 'new',
        turnId: turn,
        artifacts: [{ id: 'x', kind: 'plain_assistant', content: 'hi' }],
      }),
    ];
    expect(resolveInteractiveAssistantId(messages, turn)).toBe('a2');
    expect(resolveInteractiveAssistantId(messages, null)).toBe('a2');
    expect(resolveInteractiveAssistantId(messages, 'missing')).toBe('a2');
  });
});

describe('edit truncation', () => {
  it('truncates subsequent messages and clears edited user artifacts', () => {
    const messages = [
      msg({ id: 'u1', role: 'user', content: 'first' }),
      msg({
        id: 'a1',
        role: 'assistant',
        content: 'ans1',
        artifacts: [{ id: 'x', kind: 'outline_card' }],
      }),
      msg({ id: 'u2', role: 'user', content: 'second' }),
      msg({ id: 'a2', role: 'assistant', content: 'ans2' }),
    ];
    const result = truncateMessagesAfterUserEdit(messages, 'u1', 'first edited');
    expect(result.ok).toBe(true);
    expect(result.truncatedCount).toBe(3);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toBe('first edited');
    expect(result.messages[0]?.artifacts).toEqual([]);
  });

  it('rejects non-user or missing ids', () => {
    const messages = [
      msg({ id: 'u1', role: 'user', content: 'x' }),
      msg({ id: 'a1', role: 'assistant', content: 'y' }),
    ];
    expect(truncateMessagesAfterUserEdit(messages, 'a1', 'nope').ok).toBe(false);
    expect(truncateMessagesAfterUserEdit(messages, 'missing', 'nope').ok).toBe(
      false,
    );
    expect(truncateMessagesAfterUserEdit(messages, 'u1', '   ').ok).toBe(false);
  });

  it('shows committed side-effect notice without auto-rollback semantics', () => {
    expect(committedSideEffectNotice(null)).toBeNull();
    expect(
      committedSideEffectNotice({
        stage: 'session',
        courseId: 'course_1',
        sessionId: 'sess_1',
      }),
    ).toBe(COMMITTED_SIDE_EFFECT_NOTICE);
    expect(
      committedSideEffectNotice(
        { stage: 'outline', courseId: null, sessionId: null },
        { hasLinkedCourse: true },
      ),
    ).toBe(COMMITTED_SIDE_EFFECT_NOTICE);
  });
});

describe('copy / regenerate policy', () => {
  it('allows copy but forbids assistant content edit', () => {
    const copy = copyAssistantContentPolicy();
    expect(copy.allowed).toBe(true);
    expect(copy.editContentAllowed).toBe(false);
    expect(REGENERATE_POLICY.allowAssistantContentEdit).toBe(false);
  });

  it('regenerate never replays tools', () => {
    const regen = regenerateAssistantPolicy();
    expect(regen.allowed).toBe(true);
    expect(regen.replayTools).toBe(false);
    expect(REGENERATE_POLICY.replayTools).toBe(false);
  });

  it('truncateForAssistantRegenerate keeps preceding user only', () => {
    const messages = [
      msg({ id: 'u1', role: 'user', content: 'ask' }),
      msg({ id: 'a1', role: 'assistant', content: 'bad answer' }),
      msg({ id: 'u2', role: 'user', content: 'follow' }),
      msg({ id: 'a2', role: 'assistant', content: 'later' }),
    ];
    const r = truncateForAssistantRegenerate(messages, 'a1');
    expect(r.ok).toBe(true);
    expect(r.userMessageId).toBe('u1');
    expect(r.userContent).toBe('ask');
    expect(r.truncatedCount).toBe(3);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]?.id).toBe('u1');
  });
});

describe('SSE race guard', () => {
  it('blocks writes after conversation switch', () => {
    expect(
      isStaleStreamWrite({
        expectedConversationId: 'conv_a',
        activeConversationId: 'conv_b',
        expectedGeneration: 1,
        currentGeneration: 1,
      }),
    ).toBe(true);
  });

  it('blocks writes after turn edit (turn id mismatch)', () => {
    expect(
      isStaleStreamWrite({
        expectedConversationId: 'conv_a',
        activeConversationId: 'conv_a',
        expectedTurnId: 'turn_1',
        currentTurnId: 'turn_2',
        expectedGeneration: 2,
        currentGeneration: 2,
      }),
    ).toBe(true);
  });

  it('blocks writes after generation bump (abort)', () => {
    expect(
      isStaleStreamWrite({
        expectedConversationId: 'conv_a',
        activeConversationId: 'conv_a',
        expectedTurnId: 'turn_1',
        currentTurnId: 'turn_1',
        expectedGeneration: 3,
        currentGeneration: 4,
      }),
    ).toBe(true);
  });

  it('blocks writes when assistant message was truncated away', () => {
    expect(
      isStaleStreamWrite({
        expectedConversationId: 'conv_a',
        activeConversationId: 'conv_a',
        expectedGeneration: 1,
        currentGeneration: 1,
        assistantMessageId: 'a_gone',
        messages: [msg({ id: 'u1', role: 'user', content: 'only user left' })],
      }),
    ).toBe(true);
  });

  it('allows matching conversation + turn + generation + existing assistant', () => {
    expect(
      isStaleStreamWrite({
        expectedConversationId: 'conv_a',
        activeConversationId: 'conv_a',
        expectedTurnId: 'turn_1',
        currentTurnId: 'turn_1',
        expectedGeneration: 5,
        currentGeneration: 5,
        assistantMessageId: 'a1',
        messages: [
          msg({ id: 'u1', role: 'user', content: 'q' }),
          msg({ id: 'a1', role: 'assistant', content: '', turnId: 'turn_1' }),
        ],
      }),
    ).toBe(false);
  });
});

describe('HITL invalidate', () => {
  it('builds cancel body only when token present', () => {
    expect(hitlInvalidateRequest(null).shouldCancel).toBe(false);
    expect(hitlInvalidateRequest('').shouldCancel).toBe(false);
    const req = hitlInvalidateRequest('tok_abc');
    expect(req.shouldCancel).toBe(true);
    expect(req.body).toEqual({ action: 'cancel', resumeToken: 'tok_abc' });
  });

  it('marks cancelled tokens as unusable', () => {
    const set = new Set<string>(['tok_old']);
    expect(isHitlTokenInvalidated('tok_old', set)).toBe(true);
    expect(isHitlTokenInvalidated('tok_new', set)).toBe(false);
    expect(isHitlTokenInvalidated(null, set)).toBe(true);
  });
});

describe('chat-store editUserMessage integration', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
      error: null,
      rehydrateError: null,
    });
    useLearnFlowStore.getState().bindConversation(null, { resetDraft: true });
  });

  it('truncates messages, resets uncommitted preview, keeps committed notice ids', () => {
    const store = useChatStore.getState();
    const conv = store.createConversation('test');
    useChatStore.setState({
      conversations: [
        {
          ...conv,
          experience: {
            stage: 'outline',
            courseId: 'course_committed',
            sessionId: 'sess_committed',
            artifacts: [{ id: 'live', kind: 'outline_card' }],
          },
          messages: [
            msg({ id: 'u1', role: 'user', content: '学 React' }),
            msg({
              id: 'a1',
              role: 'assistant',
              content: '大纲…',
              artifacts: [{ id: 'o1', kind: 'outline_card', content: 'units' }],
            }),
            msg({ id: 'u2', role: 'user', content: '改成 Vue' }),
            msg({ id: 'a2', role: 'assistant', content: '好' }),
          ],
        },
      ],
      activeConversationId: conv.id,
    });
    useLearnFlowStore.getState().bindConversation(conv.id, {
      snapshot: {
        stage: 'outline',
        courseId: 'course_committed',
        sessionId: 'sess_committed',
        artifacts: [{ id: 'live', kind: 'outline_card' }],
      },
      forceSnapshot: true,
    });

    const result = useChatStore.getState().editUserMessage('u1', '学 TypeScript');
    expect(result.ok).toBe(true);
    expect(result.truncatedCount).toBe(3);
    expect(result.sideEffectNotice).toBe(COMMITTED_SIDE_EFFECT_NOTICE);

    const after = useChatStore.getState().getActiveConversation();
    expect(after?.messages).toHaveLength(1);
    expect(after?.messages[0]?.content).toBe('学 TypeScript');
    // Committed ids retained for notice/navigation — not auto-deleted courses.
    expect(after?.experience?.courseId).toBe('course_committed');
    expect(after?.experience?.sessionId).toBe('sess_committed');
    // Uncommitted live outline cleared from learn-flow active slice.
    expect(useLearnFlowStore.getState().artifacts).toEqual([]);
  });

  it('prepareAssistantRegenerate truncates from assistant and returns user text', () => {
    const store = useChatStore.getState();
    const conv = store.createConversation('regen');
    useChatStore.setState({
      conversations: [
        {
          ...conv,
          messages: [
            msg({ id: 'u1', role: 'user', content: '解释闭包' }),
            msg({ id: 'a1', role: 'assistant', content: '半成品' }),
          ],
        },
      ],
      activeConversationId: conv.id,
    });

    const prepared = useChatStore.getState().prepareAssistantRegenerate('a1');
    expect(prepared.ok).toBe(true);
    expect(prepared.userContent).toBe('解释闭包');
    expect(prepared.truncatedCount).toBe(1);
    expect(useChatStore.getState().getActiveConversation()?.messages).toHaveLength(
      1,
    );
  });
});

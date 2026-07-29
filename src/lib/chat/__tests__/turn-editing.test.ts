import { describe, expect, it } from 'vitest';
import {
  hitlInvalidateRequest,
  isHitlTokenInvalidated,
  isStaleStreamWrite,
  truncateForAssistantRegenerate,
  truncateMessagesAfterUserEdit,
} from '../turn-editing';

const messages = [
  { id: 'u1', role: 'user' as const, content: '旧问题', timestamp: new Date() },
  { id: 'a1', role: 'assistant' as const, content: '旧回答', timestamp: new Date() },
  { id: 'u2', role: 'user' as const, content: '后续问题', timestamp: new Date() },
];

describe('turn editing safety', () => {
  it('edits a user turn and truncates later messages', () => {
    const result = truncateMessagesAfterUserEdit(messages, 'u1', '新问题');
    expect(result.ok).toBe(true);
    expect(result.messages.map((message) => message.id)).toEqual(['u1']);
    expect(result.messages[0]?.content).toBe('新问题');
    expect(result.truncatedCount).toBe(2);
  });

  it('regenerates from the preceding user without replaying tools', () => {
    const result = truncateForAssistantRegenerate(messages, 'a1');
    expect(result.ok).toBe(true);
    expect(result.userMessageId).toBe('u1');
    expect(result.messages.map((message) => message.id)).toEqual(['u1']);
  });

  it('invalidates HITL tokens and rejects stale stream writes', () => {
    expect(hitlInvalidateRequest('token').body).toEqual({
      action: 'cancel',
      resumeToken: 'token',
    });
    expect(isHitlTokenInvalidated('token', new Set(['token']))).toBe(true);
    expect(
      isStaleStreamWrite({
        expectedConversationId: 'a',
        activeConversationId: 'b',
        assistantMessageId: 'a1',
        messages,
      }),
    ).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyFirstUserMessagePersist,
  applyOpenHomeDrafts,
  conversationHasContent,
  filterRecentConversations,
  persistableChatSlice,
  resolveActiveConversationId,
  stripEmptyConversations,
} from '../draft-conversation';

type C = {
  id: string;
  title: string;
  messages: Array<{ id: string; role: string; content: string }>;
  updatedAt: Date;
};

function conv(
  id: string,
  messages: C['messages'],
  updatedAt = new Date(0),
): C {
  return { id, title: id, messages, updatedAt };
}

describe('draft-conversation (UX01)', () => {
  it('conversationHasContent is false for empty / missing', () => {
    expect(conversationHasContent(null)).toBe(false);
    expect(conversationHasContent(conv('a', []))).toBe(false);
    expect(conversationHasContent(conv('b', [{ id: '1', role: 'user', content: 'hi' }]))).toBe(
      true,
    );
  });

  it('repeated home draft opens do not create conversations', () => {
    const initial = {
      conversations: [] as C[],
      activeConversationId: null as string | null,
    };
    const after = applyOpenHomeDrafts(initial, 5);
    expect(after.conversations).toHaveLength(0);
    expect(after.activeConversationId).toBeNull();
    expect(filterRecentConversations(after.conversations)).toHaveLength(0);
  });

  it('first send persists exactly one conversation', () => {
    const state = { conversations: [] as C[], activeConversationId: null as string | null };
    let seq = 0;
    const result = applyFirstUserMessagePersist(
      state,
      () => {
        seq += 1;
        return conv(`conv_${seq}`, [], new Date());
      },
      { id: 'm1', role: 'user', content: '什么是闭包' },
    );
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0].messages).toHaveLength(1);
    expect(result.activeConversationId).toBe(result.created.id);
    expect(filterRecentConversations(result.conversations)).toHaveLength(1);
  });

  it('second send on same active id does not spawn another conversation', () => {
    const first = applyFirstUserMessagePersist(
      { conversations: [], activeConversationId: null },
      () => conv('conv_1', [], new Date()),
      { id: 'm1', role: 'user', content: 'hi' },
    );
    const second = applyFirstUserMessagePersist(
      {
        conversations: first.conversations,
        activeConversationId: first.activeConversationId,
      },
      () => conv('conv_SHOULD_NOT', [], new Date()),
      { id: 'm2', role: 'user', content: 'again' },
    );
    expect(second.conversations).toHaveLength(1);
    expect(second.conversations[0].messages).toHaveLength(2);
    expect(second.activeConversationId).toBe('conv_1');
  });

  it('recent filtering excludes empty conversations', () => {
    const list = [
      conv('empty', [], new Date(3000)),
      conv(
        'full',
        [{ id: '1', role: 'user', content: 'x' }],
        new Date(1000),
      ),
      conv(
        'newer',
        [{ id: '2', role: 'assistant', content: 'y' }],
        new Date(2000),
      ),
    ];
    const recent = filterRecentConversations(list, 8);
    expect(recent.map((c) => c.id)).toEqual(['newer', 'full']);
    expect(recent.every((c) => c.messages.length > 0)).toBe(true);
  });

  it('persistableChatSlice drops empties and invalid active id', () => {
    const slice = persistableChatSlice({
      conversations: [
        conv('empty', []),
        conv('ok', [{ id: '1', role: 'user', content: 'a' }]),
      ],
      activeConversationId: 'empty',
    });
    expect(slice.conversations.map((c) => c.id)).toEqual(['ok']);
    expect(slice.activeConversationId).toBeNull();
  });

  it('resolveActiveConversationId keeps contentful ids only', () => {
    const list = [conv('ok', [{ id: '1', role: 'user', content: 'a' }])];
    expect(resolveActiveConversationId(list, 'ok')).toBe('ok');
    expect(resolveActiveConversationId(list, 'missing')).toBeNull();
    expect(resolveActiveConversationId([conv('e', [])], 'e')).toBeNull();
  });

  it('stripEmptyConversations is idempotent for contentful-only lists', () => {
    const list = [conv('a', [{ id: '1', role: 'user', content: 'z' }])];
    expect(stripEmptyConversations(list)).toEqual(list);
    expect(stripEmptyConversations([...list, conv('b', [])])).toEqual(list);
  });
});

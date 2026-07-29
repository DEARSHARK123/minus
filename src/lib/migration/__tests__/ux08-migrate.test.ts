import { describe, expect, it } from 'vitest';
import {
  assertNoContentLoss,
  migrateActiveAppView,
  migrateChatPersistedState,
  migrateClientBootstrap,
  migrateHitlAuditRecords,
  migrateLearnFlowStage,
  migrateLearningPayloadCompat,
  migrateMemoryPayloadCompat,
  migrateSafetyFieldsCompat,
  rehydrateChatPersistSlice,
} from '../ux08-client-migrate';
import { rehydrateChatPersistV2 } from '../conversation-aggregate-migrate';

describe('UX08 client migration', () => {
  it('migrates legacy learn-flow stages without wiping', () => {
    expect(migrateLearnFlowStage('memory')).toBe('goal_clarification');
    expect(migrateLearnFlowStage('calibrating')).toBe('calibration');
    expect(migrateLearnFlowStage('resources')).toBe('outline');
    expect(migrateLearnFlowStage('teaching')).toBe('teaching');
    expect(migrateLearnFlowStage('bogus')).toBe('idle');
  });

  it('maps legacy activeAppView / learning views to URL paths', () => {
    expect(migrateActiveAppView('feed').view).toBe('home');
    expect(migrateActiveAppView('feed').path).toBe('/chat');
    expect(migrateActiveAppView('knowledge').view).toBe('library');
    expect(migrateActiveAppView('knowledge').path).toBe('/library');
    expect(migrateActiveAppView('session', { courseId: 'c1' }).path).toBe(
      '/course/c1',
    );
    expect(migrateActiveAppView('home').legacy).toBe(false);
  });

  it('strips empty conversations but preserves contentful ones', () => {
    const before = [
      { id: 'e1', messages: [], title: 'empty' },
      { id: 'c1', messages: [{ role: 'user', content: '你好' }], title: '问候' },
      { id: 'e2', messages: [], title: 'draft' },
    ];
    const next = migrateChatPersistedState({
      conversations: before,
      activeConversationId: 'e1',
    });
    expect(next.conversations.map((c) => c.id)).toEqual(['c1']);
    expect(next.activeConversationId).toBe(null);
    expect(next.strippedEmpty).toBe(2);
    expect(assertNoContentLoss(before, next.conversations)).toEqual({ ok: true });
  });

  it('rehydrate never drops contentful chats', () => {
    const next = rehydrateChatPersistSlice({
      conversations: [
        {
          id: 'keep',
          messages: [{ role: 'user', content: '闭包是什么' }],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'drop',
          messages: [],
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      activeConversationId: 'keep',
    });
    expect(next.conversations).toHaveLength(1);
    expect(next.conversations[0].id).toBe('keep');
    expect(next.activeConversationId).toBe('keep');
  });

  it('rehydrate turns an interrupted assistant stream into a retryable error', () => {
    const result = rehydrateChatPersistV2({
      version: 2,
      conversations: [
        {
          id: 'interrupted',
          title: '闭包',
          createdAt: '2026-07-14T00:00:00.000Z',
          updatedAt: '2026-07-14T00:00:00.000Z',
          messages: [
            { role: 'user', content: '什么是闭包？' },
            {
              id: 'assistant-pending',
              role: 'assistant',
              content: '',
              thinking: true,
              status: 'pending',
            },
          ],
        },
      ],
      activeConversationId: 'interrupted',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const assistant = result.state.conversations[0]?.messages[1];
    expect(assistant?.thinking).toBe(false);
    expect(assistant?.status).toBe('error');
    expect(assistant?.content).toContain('重新生成');
  });

  it('learning v2 passthrough preserves courses', () => {
    const raw = {
      version: 2,
      courses: [{ id: 'course_1', title: 'JS' }],
      documents: [],
    };
    const r = migrateLearningPayloadCompat(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.migratedFromV1).toBe(false);
      expect((r.data as { courses: unknown[] }).courses).toHaveLength(1);
    }
  });

  it('invalid learning payload does not invent empty store', () => {
    const r = migrateLearningPayloadCompat(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.preservedRaw).toBe(true);
  });

  it('memory migration keeps confirmed items', () => {
    const r = migrateMemoryPayloadCompat({
      version: 1,
      memories: [
        {
          id: 'm1',
          text: '熟悉 Python',
          status: 'confirmed',
          source: 'manual',
          kind: 'fact',
          confidence: 1,
          evidence: [],
          firstObservedAt: '',
          lastObservedAt: '',
          sensitive: false,
          createdAt: '',
          updatedAt: '',
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.data.memories as unknown[]).length).toBe(1);
      expect(r.data.version).toBe(2);
    }
  });

  it('safety: legacy executionMode trust → supervised local; expired auto grant downgrades', () => {
    const trust = migrateSafetyFieldsCompat({ executionMode: 'trust' });
    expect(trust.executionEnvironment).toBe('local');
    expect(trust.approvalPolicy).toBe('supervised');
    expect(trust.executionMode).toBe('trust');

    const expired = migrateSafetyFieldsCompat({
      executionMode: 'sandbox',
      approvalPolicy: 'full_auto',
      executionEnvironment: 'local',
      autonomyGrant: { expiresAt: '2000-01-01T00:00:00.000Z' },
    });
    expect(expired.grantExpired).toBe(true);
    expect(expired.approvalPolicy).toBe('supervised');
    expect(expired.executionEnvironment).toBe('sandbox');
  });

  it('HITL audit keeps rows; drops only non-objects', () => {
    const { records, dropped } = migrateHitlAuditRecords([
      { id: 'a1', kind: 'confirm' },
      null,
      'bad',
      { id: 'a2', kind: 'deny' },
    ]);
    expect(records.map((r) => r.id)).toEqual(['a1', 'a2']);
    expect(dropped).toBe(2);
  });

  it('bootstrap migrates domains independently', () => {
    const boot = migrateClientBootstrap({
      chat: {
        conversations: [
          { id: 'ok', messages: [{ role: 'user', content: 'hi' }] },
          { id: 'empty', messages: [] },
        ],
        activeConversationId: 'ok',
      },
      learnFlowStage: 'calibrating',
      activeAppView: 'knowledge',
      safety: { executionMode: 'sandbox' },
      hitlAudit: [{ id: 'h1', kind: 'pause' }],
      memory: { version: 2, memories: [] },
    });
    expect(boot.learnFlowStage).toBe('calibration');
    expect(boot.appView.path).toBe('/library');
    expect(boot.chat.conversations).toHaveLength(1);
    expect(boot.safety?.approvalPolicy).toBe('supervised');
    expect(boot.hitlAudit.records).toHaveLength(1);
  });
});

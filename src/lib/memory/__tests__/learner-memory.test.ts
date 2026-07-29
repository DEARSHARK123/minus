import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  isMemoryStoreEmpty,
  migrateMemoryItem,
  migrateLearnerMemoryData,
  readLearnerMemory,
  upsertMemoryItem,
  confirmMemoryItem,
  rejectMemoryItem,
  deleteMemoryItem,
  listVisibleMemories,
  type LearnerMemoryData,
} from '../learner-memory';
import {
  isGreetingOnlyTranscript,
  isGreetingOrTriviaText,
  postFilterExtractedTexts,
  textsAreDuplicate,
  textsConflict,
  classifyMemoryKind,
  dedupeCandidates,
  mergeCandidatesIntoStore,
  appendAiMemories,
} from '../pipeline';
import {
  buildLearnerContextPack,
  injectContextPack,
} from '../context-pack';

const tmpRoot = path.join(os.tmpdir(), `minus-memory-test-${process.pid}`);

beforeEach(async () => {
  process.env.MINUS_DATA_DIR = tmpRoot;
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  delete process.env.MINUS_DATA_DIR;
});

function emptyStore(): LearnerMemoryData {
  return {
    version: 2,
    persona: '',
    strengths: [],
    stylePrefs: [],
    memories: [],
    externalDoc: '',
    updatedAt: new Date(0).toISOString(),
  };
}

describe('empty store / vacuum helpers', () => {
  it('readLearnerMemory returns empty on missing file', async () => {
    const data = await readLearnerMemory();
    expect(data.memories).toEqual([]);
    expect(data.persona).toBe('');
    expect(isMemoryStoreEmpty(data)).toBe(true);
  });

  it('isMemoryStoreEmpty false when proposed memory exists', () => {
    const store = emptyStore();
    store.memories = [
      migrateMemoryItem({
        text: '喜欢用例子学数学',
        source: 'ai',
        status: 'proposed',
        confidence: 0.8,
      }),
    ];
    expect(isMemoryStoreEmpty(store)).toBe(false);
  });

  it('isMemoryStoreEmpty true when only rejected', () => {
    const store = emptyStore();
    store.memories = [
      migrateMemoryItem({
        text: '已拒绝项',
        source: 'ai',
        status: 'rejected',
      }),
    ];
    expect(isMemoryStoreEmpty(store)).toBe(true);
    expect(listVisibleMemories(store)).toHaveLength(0);
  });
});

describe('migration', () => {
  it('manual v1 item → confirmed confidence 1 empty evidence', () => {
    const m = migrateMemoryItem({
      id: 'a',
      text: '手动偏好',
      source: 'manual',
      kind: 'preference',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    } as never);
    expect(m.status).toBe('confirmed');
    expect(m.confidence).toBe(1);
    expect(m.evidence).toEqual([]);
    expect(m.firstObservedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('ai v1 item → proposed confidence 0.7', () => {
    const m = migrateMemoryItem({
      text: 'AI 推断',
      source: 'ai',
      kind: 'goal',
      createdAt: '2020-01-02T00:00:00.000Z',
      updatedAt: '2020-01-02T00:00:00.000Z',
    } as never);
    expect(m.status).toBe('proposed');
    expect(m.confidence).toBe(0.7);
  });

  it('migrateLearnerMemoryData upgrades version to 2', () => {
    const data = migrateLearnerMemoryData({
      version: 1,
      persona: '',
      strengths: [],
      stylePrefs: [],
      memories: [{ text: 'x', source: 'manual', kind: 'fact', createdAt: 't', updatedAt: 't' }],
      externalDoc: '',
      updatedAt: 't',
    });
    expect(data.version).toBe(2);
    expect(data.memories[0]!.status).toBe('confirmed');
  });
});

describe('greeting / trivia filter', () => {
  it('你好 is greeting', () => {
    expect(isGreetingOrTriviaText('你好')).toBe(true);
    expect(isGreetingOrTriviaText('hello')).toBe(true);
  });

  it('stable preference is not greeting', () => {
    expect(isGreetingOrTriviaText('我更喜欢用例子学习线性代数')).toBe(false);
  });

  it('greeting-only transcript → zero extract candidates', () => {
    expect(
      isGreetingOnlyTranscript([
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！有什么可以帮你？' },
        { role: 'user', content: 'hi' },
      ]),
    ).toBe(true);
  });

  it('postFilterExtractedTexts drops greetings', () => {
    expect(postFilterExtractedTexts(['你好', '喜欢分步讲解', '谢谢'])).toEqual([
      '喜欢分步讲解',
    ]);
  });
});

describe('dedupe / conflict / merge', () => {
  it('textsAreDuplicate for exact and contained prefs', () => {
    expect(textsAreDuplicate('喜欢用例子学数学', '喜欢用例子学数学')).toBe(true);
    // containment after normalize (shorter is substring of longer)
    expect(textsAreDuplicate('喜欢用例子学数学', '非常喜欢用例子学数学')).toBe(true);
  });

  it('textsConflict for like vs dislike same topic', () => {
    expect(textsConflict('喜欢刷题', '不喜欢刷题')).toBe(true);
  });

  it('dedupeCandidates keeps higher confidence', () => {
    const out = dedupeCandidates([
      {
        text: '喜欢类比',
        kind: 'preference',
        confidence: 0.5,
        evidence: [],
        sensitive: false,
      },
      {
        text: '喜欢类比',
        kind: 'preference',
        confidence: 0.9,
        evidence: [{ quote: '我喜欢类比' }],
        sensitive: false,
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.confidence).toBe(0.9);
    expect(out[0]!.evidence.length).toBeGreaterThan(0);
  });

  it('merge creates proposed with evidence', () => {
    const next = mergeCandidatesIntoStore(emptyStore(), [
      {
        text: '偏好循序渐进',
        kind: 'preference',
        confidence: 0.85,
        evidence: [{ quote: '请一步步讲' }],
        sensitive: false,
      },
    ]);
    expect(next.memories).toHaveLength(1);
    expect(next.memories[0]!.status).toBe('proposed');
    expect(next.memories[0]!.evidence[0]!.quote).toBe('请一步步讲');
  });

  it('merge marks conflict when opposing confirmed', () => {
    let store = emptyStore();
    store = mergeCandidatesIntoStore(store, [
      {
        text: '喜欢刷题',
        kind: 'preference',
        confidence: 0.9,
        evidence: [],
        sensitive: false,
      },
    ]);
    // Confirm first
    store.memories[0] = { ...store.memories[0]!, status: 'confirmed' };
    store = mergeCandidatesIntoStore(store, [
      {
        text: '不喜欢刷题',
        kind: 'preference',
        confidence: 0.8,
        evidence: [],
        sensitive: false,
      },
    ]);
    const statuses = store.memories.map((m) => m.status);
    expect(statuses).toContain('conflicted');
  });

  it('appendAiMemories persists proposed', async () => {
    const data = await appendAiMemories([
      { text: '目标是掌握概率论', kind: 'goal', confidence: 0.8, evidence: [{ quote: '想学概率' }] },
    ]);
    expect(data.memories[0]!.status).toBe('proposed');
    expect(data.memories[0]!.kind).toBe('goal');
    const again = await readLearnerMemory();
    expect(again.memories).toHaveLength(1);
  });
});

describe('confirm / reject / delete', () => {
  it('confirm promotes proposed → confirmed', async () => {
    let data = await appendAiMemories(['喜欢可视化解释']);
    const id = data.memories[0]!.id;
    data = await confirmMemoryItem(id);
    expect(data.memories.find((m) => m.id === id)!.status).toBe('confirmed');
  });

  it('reject sets rejected and hides from visible', async () => {
    let data = await appendAiMemories(['临时偏好']);
    const id = data.memories[0]!.id;
    data = await rejectMemoryItem(id);
    expect(data.memories.find((m) => m.id === id)!.status).toBe('rejected');
    expect(listVisibleMemories(data)).toHaveLength(0);
  });

  it('delete removes item', async () => {
    let data = await upsertMemoryItem({ text: '手动条目', source: 'manual' });
    const id = data.memories[0]!.id;
    data = await deleteMemoryItem(id);
    expect(data.memories).toHaveLength(0);
  });
});

describe('LearnerContextPack', () => {
  it('empty store → empty pack', () => {
    const pack = buildLearnerContextPack(emptyStore(), 'chat');
    expect(pack.empty).toBe(true);
    expect(pack.labeledBlock).toBe('');
  });

  it('confirmed memories appear; sensitive excluded on desktop', () => {
    const store = emptyStore();
    store.memories = [
      migrateMemoryItem({
        text: '公开偏好：喜欢例子',
        source: 'manual',
        status: 'confirmed',
        confidence: 1,
        sensitive: false,
      }),
      migrateMemoryItem({
        text: '真实姓名张三住址某某路',
        source: 'ai',
        status: 'confirmed',
        confidence: 1,
        sensitive: true,
      }),
    ];
    const chat = buildLearnerContextPack(store, 'chat');
    expect(chat.empty).toBe(false);
    expect(chat.labeledBlock).toContain('喜欢例子');
    expect(chat.labeledBlock).toContain('张三');

    const desktop = buildLearnerContextPack(store, 'desktop');
    expect(desktop.labeledBlock).toContain('喜欢例子');
    expect(desktop.labeledBlock).not.toContain('张三');
  });

  it('low-confidence proposed excluded; high included for chat', () => {
    const store = emptyStore();
    store.memories = [
      migrateMemoryItem({
        text: '低置信提议',
        source: 'ai',
        status: 'proposed',
        confidence: 0.4,
      }),
      migrateMemoryItem({
        text: '高置信提议',
        source: 'ai',
        status: 'proposed',
        confidence: 0.9,
      }),
    ];
    const pack = buildLearnerContextPack(store, 'chat');
    expect(pack.labeledBlock).toContain('高置信提议');
    expect(pack.labeledBlock).not.toContain('低置信提议');
  });

  it('injectContextPack no-ops when empty', () => {
    const base = 'system prompt';
    expect(injectContextPack(base, { empty: true, labeledBlock: '', summaryLine: '', entries: [] })).toBe(
      base,
    );
  });
});

describe('classify', () => {
  it('classifies goal vs preference', () => {
    expect(classifyMemoryKind('目标是学会微积分')).toBe('goal');
    expect(classifyMemoryKind('喜欢先看例子')).toBe('preference');
  });
});

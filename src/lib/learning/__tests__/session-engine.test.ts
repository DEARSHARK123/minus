import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionEngine, SessionEngineError } from '../session-engine';
import { callLLM } from '@/lib/llm/client';
import { searchWeb } from '@/lib/tools/web-search';
import {
  emptyLearningData,
  nowIso,
  type LearningData,
  type LearningSession,
  type LearningUnit,
  type SearchHit,
} from '@/types/learning';

vi.mock('@/lib/llm/client', () => ({
  callLLM: vi.fn(),
}));

vi.mock('@/lib/tools/web-search', () => ({
  searchWeb: vi.fn(),
}));

const mockedCallLLM = vi.mocked(callLLM);
const mockedSearchWeb = vi.mocked(searchWeb);

function makeData(): LearningData {
  return {
    ...emptyLearningData(),
    courses: [
      {
        id: 'course-a',
        title: 'Course A',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    documents: [
      {
        id: 'doc-a1',
        courseId: 'course-a',
        title: 'Doc A1',
        format: 'markdown',
        content: 'Chunk zero. Chunk one.',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        chunks: [
          { index: 0, text: 'Chunk zero.' },
          { index: 1, text: 'Chunk one.' },
        ],
      },
    ],
  };
}

function makeUnits(): LearningUnit[] {
  return [
    {
      id: 'unit-1',
      courseId: 'course-a',
      title: 'Unit 1',
      order: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 'unit-2',
      courseId: 'course-a',
      title: 'Unit 2',
      order: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];
}

function makeSession(sections = makeUnits()): LearningSession {
  const engine = new SessionEngine();
  return {
    id: 'session-1',
    courseId: 'course-a',
    startedAt: nowIso(),
    sections: engine.buildSections(sections),
    currentSectionId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

const hits: SearchHit[] = [
  {
    documentId: 'doc-a1',
    title: 'Doc A1',
    chunkIndex: 0,
    snippet: 'Chunk zero.',
    score: 1.0,
  },
];

describe('SessionEngine', () => {
  beforeEach(() => {
    mockedCallLLM.mockReset();
    mockedSearchWeb.mockReset();
    mockedSearchWeb.mockResolvedValue({ results: [] });
  });

  describe('buildSections', () => {
    it('opens the first section and locks the rest', () => {
      const engine = new SessionEngine();
      const sections = engine.buildSections(makeUnits());
      expect(sections).toHaveLength(2);
      expect(sections[0]!.status).toBe('open');
      expect(sections[1]!.status).toBe('locked');
      expect(sections[0]!.phase).toBe('teach');
      expect(sections[1]!.phase).toBe('teach');
    });

    it('orders sections by unit order', () => {
      const engine = new SessionEngine();
      const units = [
        { ...makeUnits()[1]!, order: 0 },
        { ...makeUnits()[0]!, order: 1 },
      ];
      const sections = engine.buildSections(units);
      expect(sections[0]!.title).toBe('Unit 2');
      expect(sections[1]!.title).toBe('Unit 1');
    });
  });

  describe('openSection', () => {
    it('opens a locked section when prior sections are done', () => {
      const engine = new SessionEngine();
      let session = makeSession();
      const first = session.sections[0]!;
      // First section is already open by buildSections.
      expect(first.status).toBe('open');

      const doneFirst = { ...first, status: 'done' as const, phase: 'done' as const };
      session = { ...session, sections: [doneFirst, session.sections[1]!] };

      const second = session.sections[1]!;
      const next = engine.openSection(session, second.id);
      expect(next.sections[1]!.status).toBe('open');
      expect(next.currentSectionId).toBe(second.id);
    });

    it('refuses to open a section when prior sections are not done', () => {
      const engine = new SessionEngine();
      const session = makeSession();
      const second = session.sections[1]!;
      expect(() => engine.openSection(session, second.id)).toThrow(SessionEngineError);
    });

    it('refuses to open a non-locked section', () => {
      const engine = new SessionEngine();
      const session = makeSession();
      const first = session.sections[0]!;
      expect(() => engine.openSection(session, first.id)).toThrow(SessionEngineError);
    });

    it('opens a later section explicitly without completing prerequisites', () => {
      const engine = new SessionEngine();
      const session = makeSession();
      const first = session.sections[0]!;
      const second = session.sections[1]!;

      const next = engine.openSectionFlexible(session, second.id);

      expect(next.sections[0]!.status).toBe(first.status);
      expect(next.sections[1]!.status).toBe('open');
      expect(next.currentSectionId).toBe(second.id);
    });
  });

  describe('generateTeach', () => {
    it('rejects teaching when no provider is configured without mutating the section', async () => {
      const engine = new SessionEngine();
      const session = makeSession();
      const section = session.sections[0]!;
      await expect(engine.generateTeach(makeData(), 'course-a', section, hits)).rejects.toMatchObject({
        code: 'MODEL_UNAVAILABLE',
      });
      expect(section.turns).toHaveLength(0);
    });

    it('rejects invalid citations instead of persisting retrieval-shaped fallback content', async () => {
      const engine = new SessionEngine({ maxCitationRetries: 0 });
      mockedCallLLM.mockResolvedValue({
        content: 'Explanation with bad citation [cite:missing-doc:0].',
      });
      const session = makeSession();
      const section = session.sections[0]!;
      await expect(engine.generateTeach(makeData(), 'course-a', section, hits, {
        apiKey: 'key', baseUrl: 'http://localhost', model: 'gpt-4o-mini', providerId: 'openai',
      })).rejects.toMatchObject({ code: 'LOW_QUALITY_GENERATION' });
      expect(section.turns).toHaveLength(0);
    });

    it('uses LLM output when citations are valid', async () => {
      const engine = new SessionEngine();
      mockedCallLLM.mockResolvedValue({
        content: '梯度下降会沿损失函数梯度的反方向逐步更新参数，因为该方向在局部带来最快下降。学习率控制每一步幅度：过大会震荡，过小会收敛缓慢。可以把它想成在有雾的山坡上根据脚下坡度下山。[cite:doc-a1:0]',
      });
      const session = makeSession();
      const section = session.sections[0]!;
      const result = await engine.generateTeach(makeData(), 'course-a', section, hits, {
        apiKey: 'key',
        baseUrl: 'http://localhost',
        model: 'gpt-4o-mini',
        providerId: 'openai',
      });
      expect(result.fallback).toBe(false);
      expect(result.turn.content).toContain('梯度下降');
      expect(result.turn.citations).toHaveLength(1);
    });

    it('uses model knowledge when the course has no local documents', async () => {
      const engine = new SessionEngine();
      mockedCallLLM.mockResolvedValue({
        content: '数据库模型用于描述数据的结构、关系与约束。关系模型把数据组织为表，主键唯一标识记录，外键表达表之间的引用关系。设计时还要用约束保护一致性，并通过规范化减少重复与更新异常。',
      });
      const data = { ...makeData(), documents: [] };
      const section = makeSession().sections[0]!;

      const result = await engine.generateTeach(
        data,
        'course-a',
        section,
        [],
        {
          apiKey: 'key',
          baseUrl: 'http://localhost',
          model: 'gpt-4o-mini',
          providerId: 'openai',
        },
      );

      expect(result.fallback).toBe(false);
      expect(result.turn.content).toContain('数据库模型');
      expect(result.turn.citations).toEqual([]);
      const messages = mockedCallLLM.mock.calls[0]?.[0] ?? [];
      expect(messages[0]?.content).toContain('own trained knowledge');
      expect(messages[0]?.content).toContain('focused learning document');
      expect(messages[0]?.content).toContain('Do not greet the learner');
      expect(messages[0]?.content).not.toContain('Teach with definitions, intuition');
      expect(messages[1]?.content).toContain('No local course documents are required');
    });

    it('adds explicit web research as an optional source layer', async () => {
      const engine = new SessionEngine();
      mockedSearchWeb.mockResolvedValue({
        results: [
          {
            title: 'PostgreSQL Documentation',
            url: 'https://www.postgresql.org/docs/current/tutorial-concepts.html',
            content: 'Relational database concepts and terminology.',
            score: 0.95,
          },
        ],
      });
      mockedCallLLM.mockResolvedValue({ content: '关系数据库用表来表达实体与关系，主键保证记录可识别，外键维护跨表引用。公开资料可用于核验术语与当前版本细节，但概念解释仍应说明约束为何能保护数据一致性，并用订单与用户表给出具体例子。' });
      const section = makeSession().sections[0]!;

      const result = await engine.generateTeach(
        makeData(),
        'course-a',
        section,
        hits,
        {
          apiKey: 'key',
          baseUrl: 'http://localhost',
          model: 'gpt-4o-mini',
          providerId: 'openai',
        },
        { webSearchMode: 'always' },
      );

      expect(mockedSearchWeb).toHaveBeenCalledTimes(1);
      expect(result.turn.webSources).toEqual([
        expect.objectContaining({
          title: 'PostgreSQL Documentation',
          url: 'https://www.postgresql.org/docs/current/tutorial-concepts.html',
        }),
      ]);
      expect(mockedCallLLM.mock.calls[0]?.[0]?.[1]?.content).toContain(
        'Optional web research supplied by the user',
      );
    });

    it('auto-searches once per section and reuses sources when reteaching', async () => {
      const engine = new SessionEngine();
      mockedSearchWeb.mockResolvedValue({
        results: [{
          title: 'Database reference',
          url: 'https://example.com/database-reference',
          content: 'Primary keys identify rows and foreign keys connect related tables.',
          score: 0.9,
        }],
      });
      mockedCallLLM.mockResolvedValue({
        content: '关系模型使用表组织数据，主键负责唯一标识记录，外键负责表达跨表引用。约束可以阻止无效关联，规范化则减少重复数据和更新异常。以用户和订单为例，订单表中的用户编号应引用用户表的主键。',
      });
      const section = makeSession().sections[0]!;
      const provider = { apiKey: 'key', baseUrl: 'http://localhost', model: 'test' };

      const first = await engine.generateTeach(makeData(), 'course-a', section, hits, provider, {
        webSearchMode: 'auto',
      });
      const second = await engine.generateTeach(makeData(), 'course-a', first.section, hits, provider, {
        webSearchMode: 'auto',
        reteach: true,
      });

      expect(mockedSearchWeb).toHaveBeenCalledTimes(1);
      expect(first.turn.webSearchStatus).toBe('used');
      expect(second.turn.webSearchStatus).toBe('reused');
      expect(second.section.turns).toHaveLength(2);
    });

    it('rejects cross-course citations from LLM', async () => {
      const engine = new SessionEngine({ maxCitationRetries: 0 });
      mockedCallLLM.mockResolvedValue({
        content: 'Cross course [cite:doc-a1:0].',
      });
      const session = makeSession();
      const section = session.sections[0]!;
      await expect(engine.generateTeach(makeData(), 'course-b', section, hits, {
        apiKey: 'key',
        baseUrl: 'http://localhost',
        model: 'gpt-4o-mini',
        providerId: 'openai',
      })).rejects.toMatchObject({ code: 'LOW_QUALITY_GENERATION' });
    });

    it('does not persist invalid citations', async () => {
      const engine = new SessionEngine({ maxCitationRetries: 0 });
      mockedCallLLM.mockResolvedValue({
        content: 'Bad [cite:missing-doc:99].',
      });
      const session = makeSession();
      const section = session.sections[0]!;
      await expect(engine.generateTeach(makeData(), 'course-a', section, hits, {
        apiKey: 'key',
        baseUrl: 'http://localhost',
        model: 'gpt-4o-mini',
        providerId: 'openai',
      })).rejects.toMatchObject({ code: 'LOW_QUALITY_GENERATION' });
      expect(section.turns).toHaveLength(0);
    });
  });

  describe('recall flow', () => {
    it('transitions from teach to active_recall and records answer', () => {
      const engine = new SessionEngine();
      let section = engine.buildSections(makeUnits())[0]!;
      section = engine.startRecall(section);
      expect(section.phase).toBe('active_recall');
      expect(section.turns?.[0]?.content).toContain('用自己的话解释');
      section = engine.submitRecall(section, 'My answer');
      expect(section.phase).toBe('assess');
      expect(section.turns).toHaveLength(2);
    });

    it('refuses to submit recall outside active_recall phase', () => {
      const engine = new SessionEngine();
      const section = engine.buildSections(makeUnits())[0]!;
      expect(() => engine.submitRecall(section, 'answer')).toThrow(SessionEngineError);
    });
  });

  describe('course follow-up', () => {
    it('answers with the active provider instead of only acknowledging the question', async () => {
      const engine = new SessionEngine();
      mockedCallLLM.mockResolvedValue({
        content: 'let 允许重新赋值，const 不允许重新绑定；两者都具有块级作用域。',
      });
      const section = makeSession().sections[0]!;

      const result = await engine.generateFollowUp(
        section,
        'let 和 const 有什么区别？',
        {
          unitTitle: '变量声明',
          data: makeData(),
          courseId: 'course-a',
          provider: {
            apiKey: 'key',
            baseUrl: 'http://localhost',
            model: 'gpt-4o-mini',
            providerId: 'openai',
          },
          hits,
        },
      );

      expect(result.assistantTurn.content).toContain('块级作用域');
      expect(result.assistantTurn.content).not.toContain('我记下了你的问题');
      expect(result.section.turns).toHaveLength(2);
    });

    it('reuses section sources for ordinary questions and re-searches current-information questions', async () => {
      const engine = new SessionEngine();
      mockedSearchWeb.mockResolvedValue({
        results: [{ title: 'Current reference', url: 'https://example.com/current', content: 'Current details.', score: 1 }],
      });
      mockedCallLLM.mockResolvedValue({
        content: '普通追问可以沿用本节已经核验过的来源，因为概念本身没有发生变化。只有问题涉及版本、时间或要求核验出处时，才需要重新搜索以避免使用过期信息。',
      });
      const base = makeSession().sections[0]!;
      const section = {
        ...base,
        turns: [{
          id: 'prior-source',
          role: 'assistant' as const,
          content: '这是此前通过模型生成并经过质量检查的完整课程讲解，其中包含足够的概念说明、例子与常见误区，供后续追问复用。',
          webSources: [{ title: 'Existing reference', url: 'https://example.com/existing' }],
          webSearchStatus: 'used' as const,
          createdAt: nowIso(),
        }],
      };
      const provider = { apiKey: 'key', baseUrl: 'http://localhost', model: 'test' };

      const ordinary = await engine.generateFollowUp(section, '为什么这样设计？', {
        data: makeData(), courseId: 'course-a', provider, webSearchMode: 'auto',
      });
      expect(mockedSearchWeb).not.toHaveBeenCalled();
      expect(ordinary.assistantTurn.webSearchStatus).toBe('reused');

      await engine.generateFollowUp(ordinary.section, '请核验当前最新版本和来源链接', {
        data: makeData(), courseId: 'course-a', provider, webSearchMode: 'auto',
      });
      expect(mockedSearchWeb).toHaveBeenCalledTimes(1);
    });
  });

  describe('generateAssessment', () => {
    it('falls back to rule-based assessment without provider', async () => {
      const engine = new SessionEngine();
      let section = engine.buildSections(makeUnits())[0]!;
      section = engine.startRecall(section);
      section = engine.submitRecall(section, 'Chunk zero');
      const data = makeData();
      section.turns = [
        {
          id: 't1',
          role: 'assistant',
          content: 'Teach',
          citations: [{ documentId: 'doc-a1', chunkIndex: 0 }],
          createdAt: nowIso(),
        },
        ...section.turns!,
      ];
      const result = await engine.generateAssessment(data, 'course-a', section);
      expect(['pass', 'partial', 'fail']).toContain(result.assessment.result);
      expect(result.section.assessment).toBeUndefined();
    });

    it('uses LLM assessment when provider is configured', async () => {
      const engine = new SessionEngine();
      mockedCallLLM.mockResolvedValue({
        content: 'RESULT: pass\nNOTES: Good recall.',
      });
      let section = engine.buildSections(makeUnits())[0]!;
      section = engine.startRecall(section);
      section = engine.submitRecall(section, 'answer');
      const data = makeData();
      section.turns = [
        {
          id: 't1',
          role: 'assistant',
          content: 'Teach',
          citations: [{ documentId: 'doc-a1', chunkIndex: 0 }],
          createdAt: nowIso(),
        },
        ...section.turns!,
      ];
      const result = await engine.generateAssessment(data, 'course-a', section, {
        apiKey: 'key',
        baseUrl: 'http://localhost',
        model: 'gpt-4o-mini',
        providerId: 'openai',
      });
      expect(result.assessment.result).toBe('pass');
      expect(result.assessment.notes).toContain('Good recall');
    });
  });

  describe('applyAssessment', () => {
    it('marks section done and unlocks next section on pass', () => {
      const engine = new SessionEngine();
      const session = makeSession();
      const first = session.sections[0]!;
      let section = engine.startRecall(first);
      section = engine.submitRecall(section, 'answer');
      const next = engine.applyAssessment(session, section, { result: 'pass', notes: 'Great' });
      expect(next.sections[0]!.status).toBe('done');
      expect(next.sections[1]!.status).toBe('open');
      expect(next.currentSectionId).toBe(session.sections[1]!.id);
    });

    it('keeps section open and moves to remediate on fail', () => {
      const engine = new SessionEngine();
      const session = makeSession();
      const first = session.sections[0]!;
      let section = engine.startRecall(first);
      section = engine.submitRecall(section, 'answer');
      const next = engine.applyAssessment(session, section, { result: 'fail' });
      expect(next.sections[0]!.status).toBe('open');
      expect(next.sections[0]!.phase).toBe('remediate');
      expect(next.sections[1]!.status).toBe('locked');
    });

    it('model cannot unlock sections directly', () => {
      const engine = new SessionEngine();
      const session = makeSession();
      // No API on the engine lets the model decide to unlock; unlocking is
      // only a side effect of applyAssessment with a passing assessment.
      const first = session.sections[0]!;
      let section = engine.startRecall(first);
      section = engine.submitRecall(section, 'answer');
      const next = engine.applyAssessment(session, section, { result: 'fail' });
      expect(next.sections[1]!.status).toBe('locked');
    });

    it('distinguishes completed vs mastered vs durable mastery', () => {
      const engine = new SessionEngine();
      const session = makeSession();
      const first = session.sections[0]!;
      // Clean pass → durable
      let section = engine.startRecall(first);
      section = engine.submitRecall(section, 'answer');
      const passed = engine.applyAssessment(session, section, { result: 'pass' });
      expect(passed.sections[0]!.status).toBe('done');
      expect(passed.sections[0]!.masteryLevel).toBe('durable');

      // Fail → remediate, then pass → mastered (not durable)
      const session2 = makeSession();
      let s2 = engine.startRecall(session2.sections[0]!);
      s2 = engine.submitRecall(s2, 'wrong');
      const failed = engine.applyAssessment(session2, s2, { result: 'fail' });
      expect(failed.sections[0]!.phase).toBe('remediate');
      expect(failed.sections[0]!.hadRemediation).toBe(true);
      expect(failed.sections[0]!.masteryLevel).toBe('none');
      let rem = failed.sections[0]!;
      rem = engine.startRecall(rem);
      rem = engine.submitRecall(rem, 'better');
      const remastered = engine.applyAssessment(failed, rem, { result: 'pass' });
      expect(remastered.sections[0]!.status).toBe('done');
      expect(remastered.sections[0]!.masteryLevel).toBe('mastered');
    });

    it('copies knowledgePoints from units into sections', () => {
      const engine = new SessionEngine();
      const units = makeUnits().map((u, i) => ({
        ...u,
        knowledgePoints: i === 0 ? ['点积', '叉积'] : ['矩阵'],
      }));
      const sections = engine.buildSections(units);
      expect(sections[0]!.knowledgePoints).toEqual(['点积', '叉积']);
      expect(sections[0]!.masteryLevel).toBe('none');
    });
  });
});

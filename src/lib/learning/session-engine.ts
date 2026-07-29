import { callLLM } from '@/lib/llm/client';
import type { LLMConfig } from '@/lib/llm/types';
import { injectContextPack } from '@/lib/memory/context-pack';
import { loadLearnerContextPack } from '@/lib/memory/context-pack-server';
import { searchWeb } from '@/lib/tools/web-search';
import { assertCitationsValid, validateCitations } from './citation';
import {
  newId,
  nowIso,
  type Assessment,
  type Citation,
  type InteractionTurn,
  type LearningData,
  type LearningSession,
  type LearningUnit,
  type SearchHit,
  type SessionSection,
  type SessionSectionPhase,
  type WebSource,
  type WebSearchMode,
} from '@/types/learning';

export const SECTION_PHASES: SessionSectionPhase[] = [
  'teach',
  'active_recall',
  'assess',
  'remediate',
  'done',
];

export class SessionEngineError extends Error {
  readonly code: string;

  constructor(message: string, code = 'SESSION_ENGINE_ERROR') {
    super(message);
    this.name = 'SessionEngineError';
    this.code = code;
  }
}

export type ProviderConfig = LLMConfig & { providerId?: string };

export type SessionEngineOptions = {
  /** Max retries when LLM teach citations fail validation. */
  maxCitationRetries?: number;
  /** Minimum ratio of citation chunk tokens that must appear in a recall answer for a rule-based pass. */
  recallMatchThreshold?: number;
};

export type KnowledgeSourceOptions = {
  /** Smart search is the course default; always/off remain explicit user choices. */
  webSearchMode?: WebSearchMode;
  /** User-authored instruction, subordinate to course safety and integrity rules. */
  userSystemPrompt?: string;
  /** Append a new explanation without deleting historical turns. */
  reteach?: boolean;
};

export type GeneratedTeach = {
  turn: InteractionTurn;
  section: SessionSection;
  fallback: boolean;
};

export type GeneratedAssessment = {
  assessment: Assessment;
  section: SessionSection;
};

const LEGACY_PSEUDO_LESSON_PATTERNS = [
  /^Read the course materials for\b/i,
  /^本节围绕「?.+?」?展开[。.]?$/,
  /模型服务可用时，?Minus 会进一步生成完整讲解/,
  /当前模型服务暂不可用，因此我不会编造具体结论/,
  /以下是本地资料中与.+相关的要点/,
];

function compactCourseText(value: string): string {
  return value
    .replace(/\[cite:[^\]]+\]/g, '')
    .replace(/[`#>*_~\s，。！？；：,.!?;:()（）「」『』【】\[\]]/g, '')
    .trim();
}

export function isSubstantiveCourseAnswer(
  content: string,
  section: Pick<SessionSection, 'title' | 'description'>,
  kind: 'teach' | 'follow_up' = 'teach',
): boolean {
  const raw = content.trim();
  const compact = compactCourseText(raw);
  const minimum = kind === 'teach' ? 48 : 24;
  if (compact.length < minimum) return false;
  if (LEGACY_PSEUDO_LESSON_PATTERNS.some((pattern) => pattern.test(raw))) return false;
  const description = compactCourseText(section.description || '');
  if (description && compact.includes(description) && compact.length <= description.length + 24) {
    return false;
  }
  const title = compactCourseText(section.title || '');
  if (title && compact === title) return false;
  return true;
}

export function isLegacyLowQualityCourseTurn(
  turn: InteractionTurn,
  section: Pick<SessionSection, 'title' | 'description'>,
): boolean {
  if (turn.role !== 'assistant') return false;
  if (turn.qualityStatus === 'substantive') return false;
  if (turn.qualityStatus === 'legacy_low_quality') return true;
  return !isSubstantiveCourseAnswer(turn.content, section, 'teach');
}

export function requiresFreshWebSearch(question: string): boolean {
  return /(最新|近期|现在|当前|今天|今年|刚刚|新闻|版本|价格|政策|法规|发布日期|来源|出处|核验|验证|链接|网址|latest|current|today|news|source|verify|version|price)/i.test(question);
}

/**
 * Pure session state machine + optional LLM teach/assess.
 *
 * Rules:
 * - Sections are ordered; the first is open, the rest locked.
 * - A locked section can only open after every prior section is done.
 * - The model generates explanations and assessments but NEVER unlocks sections;
 *   unlocking is a deterministic rule after a passing assessment.
 * - Model knowledge is the default teaching base. Local documents and explicit
 *   web research are optional evidence layers, never prerequisites.
 * - Every local citation that is present must resolve against course documents.
 *   Uncited general model knowledge is allowed; invented citations are not.
 */
export class SessionEngine {
  private readonly maxCitationRetries: number;
  private readonly recallMatchThreshold: number;

  constructor(options: SessionEngineOptions = {}) {
    this.maxCitationRetries = options.maxCitationRetries ?? 1;
    this.recallMatchThreshold = options.recallMatchThreshold ?? 0.25;
  }

  // ─── Section lifecycle ───────────────────────────────────────────────────

  buildSections(units: LearningUnit[]): SessionSection[] {
    const sorted = [...units].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return sorted.map((unit, index) => ({
      id: newId(),
      status: index === 0 ? 'open' : 'locked',
      phase: 'teach',
      order: index,
      title: unit.title,
      description: unit.description,
      knowledgePoints: unit.knowledgePoints?.length ? [...unit.knowledgePoints] : undefined,
      masteryLevel: 'none' as const,
      hadRemediation: false,
      turns: [],
    }));
  }

  getOpenSection(session: LearningSession): SessionSection | undefined {
    return session.sections.find((s) => s.status === 'open');
  }

  getSectionById(session: LearningSession, sectionId: string): SessionSection | undefined {
    return session.sections.find((s) => s.id === sectionId);
  }

  /** Open a locked section after every earlier section is done. */
  openSection(session: LearningSession, sectionId: string): LearningSession {
    const section = this.getSectionById(session, sectionId);
    if (!section) {
      throw new SessionEngineError(`Section not found: ${sectionId}`, 'NOT_FOUND');
    }
    if (section.status !== 'locked') {
      throw new SessionEngineError(
        `Section ${sectionId} is already ${section.status}`,
        'INVALID_STATE',
      );
    }

    const prior = session.sections.filter((s) => (s.order ?? 0) < (section.order ?? 0));
    if (!prior.every((s) => s.status === 'done')) {
      throw new SessionEngineError(
        `Section ${sectionId} is locked until prior sections are done`,
        'LOCKED',
      );
    }

    const sections = session.sections.map((s) =>
      s.id === sectionId
        ? { ...s, status: 'open' as const, phase: 'teach' as const }
        : s,
    );

    return {
      ...session,
      sections,
      currentSectionId: sectionId,
      updatedAt: nowIso(),
    };
  }

  /**
   * Explicit learner-controlled bypass. It opens only the requested section,
   * never marks any prerequisite done, and leaves normal progression intact.
   */
  openSectionFlexible(session: LearningSession, sectionId: string): LearningSession {
    const section = this.getSectionById(session, sectionId);
    if (!section) {
      throw new SessionEngineError(`Section not found: ${sectionId}`, 'NOT_FOUND');
    }
    const sections = session.sections.map((item) =>
      item.id === sectionId && item.status === 'locked'
        ? { ...item, status: 'open' as const, phase: 'teach' as const }
        : item,
    );
    return {
      ...session,
      sections,
      currentSectionId: sectionId,
      updatedAt: nowIso(),
    };
  }

  // ─── Teach / active recall ───────────────────────────────────────────────

  /**
   * Generate a teach explanation for the current section.
   *
   * If a provider is configured, the LLM teaches from its own knowledge and may
   * supplement it with local documents and explicitly requested web research.
   * Local document claims can use `[cite:documentId:chunkIndex]`; citations that
   * are present are validated before persistence.
   */
  async generateTeach(
    data: LearningData,
    courseId: string,
    section: SessionSection,
    hits: SearchHit[],
    provider?: ProviderConfig,
    options: KnowledgeSourceOptions = {},
  ): Promise<GeneratedTeach> {
    if (!options.reteach && section.phase !== 'teach' && section.phase !== 'remediate') {
      throw new SessionEngineError(
        `Cannot teach from phase ${section.phase}`,
        'INVALID_STATE',
      );
    }

    if (!provider?.apiKey) {
      throw new SessionEngineError(
        '当前模型未配置，无法生成可靠讲解。请在设置中配置模型后重试。',
        'MODEL_UNAVAILABLE',
      );
    }
    const webSearchMode = options.webSearchMode ?? 'auto';
    const previousSearch = (section.turns ?? []).some((turn) => turn.webSearchStatus != null);
    const shouldSearch = webSearchMode === 'always' || (webSearchMode === 'auto' && !previousSearch);
    const webSources = shouldSearch
      ? await this.loadWebSources(data, courseId, section)
      : webSearchMode === 'off'
        ? []
        : this.collectSectionWebSources(section);
    const result = await this.tryLlmTeach(
      data,
      courseId,
      section,
      provider,
      hits,
      webSources,
      options.userSystemPrompt,
    );
    if (!result) {
      throw new SessionEngineError(
        '本次讲解未达到课程质量要求，内容没有保存。请重试或切换模型。',
        'LOW_QUALITY_GENERATION',
      );
    }
    const webSearchStatus = shouldSearch
      ? result.webSources.length > 0 ? ('used' as const) : ('unavailable' as const)
      : result.webSources.length > 0 ? ('reused' as const) : undefined;
    const turn: InteractionTurn = {
      id: newId(),
      role: 'assistant',
      content: result.content,
      citations: result.citations,
      contentOrigin: 'model',
      qualityStatus: 'substantive',
      sourceStatus: {
        model: 'used',
        local: result.citations.length > 0 ? 'used' : hits.length > 0 ? 'available' : 'not_used',
        web: webSearchStatus === 'used'
          ? 'used'
          : webSearchStatus === 'reused'
            ? 'reused'
            : webSearchStatus === 'unavailable'
              ? 'unavailable'
              : 'not_used',
      },
      ...(result.webSources.length > 0 ? { webSources: result.webSources } : {}),
      ...(webSearchStatus ? { webSearchStatus } : {}),
      createdAt: nowIso(),
    };
    return {
      turn,
      section: { ...section, turns: [...(section.turns ?? []), turn] },
      fallback: false,
    };
  }

  private async tryLlmTeach(
    data: LearningData,
    courseId: string,
    section: SessionSection,
    provider: ProviderConfig,
    hits: SearchHit[] = [],
    webSources: WebSource[] = [],
    userSystemPrompt?: string,
  ): Promise<{
    content: string;
    citations: Citation[];
    webSources: WebSource[];
  } | null> {
    const context = this.buildTeachContext(section, data, courseId);
    const recentErrors = this.collectRecentErrors(data, courseId, section);
    const citedHits =
      hits.length > 0
        ? hits
            .slice(0, 8)
            .map(
              (h) =>
                `[cite:${h.documentId}:${h.chunkIndex}] ${h.snippet.slice(0, 160)} (score ${h.score.toFixed(2)})`,
            )
            .join('\n')
        : this.formatCitationHints(data, courseId);

    for (let attempt = 0; attempt <= this.maxCitationRetries; attempt++) {
      const previousAttempts = attempt > 0 ? `Attempt ${attempt}/${this.maxCitationRetries}: previous citations failed validation. ` : '';
      let teachSystem =
        'You are an expert teaching assistant. Use your own trained knowledge as the primary basis for a complete, accurate lesson. ' +
        'Local course documents and web research are optional evidence layers, not prerequisites. ' +
        'When you use a local document, cite it with the exact provided format [cite:documentId:chunkIndex]; general stable knowledge does not require a local citation. ' +
        'Use web results only as supplied context and never invent a title or URL. If sources conflict, explain the uncertainty. ' +
        'Respond in Simplified Chinese unless the section clearly requires another language. ' +
        'Write as a focused learning document rather than a chat transcript. Choose the depth and structure from the actual topic; cover definitions, intuition, examples, and mistakes only when they improve this lesson. ' +
        'Use well-formed Markdown when structure improves comprehension: meaningful H2/H3 headings, compact paragraphs, lists, blockquotes for genuine definitions or cautions, tables, and fenced code blocks as appropriate. ' +
        'Do not greet the learner, repeat the section title as an H1, add decorative horizontal rules, announce a fixed teaching template, or output raw HTML. End naturally, with at most one concise checkpoint prompt when useful. ' +
        'Do not unlock later sections, reveal assessment answers, or claim the learner has mastered or durably retained material.';
      if (userSystemPrompt?.trim()) {
        teachSystem += `\n\nUser instructions (apply unless they conflict with safety, citation truthfulness, or course state rules):\n${userSystemPrompt.trim()}`;
      }
      try {
        const pack = await loadLearnerContextPack('session');
        teachSystem = injectContextPack(teachSystem, pack);
      } catch (packErr) {
        console.warn(
          '[SessionEngine] LearnerContextPack inject failed:',
          packErr instanceof Error ? packErr.message : packErr,
        );
      }
      const messages = [
        {
          role: 'system' as const,
          content: teachSystem,
        },
        {
          role: 'user' as const,
          content:
            `${previousAttempts}Explain this section for active recall practice:\n` +
            `${context}\n\n` +
            (recentErrors
              ? `Recent learner errors / partial assessments (address gently):\n${recentErrors}\n\n`
              : '') +
            (citedHits
              ? `Optional local document citation anchors:\n${citedHits}\n\n`
              : 'No local course documents are required for this lesson.\n\n') +
            (webSources.length > 0
              ? `Optional web research supplied by the user:\n${this.formatWebSourcesForPrompt(webSources)}\n\n`
              : '') +
            `Optional course documents:\n${this.formatDocumentsForPrompt(data, courseId)}`,
        },
      ];

      try {
        const response = await callLLM(messages, [], provider);
        const raw = response.content ?? '';
        const { content, citations } = this.extractCitations(raw);
        const validation = validateCitations(data, citations, { courseId });
        if (validation.valid && isSubstantiveCourseAnswer(content, section, 'teach')) {
          return { content, citations, webSources };
        }
        console.warn('LLM teach output rejected, will retry:', validation.errors);
      } catch (err) {
        console.warn('LLM teach call failed:', err instanceof Error ? err.message : err);
        return null;
      }
    }

    return null;
  }

  /**
   * Move the section from teach/remediate into active_recall.
   * Adds a lightweight prompt turn so the UI can display the recall question.
   */
  startRecall(section: SessionSection): SessionSection {
    if (section.phase !== 'teach' && section.phase !== 'remediate') {
      throw new SessionEngineError(
        `Cannot start recall from phase ${section.phase}`,
        'INVALID_STATE',
      );
    }
    const prompt: InteractionTurn = {
      id: newId(),
      role: 'assistant',
      content: `请暂时离开材料，用自己的话解释「${section.title || '这一节'}」的核心概念、它们之间的关系，以及一个具体例子。`,
      createdAt: nowIso(),
    };
    return {
      ...section,
      phase: 'active_recall',
      turns: [...(section.turns ?? []), prompt],
    };
  }

  /**
   * Record the learner's recall answer and move to the assess phase.
   */
  submitRecall(section: SessionSection, answer: string): SessionSection {
    if (section.phase !== 'active_recall') {
      throw new SessionEngineError(
        `Cannot submit recall from phase ${section.phase}`,
        'INVALID_STATE',
      );
    }
    const turn: InteractionTurn = {
      id: newId(),
      role: 'user',
      content: answer,
      createdAt: nowIso(),
    };
    return {
      ...section,
      phase: 'assess',
      turns: [...(section.turns ?? []), turn],
    };
  }

  /**
   * In-unit follow-up question — persists user + assistant turns on the section.
   * Does not re-enter IntentJudge or experience planner.
   */
  async generateFollowUp(
    section: SessionSection,
    question: string,
    opts?: {
      unitTitle?: string;
      data?: LearningData;
      courseId?: string;
      provider?: ProviderConfig;
      hits?: SearchHit[];
      webSearchMode?: WebSearchMode;
      userSystemPrompt?: string;
    },
  ): Promise<{
    section: SessionSection;
    userTurn: InteractionTurn;
    assistantTurn: InteractionTurn;
  }> {
    const text = question.trim();
    if (!text) {
      throw new SessionEngineError('Follow-up question is empty', 'INVALID_STATE');
    }
    const unitTitle = opts?.unitTitle || section.title || '这一节';
    const userTurn: InteractionTurn = {
      id: newId(),
      role: 'user',
      content: text,
      createdAt: nowIso(),
    };

    const data = opts?.data;
    const courseId = opts?.courseId;
    const webSearchMode = opts?.webSearchMode ?? 'auto';
    const shouldSearch = webSearchMode === 'always' ||
      (webSearchMode === 'auto' && requiresFreshWebSearch(text));
    const webSources = shouldSearch && data && courseId
      ? await this.loadWebSources(data, courseId, section, text)
      : webSearchMode === 'off'
        ? []
        : this.collectSectionWebSources(section);

    let answer = '';
    let citations: Citation[] = [];
    if (!opts?.provider?.apiKey) {
      throw new SessionEngineError(
        '当前模型未配置，无法生成可靠追问回答。你的问题没有被提交或保存。',
        'MODEL_UNAVAILABLE',
      );
    }
    {
      const localHints = opts.hits?.length
        ? opts.hits
            .slice(0, 6)
            .map(
              (hit) =>
                `[cite:${hit.documentId}:${hit.chunkIndex}] ${hit.snippet.slice(0, 180)}`,
            )
            .join('\n')
        : data && courseId
          ? this.formatCitationHints(data, courseId)
          : '';
      const recentTurns = (section.turns ?? [])
        .slice(-8)
        .map((turn) => `${turn.role === 'user' ? '学习者' : '教师'}：${turn.content}`)
        .join('\n');
      let followUpSystem =
        '你是课程内的专业助教。请直接、完整地回答学习者的问题，模型自身知识是主要基础；本地资料与用户启用的联网资料用于补充和核验。' +
        '使用本地资料时可添加 [cite:documentId:chunkIndex]，不要编造引用。不要只复述或确认问题，不要声称学习者已经掌握。默认使用简体中文。';
      if (opts.userSystemPrompt?.trim()) {
        followUpSystem += `\n\n用户指令（仅在不与安全、引用真实性和课程状态规则冲突时应用）：\n${opts.userSystemPrompt.trim()}`;
      }
      const messages = [
        {
          role: 'system' as const,
          content: followUpSystem,
        },
        {
          role: 'user' as const,
          content:
            `课程单元：${unitTitle}\n问题：${text}\n\n` +
            (recentTurns ? `本节最近上下文：\n${recentTurns}\n\n` : '') +
            (localHints ? `可选本地资料：\n${localHints}\n\n` : '') +
            (webSources.length > 0
              ? `可选联网资料：\n${this.formatWebSourcesForPrompt(webSources)}\n\n`
              : '') +
            '请给出解释、一个具体例子，并在适合时指出常见误区。使用规范 Markdown 自然组织内容，但不要套用固定章节模板或输出 HTML。',
        },
      ];
      try {
        const response = await callLLM(messages, [], opts.provider);
        const extracted = this.extractCitations(response.content ?? '');
        answer = extracted.content;
        if (data && courseId) {
          const validation = validateCitations(data, extracted.citations, {
            courseId,
          });
          citations = validation.valid ? extracted.citations : [];
        }
      } catch (err) {
        console.warn('LLM follow-up call failed:', err instanceof Error ? err.message : err);
        throw new SessionEngineError(
          '追问回答生成失败，内容没有保存。请稍后重试。',
          'MODEL_UNAVAILABLE',
        );
      }
    }

    if (!isSubstantiveCourseAnswer(answer, section, 'follow_up')) {
      throw new SessionEngineError(
        '本次追问回答过短或只复述了课程内容，内容没有保存。请重试或切换模型。',
        'LOW_QUALITY_GENERATION',
      );
    }

    const webSearchStatus = shouldSearch
      ? webSources.length > 0 ? ('used' as const) : ('unavailable' as const)
      : webSources.length > 0 ? ('reused' as const) : undefined;

    const assistantTurn: InteractionTurn = {
      id: newId(),
      role: 'assistant',
      content: answer,
      contentOrigin: 'model',
      qualityStatus: 'substantive',
      sourceStatus: {
        model: 'used',
        local: citations.length > 0 ? 'used' : (opts.hits?.length || 0) > 0 ? 'available' : 'not_used',
        web: webSearchStatus === 'used'
          ? 'used'
          : webSearchStatus === 'reused'
            ? 'reused'
            : webSearchStatus === 'unavailable'
              ? 'unavailable'
              : 'not_used',
      },
      ...(citations.length > 0 ? { citations } : {}),
      ...(webSources.length > 0 ? { webSources } : {}),
      ...(webSearchStatus ? { webSearchStatus } : {}),
      createdAt: nowIso(),
    };
    const turns = [...(section.turns ?? []), userTurn, assistantTurn];
    return {
      userTurn,
      assistantTurn,
      section: { ...section, turns },
    };
  }

  // ─── Assessment ──────────────────────────────────────────────────────────

  /**
   * Assess the latest recall answer. Model/domain knowledge and the generated
   * lesson are the primary rubric; local documents are optional evidence.
   */
  async generateAssessment(
    data: LearningData,
    courseId: string,
    section: SessionSection,
    provider?: ProviderConfig,
  ): Promise<GeneratedAssessment> {
    if (section.phase !== 'assess') {
      throw new SessionEngineError(
        `Cannot assess from phase ${section.phase}`,
        'INVALID_STATE',
      );
    }

    const answer = this.findLatestRecallAnswer(section);
    if (!answer) {
      throw new SessionEngineError('No recall answer to assess', 'INVALID_STATE');
    }

    const citations = section.turns?.flatMap((t) => t.citations ?? []) ?? [];
    if (citations.length > 0) {
      assertCitationsValid(data, citations, { courseId });
    }

    if (provider?.apiKey) {
      const result = await this.tryLlmAssess(data, courseId, section, answer, provider);
      if (result) {
        return {
          assessment: { result: result.result, notes: result.notes },
          section,
        };
      }
    }

    return this.fallbackAssessment(data, section, answer);
  }

  private async tryLlmAssess(
    data: LearningData,
    courseId: string,
    section: SessionSection,
    answer: string,
    provider: ProviderConfig,
  ): Promise<{ result: 'pass' | 'partial' | 'fail'; notes?: string } | null> {
    const context = this.formatDocumentsForPrompt(data, courseId);
    const citations = section.turns?.flatMap((t) => t.citations ?? []) ?? [];
    const citationText = citations
      .map((c) => {
        const doc = data.documents.find((d) => d.id === c.documentId);
        const chunk = doc?.chunks.find((ch) => ch.index === c.chunkIndex);
        return chunk ? `[cite:${c.documentId}:${c.chunkIndex}] ${chunk.text}` : '';
      })
      .filter(Boolean)
      .join('\n');

    const messages = [
      {
        role: 'system' as const,
        content:
          'You are a rigorous teaching assessor. Evaluate conceptual accuracy using your domain knowledge, the section goals, the generated lesson, and any optional source material. ' +
          'Local documents are evidence, not the sole rubric. Respond in this exact format:\nRESULT: pass|partial|fail\nNOTES: 用简体中文给出具体、简洁的反馈（1-2句）。',
      },
      {
        role: 'user' as const,
        content:
          `Section: ${section.title || 'this section'}\n` +
          `Section description: ${section.description || 'not provided'}\n` +
          `Knowledge points: ${(section.knowledgePoints || []).join(', ') || 'not provided'}\n\n` +
          `Generated lesson context:\n${(section.turns ?? [])
            .filter((turn) => turn.role === 'assistant' && !turn.assessment)
            .slice(0, 4)
            .map((turn) => turn.content)
            .join('\n\n')}\n\n` +
          (citationText ? `Optional cited source chunks:\n${citationText}\n\n` : '') +
          `Learner answer:\n${answer}\n\n` +
          `Optional course documents for context:\n${context}`,
      },
    ];

    try {
      const response = await callLLM(messages, [], provider);
      return this.parseAssessmentResult(response.content ?? '');
    } catch (err) {
      console.warn('LLM assess call failed, will fallback:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  private fallbackAssessment(
    data: LearningData,
    section: SessionSection,
    answer: string,
  ): GeneratedAssessment {
    const citations = section.turns?.flatMap((t) => t.citations ?? []) ?? [];
    const chunks = citations
      .map((c) => {
        const doc = data.documents.find((d) => d.id === c.documentId);
        return doc?.chunks.find((ch) => ch.index === c.chunkIndex)?.text ?? '';
      })
      .filter(Boolean);

    const referenceTexts = [
      ...chunks,
      section.title || '',
      section.description || '',
      ...(section.knowledgePoints ?? []),
      ...(section.turns ?? [])
        .filter((turn) => turn.role === 'assistant' && !turn.assessment)
        .slice(0, 4)
        .map((turn) => turn.content),
    ].filter(Boolean);

    const answerTokens = this.tokenize(answer);
    if (answerTokens.length === 0) {
      const assessment: Assessment = {
        result: 'fail',
        notes: '还没有可评估的复述内容，请先用自己的话说明核心概念。',
      };
      return { assessment, section };
    }

    if (referenceTexts.length === 0) {
      const assessment: Assessment = {
        result: answerTokens.length >= 12 ? 'partial' : 'fail',
        notes: '当前缺少可比对的课程上下文；已根据回答完整度给出临时结果，建议稍后使用模型评估。',
      };
      return { assessment, section };
    }

    const sourceTokens = referenceTexts.flatMap((text) => this.tokenize(text));
    const sourceSet = new Set(sourceTokens);
    const uniqueAnswerTokens = new Set(answerTokens);
    const matched = [...uniqueAnswerTokens].filter((token) =>
      sourceSet.has(token),
    ).length;
    const ratio =
      uniqueAnswerTokens.size === 0 ? 0 : matched / uniqueAnswerTokens.size;

    let result: 'pass' | 'partial' | 'fail';
    if (ratio >= this.recallMatchThreshold * 1.5) {
      result = 'pass';
    } else if (ratio >= this.recallMatchThreshold) {
      result = 'partial';
    } else {
      result = 'fail';
    }

    const notes = `基于本节目标、讲解内容与可用资料的关键词覆盖率约为 ${Math.round(ratio * 100)}%。`;
    const assessment: Assessment = { result, notes };

    return {
      assessment,
      section,
    };
  }

  /**
   * Apply a completed assessment to the section and, on pass, unlock the next
   * locked section. This is the only place sections are unlocked and mastery
   * is written. ProgressNarrator / agents must never call this path via copy.
   *
   * Mastery:
   * - fail/partial → remediate; hadRemediation=true; masteryLevel stays none/prior
   * - pass without prior remediation → mastered (and durable proxy)
   * - pass after remediation → mastered (not durable until clean re-pass proxy: durable if hadRemediation then pass still counts mastered; durable only if !hadRemediation)
   * - section status done = completed
   */
  applyAssessment(session: LearningSession, section: SessionSection, assessment: Assessment): LearningSession {
    if (section.phase !== 'assess') {
      throw new SessionEngineError(
        `Cannot apply assessment from phase ${section.phase}`,
        'INVALID_STATE',
      );
    }

    const hadRemediation = Boolean(section.hadRemediation);
    let masteryLevel: 'none' | 'completed' | 'mastered' | 'durable' =
      section.masteryLevel ?? 'none';
    let nextHadRemediation = hadRemediation;

    if (assessment.result === 'pass') {
      // completed + mastered; durable if first-pass without remediation
      masteryLevel = hadRemediation ? 'mastered' : 'durable';
    } else {
      nextHadRemediation = true;
      masteryLevel = 'none';
    }

    const assessedSection: SessionSection = {
      ...section,
      assessment,
      phase: assessment.result === 'pass' ? 'done' : 'remediate',
      status: assessment.result === 'pass' ? 'done' : 'open',
      masteryLevel: assessment.result === 'pass' ? masteryLevel : 'none',
      hadRemediation: nextHadRemediation,
      turns: [
        ...(section.turns ?? []),
        {
          id: newId(),
          role: 'assistant',
          content: assessment.notes ?? `Assessment: ${assessment.result}`,
          assessment,
          createdAt: nowIso(),
        },
      ],
    };

    // completed is represented by status=done; mastered/durable via masteryLevel
    if (assessment.result === 'pass' && assessedSection.masteryLevel === 'none') {
      assessedSection.masteryLevel = 'completed';
    }

    let sections = session.sections.map((s) => (s.id === section.id ? assessedSection : s));
    let currentSectionId = session.currentSectionId;

    if (assessment.result === 'pass') {
      const next = sections
        .filter((s) => s.status === 'locked')
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
      if (next) {
        sections = sections.map((s) =>
          s.id === next.id ? { ...s, status: 'open' as const, phase: 'teach' as const } : s,
        );
        currentSectionId = next.id;
      }
    }

    return {
      ...session,
      sections,
      currentSectionId,
      updatedAt: nowIso(),
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async loadWebSources(
    data: LearningData,
    courseId: string,
    section: SessionSection,
    question?: string,
  ): Promise<WebSource[]> {
    const courseTitle = data.courses.find((course) => course.id === courseId)?.title;
    const query = [
      courseTitle,
      section.title,
      ...(section.knowledgePoints ?? []).slice(0, 4),
      question,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!query) return [];

    try {
      const response = await searchWeb(query, 5);
      return response.results
        .filter(
          (result) =>
            result.title?.trim() && /^https?:\/\//i.test(result.url || ''),
        )
        .slice(0, 5)
        .map((result) => ({
          title: result.title.trim(),
          url: result.url,
          snippet: result.content?.trim().slice(0, 500) || undefined,
        }));
    } catch (err) {
      console.warn(
        '[SessionEngine] Optional web research unavailable:',
        err instanceof Error ? err.message : err,
      );
      return [];
    }
  }

  private collectSectionWebSources(section: SessionSection): WebSource[] {
    const unique = new Map<string, WebSource>();
    for (const turn of section.turns ?? []) {
      for (const source of turn.webSources ?? []) unique.set(source.url, source);
    }
    return [...unique.values()].slice(0, 5);
  }

  private formatWebSourcesForPrompt(sources: WebSource[]): string {
    return sources
      .map(
        (source, index) =>
          `[web:${index + 1}] ${source.title}\nURL: ${source.url}\n${source.snippet || ''}`,
      )
      .join('\n\n');
  }

  private buildTeachContext(
    section: SessionSection,
    data?: LearningData,
    courseId?: string,
  ): string {
    const parts = [`Section: ${section.title || 'Untitled'}`];
    if (section.description) parts.push(`Description: ${section.description}`);

    const kps =
      section.knowledgePoints && section.knowledgePoints.length > 0
        ? section.knowledgePoints
        : data && courseId
          ? this.findUnitKnowledgePoints(data, courseId, section)
          : [];
    if (kps.length > 0) {
      parts.push(`Knowledge points:\n${kps.map((k) => `- ${k}`).join('\n')}`);
    }
    if (section.phase === 'remediate') {
      parts.push('Mode: remediation — focus on gaps from prior assessment.');
    }
    return parts.join('\n');
  }

  private findUnitKnowledgePoints(
    data: LearningData,
    courseId: string,
    section: SessionSection,
  ): string[] {
    const units = data.units
      .filter((u) => u.courseId === courseId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const byTitle = units.find((u) => u.title === section.title);
    const byOrder =
      typeof section.order === 'number'
        ? units.find((u) => (u.order ?? 0) === section.order)
        : undefined;
    const unit = byTitle || byOrder;
    return unit?.knowledgePoints?.filter(Boolean) ?? [];
  }

  /** Collect fail/partial notes from this session for teach injection. */
  private collectRecentErrors(
    data: LearningData,
    courseId: string,
    section: SessionSection,
  ): string {
    const sessions = data.sessions.filter((s) => s.courseId === courseId).slice(-3);
    const lines: string[] = [];
    for (const sess of sessions) {
      for (const sec of sess.sections) {
        const result = sec.assessment?.result;
        if (result === 'fail' || result === 'partial') {
          lines.push(
            `- [${sec.title || 'section'}] ${result}: ${sec.assessment?.notes || 'no notes'}`,
          );
        }
      }
    }
    // Also section-local fail turns
    for (const turn of section.turns ?? []) {
      if (turn.assessment && (turn.assessment.result === 'fail' || turn.assessment.result === 'partial')) {
        lines.push(`- [current] ${turn.assessment.result}: ${turn.assessment.notes || turn.content}`);
      }
    }
    return lines.slice(-8).join('\n');
  }

  private formatCitationHints(data: LearningData, courseId: string): string {
    const docs = data.documents.filter((d) => d.courseId === courseId).slice(0, 4);
    if (docs.length === 0) return '';
    return docs
      .flatMap((doc) =>
        doc.chunks.slice(0, 3).map(
          (chunk) => `[cite:${doc.id}:${chunk.index}] ${chunk.text.slice(0, 120)}…`,
        ),
      )
      .join('\n');
  }

  private formatDocumentsForPrompt(data: LearningData, courseId?: string): string {
    const docs = courseId ? data.documents.filter((d) => d.courseId === courseId) : data.documents;
    if (docs.length === 0) return 'No documents available.';
    return docs
      .flatMap((doc) =>
        doc.chunks.map((chunk) => `[doc:${doc.id}] [chunk:${chunk.index}] ${chunk.text}`),
      )
      .join('\n');
  }

  private extractCitations(raw: string): { content: string; citations: Citation[] } {
    const citations: Citation[] = [];
    const seen = new Set<string>();
    const content = raw.replace(/\[cite:([^\]:]+):(\d+)\]/g, (_match, docId, chunkIdx) => {
      const key = `${docId}:${chunkIdx}`;
      if (!seen.has(key)) {
        seen.add(key);
        citations.push({ documentId: docId, chunkIndex: Number(chunkIdx) });
      }
      return '';
    });
    return { content: content.replace(/\n{3,}/g, '\n\n').trim(), citations };
  }

  private parseAssessmentResult(raw: string): { result: 'pass' | 'partial' | 'fail'; notes?: string } | null {
    const resultMatch = raw.match(/RESULT:\s*(pass|partial|fail)/i);
    if (!resultMatch) return null;
    const result = resultMatch[1].toLowerCase() as 'pass' | 'partial' | 'fail';
    const notesMatch = raw.match(/NOTES:\s*([\s\S]+)$/i);
    const notes = notesMatch ? notesMatch[1].trim() : undefined;
    return { result, notes };
  }

  private findLatestRecallAnswer(section: SessionSection): string | undefined {
    const turns = section.turns ?? [];
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i]!;
      if (turn.role === 'user') return turn.content;
    }
    return undefined;
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase().match(/[\p{Script=Han}]|[\p{L}\p{N}]+/gu) ?? [];
  }
}

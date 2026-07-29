/**
 * @deprecated Legacy heuristic learn script — DO NOT use in production path.
 * Production routing uses IntentJudge / Calibrate / Resource / Outline agents via `/api/agents/run`.
 * Kept only for historical tests and migration reference.
 */

const LEARN_PATTERNS: RegExp[] = [
  /想学|学习|入门|进阶|刷题|备考|课程|教我|讲解|掌握|复习|计划学/,
  /learn|study|course|tutorial|master|exam prep/i,
  /规划.*(路径|计划|课程)|学习路径|学习计划/,
];

/** @deprecated Use IntentJudge agent via orchestrator */
export function detectLearnIntent(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  return LEARN_PATTERNS.some((re) => re.test(t));
}

/** @deprecated Use IntentJudge topic field */
export function extractTopicHint(text: string): string {
  const cleaned = text
    .replace(/我想|请帮我|帮我|请|如何|怎么|怎样/g, '')
    .replace(/学习|学|规划|路径|计划/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length >= 2 && cleaned.length <= 48) return cleaned;
  const slice = text.trim().slice(0, 40);
  return slice || '新主题';
}

/** @deprecated Use ResourceAgent */
export function suggestResources(topic: string): Array<{
  title: string;
  reason: string;
  source: 'llm';
}> {
  const t = topic || '该主题';
  return [
    {
      title: `${t}：核心概念速览`,
      reason: '先建立术语与定义地图，降低后续章节跳跃感。',
      source: 'llm',
    },
    {
      title: `${t}：例题与主动回忆`,
      reason: '用短练习检验理解，避免只读不练。',
      source: 'llm',
    },
    {
      title: `${t}：进阶拓展阅读清单`,
      reason: '在基础稳固后按难度递进，仍由本地建议生成，不实时爬取网页。',
      source: 'llm',
    },
  ];
}

/** @deprecated Use CalibrateAgent */
export function buildCalibration(topic: string): {
  question: string;
  options: string[];
} {
  return {
    question: `关于「${topic}」，你目前的基础更接近哪一项？`,
    options: [
      '几乎零基础，需要从术语讲起',
      '有一点了解，需要系统梳理',
      '学过但生疏，想快速复习',
      '较熟，想做进阶与查缺补漏',
    ],
  };
}

/** @deprecated Use OutlineAgent — never use to overwrite OutlineAgent units on Start Session */
export function buildOutlineUnits(topic: string, levelIndex: number): Array<{
  title: string;
  knowledgePoints: string[];
}> {
  const base = [
    {
      title: 'Unit 1 · 基础概念',
      knowledgePoints: [`${topic} 核心术语`, '前置知识检查', '最小可行心智模型'],
    },
    {
      title: 'Unit 2 · 核心原理',
      knowledgePoints: ['关键机制', '常见误区', '对比与类比'],
    },
    {
      title: 'Unit 3 · 实践练习',
      knowledgePoints: ['例题拆解', '主动回忆', '小项目 / 应用'],
    },
    {
      title: 'Unit 4 · 复盘评估',
      knowledgePoints: ['薄弱点清单', '自测题', '下一阶段建议'],
    },
  ];
  if (levelIndex <= 0) return base;
  if (levelIndex === 1) return base.slice(0, 4);
  if (levelIndex === 2) return [base[0]!, base[1]!, base[3]!];
  return [base[1]!, base[2]!, base[3]!];
}

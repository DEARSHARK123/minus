import { describe, expect, it } from 'vitest';
import {
  buildMergedOutlineTeachMessage,
  ensureTeachFences,
  hasLearnContentMarkup,
  learningBlocksToDisplayText,
  parseLearnContent,
  toPublicTeachPayload,
} from '../learn-content';
import { clampKnowledgePoints } from '@/lib/agents/outline';
import { OutlineAgentOutputSchema } from '@/lib/agents/schemas';

describe('learn-content', () => {
  it('parses :::summary and :::key fences into typed blocks', () => {
    const text = `开场白

:::summary
这是摘要内容。
:::

:::key
- 重点甲
- 重点乙
:::

**第一章**
正文说明。
`;
    const blocks = parseLearnContent(text);
    expect(blocks.some((b) => b.kind === 'summary' && b.body.includes('摘要'))).toBe(true);
    expect(blocks.some((b) => b.kind === 'key' && b.body.includes('重点甲'))).toBe(true);
    expect(blocks.some((b) => b.kind === 'section' && b.title === '第一章')).toBe(true);
    expect(hasLearnContentMarkup(text)).toBe(true);
  });

  it('parses Chinese fence aliases 摘要 / 重点', () => {
    const text = `:::摘要
橙框摘要
:::

:::重点
绿框重点
:::`;
    const blocks = parseLearnContent(text);
    expect(blocks[0]?.kind).toBe('summary');
    expect(blocks[1]?.kind).toBe('key');
  });

  it('parses :::tip and :::definition fences with correct kind and title', () => {
    const text = `:::tip
先画图再列方程。
:::

:::definition
闭包是函数与其词法环境的组合。
:::`;
    const blocks = parseLearnContent(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: 'tip', title: '提示' });
    expect(blocks[0]?.body).toContain('先画图');
    expect(blocks[1]).toMatchObject({ kind: 'definition', title: '定义' });
    expect(blocks[1]?.body).toContain('闭包');
    expect(hasLearnContentMarkup(text)).toBe(true);
  });

  it('parses Chinese fence aliases 提示 / 定义', () => {
    const text = `:::提示
易错点：单位要统一。
:::

:::定义
熵是无序程度的度量。
:::`;
    const blocks = parseLearnContent(text);
    expect(blocks[0]).toMatchObject({ kind: 'tip', title: '提示' });
    expect(blocks[1]).toMatchObject({ kind: 'definition', title: '定义' });
  });

  it('parses mixed fences preserving order, kinds and titles', () => {
    const text = `:::summary
总览
:::

:::key
- 要点一
:::

:::tip
提示内容
:::

:::definition
定义内容
:::

**第一节**
正文。`;
    const blocks = parseLearnContent(text);
    expect(blocks.map((b) => b.kind)).toEqual([
      'summary',
      'key',
      'tip',
      'definition',
      'section',
    ]);
    expect(blocks.map((b) => b.title)).toEqual([
      '摘要',
      '重点',
      '提示',
      '定义',
      '第一节',
    ]);
  });

  it('parses learn-json fence with optional tip / definition fields', () => {
    const text = `\`\`\`learn-json
{"summary":"S","keyPoints":["A"],"tip":"易错点提示","definition":"术语定义","sections":[{"title":"S1","body":"body"}]}
\`\`\``;
    const blocks = parseLearnContent(text);
    expect(blocks.find((b) => b.kind === 'tip')).toMatchObject({
      title: '提示',
      body: '易错点提示',
    });
    expect(blocks.find((b) => b.kind === 'definition')).toMatchObject({
      title: '定义',
      body: '术语定义',
    });
    // Backward compatible: old payloads without tip/definition still parse.
    const legacy = `\`\`\`learn-json
{"summary":"只有摘要","keyPoints":["B"]}
\`\`\``;
    const legacyBlocks = parseLearnContent(legacy);
    expect(legacyBlocks.some((b) => b.kind === 'summary')).toBe(true);
    expect(legacyBlocks.some((b) => b.kind === 'tip')).toBe(false);
  });

  it('hasLearnContentMarkup detects new fence kinds', () => {
    expect(hasLearnContentMarkup(':::tip\n内容\n:::')).toBe(true);
    expect(hasLearnContentMarkup(':::definition\n内容\n:::')).toBe(true);
    expect(hasLearnContentMarkup(':::提示\n内容\n:::')).toBe(true);
    expect(hasLearnContentMarkup(':::定义\n内容\n:::')).toBe(true);
    expect(hasLearnContentMarkup('普通正文，没有围栏。')).toBe(false);
  });

  it('toPublicTeachPayload emits typed tip/definition blocks and fence-free content', () => {
    const raw = `:::summary
摘要
:::

:::tip
提示
:::

:::定义
定义
:::`;
    const pub = toPublicTeachPayload(raw);
    expect(pub.contentBlocks.map((b) => b.kind)).toEqual([
      'summary',
      'tip',
      'definition',
    ]);
    expect(pub.content).not.toMatch(/:::/);
    expect(pub.content).toContain('提示');
    const display = learningBlocksToDisplayText(pub.contentBlocks);
    expect(display).toContain('提示\n提示');
    expect(display).toContain('定义\n定义');
  });

  it('parses learn-json fence', () => {
    const text = `\`\`\`learn-json
{"summary":"JSON摘要","keyPoints":["A","B"],"sections":[{"title":"S1","body":"body"}]}
\`\`\``;
    const blocks = parseLearnContent(text);
    expect(blocks.find((b) => b.kind === 'summary')?.body).toBe('JSON摘要');
    expect(blocks.find((b) => b.kind === 'key')?.body).toContain('- A');
    expect(blocks.find((b) => b.kind === 'section')?.title).toBe('S1');
  });

  it('builds merged outline teach message with both box types', () => {
    const msg = buildMergedOutlineTeachMessage({
      topic: '线性代数',
      goalTitle: '掌握线性代数基础',
      levelHint: '初学者',
      units: [
        { title: '向量', knowledgePoints: ['向量加法', '点积'], description: '向量基础' },
        { title: '矩阵', knowledgePoints: ['矩阵乘法'] },
      ],
    });
    expect(hasLearnContentMarkup(msg)).toBe(true);
    const blocks = parseLearnContent(msg);
    expect(blocks.some((b) => b.kind === 'summary')).toBe(true);
    expect(blocks.some((b) => b.kind === 'key')).toBe(true);
    expect(blocks.some((b) => b.kind === 'section' && b.title === '向量')).toBe(true);
  });

  it('ensureTeachFences wraps plain prose', () => {
    const wrapped = ensureTeachFences('这是一段没有围栏的教学内容。\n- 要点甲');
    expect(hasLearnContentMarkup(wrapped)).toBe(true);
    expect(wrapped).toContain(':::summary');
    expect(wrapped).toContain(':::key');
  });

  it('ensureTeachFences prefers outline fallback', () => {
    const wrapped = ensureTeachFences('plain', {
      topic: '主题',
      units: [{ title: 'U1', knowledgePoints: ['A', 'B'] }],
    });
    expect(wrapped).toContain('**U1**');
    expect(hasLearnContentMarkup(wrapped)).toBe(true);
  });

  it('ensureTeachFences leaves greeting-like text unchanged (no outline)', () => {
    expect(ensureTeachFences('你好')).toBe('你好');
    expect(ensureTeachFences('Hello!')).toBe('Hello!');
    expect(hasLearnContentMarkup(ensureTeachFences('你好'))).toBe(false);
  });
});

describe('outline constraints', () => {
  it('keeps adaptive knowledge points without adding filler and applies a technical ceiling', () => {
    expect(clampKnowledgePoints([])).toEqual([]);
    expect(clampKnowledgePoints(['only'])).toEqual(['only']);
    expect(clampKnowledgePoints(Array.from({ length: 14 }, (_, index) => `p${index}`))).toHaveLength(10);
  });

  it('OutlineAgentOutputSchema keeps adaptive unit counts and slices only at the technical ceiling', () => {
    const units = Array.from({ length: 14 }, (_, i) => ({
      title: `U${i + 1}`,
      knowledgePoints: ['a', 'b'],
    }));
    const parsed = OutlineAgentOutputSchema.parse({
      goalTitle: '目标',
      units,
    });
    expect(parsed.units).toHaveLength(12);
  });

  it('OutlineAgentOutputSchema accepts one meaningful unit but rejects an empty outline', () => {
    expect(OutlineAgentOutputSchema.parse({
      goalTitle: '目标',
      units: [{ title: 'U1', knowledgePoints: ['a'] }],
    }).units).toHaveLength(1);
    expect(() => OutlineAgentOutputSchema.parse({ goalTitle: '目标', units: [] })).toThrow();
  });
});

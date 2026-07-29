import { describe, expect, it } from 'vitest';
import { buildSkillPlan } from '../skill-router';
import {
  looksLikeFullLessonProse,
  reviewOutput,
  stripTeachFences,
} from '../output-reviewer';
import { hasLearnContentMarkup } from '@/lib/chat/learn-content';

describe('stripTeachFences', () => {
  it('removes summary/key fences into plain prose', () => {
    const raw = `:::summary
你好，欢迎。
:::

:::key
- 点一
:::

正文`;
    const plain = stripTeachFences(raw);
    expect(hasLearnContentMarkup(plain)).toBe(false);
    expect(plain).toContain('你好');
    expect(plain).toContain('点一');
    expect(plain).toContain('正文');
  });
});

describe('reviewOutput', () => {
  it('chat/greeting: strips teach fences (negative)', () => {
    const plan = buildSkillPlan({ scene: 'chat', intent: 'chat', stage: 'idle' });
    const fenced = `:::summary
这是误用的摘要框
:::

:::key
- 误用重点
:::`;
    const result = reviewOutput({
      scene: { scene: 'chat', intent: 'chat', stage: 'idle' },
      skillPlan: plan,
      text: fenced,
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('teach_fences_on_plain');
    expect(result.stripped).toBe(true);
    expect(hasLearnContentMarkup(result.text)).toBe(false);
    expect(result.text).toContain('误用');
  });

  it('chat plain greeting passes without strip', () => {
    const plan = buildSkillPlan({ scene: 'chat', intent: 'chat', stage: 'idle' });
    const result = reviewOutput({
      scene: { scene: 'chat', intent: 'chat', stage: 'idle' },
      skillPlan: plan,
      text: '你好！有什么我可以帮你的？',
    });
    expect(result.ok).toBe(true);
    expect(result.stripped).toBe(false);
    expect(result.text).toBe('你好！有什么我可以帮你的？');
  });

  it('planning: flags full lesson shape (negative)', () => {
    const plan = buildSkillPlan({
      scene: 'planning',
      intent: 'learn',
      stage: 'calibrating',
    });
    const lesson = [
      ':::summary',
      '本章完整讲授线性代数全部内容。',
      ':::',
      '',
      ':::key',
      '- 向量',
      '- 矩阵',
      ':::',
      '',
      '**第一章**',
      '很长的正文……'.repeat(20),
      '**第二章**',
      '更多正文……'.repeat(20),
      '**第三章**',
      '继续……'.repeat(20),
    ].join('\n');
    const result = reviewOutput({
      scene: { scene: 'planning', intent: 'learn', stage: 'calibrating' },
      skillPlan: plan,
      text: lesson,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(hasLearnContentMarkup(result.text)).toBe(false);
  });

  it('session_teach: strips legacy teach fences into ordinary prose', () => {
    const plan = buildSkillPlan({
      scene: 'session_teach',
      intent: 'learn',
      stage: 'teaching',
    });
    const teach = `:::summary
摘要内容
:::

:::key
- 重点
:::`;
    const result = reviewOutput({
      scene: { scene: 'session_teach', intent: 'learn', stage: 'teaching' },
      skillPlan: plan,
      text: teach,
    });
    expect(result.ok).toBe(false);
    expect(result.stripped).toBe(true);
    expect(hasLearnContentMarkup(result.text)).toBe(false);
    expect(result.text).toContain('摘要内容');
  });
});

describe('looksLikeFullLessonProse', () => {
  it('detects multi-heading long lesson', () => {
    const body = [
      '**第一章**',
      'a'.repeat(150),
      '**第二章**',
      'b'.repeat(150),
      '**第三章**',
      'c'.repeat(150),
    ].join('\n');
    expect(looksLikeFullLessonProse(body)).toBe(true);
  });

  it('short plan bullets are not a full lesson', () => {
    expect(looksLikeFullLessonProse('- 目标\n- 步骤一\n- 步骤二')).toBe(false);
  });
});

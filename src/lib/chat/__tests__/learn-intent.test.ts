import { describe, expect, it } from 'vitest';
import {
  buildCalibration,
  detectLearnIntent,
  extractTopicHint,
  suggestResources,
} from '@/lib/chat/learn-intent';

describe('learn-intent', () => {
  it('detects Chinese learn intent', () => {
    expect(detectLearnIntent('我想学习机器学习')).toBe(true);
    expect(detectLearnIntent('今天天气怎么样')).toBe(false);
  });

  it('extracts topic hint', () => {
    const topic = extractTopicHint('我想学习线性代数');
    expect(topic.length).toBeGreaterThan(0);
  });

  it('returns llm-only resources without crawl', () => {
    const resources = suggestResources('概率论');
    expect(resources).toHaveLength(3);
    expect(resources.every((r) => r.source === 'llm')).toBe(true);
  });

  it('builds calibration options', () => {
    const cal = buildCalibration('微积分');
    expect(cal.options).toHaveLength(4);
  });
});

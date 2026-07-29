import { describe, it, expect, afterEach } from 'vitest';
import { buildSystemPrompt, SYSTEM_PROMPT } from '../prompt';
import { blackboard } from '../blackboard';
import { z } from 'zod';
import { Tool } from '@/types/tool';
import { Playbook } from '@/types/playbook';

const mockTools: Tool[] = [
  {
    name: 'web_search',
    description: 'Search the web',
    parameters: z.object({ query: z.string() }),
    execute: async () => ({ success: true }),
  },
  {
    name: 'code_executor',
    description: 'Execute code',
    parameters: z.object({ code: z.string() }),
    execute: async () => ({ success: true }),
  },
];

const mockPlaybook: Playbook = {
  id: 'data-analyst',
  name: 'Data Analyst',
  description: 'Analyze data',
  category: 'business',
  icon: 'barChart',
  tags: ['data'],
  prompt: 'Focus on data analysis.',
  tools: ['web_search'],
  steps: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  usageCount: 0,
  rating: 0,
};

afterEach(() => {
  blackboard.clear();
});

describe('buildSystemPrompt', () => {
  it('should include the base system prompt', () => {
    const result = buildSystemPrompt({ tools: mockTools });
    expect(result).toContain(SYSTEM_PROMPT);
  });

  it('should list available tool names', () => {
    const result = buildSystemPrompt({ tools: mockTools });
    expect(result).toContain('web_search');
    expect(result).toContain('code_executor');
  });

  it('should include tool descriptions', () => {
    const result = buildSystemPrompt({ tools: mockTools });
    expect(result).toContain('Search the web');
    expect(result).toContain('Execute code');
  });

  it('should include playbook instructions when provided', () => {
    const result = buildSystemPrompt({
      tools: mockTools,
      playbook: mockPlaybook,
    });
    expect(result).toContain('Data Analyst');
    expect(result).toContain('Focus on data analysis.');
  });

  it('should include user custom system prompt when provided', () => {
    const result = buildSystemPrompt({
      tools: mockTools,
      userSystemPrompt: 'Always respond in Chinese.',
    });
    expect(result).toContain('Always respond in Chinese.');
  });

  it('should include blackboard context when available', () => {
    blackboard.set('test_key', 'test_value', 'test_source', 60000);

    const result = buildSystemPrompt({ tools: mockTools });
    expect(result).toContain('test_value');
  });

  it('does not inject learn-teach-format by default', () => {
    const result = buildSystemPrompt({ tools: mockTools });
    expect(result).not.toMatch(/Teach-format skill/i);
    expect(result).toMatch(/do not force a lesson template/i);
  });

  it('injects learn-teach-format when allowTeachFormat is true', () => {
    const result = buildSystemPrompt({
      tools: mockTools,
      allowTeachFormat: true,
    });
    // Skill file may or may not load depending on cwd; instruction block must appear
    expect(result).toMatch(/:::summary/);
    expect(result).not.toMatch(/Do NOT emit :::summary/i);
  });
});

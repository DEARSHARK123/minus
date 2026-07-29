import { describe, it, expect } from 'vitest';
import { isRetryableError, detectExecutionIntent, generateSummary } from '../loop-utils';
import { AgentState } from '@/types/agent';

describe('isRetryableError', () => {
  it('should retry on timeout', () => {
    expect(isRetryableError('Request timeout')).toBe(true);
  });

  it('should retry on ECONNREFUSED', () => {
    expect(isRetryableError('ECONNREFUSED')).toBe(true);
  });

  it('should retry on ECONNRESET', () => {
    expect(isRetryableError('ECONNRESET')).toBe(true);
  });

  it('should retry on ENOTFOUND', () => {
    expect(isRetryableError('ENOTFOUND')).toBe(true);
  });

  it('should retry on 5xx errors', () => {
    expect(isRetryableError('502 Bad Gateway')).toBe(true);
    expect(isRetryableError('503 Service Unavailable')).toBe(true);
  });

  it('should retry on JSON parse errors', () => {
    expect(isRetryableError('Unexpected token in JSON')).toBe(true);
  });

  it('should not retry on 4xx errors', () => {
    expect(isRetryableError('400 Bad Request')).toBe(false);
    expect(isRetryableError('404 Not Found')).toBe(false);
  });

  it('should not retry on generic errors', () => {
    expect(isRetryableError('Something went wrong')).toBe(false);
  });
});

describe('detectExecutionIntent', () => {
  it('should detect code execution requests in Chinese', () => {
    expect(detectExecutionIntent('执行这段代码')).toBe(true);
    expect(detectExecutionIntent('跑一下这个脚本')).toBe(true);
    expect(detectExecutionIntent('运行Python程序')).toBe(true);
  });

  it('should detect code writing requests', () => {
    expect(detectExecutionIntent('写一个函数')).toBe(true);
    expect(detectExecutionIntent('帮我写代码')).toBe(true);
    expect(detectExecutionIntent('帮我生成一个脚本')).toBe(true);
  });

  it('should detect code snippets', () => {
    expect(detectExecutionIntent('console.log("hello")')).toBe(true);
    expect(detectExecutionIntent('def my_function():')).toBe(true);
    expect(detectExecutionIntent('import pandas')).toBe(true);
  });

  it('should detect language mentions', () => {
    expect(detectExecutionIntent('用python分析数据')).toBe(true);
    expect(detectExecutionIntent('写一个javascript程序')).toBe(true);
  });

  it('should detect search requests', () => {
    expect(detectExecutionIntent('搜索一下最新的AI论文')).toBe(true);
    expect(detectExecutionIntent('查找相关信息')).toBe(true);
  });

  it('should detect file operations', () => {
    expect(detectExecutionIntent('读取文件内容')).toBe(true);
    expect(detectExecutionIntent('写入文件')).toBe(true);
  });

  it('should detect data analysis', () => {
    expect(detectExecutionIntent('数据分析')).toBe(true);
    expect(detectExecutionIntent('做一个统计可视化')).toBe(true);
  });

  it('should not detect casual chat', () => {
    expect(detectExecutionIntent('你好')).toBe(false);
    expect(detectExecutionIntent('今天天气怎么样')).toBe(false);
    expect(detectExecutionIntent('谢谢你的帮助')).toBe(false);
  });

  it('should detect English execution requests', () => {
    expect(detectExecutionIntent('execute this code')).toBe(true);
    expect(detectExecutionIntent('run this code')).toBe(true);
    expect(detectExecutionIntent('search for information')).toBe(true);
  });
});

describe('generateSummary', () => {
  it('should generate summary with basic stats', () => {
    const state: AgentState = {
      status: 'done',
      plan: [
        { id: '1', title: 'Step 1', status: 'completed' },
        { id: '2', title: 'Step 2', status: 'completed' },
      ],
      currentStep: 1,
      messages: [],
      toolCalls: [
        { id: 'tc1', toolName: 'web_search', parameters: {}, status: 'completed' },
      ],
      toolStreams: [],
      artifacts: [],
    };

    const summary = generateSummary(state);
    expect(summary).toContain('Completed steps: 2/2');
    expect(summary).toContain('Tool calls: 1');
    expect(summary).toContain('Artifacts: 0');
  });

  it('should list artifacts when present', () => {
    const state: AgentState = {
      status: 'done',
      plan: [],
      currentStep: 0,
      messages: [],
      toolCalls: [],
      toolStreams: [],
      artifacts: [
        { id: 'a1', name: 'script.py', type: 'code', content: 'print(1)', createdAt: new Date() },
        { id: 'a2', name: 'data.csv', type: 'data', content: 'a,b', createdAt: new Date() },
      ],
    };

    const summary = generateSummary(state);
    expect(summary).toContain('script.py');
    expect(summary).toContain('data.csv');
  });

  it('should count completed steps correctly', () => {
    const state: AgentState = {
      status: 'done',
      plan: [
        { id: '1', title: 'Step 1', status: 'completed' },
        { id: '2', title: 'Step 2', status: 'failed' },
        { id: '3', title: 'Step 3', status: 'in_progress' },
      ],
      currentStep: 2,
      messages: [],
      toolCalls: [],
      toolStreams: [],
      artifacts: [],
    };

    const summary = generateSummary(state);
    expect(summary).toContain('Completed steps: 1/3');
  });
});

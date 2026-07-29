import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAgentLoop, AgentLoopConfig } from '../loop';
import { callLLM } from '../../llm/client';
import { toolRegistry } from '../../tools';
import { blackboard } from '../blackboard';


vi.mock('../../llm/client', () => ({
  callLLM: vi.fn(),
}));

vi.mock('../../tools', () => ({
  toolRegistry: {
    getAll: vi.fn(() => []),
    getAllAsLLMTools: vi.fn(() => []),
    getByNames: vi.fn(() => []),
    execute: vi.fn(),
  },
}));

describe('runAgentLoop', () => {
  const baseConfig: AgentLoopConfig = {
    maxSteps: 5,
    maxRetries: 2,
    timeout: 120000,
    apiKey: 'test-key',
    model: 'gpt-4',
    providerId: 'openai',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    blackboard.clear();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should return error when API key is missing', async () => {
    const config = { ...baseConfig, apiKey: '' };
    const onError = vi.fn();

    const result = await runAgentLoop('Hello', [], { ...config, onError });

    expect(result.status).toBe('error');
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('API Key'));
  });

  it('should handle direct response without tool calls', async () => {
    vi.mocked(callLLM).mockResolvedValueOnce({
      content: 'Hello! How can I help you?',
      tool_calls: [],
    });

    const onFinalResponse = vi.fn();
    const onDone = vi.fn();

    const result = await runAgentLoop('Hello', [], {
      ...baseConfig,
      onFinalResponse,
      onDone,
    });

    expect(result.status).toBe('done');
    expect(result.messages[result.messages.length - 1].content).toBe('Hello! How can I help you?');
    expect(onFinalResponse).toHaveBeenCalledWith('Hello! How can I help you?');
    expect(onDone).toHaveBeenCalled();
  });

  it('should execute single tool call and return result', async () => {
    vi.mocked(callLLM)
      .mockResolvedValueOnce({
        content: 'Let me search for that.',
        tool_calls: [{
          id: 'tc1',
          type: 'function',
          function: { name: 'web_search', arguments: '{"query":"test"}' },
        }],
      })
      .mockResolvedValueOnce({
        content: 'Here are the search results.',
        tool_calls: [],
      });

    vi.mocked(toolRegistry.execute).mockResolvedValueOnce({
      success: true,
      data: 'Search results for test',
    });

    const onToolCall = vi.fn();
    const onStepComplete = vi.fn();

    const result = await runAgentLoop('Search for test', [], {
      ...baseConfig,
      onToolCall,
      onStepComplete,
    });

    expect(result.status).toBe('done');
    expect(toolRegistry.execute).toHaveBeenCalledWith(
      'web_search',
      { query: 'test' },
      expect.any(Object)
    );
    expect(onToolCall).toHaveBeenCalled();
    expect(onStepComplete).toHaveBeenCalled();
  });

  it('should handle multiple iterations', async () => {
    vi.mocked(callLLM)
      .mockResolvedValueOnce({
        content: 'Step 1',
        tool_calls: [{
          id: 'tc1',
          type: 'function',
          function: { name: 'web_search', arguments: '{"query":"a"}' },
        }],
      })
      .mockResolvedValueOnce({
        content: 'Step 2',
        tool_calls: [{
          id: 'tc2',
          type: 'function',
          function: { name: 'web_search', arguments: '{"query":"b"}' },
        }],
      })
      .mockResolvedValueOnce({
        content: 'All done.',
        tool_calls: [],
      });

    vi.mocked(toolRegistry.execute)
      .mockResolvedValueOnce({ success: true, data: 'Result A' })
      .mockResolvedValueOnce({ success: true, data: 'Result B' });

    const onThinking = vi.fn();

    const result = await runAgentLoop('Multi-step task', [], {
      ...baseConfig,
      onThinking,
    });

    expect(result.status).toBe('done');
    expect(callLLM).toHaveBeenCalledTimes(3);
    expect(toolRegistry.execute).toHaveBeenCalledTimes(2);
  });

  it('should abort on signal', async () => {
    const controller = new AbortController();
    const signal = controller.signal;

    vi.mocked(callLLM).mockImplementation(async (_msgs, _tools, _config, sig) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (sig?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
          } else {
            resolve({ content: 'Delayed response', tool_calls: [] });
          }
        }, 100);
        sig?.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const promise = runAgentLoop('Hello', [], { ...baseConfig, signal });
    controller.abort();

    const result = await promise;
    expect(result.status).toBe('error');
    expect(result.messages[result.messages.length - 1].content).toContain('已取消');
  });

  it('should handle tool execution errors gracefully', async () => {
    vi.mocked(callLLM)
      .mockResolvedValueOnce({
        content: 'Let me try.',
        tool_calls: [{
          id: 'tc1',
          type: 'function',
          function: { name: 'code_executor', arguments: '{"code":"bad code"}' },
        }],
      })
      .mockResolvedValueOnce({
        content: 'The tool failed but I can continue.',
        tool_calls: [],
      });

    vi.mocked(toolRegistry.execute).mockResolvedValueOnce({
      success: false,
      error: 'Syntax error',
    });

    const result = await runAgentLoop('Run bad code', [], baseConfig);

    expect(result.status).toBe('done');
    expect(result.toolCalls[0].status).toBe('failed');
  });

  it('should include tool results in messages for LLM context', async () => {
    vi.mocked(callLLM)
      .mockResolvedValueOnce({
        content: 'Searching...',
        tool_calls: [{
          id: 'tc1',
          type: 'function',
          function: { name: 'web_search', arguments: '{"query":"test"}' },
        }],
      })
      .mockResolvedValueOnce({
        content: 'Done.',
        tool_calls: [],
      });

    vi.mocked(toolRegistry.execute).mockResolvedValueOnce({
      success: true,
      data: 'Tool output',
    });

    const result = await runAgentLoop('Search', [], baseConfig);

    const toolMessages = result.messages.filter(m => m.role === 'tool');
    expect(toolMessages.length).toBe(1);
    expect(toolMessages[0].content).toBe('Tool output');
  });

  it('should respect maxSteps limit', async () => {
    vi.mocked(callLLM).mockResolvedValue({
      content: 'Step',
      tool_calls: [{
        id: 'tc1',
        type: 'function',
        function: { name: 'web_search', arguments: '{"query":"x"}' },
      }],
    });

    vi.mocked(toolRegistry.execute).mockResolvedValue({
      success: true,
      data: 'Result',
    });

    const result = await runAgentLoop('Long task', [], { ...baseConfig, maxSteps: 2 });

    expect(result.status).toBe('done');
    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it('should generate summary when max iterations reached', async () => {
    vi.mocked(callLLM).mockResolvedValue({
      content: 'Step',
      tool_calls: [{
        id: 'tc1',
        type: 'function',
        function: { name: 'web_search', arguments: '{"query":"x"}' },
      }],
    });

    vi.mocked(toolRegistry.execute).mockResolvedValue({
      success: true,
      data: 'Result',
    });

    const result = await runAgentLoop('Task', [], { ...baseConfig, maxSteps: 1 });

    expect(result.status).toBe('done');
    const lastMessage = result.messages[result.messages.length - 1];
    expect(lastMessage.content).toContain('Execution Statistics');
  });
});

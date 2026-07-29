import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeSingleTool } from '../executor';
import { toolRegistry } from '../../tools';
import { blackboard } from '../blackboard';

vi.mock('../../tools', () => ({
  toolRegistry: {
    execute: vi.fn(),
  },
}));

describe('executeSingleTool', () => {
  const mockCallbacks = {
    onStepStart: vi.fn(),
    onStepComplete: vi.fn(),
    onToolCall: vi.fn(),
    onToolCallUpdate: vi.fn(),
    onArtifact: vi.fn(),
    onThinking: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    blackboard.clear();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should execute tool successfully', async () => {
    vi.mocked(toolRegistry.execute).mockResolvedValueOnce({
      success: true,
      data: 'Result from tool',
    });

    const result = await executeSingleTool(
      { id: 'tc1', type: 'function', function: { name: 'test_tool', arguments: '{"key":"value"}' } },
      1,
      { workspacePath: '/tmp', executionMode: 'trust' },
      () => {},
      mockCallbacks
    );

    expect(result.content).toBe('Result from tool');
    expect(result.isHumanEscalation).toBe(false);
    expect(mockCallbacks.onStepStart).toHaveBeenCalledTimes(1);
    expect(mockCallbacks.onStepComplete).toHaveBeenCalledTimes(1);
    expect(mockCallbacks.onToolCall).toHaveBeenCalledTimes(1);
    expect(mockCallbacks.onToolCallUpdate).toHaveBeenCalledTimes(1);
  });

  it('should collect artifacts from tool result', async () => {
    vi.mocked(toolRegistry.execute).mockResolvedValueOnce({
      success: true,
      data: 'Done',
      artifacts: [
        { name: 'file.txt', type: 'file' as const, content: 'hello' },
      ],
    });

    const result = await executeSingleTool(
      { id: 'tc1', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
      1,
      {},
      () => {},
      mockCallbacks
    );

    expect(result.content).toBe('Done');
    expect(mockCallbacks.onArtifact).toHaveBeenCalledTimes(1);
  });

  it('should collect code artifact from code_executor', async () => {
    vi.mocked(toolRegistry.execute).mockResolvedValueOnce({
      success: true,
      data: 'output',
    });

    await executeSingleTool(
      { id: 'tc1', type: 'function', function: { name: 'code_executor', arguments: '{"code":"print(1)","language":"python"}' } },
      1,
      {},
      () => {},
      mockCallbacks
    );

    expect(mockCallbacks.onArtifact).toHaveBeenCalledTimes(1);
    const artifact = mockCallbacks.onArtifact.mock.calls[0][0];
    expect(artifact.name).toContain('python');
    expect(artifact.type).toBe('code');
  });

  it('should collect file artifact from file_manager read action', async () => {
    vi.mocked(toolRegistry.execute).mockResolvedValueOnce({
      success: true,
      data: { action: 'read', path: '/tmp/test.txt', content: 'file content' },
    });

    await executeSingleTool(
      { id: 'tc1', type: 'function', function: { name: 'file_manager', arguments: '{"action":"read","path":"/tmp/test.txt"}' } },
      1,
      {},
      () => {},
      mockCallbacks
    );

    expect(mockCallbacks.onArtifact).toHaveBeenCalledTimes(1);
    const artifact = mockCallbacks.onArtifact.mock.calls[0][0];
    expect(artifact.type).toBe('file');
    expect(artifact.content).toBe('file content');
  });

  it('should retry on retryable error', async () => {
    vi.mocked(toolRegistry.execute)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ success: true, data: 'ok' });

    const result = await executeSingleTool(
      { id: 'tc1', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
      1,
      {},
      () => {},
      mockCallbacks
    );

    expect(toolRegistry.execute).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('ok');
    expect(mockCallbacks.onThinking).toHaveBeenCalledWith(expect.stringContaining('Retrying'));
  });

  it('should fail after max retries', async () => {
    vi.mocked(toolRegistry.execute).mockRejectedValue(
      new Error('ECONNREFUSED')
    );

    const result = await executeSingleTool(
      { id: 'tc1', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
      1,
      {},
      () => {},
      mockCallbacks
    );

    expect(toolRegistry.execute).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(result.content).toContain('ERROR:');
    expect(result.content).toContain('ECONNREFUSED');
  });

  it('should handle tool execution failure', async () => {
    vi.mocked(toolRegistry.execute).mockResolvedValueOnce({
      success: false,
      error: 'Tool execution failed',
    });

    const result = await executeSingleTool(
      { id: 'tc1', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
      1,
      {},
      () => {},
      mockCallbacks
    );

    expect(result.content).toContain('ERROR: Tool execution failed');
    expect(mockCallbacks.onToolCallUpdate).toHaveBeenCalled();
    expect(mockCallbacks.onStepComplete).toHaveBeenCalled();
  });

  it('should return human escalation for ask_human', async () => {
    vi.mocked(toolRegistry.execute).mockResolvedValueOnce({
      success: true,
      data: { question: 'Please confirm this action' },
    });

    const result = await executeSingleTool(
      { id: 'tc1', type: 'function', function: { name: 'ask_human', arguments: '{"question":"Confirm?"}' } },
      1,
      {},
      () => {},
      mockCallbacks
    );

    expect(result.isHumanEscalation).toBe(true);
    expect(result.content).toContain('Please confirm this action');
  });

  it('should store result in blackboard when under size limit', async () => {
    vi.mocked(toolRegistry.execute).mockResolvedValueOnce({
      success: true,
      data: 'Short result',
    });

    await executeSingleTool(
      { id: 'tc1', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
      1,
      {},
      () => {},
      mockCallbacks
    );

    const entries = blackboard.getAll();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].value).toBe('Short result');
  });

  it('should not store oversized results in blackboard', async () => {
    const longResult = 'x'.repeat(6000);
    vi.mocked(toolRegistry.execute).mockResolvedValueOnce({
      success: true,
      data: longResult,
    });

    blackboard.clear();
    await executeSingleTool(
      { id: 'tc1', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
      1,
      {},
      () => {},
      mockCallbacks
    );

    const entries = blackboard.getAll();
    expect(entries.length).toBe(0);
  });
});

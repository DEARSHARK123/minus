import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { Tool, ToolResult } from '@/types/tool';
import { ToolRegistryImpl } from '../registry';

function createMockTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: 'test_tool',
    description: 'A test tool',
    parameters: z.object({
      input: z.string().describe('Test input'),
    }),
    execute: async (params): Promise<ToolResult> => ({
      success: true,
      data: `Received: ${(params as { input: string }).input}`,
    }),
    ...overrides,
  };
}

describe('ToolRegistryImpl', () => {
  let registry: InstanceType<typeof ToolRegistryImpl>;

  beforeEach(() => {
    registry = new ToolRegistryImpl();
  });

  describe('register and get', () => {
    it('should register and retrieve a tool', () => {
      const tool = createMockTool();
      registry.register(tool);

      const retrieved = registry.get('test_tool');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test_tool');
    });

    it('should return undefined for non-existent tool', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('should overwrite existing tool on re-register', () => {
      registry.register(createMockTool({ description: 'v1' }));
      registry.register(createMockTool({ description: 'v2' }));

      const retrieved = registry.get('test_tool');
      expect(retrieved?.description).toBe('v2');
    });
  });

  describe('getByNames', () => {
    it('should return tools matching given names', () => {
      registry.register(createMockTool({ name: 'tool_a' }));
      registry.register(createMockTool({ name: 'tool_b' }));
      registry.register(createMockTool({ name: 'tool_c' }));

      const result = registry.getByNames(['tool_a', 'tool_c']);
      expect(result).toHaveLength(2);
      expect(result.map(t => t.name)).toEqual(['tool_a', 'tool_c']);
    });

    it('should skip non-existent names', () => {
      registry.register(createMockTool({ name: 'tool_a' }));

      const result = registry.getByNames(['tool_a', 'missing']);
      expect(result).toHaveLength(1);
    });
  });

  describe('getAll', () => {
    it('should return all registered tools', () => {
      registry.register(createMockTool({ name: 'a' }));
      registry.register(createMockTool({ name: 'b' }));

      expect(registry.getAll()).toHaveLength(2);
    });

    it('should return empty array when no tools registered', () => {
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe('getAllAsLLMTools', () => {
    it('should convert tools to LLM function format', () => {
      registry.register(createMockTool({ name: 'my_tool', description: 'Does things' }));

      const llmTools = registry.getAllAsLLMTools();
      expect(llmTools).toHaveLength(1);
      expect(llmTools[0].type).toBe('function');
      expect(llmTools[0].function.name).toBe('my_tool');
      expect(llmTools[0].function.description).toBe('Does things');
      expect(llmTools[0].function.parameters).toBeDefined();
    });

    it('should include JSON schema for parameters', () => {
      registry.register(createMockTool());

      const llmTools = registry.getAllAsLLMTools();
      const schema = llmTools[0].function.parameters as Record<string, unknown>;
      expect(schema).toHaveProperty('type', 'object');
      expect(schema).toHaveProperty('properties');
    });
  });

  describe('execute', () => {
    it('should execute a registered tool with valid params', async () => {
      registry.register(createMockTool());

      const result = await registry.execute('test_tool', { input: 'hello' });
      expect(result.success).toBe(true);
      expect(result.data).toBe('Received: hello');
    });

    it('should return error for non-existent tool', async () => {
      const result = await registry.execute('missing', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should validate parameters with Zod schema', async () => {
      registry.register(createMockTool());

      const result = await registry.execute('test_tool', { input: 123 });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle tool execution errors gracefully', async () => {
      registry.register(createMockTool({
        name: 'crashing_tool',
        execute: async () => {
          throw new Error('Tool crashed');
        },
      }));

      const result = await registry.execute('crashing_tool', { input: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool crashed');
    });

    it('should fail dangerous tools before execute when not confirmed', async () => {
      const execute = vi.fn(async (): Promise<ToolResult> => ({
        success: true,
        data: 'should never run',
      }));

      registry.register(createMockTool({
        name: 'dangerous_tool',
        isDangerous: true,
        execute,
      }));

      const result = await registry.execute('dangerous_tool', { input: 'x' });
      expect(result.success).toBe(false);
      expect(result.needsConfirmation).toBe(true);
      expect(result.error).toMatch(/CONFIRMATION_REQUIRED|确认/);
      expect(execute).not.toHaveBeenCalled();
    });

    it('should execute dangerous tools when dangerousConfirmed is true', async () => {
      const execute = vi.fn(async (): Promise<ToolResult> => ({
        success: true,
        data: 'ran after confirm',
      }));

      registry.register(createMockTool({
        name: 'dangerous_tool',
        isDangerous: true,
        execute,
      }));

      const result = await registry.execute(
        'dangerous_tool',
        { input: 'x' },
        { workspacePath: '/tmp', dangerousConfirmed: true },
      );
      expect(result.success).toBe(true);
      expect(result.data).toBe('ran after confirm');
      expect(execute).toHaveBeenCalledOnce();
    });
  });

  describe('JSON schema caching', () => {
    it('should cache the JSON schema during registration', () => {
      const tool = createMockTool();
      expect(tool.cachedJsonSchema).toBeUndefined();

      registry.register(tool);

      expect(tool.cachedJsonSchema).toBeDefined();
      expect(tool.cachedJsonSchema).toHaveProperty('type', 'object');
    });

    it('should reuse cached schema on subsequent registrations', () => {
      const tool = createMockTool();
      registry.register(tool);
      const firstSchema = tool.cachedJsonSchema;

      registry.register(tool);
      const secondSchema = tool.cachedJsonSchema;

      expect(firstSchema).toBe(secondSchema);
    });
  });
});

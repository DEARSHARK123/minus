import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../e2b-provider', () => ({
  E2BProvider: class {
    name = 'e2b';
    async isAvailable() {
      return false;
    }
  },
}));

vi.mock('../docker-provider', () => ({
  DockerProvider: class {
    name = 'docker';
    async isAvailable() {
      return false;
    }
  },
}));

describe('SandboxManager — no trust degradation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('must not fall back to trust when no sandbox provider is available', async () => {
    const { SandboxManager } = await import('../manager');
    const manager = new SandboxManager();
    await manager.initialize();

    expect(manager.getProviderName()).toBe('none');

    const result = await manager.executeCode('chat-test', 'print(1)', 'python');

    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/Trust-mode fallback is disabled|No sandbox provider/i);
    expect(result.stdout).toBe('');
    // No local process execution — only a failed sandbox result
    expect(result.exitCode).toBe(1);
  });

  it('must not degrade to trust when session creation fails', async () => {
    vi.doMock('../e2b-provider', () => ({
      E2BProvider: class {
        name = 'e2b';
        async isAvailable() {
          return true;
        }
        async create() {
          throw new Error('create failed');
        }
      },
    }));
    vi.doMock('../docker-provider', () => ({
      DockerProvider: class {
        name = 'docker';
        async isAvailable() {
          return false;
        }
      },
    }));

    vi.resetModules();
    const { SandboxManager } = await import('../manager');
    const manager = new SandboxManager();
    await manager.initialize();

    const result = await manager.executeCode('chat-2', 'print(1)', 'python');
    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/Trust-mode fallback is disabled|Failed to create sandbox/i);
  });
});

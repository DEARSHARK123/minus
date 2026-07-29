import type { SandboxProvider, SandboxSession, SandboxExecutionResult, StreamChunk } from './types';
import { E2BProvider } from './e2b-provider';
import { DockerProvider } from './docker-provider';
import { scanImports, buildInstallCommand } from './imports';

const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

export class SandboxManager {
  private sessions = new Map<string, SandboxSession>();
  private provider: SandboxProvider | null = null;
  private initialized = false;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const e2b = new E2BProvider();
    if (await e2b.isAvailable()) {
      this.provider = e2b;
    } else {
      const docker = new DockerProvider();
      if (await docker.isAvailable()) {
        this.provider = docker;
      } else {
        // No sandbox provider available. Must NOT degrade to trust mode.
        this.provider = null;
      }
    }

    this.initialized = true;
    this.startCleanup();
  }

  getProviderName(): string {
    return this.provider?.name || 'none';
  }

  async getOrCreateSession(chatId: string): Promise<SandboxSession | null> {
    if (!this.provider) {
      return null;
    }

    const existing = this.sessions.get(chatId);
    if (existing) {
      try {
        const running = await existing.sandbox.isRunning();
        if (running) {
          existing.lastUsedAt = new Date();
          return existing;
        }
      } catch {
        this.sessions.delete(chatId);
      }
    }

    try {
      const sandbox = await this.provider.create({
        timeout: SESSION_IDLE_TIMEOUT_MS,
      });

      const session: SandboxSession = {
        sandbox,
        sessionId: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        chatId,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      };

      this.sessions.set(chatId, session);
      return session;
    } catch (error) {
      console.error('[SandboxManager] Failed to create sandbox:', error);
      return null;
    }
  }

  /**
   * Execute code strictly inside a sandbox session.
   * Never degrades to local trust execution — callers must handle failure.
   */
  async executeCode(
    chatId: string,
    code: string,
    language: 'python' | 'javascript' | 'typescript' = 'python',
    opts?: {
      timeout?: number;
      onStream?: (chunk: StreamChunk) => void;
    }
  ): Promise<SandboxExecutionResult> {
    if (!this.provider) {
      return {
        success: false,
        stdout: '',
        stderr:
          'No sandbox provider available. Configure E2B_API_KEY or install Docker. ' +
          'Trust-mode fallback is disabled for security.',
        exitCode: 1,
        artifacts: [],
        executionTimeMs: 0,
      };
    }

    const session = await this.getOrCreateSession(chatId);
    if (!session) {
      return {
        success: false,
        stdout: '',
        stderr:
          'Failed to create sandbox session. Trust-mode fallback is disabled for security.',
        exitCode: 1,
        artifacts: [],
        executionTimeMs: 0,
      };
    }

    const scan = scanImports(code, language);
    if (scan.needsInstall) {
      opts?.onStream?.({
        type: 'status',
        data: `Installing dependencies: ${scan.missing.join(', ')}...`,
        timestamp: Date.now(),
      });

      const installCmd = buildInstallCommand(scan.missing, language);
      const installResult = await session.sandbox.runCode(installCmd, {
        language: 'python',
        timeout: 60_000,
      });

      if (!installResult.success) {
        opts?.onStream?.({
          type: 'stderr',
          data: `Warning: Failed to install some dependencies: ${installResult.stderr}`,
          timestamp: Date.now(),
        });
      }
    }

    return session.sandbox.runCode(code, {
      language,
      timeout: opts?.timeout ?? 30_000,
      onStdout: (chunk) => opts?.onStream?.({ type: 'stdout', data: chunk, timestamp: Date.now() }),
      onStderr: (chunk) => opts?.onStream?.({ type: 'stderr', data: chunk, timestamp: Date.now() }),
    });
  }

  async destroySession(chatId: string): Promise<void> {
    const session = this.sessions.get(chatId);
    if (session) {
      await session.sandbox.destroy().catch(() => {});
      this.sessions.delete(chatId);
    }
  }

  async destroyAll(): Promise<void> {
    const promises = [...this.sessions.values()].map(s =>
      s.sandbox.destroy().catch(() => {})
    );
    await Promise.all(promises);
    this.sessions.clear();
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [chatId, session] of this.sessions.entries()) {
        if (now - session.lastUsedAt.getTime() > SESSION_IDLE_TIMEOUT_MS) {
          session.sandbox.destroy().catch(() => {});
          this.sessions.delete(chatId);
        }
      }
    }, CLEANUP_INTERVAL_MS);

    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.destroyAll().catch(() => {});
  }
}

let _instance: SandboxManager | null = null;

export async function getSandboxManager(): Promise<SandboxManager> {
  if (!_instance) {
    _instance = new SandboxManager();
    await _instance.initialize();
  }
  return _instance;
}

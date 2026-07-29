import type { SandboxProvider, SandboxInstance, SandboxCreateOpts, SandboxExecutionResult } from './types';

export class E2BProvider implements SandboxProvider {
  name = 'e2b';

  async isAvailable(): Promise<boolean> {
    return !!process.env.E2B_API_KEY;
  }

  async create(opts?: SandboxCreateOpts): Promise<SandboxInstance> {
    const { Sandbox } = await import('@e2b/code-interpreter');

    const sandbox = await Sandbox.create({
      timeoutMs: opts?.timeout ?? 300_000,
      envs: opts?.envVars,
    });

    return new E2BSandboxInstance(sandbox);
  }
}

class E2BSandboxInstance implements SandboxInstance {
  private sandbox: InstanceType<Awaited<ReturnType<typeof this.getSandboxClass>>>;
  public id: string;
  public provider = 'e2b' as const;

  constructor(sandbox: InstanceType<Awaited<ReturnType<typeof this.getSandboxClass>>>) {
    this.sandbox = sandbox;
    this.id = sandbox.sandboxId;
  }

  private async getSandboxClass() {
    const { Sandbox } = await import('@e2b/code-interpreter');
    return Sandbox;
  }

  async isRunning(): Promise<boolean> {
    try {
      return await this.sandbox.isRunning();
    } catch {
      return false;
    }
  }

  async runCode(code: string, opts?: {
    language?: 'python' | 'javascript' | 'typescript';
    timeout?: number;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  }): Promise<SandboxExecutionResult> {
    const start = Date.now();
    const allStdout: string[] = [];
    const allStderr: string[] = [];

    try {
      const result = await this.sandbox.runCode(code, {
        language: opts?.language === 'typescript' ? 'javascript' : opts?.language,
        timeoutMs: opts?.timeout ?? 30_000,
        onStdout: (msg: { line: string }) => {
          allStdout.push(msg.line);
          opts?.onStdout?.(msg.line);
        },
        onStderr: (msg: { line: string }) => {
          allStderr.push(msg.line);
          opts?.onStderr?.(msg.line);
        },
      });

      const artifacts: SandboxExecutionResult['artifacts'] = [];

      if (result.results) {
        for (const r of result.results) {
          if (r.png) {
            artifacts.push({
              name: `output_${Date.now()}.png`,
              type: 'image',
              content: r.png,
              mimeType: 'image/png',
            });
          }
          if (r.jpeg) {
            artifacts.push({
              name: `output_${Date.now()}.jpg`,
              type: 'image',
              content: r.jpeg,
              mimeType: 'image/jpeg',
            });
          }
          if (r.html) {
            artifacts.push({
              name: `output_${Date.now()}.html`,
              type: 'data',
              content: r.html,
              mimeType: 'text/html',
            });
          }
        }
      }

      const stdout = result.logs?.stdout?.join('') || allStdout.join('');
      const stderr = result.logs?.stderr?.join('') || allStderr.join('');
      const hasError = result.error !== undefined && result.error !== null;

      return {
        success: !hasError,
        stdout,
        stderr,
        exitCode: hasError ? 1 : 0,
        artifacts,
        executionTimeMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        stdout: allStdout.join(''),
        stderr: error instanceof Error ? error.message : 'E2B execution failed',
        exitCode: 1,
        artifacts: [],
        executionTimeMs: Date.now() - start,
      };
    }
  }

  async destroy(): Promise<void> {
    try {
      await this.sandbox.kill();
    } catch {
      // Already destroyed
    }
  }

  async setTimeout(ms: number): Promise<void> {
    await this.sandbox.setTimeout(ms);
  }
}

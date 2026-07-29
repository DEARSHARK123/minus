import type { SandboxProvider, SandboxInstance, SandboxCreateOpts, SandboxExecutionResult } from './types';

const DOCKER_IMAGE = 'python:3.12-slim';
const NETWORK_POLICY = 'none';
const CPU_LIMIT = '1.0';
const MEMORY_LIMIT = '512m';

export class DockerProvider implements SandboxProvider {
  name = 'docker';

  async isAvailable(): Promise<boolean> {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const exec = promisify(execFile);
      const cmd = process.platform === 'win32' ? 'docker' : 'docker';
      await exec(cmd, ['info'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async create(opts?: SandboxCreateOpts): Promise<SandboxInstance> {
    const timeoutSec = Math.ceil((opts?.timeout ?? 300_000) / 1000);
    const envArgs: string[] = [];

    if (opts?.envVars) {
      for (const [k, v] of Object.entries(opts.envVars)) {
        envArgs.push('-e', `${k}=${v}`);
      }
    }

    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const exec = promisify(execFile);

    const args = [
      'run', '-d',
      '--network', NETWORK_POLICY,
      '--cpus', CPU_LIMIT,
      '-m', MEMORY_LIMIT,
      '--read-only',
      '--tmpfs', '/tmp:size=100m',
      ...envArgs,
      DOCKER_IMAGE,
      'sleep', String(timeoutSec),
    ];

    const { stdout } = await exec('docker', args, { timeout: 30000 });
    const containerId = stdout.trim();

    return new DockerSandboxInstance(containerId);
  }
}

class DockerSandboxInstance implements SandboxInstance {
  public id: string;
  public provider = 'docker' as const;

  constructor(containerId: string) {
    this.id = containerId;
  }

  async isRunning(): Promise<boolean> {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const exec = promisify(execFile);
      const { stdout } = await exec('docker', ['inspect', '-f', '{{.State.Running}}', this.id], { timeout: 5000 });
      return stdout.trim() === 'true';
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
    const lang = opts?.language || 'python';
    const timeoutMs = opts?.timeout ?? 30_000;

    const interpreter = lang === 'python' ? 'python3' : 'node';
    const codeArg = lang === 'python' ? ['-c', code] : ['-e', code];

    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const exec = promisify(execFile);

      const { stdout, stderr } = await exec(
        'docker',
        ['exec', this.id, interpreter, ...codeArg],
        { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }
      );

      opts?.onStdout?.(stdout);
      if (stderr) opts?.onStderr?.(stderr);

      const artifacts: SandboxExecutionResult['artifacts'] = [];

      try {
        const { stdout: lsOut } = await exec(
          'docker',
          ['exec', this.id, 'find', '/tmp', '-name', '*.png', '-o', '-name', '*.jpg', '-o', '-name', '*.html'],
          { timeout: 5000 }
        );

        const files = lsOut.trim().split('\n').filter(Boolean);
        for (const file of files) {
          try {
            const { stdout: content } = await exec(
              'docker',
              ['exec', this.id, 'base64', file],
              { timeout: 5000 }
            );
            const mimeType = file.endsWith('.png') ? 'image/png'
              : file.endsWith('.jpg') ? 'image/jpeg'
              : 'text/html';
            const type = mimeType.startsWith('image/') ? 'image' as const : 'data' as const;
            artifacts.push({
              name: file.split('/').pop() || 'output',
              type,
              content: content.trim(),
              mimeType,
            });
          } catch {
            // Skip unreadable files
          }
        }
      } catch {
        // No artifacts
      }

      return {
        success: true,
        stdout,
        stderr,
        exitCode: 0,
        artifacts,
        executionTimeMs: Date.now() - start,
      };
    } catch (error: unknown) {
      const err = error as { code?: string; killed?: boolean; stderr?: string; message?: string };

      if (err.killed || err.code === 'ETIMEDOUT') {
        return {
          success: false,
          stdout: '',
          stderr: `Execution timed out after ${timeoutMs}ms`,
          exitCode: 1,
          artifacts: [],
          executionTimeMs: Date.now() - start,
        };
      }

      return {
        success: false,
        stdout: '',
        stderr: err.stderr || err.message || 'Docker execution failed',
        exitCode: 1,
        artifacts: [],
        executionTimeMs: Date.now() - start,
      };
    }
  }

  async destroy(): Promise<void> {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const exec = promisify(execFile);
      await exec('docker', ['rm', '-f', this.id], { timeout: 10000 });
    } catch {
      // Already destroyed
    }
  }

  async setTimeout(): Promise<void> {
    // Docker containers have timeout set at creation via `sleep`
  }
}

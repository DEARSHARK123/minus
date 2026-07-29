export interface SandboxInstance {
  id: string;
  provider: 'e2b' | 'docker';
  isRunning(): Promise<boolean>;
  runCode(code: string, opts?: {
    language?: 'python' | 'javascript' | 'typescript';
    timeout?: number;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  }): Promise<SandboxExecutionResult>;
  destroy(): Promise<void>;
  setTimeout(ms: number): Promise<void>;
}

export interface SandboxExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  artifacts: Array<{ name: string; type: 'file' | 'code' | 'image' | 'data'; content: string; mimeType?: string }>;
  executionTimeMs: number;
}

export interface SandboxProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  create(opts?: SandboxCreateOpts): Promise<SandboxInstance>;
}

export interface SandboxCreateOpts {
  timeout?: number;
  envVars?: Record<string, string>;
}

export interface SandboxSession {
  sandbox: SandboxInstance;
  sessionId: string;
  chatId: string;
  createdAt: Date;
  lastUsedAt: Date;
  contextId?: string;
}

export interface StreamChunk {
  type: 'stdout' | 'stderr' | 'status';
  data: string;
  timestamp: number;
}

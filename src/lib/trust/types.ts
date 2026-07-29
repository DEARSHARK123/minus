export type RiskLevel = 'green' | 'yellow' | 'red';

export interface SanitizerResult {
  allowed: boolean;
  riskLevel: RiskLevel;
  reason?: string;
  requiresApproval: boolean;
  matchedRule?: string;
}

export interface TrustExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
  killedByTimeout: boolean;
}

export interface AuditEntry {
  timestamp: string;
  command: string;
  language: string;
  cwd: string;
  riskLevel: RiskLevel;
  approvedBy: 'auto' | 'user' | 'session';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  executionTimeMs: number;
  killedByTimeout: boolean;
  chatId?: string;
}

export interface TrustExecutorOpts {
  code: string;
  language: 'python' | 'javascript' | 'typescript';
  timeout?: number;
  cwd?: string;
  chatId?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  approvedBy?: 'auto' | 'user' | 'session';
  filePath?: string;
}

export type ExecutionMode = 'sandbox' | 'trust';

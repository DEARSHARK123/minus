import path from 'path';
import fs from 'fs';
import crossSpawn from 'cross-spawn';
import treeKill from 'tree-kill';
import { sanitizeCommand, extractCommandsFromCode } from './command-sanitizer';
import { buildSanitizedEnv } from './env-sanitizer';
import { writeAuditEntry } from './audit-logger';
import type { TrustExecutionResult, TrustExecutorOpts, SanitizerResult } from './types';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_CWD = process.cwd();

function getRunner(language: string): { command: string; args: string[]; fileExt: string } {
  switch (language) {
    case 'python':
      return { command: 'python', args: ['-u'], fileExt: '.py' };
    case 'javascript':
      return { command: 'node', args: [], fileExt: '.js' };
    case 'typescript':
      return { command: 'npx', args: ['tsx'], fileExt: '.ts' };
    default:
      return { command: 'node', args: [], fileExt: '.js' };
  }
}

export function checkCodeSafety(code: string, language: string): SanitizerResult {
  const inlineCommands = extractCommandsFromCode(code, language);
  for (const cmd of inlineCommands) {
    const result = sanitizeCommand(cmd);
    if (!result.allowed) return result;
  }

  const codePatterns = [
    { pattern: /process\.env/, reason: 'Accessing environment variables', risk: 'yellow' as const },
    { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, reason: 'Spawning child processes', risk: 'yellow' as const },
    { pattern: /\bexecSync\s*\(/, reason: 'Synchronous command execution', risk: 'yellow' as const },
  ];

  for (const { pattern, reason, risk } of codePatterns) {
    if (pattern.test(code)) {
      return {
        allowed: true,
        riskLevel: risk,
        reason,
        requiresApproval: true,
        matchedRule: pattern.source,
      };
    }
  }

  return { allowed: true, riskLevel: 'green', requiresApproval: false };
}

export function executeTrust(opts: TrustExecutorOpts): Promise<TrustExecutionResult> {
  const {
    code,
    language,
    timeout = DEFAULT_TIMEOUT_MS,
    cwd = DEFAULT_CWD,
    chatId,
    onStdout,
    onStderr,
    approvedBy = 'auto',
    filePath,
  } = opts;

  const runner = getRunner(language);
  let codePath: string;
  let isTempFile = false;

  if (filePath) {
    codePath = filePath;
  } else {
    fs.mkdirSync(cwd, { recursive: true });
    const codeFile = `minus_exec_${Date.now()}${runner.fileExt}`;
    codePath = path.join(cwd, codeFile);
    fs.writeFileSync(codePath, code, 'utf-8');
    isTempFile = true;
  }

  return new Promise((resolve) => {
    const start = Date.now();
    let killedByTimeout = false;

    const env = buildSanitizedEnv();

    const child = crossSpawn(runner.command, [...runner.args, codePath], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });

    const childPid = child.pid;

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutChunks.push(text);
      onStdout?.(text);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrChunks.push(text);
      onStderr?.(text);
    });

    const timer = setTimeout(() => {
      killedByTimeout = true;
      if (childPid) {
        treeKill(childPid, 'SIGKILL', () => {});
      }
    }, timeout);

    child.on('close', (exitCode) => {
      clearTimeout(timer);

      try { if (isTempFile) fs.unlinkSync(codePath); } catch {}

      const result: TrustExecutionResult = {
        success: exitCode === 0 && !killedByTimeout,
        stdout: stdoutChunks.join(''),
        stderr: killedByTimeout
          ? `Execution timed out after ${timeout}ms. Optimize your code or process data in smaller chunks.`
          : stderrChunks.join(''),
        exitCode: killedByTimeout ? -1 : (exitCode ?? 1),
        executionTimeMs: Date.now() - start,
        killedByTimeout,
      };

      const commandDesc = filePath
        ? `${runner.command} ${runner.args.join(' ')} ${filePath}`
        : `${runner.command} ${runner.args.join(' ')} ${path.basename(codePath)}`;

      writeAuditEntry({
        timestamp: new Date().toISOString(),
        command: commandDesc,
        language,
        cwd,
        riskLevel: 'green',
        approvedBy,
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 2000),
        stderr: result.stderr.slice(0, 2000),
        executionTimeMs: result.executionTimeMs,
        killedByTimeout: result.killedByTimeout,
        chatId,
      });

      resolve(result);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      try { if (isTempFile) fs.unlinkSync(codePath); } catch {}

      const commandDesc = filePath
        ? `${runner.command} ${runner.args.join(' ')} ${filePath}`
        : `${runner.command} ${runner.args.join(' ')} ${path.basename(codePath)}`;

      writeAuditEntry({
        timestamp: new Date().toISOString(),
        command: commandDesc,
        language,
        cwd,
        riskLevel: 'green',
        approvedBy,
        exitCode: -1,
        stdout: '',
        stderr: err.message,
        executionTimeMs: Date.now() - start,
        killedByTimeout: false,
        chatId,
      });

      resolve({
        success: false,
        stdout: '',
        stderr: `Process error: ${err.message}`,
        exitCode: -1,
        executionTimeMs: Date.now() - start,
        killedByTimeout: false,
      });
    });
  });
}

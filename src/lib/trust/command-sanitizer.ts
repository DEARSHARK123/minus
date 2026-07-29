import type { RiskLevel, SanitizerResult } from './types';

interface BlacklistRule {
  pattern: RegExp;
  reason: string;
  platform: 'all' | 'win32' | 'unix';
  riskLevel: RiskLevel;
}

const CATASTROPHIC_BLACKLIST: BlacklistRule[] = [
  { pattern: /\brm\s+(-[rRf]+\s+)?\/(\s|$)/, reason: 'Attempted to delete root filesystem', platform: 'all', riskLevel: 'red' },
  { pattern: /\brm\s+(-[rRf]+\s+)?\/\*/, reason: 'Attempted to delete root filesystem (glob)', platform: 'all', riskLevel: 'red' },
  { pattern: /\bdd\s+.*of=\/dev\/sd/, reason: 'Attempted to overwrite disk device', platform: 'all', riskLevel: 'red' },
  { pattern: /\bmkfs\./, reason: 'Attempted to format filesystem', platform: 'all', riskLevel: 'red' },
  { pattern: />\s*\/dev\/sd[a-z]/, reason: 'Attempted to write to disk device', platform: 'all', riskLevel: 'red' },
  { pattern: /\bchmod\s+(-R\s+)?777\s+\/(\s|$)/, reason: 'Attempted to set world-writable permissions on root', platform: 'all', riskLevel: 'red' },
  { pattern: /:\(\)\{\s*:\|:&\s*\};:/, reason: 'Fork bomb detected', platform: 'all', riskLevel: 'red' },
  { pattern: /\bmv\s+.*\/\s/, reason: 'Attempted to move files to root', platform: 'all', riskLevel: 'red' },
  { pattern: /\bdel\s+\/[sS]\s+\/[qQ]\s+[A-Z]:\\?\s*$/i, reason: 'Attempted to delete entire drive', platform: 'all', riskLevel: 'red' },
  { pattern: /\bformat\s+[A-Z]:/i, reason: 'Attempted to format drive', platform: 'all', riskLevel: 'red' },
  { pattern: /\breg\s+delete\s+HKLM/i, reason: 'Attempted to delete HKLM registry hive', platform: 'all', riskLevel: 'red' },
  { pattern: /Remove-Item\s+.*-Recurse\s+.*-Force\s+[A-Z]:\\\\?\s*$/i, reason: 'PowerShell: Attempted to delete entire drive', platform: 'all', riskLevel: 'red' },
  { pattern: /\brm\s+-[rRf]+\s+~\/(\s|$)/, reason: 'Attempted to delete home directory', platform: 'all', riskLevel: 'red' },
  { pattern: /\bwget\s+.*\|\s*(ba)?sh/, reason: 'Piping remote script to shell', platform: 'all', riskLevel: 'red' },
  { pattern: /\bcurl\s+.*\|\s*(ba)?sh/, reason: 'Piping remote script to shell', platform: 'all', riskLevel: 'red' },
  { pattern: /\b(sudo\s+)?shutdown/, reason: 'Attempted system shutdown', platform: 'all', riskLevel: 'red' },
  { pattern: /\b(sudo\s+)?reboot/, reason: 'Attempted system reboot', platform: 'all', riskLevel: 'red' },
];

const YELLOW_LIST: BlacklistRule[] = [
  { pattern: /\bnpm\s+(publish|unpublish)/, reason: 'NPM publish/unpublish operation', platform: 'all', riskLevel: 'yellow' },
  { pattern: /\bpip\s+(install|uninstall)/, reason: 'Python package install/uninstall', platform: 'all', riskLevel: 'yellow' },
  { pattern: /\bgit\s+(push|force)/, reason: 'Git remote operation', platform: 'all', riskLevel: 'yellow' },
  { pattern: /\bcurl\s+/, reason: 'HTTP request via curl', platform: 'unix', riskLevel: 'yellow' },
  { pattern: /\bwget\s+/, reason: 'HTTP request via wget', platform: 'unix', riskLevel: 'yellow' },
  { pattern: /\bInvoke-WebRequest\b/, reason: 'PowerShell HTTP request', platform: 'win32', riskLevel: 'yellow' },
  { pattern: /\bnpm\s+install/, reason: 'NPM install', platform: 'all', riskLevel: 'yellow' },
  { pattern: /\byarn\s+add/, reason: 'Yarn add', platform: 'all', riskLevel: 'yellow' },
  { pattern: /\bpnpm\s+add/, reason: 'PNPM add', platform: 'all', riskLevel: 'yellow' },
  { pattern: /\brm\s+(-[rRf]+\s+)?[^\s/]/, reason: 'File deletion', platform: 'unix', riskLevel: 'yellow' },
  { pattern: /\bdel\s+[A-Z]:/i, reason: 'File deletion', platform: 'win32', riskLevel: 'yellow' },
  { pattern: /Remove-Item\s+/, reason: 'PowerShell file deletion', platform: 'win32', riskLevel: 'yellow' },
];

const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /\.ssh[\\\/]/i,
  /\.aws[\\\/]/i,
  /\.gnupg[\\\/]/i,
  /\.config[\\\/]/i,
  /\.env\b/i,
  /\.git[\\\/]/i,
  /id_rsa/i,
  /id_ed25519/i,
  /credentials/i,
  /\.pem$/i,
  /\.key$/i,
  /[A-Z]:\\Users\\[^\s]+\\\.(ssh|aws|gnupg)/i,
  /\/etc\/(passwd|shadow|sudoers)/i,
  /\/root\//i,
];

export function sanitizeCommand(command: string): SanitizerResult {
  const isWin = process.platform === 'win32';

  for (const rule of CATASTROPHIC_BLACKLIST) {
    if (rule.platform !== 'all' && rule.platform !== (isWin ? 'win32' : 'unix')) continue;
    if (rule.pattern.test(command)) {
      return {
        allowed: false,
        riskLevel: 'red',
        reason: rule.reason,
        requiresApproval: false,
        matchedRule: rule.pattern.source,
      };
    }
  }

  for (const rule of YELLOW_LIST) {
    if (rule.platform !== 'all' && rule.platform !== (isWin ? 'win32' : 'unix')) continue;
    if (rule.pattern.test(command)) {
      return {
        allowed: true,
        riskLevel: 'yellow',
        reason: rule.reason,
        requiresApproval: true,
        matchedRule: rule.pattern.source,
      };
    }
  }

  if (detectSensitivePathAccess(command)) {
    return {
      allowed: true,
      riskLevel: 'yellow',
      reason: 'Command references a sensitive directory or file',
      requiresApproval: true,
      matchedRule: 'sensitive_path',
    };
  }

  return {
    allowed: true,
    riskLevel: 'green',
    requiresApproval: false,
  };
}

function detectSensitivePathAccess(command: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some(p => p.test(command));
}

export function extractCommandsFromCode(code: string, language: string): string[] {
  const commands: string[] = [];

  if (language === 'python') {
    const subprocessPatterns = [
      /(?:subprocess\.(?:call|run|Popen|check_output|check_call))\s*\(\s*['"`]([^'"`]+)/g,
      /os\.system\s*\(\s*['"`]([^'"`]+)/g,
      /os\.popen\s*\(\s*['"`]([^'"`]+)/g,
    ];
    for (const pattern of subprocessPatterns) {
      let match;
      while ((match = pattern.exec(code)) !== null) {
        commands.push(match[1]);
      }
    }
  }

  if (language === 'javascript' || language === 'typescript') {
    const jsPatterns = [
      /exec(?:Sync)?\s*\(\s*['"`]([^'"`]+)/g,
      /spawn(?:Sync)?\s*\(\s*['"`]([^'"`]+)/g,
      /execFile(?:Sync)?\s*\(\s*['"`]([^'"`]+)/g,
    ];
    for (const pattern of jsPatterns) {
      let match;
      while ((match = pattern.exec(code)) !== null) {
        commands.push(match[1]);
      }
    }
  }

  return commands;
}

export function isExecutionIntent(command: string): boolean {
  const executionPrefixes = ['python', 'node', 'npx', 'ts-node', 'deno', 'bun', 'java', 'go run', 'cargo run'];
  const trimmed = command.trim().toLowerCase();
  return executionPrefixes.some(prefix => trimmed.startsWith(prefix));
}

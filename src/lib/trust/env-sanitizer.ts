const SAFE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LANGUAGE',
  'TERM',
  'SHELL',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'LOGNAME',
  'USERNAME',
  'HOSTNAME',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'APPDATA',
  'LOCALAPPDATA',
  'NODE_ENV',
  'NODE_PATH',
  'PYTHONPATH',
  'PYTHONIOENCODING',
  'UV_SYSTEM_PYTHON',
];

const SENSITIVE_KEY_PATTERNS = [
  /KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /AUTH/i,
  /OPENAI/i,
  /ANTHROPIC/i,
  /GOOGLE/i,
  /DEEPSEEK/i,
  /API_KEY/i,
  /ACCESS_KEY/i,
  /PRIVATE/i,
];

export function buildSanitizedEnv(): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV || 'production',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  };

  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      sanitized[key] = process.env[key];
    }
  }

  return sanitized;
}

export function isEnvKeySensitive(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key));
}

export function getEnvAuditReport(): { safe: string[]; stripped: string[] } {
  const safe: string[] = [];
  const stripped: string[] = [];

  for (const key of Object.keys(process.env)) {
    if (SAFE_ENV_KEYS.includes(key)) {
      safe.push(key);
    } else if (isEnvKeySensitive(key)) {
      stripped.push(key);
    }
  }

  return { safe, stripped };
}

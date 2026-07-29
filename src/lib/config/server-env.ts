import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getFileSecret,
  readProviderSecrets,
  writeProviderSecret,
  type ProviderSecretEntry,
} from './provider-secrets';

function getProviderEnvKeys(): Record<string, { apiKey: string; baseUrl?: string; model?: string }> {
  return {
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
      baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
      model: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
    },
  };
}

/** Legacy client id → server env key */
const PROVIDER_ID_ALIASES: Record<string, string> = {
  google: 'gemini',
};

function secretsFilePath(): string {
  if (process.env.MINUS_DATA_DIR) {
    return path.join(process.env.MINUS_DATA_DIR, 'provider-secrets.json');
  }
  return path.join(os.homedir(), '.minus', 'data', 'provider-secrets.json');
}

/** Sync read of file secrets for resolveProviderConfig call sites. */
function readProviderSecretsSync(): Record<string, ProviderSecretEntry> {
  try {
    const raw = fs.readFileSync(secretsFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as { providers?: Record<string, ProviderSecretEntry> };
    return parsed.providers || {};
  } catch {
    return {};
  }
}

function mergeProviderConfig(providerId: string): {
  apiKey: string;
  baseUrl: string;
  model: string;
} {
  const env = getProviderEnvKeys()[providerId];
  if (!env) {
    throw new Error(
      `Unsupported provider "${providerId}". Supported providers: ${Object.keys(getProviderEnvKeys()).join(', ')}.`,
    );
  }
  const file = readProviderSecretsSync()[providerId] || {};
  return {
    apiKey: (file.apiKey && file.apiKey.trim()) || env.apiKey || '',
    baseUrl: (file.baseUrl && file.baseUrl.trim()) || env.baseUrl || '',
    model: (file.model && file.model.trim()) || env.model || '',
  };
}

/** Provider ids with a non-empty key (file or env), in deterministic order. */
export function getConfiguredProviders(): string[] {
  const ids = Object.keys(getProviderEnvKeys());
  return ids.filter((id) => {
    try {
      return !!mergeProviderConfig(id).apiKey;
    } catch {
      return false;
    }
  });
}

export interface ProviderStatus {
  providerId: string;
  hasKey: boolean;
  maskedKey: string;
  model: string;
  baseUrl: string;
  configuredProviders: string[];
  source: 'file' | 'env' | 'none';
}

/**
 * Read-only status for the Model settings tab.
 */
export function getProviderStatus(providerId: string): ProviderStatus {
  const normalizedId = PROVIDER_ID_ALIASES[providerId] || providerId;
  const file = readProviderSecretsSync()[normalizedId];
  const merged = mergeProviderConfig(normalizedId);
  const env = getProviderEnvKeys()[normalizedId];
  let source: ProviderStatus['source'] = 'none';
  if (file?.apiKey?.trim()) source = 'file';
  else if (env?.apiKey) source = 'env';

  return {
    providerId: normalizedId,
    hasKey: !!merged.apiKey,
    maskedKey: maskApiKey(merged.apiKey || ''),
    model: merged.model || '',
    baseUrl: merged.baseUrl || '',
    configuredProviders: getConfiguredProviders(),
    source,
  };
}

export interface ResolvedProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  source: 'server';
  providerId: string;
}

/**
 * Resolve provider credentials: ~/.minus file secrets override env.
 */
export function resolveProviderConfig(
  providerId: string,
): ResolvedProviderConfig {
  const normalizedId = PROVIDER_ID_ALIASES[providerId] || providerId;
  const merged = mergeProviderConfig(normalizedId);

  return {
    apiKey: merged.apiKey,
    baseUrl: merged.baseUrl,
    model: merged.model,
    source: 'server',
    providerId: normalizedId,
  };
}

export function missingApiKeyError(providerId: string): string {
  const envHints: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    gemini: 'GEMINI_API_KEY',
  };
  const hint = envHints[providerId] || `${providerId.toUpperCase()}_API_KEY`;
  return `No API key configured for provider "${providerId}". Save a key in Settings, or set ${hint} in the server environment (.env).`;
}

export function maskApiKey(key: string): string {
  if (!key) return '(empty)';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

export function listSupportedProviders(): Array<{
  id: string;
  defaultModel: string;
  defaultBaseUrl: string;
}> {
  return Object.entries(getProviderEnvKeys()).map(([id, cfg]) => ({
    id,
    defaultModel: cfg.model || '',
    defaultBaseUrl: cfg.baseUrl || '',
  }));
}

export { writeProviderSecret, readProviderSecrets, getFileSecret };

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface ProviderSecretEntry {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export type ProviderSecretsFile = {
  updatedAt?: string;
  providers: Record<string, ProviderSecretEntry>;
};

function dataDir(): string {
  if (process.env.MINUS_DATA_DIR) {
    return process.env.MINUS_DATA_DIR;
  }
  return path.join(os.homedir(), '.minus', 'data');
}

function secretsPath(): string {
  return path.join(dataDir(), 'provider-secrets.json');
}

async function ensureDir(): Promise<void> {
  const dir = path.dirname(secretsPath());
  await fs.mkdir(dir, { recursive: true });
}

export async function readProviderSecrets(): Promise<ProviderSecretsFile> {
  try {
    const raw = await fs.readFile(secretsPath(), 'utf8');
    const parsed = JSON.parse(raw) as ProviderSecretsFile;
    if (!parsed || typeof parsed !== 'object' || !parsed.providers) {
      return { providers: {} };
    }
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return { providers: {} };
    throw err;
  }
}

export async function writeProviderSecret(
  providerId: string,
  entry: ProviderSecretEntry,
): Promise<void> {
  await ensureDir();
  const current = await readProviderSecrets();
  const prev = current.providers[providerId] || {};
  const next: ProviderSecretEntry = { ...prev };

  if (typeof entry.apiKey === 'string') {
    const trimmed = entry.apiKey.trim();
    // Empty string from client means "keep existing key"
    if (trimmed.length > 0) {
      next.apiKey = trimmed;
    }
  }
  if (entry.baseUrl !== undefined) next.baseUrl = entry.baseUrl.trim();
  if (entry.model !== undefined) next.model = entry.model.trim();

  current.providers[providerId] = next;
  current.updatedAt = new Date().toISOString();

  const file = secretsPath();
  await fs.writeFile(file, JSON.stringify(current, null, 2), 'utf8');
  try {
    await fs.chmod(file, 0o600);
  } catch {
    // Windows may ignore chmod; best-effort
  }
}

export async function getFileSecret(
  providerId: string,
): Promise<ProviderSecretEntry | undefined> {
  const file = await readProviderSecrets();
  return file.providers[providerId];
}

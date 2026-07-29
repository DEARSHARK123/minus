import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readUserConfigurationSync } from '@/lib/config/user-configuration';

export function auditLogsDir(): string {
  return process.env.MINUS_DATA_DIR
    ? path.join(process.env.MINUS_DATA_DIR, 'logs')
    : path.join(os.homedir(), '.minus', 'logs');
}

export function redactAuditDetail(detail: string): string {
  const policy = readUserConfigurationSync().auditPolicy;
  let value = String(detail || '')
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]');
  if (policy.redactLevel === 'strict') {
    const home = os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    value = value
      .replace(new RegExp(home, 'gi'), '~')
      .replace(/https?:\/\/[^\s?#]+\?[^\s]+/gi, (url) => url.split('?')[0] || url);
  }
  return value.slice(0, 4000);
}

export function compactAuditFile(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const policy = readUserConfigurationSync().auditPolicy;
    const cutoff = policy.retentionDays == null
      ? null
      : Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000;
    let lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    if (cutoff != null) {
      lines = lines.filter((line) => {
        try {
          const timestamp = String((JSON.parse(line) as { timestamp?: string }).timestamp || '');
          const parsed = Date.parse(timestamp);
          return !Number.isFinite(parsed) || parsed >= cutoff;
        } catch {
          return false;
        }
      });
    }
    while (Buffer.byteLength(lines.join('\n'), 'utf8') > policy.maxFileBytes && lines.length > 1) {
      lines.shift();
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');
  } catch {
    // Audit maintenance is non-blocking.
  }
}

export function clearAuditFile(filePath: string): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '', 'utf8');
  } catch {
    // Caller reports best-effort status.
  }
}


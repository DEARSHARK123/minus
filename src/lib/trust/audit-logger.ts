import fs from 'fs';
import path from 'path';
import type { AuditEntry } from './types';
import {
  auditLogsDir,
  clearAuditFile,
  compactAuditFile,
  redactAuditDetail,
} from './audit-policy';

const AUDIT_DIR = auditLogsDir();
const AUDIT_FILE = path.join(AUDIT_DIR, 'audit.jsonl');

let ensured = false;

function ensureAuditDir(): void {
  if (ensured) return;
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    ensured = true;
  } catch {
    console.warn('[AuditLogger] Failed to create audit directory:', AUDIT_DIR);
  }
}

export function writeAuditEntry(entry: AuditEntry): void {
  ensureAuditDir();

  compactAuditFile(AUDIT_FILE);
  const line = JSON.stringify({
    ...entry,
    command: redactAuditDetail(entry.command),
  }) + '\n';

  try {
    fs.appendFileSync(AUDIT_FILE, line, 'utf-8');
    compactAuditFile(AUDIT_FILE);
  } catch (error) {
    console.warn('[AuditLogger] Failed to write audit entry:', error);
  }
}

export function clearAuditEntries(): void {
  clearAuditFile(AUDIT_FILE);
}

export function getAuditLogPath(): string {
  return AUDIT_FILE;
}

export function readAuditEntries(limit = 100): AuditEntry[] {
  ensureAuditDir();

  try {
    if (!fs.existsSync(AUDIT_FILE)) return [];

    const content = fs.readFileSync(AUDIT_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    return lines
      .slice(-limit)
      .map(line => {
        try {
          return JSON.parse(line) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is AuditEntry => e !== null);
  } catch {
    return [];
  }
}

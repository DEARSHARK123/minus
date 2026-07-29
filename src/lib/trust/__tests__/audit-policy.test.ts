import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compactAuditFile, redactAuditDetail } from '../audit-policy';
import { defaultUserConfiguration } from '@/lib/config/user-configuration-core';
import { writeUserConfiguration } from '@/lib/config/user-configuration';

describe('audit policy', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minus-audit-policy-'));
    process.env.MINUS_DATA_DIR = tempDir;
  });

  afterEach(() => {
    delete process.env.MINUS_DATA_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('redacts credentials and strict-mode query strings', async () => {
    await writeUserConfiguration({
      ...defaultUserConfiguration(),
      auditPolicy: {
        retentionDays: 90,
        redactLevel: 'strict',
        maxFileBytes: 64 * 1024,
        optionalKinds: [],
      },
    });
    const redacted = redactAuditDetail('token=secret-value GET https://example.com/path?q=private');
    expect(redacted).toContain('token=[redacted]');
    expect(redacted).toContain('https://example.com/path');
    expect(redacted).not.toContain('q=private');
  });

  it('drops expired rows while preserving recent valid JSONL', async () => {
    await writeUserConfiguration({
      ...defaultUserConfiguration(),
      auditPolicy: {
        retentionDays: 1,
        redactLevel: 'standard',
        maxFileBytes: 64 * 1024,
        optionalKinds: [],
      },
    });
    const file = path.join(tempDir, 'logs', 'audit.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
      JSON.stringify({ timestamp: '2020-01-01T00:00:00.000Z', kind: 'old' }),
      JSON.stringify({ timestamp: new Date().toISOString(), kind: 'recent' }),
      'invalid-json',
    ].join('\n') + '\n');

    compactAuditFile(file);
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('recent');
    expect(content).not.toContain('old');
    expect(content).not.toContain('invalid-json');
  });
});

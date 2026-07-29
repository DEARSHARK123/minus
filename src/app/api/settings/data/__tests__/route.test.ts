import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import { emptyLearningData } from '@/types/learning';
import { LearningRepository } from '@/lib/learning/repository';
import {
  readLearnerMemory,
  replaceLearnerMemory,
} from '@/lib/memory/learner-memory';
import { GET, POST } from '../route';

describe('settings data backup route', () => {
  let tempDir: string;
  let previousLearningPath: string | undefined;
  let previousMinusDataDir: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minus-data-backup-'));
    previousLearningPath = process.env.LEARNING_DATA_PATH;
    previousMinusDataDir = process.env.MINUS_DATA_DIR;
    process.env.LEARNING_DATA_PATH = path.join(tempDir, 'learning-data.json');
    process.env.MINUS_DATA_DIR = tempDir;

    await new LearningRepository().save(emptyLearningData());
    await replaceLearnerMemory({
      version: 2,
      persona: '',
      strengths: [],
      stylePrefs: [],
      memories: [],
      externalDoc: 'before',
    });
  });

  afterEach(async () => {
    if (previousLearningPath === undefined) delete process.env.LEARNING_DATA_PATH;
    else process.env.LEARNING_DATA_PATH = previousLearningPath;
    if (previousMinusDataDir === undefined) delete process.env.MINUS_DATA_DIR;
    else process.env.MINUS_DATA_DIR = previousMinusDataDir;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('exports and restores validated server-owned data', async () => {
    const exportedResponse = await GET();
    expect(exportedResponse.status).toBe(200);
    const exported = await exportedResponse.json();
    expect(exported.success).toBe(true);
    expect(exported.data.schemaVersion).toBe(1);
    expect(exported.data.memory.externalDoc).toBe('before');

    const nextPackage = {
      ...exported.data,
      memory: {
        ...exported.data.memory,
        externalDoc: 'restored',
      },
    };
    const importResponse = await POST(
      new NextRequest('http://localhost/api/settings/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import', data: nextPackage }),
      }),
    );
    expect(importResponse.status).toBe(200);
    const imported = await importResponse.json();
    expect(imported.success).toBe(true);
    expect(imported.data.rollbackToken).toMatch(/^import-/);
    expect((await readLearnerMemory()).externalDoc).toBe('restored');
    expect((await new LearningRepository().load()).version).toBe(2);

    const rollbackResponse = await POST(
      new NextRequest('http://localhost/api/settings/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rollback',
          token: imported.data.rollbackToken,
        }),
      }),
    );
    expect(rollbackResponse.status).toBe(200);
    expect((await readLearnerMemory()).externalDoc).toBe('before');
  });

  it('rejects unsupported packages before writing', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/settings/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          data: { schemaVersion: 99, learning: {}, memory: {} },
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await readLearnerMemory()).externalDoc).toBe('before');
  });
});

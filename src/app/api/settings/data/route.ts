import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { LearningRepository } from '@/lib/learning/repository';
import {
  readLearnerMemory,
  replaceLearnerMemory,
} from '@/lib/memory/learner-memory';
import { LearningDataSchema } from '@/types/learning';
import {
  readUserConfiguration,
  writeUserConfiguration,
} from '@/lib/config/user-configuration';
import { UserConfigurationSchema } from '@/lib/config/user-configuration-core';

export const runtime = 'nodejs';

const PACKAGE_SCHEMA_VERSION = 1;

function fail(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function rollbackDirectory(): string {
  const dataDir = process.env.MINUS_DATA_DIR || path.join(os.homedir(), '.minus', 'data');
  return path.join(dataDir, 'import-rollbacks');
}

function rollbackPath(token: string): string {
  return path.join(rollbackDirectory(), `${token}.json`);
}

/** Export server-owned local data. Browser-owned chat/settings are added client-side. */
export async function GET(): Promise<Response> {
  try {
    const repository = new LearningRepository();
    const [learning, memory, configuration] = await Promise.all([
      repository.load(),
      readLearnerMemory(),
      readUserConfiguration(),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        schemaVersion: PACKAGE_SCHEMA_VERSION,
        learning,
        memory,
        configuration,
      },
    });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : '无法导出本地数据',
      500,
    );
  }
}

/** Restore server-owned data after validating the complete package first. */
export async function POST(request: NextRequest): Promise<Response> {
  let body: {
    action?: string;
    data?: { schemaVersion?: number; learning?: unknown; memory?: unknown; configuration?: unknown };
    token?: string;
  };
  try {
    body = await request.json();
  } catch {
    return fail('备份文件不是有效 JSON');
  }

  if (body.action === 'rollback') {
    const token = String(body.token || '');
    if (!/^import-[0-9TZ-]+-[a-f0-9]{8}$/.test(token)) {
      return fail('无效的回滚标识');
    }
    try {
      const raw = await fs.readFile(rollbackPath(token), 'utf8');
      const snapshot = JSON.parse(raw) as { learning?: unknown; memory?: unknown; configuration?: unknown };
      const parsedLearning = LearningDataSchema.safeParse(snapshot.learning);
      if (!parsedLearning.success || !snapshot.memory || typeof snapshot.memory !== 'object') {
        return fail('回滚快照已损坏', 500);
      }
      const repository = new LearningRepository();
      await repository.save(parsedLearning.data);
      await replaceLearnerMemory(snapshot.memory);
      if (snapshot.configuration) await writeUserConfiguration(snapshot.configuration);
      return NextResponse.json({
        success: true,
        data: { rolledBack: true, token },
      });
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : '服务端回滚失败',
        500,
      );
    }
  }

  if (body.action !== 'import' || !body.data) {
    return fail('仅支持 import / rollback 操作');
  }
  if (body.data.schemaVersion !== PACKAGE_SCHEMA_VERSION) {
    return fail('不支持的备份版本');
  }

  const parsedLearning = LearningDataSchema.safeParse(body.data.learning);
  if (!parsedLearning.success) {
    return fail('学习数据未通过结构校验');
  }
  if (!body.data.memory || typeof body.data.memory !== 'object') {
    return fail('学习者记忆未通过结构校验');
  }
  const parsedConfiguration = body.data.configuration == null
    ? null
    : UserConfigurationSchema.safeParse(body.data.configuration);
  if (parsedConfiguration && !parsedConfiguration.success) {
    return fail('用户配置未通过结构校验');
  }

  const repository = new LearningRepository();
  let learningBackupPath: string | null = null;
  let previousLearning: Awaited<ReturnType<LearningRepository['load']>> | null = null;
  let previousMemory: Awaited<ReturnType<typeof readLearnerMemory>> | null = null;
  let previousConfiguration: Awaited<ReturnType<typeof readUserConfiguration>> | null = null;
  let rollbackToken: string | null = null;
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    [previousLearning, previousMemory, previousConfiguration] = await Promise.all([
      repository.load(),
      readLearnerMemory(),
      readUserConfiguration(),
    ]);
    rollbackToken = `import-${stamp}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    await fs.mkdir(rollbackDirectory(), { recursive: true });
    await fs.writeFile(
      rollbackPath(rollbackToken),
      JSON.stringify(
        {
          schemaVersion: PACKAGE_SCHEMA_VERSION,
          learning: previousLearning,
          memory: previousMemory,
          configuration: previousConfiguration,
        },
        null,
        2,
      ),
      'utf8',
    );

    learningBackupPath = `${repository.dataPath}.before-import.${stamp}`;
    try {
      await fs.copyFile(repository.dataPath, learningBackupPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
      learningBackupPath = null;
    }

    await repository.save(parsedLearning.data);
    await replaceLearnerMemory(body.data.memory);
    if (parsedConfiguration?.success) {
      await writeUserConfiguration(parsedConfiguration.data);
    }

    return NextResponse.json({
      success: true,
      data: {
        imported: true,
        schemaVersion: PACKAGE_SCHEMA_VERSION,
        rollbackToken,
      },
    });
  } catch (error) {
    if (previousLearning && previousMemory && previousConfiguration) {
      try {
        await repository.save(previousLearning);
        await replaceLearnerMemory(previousMemory);
        await writeUserConfiguration(previousConfiguration);
      } catch {
        if (learningBackupPath) {
          try {
            await fs.copyFile(learningBackupPath, repository.dataPath);
          } catch {
            // Preserve the original import error; dated backups remain on disk.
          }
        }
      }
    }
    return fail(
      error instanceof Error ? error.message : '无法导入本地数据',
      500,
    );
  }
}

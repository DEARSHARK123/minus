import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listEffectiveSkills,
  readUserConfigurationSync,
  saveAutomation,
  saveSkill,
  userConfigurationPath,
  writeUserConfiguration,
} from '../user-configuration';
import { defaultUserConfiguration } from '../user-configuration-core';

describe('user configuration', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minus-user-config-'));
    process.env.MINUS_DATA_DIR = tempDir;
  });

  afterEach(() => {
    delete process.env.MINUS_DATA_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('atomically replaces an existing configuration and keeps schema defaults', async () => {
    await writeUserConfiguration(defaultUserConfiguration());
    await writeUserConfiguration({
      ...readUserConfigurationSync(),
      networkAccess: 'allow',
    });

    expect(readUserConfigurationSync().networkAccess).toBe('allow');
    expect(readUserConfigurationSync().auditPolicy.retentionDays).toBe(90);
    expect(fs.existsSync(userConfigurationPath())).toBe(true);
    expect(fs.readdirSync(tempDir).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('applies an editable built-in override before runtime prompt resolution', async () => {
    await saveSkill({
      id: 'planning',
      enabled: true,
      body: '# Skill: 用户规划\n\n只在任务需要时给出计划。',
      extraInstructions: '',
      scenes: ['planning'],
      priority: 42,
      updatedAt: new Date().toISOString(),
    });

    const skill = listEffectiveSkills().find((item) => item.id === 'planning');
    expect(skill?.body).toContain('只在任务需要时给出计划');
    expect(skill?.priority).toBe(42);
    expect(skill?.overridden).toBe(true);
  });

  it('never disables or rewrites a locked safety skill', async () => {
    await expect(saveSkill({
      id: 'workspace-files',
      enabled: false,
      extraInstructions: '',
      scenes: [],
      priority: 0,
      updatedAt: new Date().toISOString(),
    })).rejects.toThrow(/cannot be disabled/i);

    await saveSkill({
      id: 'workspace-files',
      enabled: true,
      extraInstructions: '禁止访问项目父目录。',
      scenes: ['desktop'],
      priority: 10,
      updatedAt: new Date().toISOString(),
    });
    const skill = listEffectiveSkills().find((item) => item.id === 'workspace-files');
    expect(skill?.enabled).toBe(true);
    expect(skill?.body).toContain('禁止访问项目父目录');
    expect(skill?.editableBody).not.toBe('禁止访问项目父目录。');
  });

  it('rejects an invalid automation before writing it', async () => {
    await expect(saveAutomation({
      id: crypto.randomUUID(),
      name: 'invalid',
      enabled: true,
      trigger: { type: 'daily', time: '25:99', timeZone: 'Asia/Shanghai' },
      action: { type: 'reminder', title: '提醒', message: '' },
      approvalPolicy: 'supervised',
      catchUp: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })).rejects.toThrow();
    expect(readUserConfigurationSync().automations).toHaveLength(0);
  });
});

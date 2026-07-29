import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  AutomationRuleSchema,
  CustomSkillSchema,
  SkillOverrideSchema,
  UserConfigurationSchema,
  UserPlaybookSchema,
  defaultUserConfiguration,
  isLockedSkill,
  type AutomationRule,
  type CustomSkill,
  type SkillOverride,
  type UserConfiguration,
  type UserPlaybook,
} from './user-configuration-core';
import { playbookTemplates } from '@/lib/playbooks/templates';

function dataDir(): string {
  return process.env.MINUS_DATA_DIR || path.join(os.homedir(), '.minus', 'data');
}

export function userConfigurationPath(): string {
  return path.join(dataDir(), 'user-configuration.json');
}

function parseConfiguration(raw: unknown): UserConfiguration {
  const parsed = UserConfigurationSchema.safeParse(raw);
  return parsed.success ? parsed.data : defaultUserConfiguration();
}

export function readUserConfigurationSync(): UserConfiguration {
  try {
    return parseConfiguration(JSON.parse(fs.readFileSync(userConfigurationPath(), 'utf8')));
  } catch {
    return defaultUserConfiguration();
  }
}

export async function readUserConfiguration(): Promise<UserConfiguration> {
  return readUserConfigurationSync();
}

export async function writeUserConfiguration(input: unknown): Promise<UserConfiguration> {
  const next = UserConfigurationSchema.parse({
    ...(input as Record<string, unknown>),
    version: 1,
    updatedAt: new Date().toISOString(),
  });
  const target = userConfigurationPath();
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    const handle = await fs.promises.open(temp, 'wx');
    try {
      await handle.writeFile(JSON.stringify(next, null, 2), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(temp, target);
  } catch (error) {
    await fs.promises.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  return next;
}

export type EffectiveSkill = {
  id: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  scenes: string[];
  priority: number;
  source: 'builtin' | 'custom';
  locked: boolean;
  overridden: boolean;
  editableBody: string;
  extraInstructions: string;
};

function parseSkillMetadata(id: string, body: string): { name: string; description: string } {
  const title = body.match(/^#\s+Skill:\s*(.+)$/im)?.[1]?.trim() || id;
  const description = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#')) || '';
  return { name: title, description };
}

export function listEffectiveSkills(config = readUserConfigurationSync()): EffectiveSkill[] {
  const root = path.join(process.cwd(), 'skills');
  const overrides = new Map(config.skillOverrides.map((item) => [item.id, item]));
  const builtins: EffectiveSkill[] = [];
  try {
    for (const file of fs.readdirSync(root).filter((name) => name.endsWith('.md')).sort()) {
      const id = file.slice(0, -3);
      const original = fs.readFileSync(path.join(root, file), 'utf8').trim();
      const override = overrides.get(id);
      const locked = isLockedSkill(id);
      const baseBody = locked ? original : override?.body?.trim() || original;
      const body = override?.extraInstructions?.trim()
        ? `${baseBody}\n\n## User restrictions\n${override.extraInstructions.trim()}`
        : baseBody;
      const meta = parseSkillMetadata(id, original);
      builtins.push({
        id,
        name: meta.name,
        description: meta.description,
        body,
        enabled: locked ? true : override?.enabled ?? true,
        scenes: override?.scenes ?? [],
        priority: override?.priority ?? 0,
        source: 'builtin',
        locked,
        overridden: !!override,
        editableBody: locked ? original : override?.body?.trim() || original,
        extraInstructions: override?.extraInstructions || '',
      });
    }
  } catch {
    // Empty catalog is surfaced to the settings UI.
  }

  const custom = config.customSkills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    body: skill.extraInstructions.trim()
      ? `${skill.body.trim()}\n\n## User restrictions\n${skill.extraInstructions.trim()}`
      : skill.body.trim(),
    enabled: skill.enabled,
    scenes: skill.scenes,
    priority: skill.priority,
    source: 'custom' as const,
    locked: false,
    overridden: true,
    editableBody: skill.body,
    extraInstructions: skill.extraInstructions,
  }));

  return [...builtins, ...custom].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

export function getEffectiveSkill(id: string, config = readUserConfigurationSync()): EffectiveSkill | undefined {
  return listEffectiveSkills(config).find((skill) => skill.id === id && skill.enabled);
}

export function listEffectivePlaybooks(config = readUserConfigurationSync()): UserPlaybook[] {
  const configured = new Map(config.playbooks.map((playbook) => [playbook.id, playbook]));
  const now = new Date(0).toISOString();
  const builtins = playbookTemplates.map((template) =>
    configured.get(template.id) ||
    UserPlaybookSchema.parse({
      id: template.id,
      name: template.name,
      description: template.description,
      prompt: template.prompt,
      tools: template.tools,
      steps: template.steps.map((step, index) => ({
        ...step,
        id: `step-${index + 1}`,
      })),
      scenes: [],
      enabled: true,
      source: 'builtin',
      updatedAt: now,
    }),
  );
  const custom = config.playbooks.filter((playbook) => playbook.source === 'custom');
  return [...builtins, ...custom];
}

export async function saveSkill(input: unknown): Promise<UserConfiguration> {
  const current = readUserConfigurationSync();
  const raw = input as Record<string, unknown>;
  if (raw.source === 'custom') {
    const skill = CustomSkillSchema.parse(raw);
    return writeUserConfiguration({
      ...current,
      customSkills: [...current.customSkills.filter((item) => item.id !== skill.id), skill],
    });
  }
  const override = SkillOverrideSchema.parse(raw);
  if (isLockedSkill(override.id) && (override.body?.trim() || !override.enabled)) {
    throw new Error('Locked safety skills cannot be disabled or rewritten; add restrictions instead.');
  }
  return writeUserConfiguration({
    ...current,
    skillOverrides: [...current.skillOverrides.filter((item) => item.id !== override.id), override],
  });
}

export async function resetSkill(id: string): Promise<UserConfiguration> {
  const current = readUserConfigurationSync();
  return writeUserConfiguration({
    ...current,
    skillOverrides: current.skillOverrides.filter((item) => item.id !== id),
    customSkills: current.customSkills.filter((item) => item.id !== id),
  });
}

export async function savePlaybook(input: unknown): Promise<UserConfiguration> {
  const current = readUserConfigurationSync();
  const playbook = UserPlaybookSchema.parse(input);
  return writeUserConfiguration({
    ...current,
    playbooks: [...current.playbooks.filter((item) => item.id !== playbook.id), playbook],
  });
}

export async function resetPlaybook(id: string): Promise<UserConfiguration> {
  const current = readUserConfigurationSync();
  return writeUserConfiguration({
    ...current,
    playbooks: current.playbooks.filter((item) => item.id !== id),
  });
}

export async function saveAutomation(input: unknown): Promise<UserConfiguration> {
  const current = readUserConfigurationSync();
  const automation = AutomationRuleSchema.parse(input) as AutomationRule;
  return writeUserConfiguration({
    ...current,
    automations: [...current.automations.filter((item) => item.id !== automation.id), automation],
  });
}

export async function deleteAutomation(id: string): Promise<UserConfiguration> {
  const current = readUserConfigurationSync();
  return writeUserConfiguration({
    ...current,
    automations: current.automations.filter((item) => item.id !== id),
  });
}

export type { AutomationRule, CustomSkill, SkillOverride, UserConfiguration, UserPlaybook };

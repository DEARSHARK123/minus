import path from 'path';
import fs from 'fs';
import { getEffectiveSkill } from '@/lib/config/user-configuration';

const SAFE_SKILL_BASENAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

function normalizeSkillBasename(name: string): string | null {
  const basename = name.endsWith('.md') ? name.slice(0, -3) : name;
  return SAFE_SKILL_BASENAME.test(basename) ? basename : null;
}

/**
 * Load a skill markdown file by basename (without .md).
 * Looks under `skills/` then `src/lib/agents/skills/` relative to cwd.
 */
export function loadSkill(name: string): string {
  const basename = normalizeSkillBasename(name);
  if (!basename) return '';

  const effective = getEffectiveSkill(basename);
  if (effective) return effective.body.trim();

  const filename = `${basename}.md`;
  // Keep both dynamic reads statically scoped to known subdirectories. Besides
  // blocking traversal, this prevents Next's file tracer from treating the
  // entire repository as a possible runtime dependency.
  const candidates = [
    path.join(
      /* turbopackIgnore: true */ process.cwd(),
      'skills',
      filename,
    ),
    path.join(
      /* turbopackIgnore: true */ process.cwd(),
      'src',
      'lib',
      'agents',
      'skills',
      filename,
    ),
  ];

  for (const full of candidates) {
    try {
      if (fs.existsSync(/* turbopackIgnore: true */ full)) {
        return fs
          .readFileSync(/* turbopackIgnore: true */ full, 'utf-8')
          .trim();
      }
    } catch {
      // try next
    }
  }
  return '';
}

/** Append skill body under a heading if non-empty. */
export function appendSkill(system: string, skillName: string, heading?: string): string {
  const body = loadSkill(skillName);
  if (!body) return system;
  const title = heading || `Skill: ${skillName}`;
  return `${system}\n\n## ${title}\n${body}`;
}

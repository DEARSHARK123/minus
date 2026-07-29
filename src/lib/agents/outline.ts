import { callAgentJson, type AgentLLMOptions } from './llm-json';
import type { OutlineUnitArtifact } from './types';
import { OutlineAgentOutputSchema } from './schemas';
import { appendSkill } from './load-skill';
import { injectContextPack } from '@/lib/memory/context-pack';
import { loadLearnerContextPack } from '@/lib/memory/context-pack-server';

export interface OutlineAgentResult {
  units: OutlineUnitArtifact[];
  goalTitle: string;
}

const BASE_SYSTEM = `You are OutlineAgent for Minus.
Build a structured learning outline adapted to the topic's real complexity and the learner level.
Use the fewest units that still form a coherent progression. Each unit needs a title and concrete knowledgePoints; never add filler to reach a count.
If learner context is present, adapt pace/style labels; never invent a fake learner profile when empty.
Respond with ONLY valid JSON:
{
  "goalTitle": string,
  "units": [
    {
      "title": string,
      "knowledgePoints": string[],
      "description": string,
      "estimatedMinutes": number
    }
  ]
}`;

/** Remove empty/duplicate knowledge points and apply only a technical ceiling. */
export function sanitizeKnowledgePoints(raw: string[]): string[] {
  const seen = new Set<string>();
  return raw
    .map((k) => String(k).trim())
    .filter((item) => {
      const key = item.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

/** @deprecated Use sanitizeKnowledgePoints. */
export const clampKnowledgePoints = sanitizeKnowledgePoints;

export async function runOutlineAgent(
  topic: string,
  levelHint: string,
  options: AgentLLMOptions,
  proposal?: string,
): Promise<OutlineAgentResult> {
  const pack = await loadLearnerContextPack('outline');
  const system = injectContextPack(
    appendSkill(BASE_SYSTEM, 'learn-divide', 'Divide skill'),
    pack,
  );

  const parsed = await callAgentJson(
    system,
    `Topic: ${topic}\nProposal: ${proposal || topic}\nLevel: ${levelHint}`,
    { ...options, temperature: 0.5, maxTokens: 3000 },
    OutlineAgentOutputSchema,
  );

  const units: OutlineUnitArtifact[] = parsed.units
    .map((u) => ({
      title: u.title.trim(),
      knowledgePoints: sanitizeKnowledgePoints(
        Array.isArray(u.knowledgePoints) ? u.knowledgePoints : [],
      ),
      description: u.description ? u.description.trim() : undefined,
      estimatedMinutes:
        typeof u.estimatedMinutes === 'number' && u.estimatedMinutes > 0
          ? Math.min(180, Math.round(u.estimatedMinutes))
          : 45,
    }))
    .filter((u) => u.title.length > 0 && u.knowledgePoints.length > 0);

  if (units.length === 0) {
    throw new Error('OutlineAgent returned no usable units after sanitization');
  }

  return {
    goalTitle: parsed.goalTitle.trim() || `掌握 ${topic}`,
    units: units.slice(0, 12),
  };
}

import { callAgentJson, type AgentLLMOptions } from './llm-json';
import type { ResourceItem } from './types';
import { ResourceAgentOutputSchema } from './schemas';

export interface ResourceAgentResult {
  resources: ResourceItem[];
}

const SYSTEM = `You are ResourceAgent for Minus.
Suggest a small set of learning-resource directions for a topic.
These are model suggestions only — do NOT claim you searched the live web or present an uncertain title as a verified source.
Prefer stable resource categories, well-known works you are confident about, and useful practice formats. Mark every item as source=llm.
Respond with ONLY valid JSON:
{
  "resources": [
    { "title": string, "reason": string, "source": "llm" }
  ]
}`;

export async function runResourceAgent(
  topic: string,
  levelHint: string,
  options: AgentLLMOptions,
): Promise<ResourceAgentResult> {
  const parsed = await callAgentJson(
    SYSTEM,
    `Topic: ${topic}\nLearner level / calibration answer: ${levelHint}`,
    { ...options, temperature: 0.6 },
    ResourceAgentOutputSchema,
  );

  const resources: ResourceItem[] = parsed.resources
    .map((r) => ({
      title: r.title.trim(),
      reason: r.reason.trim(),
      source: 'llm' as const,
    }))
    .filter((r) => r.title.length > 0)
    .slice(0, 6);

  if (resources.length === 0) {
    throw new Error('ResourceAgent returned no resources');
  }

  return { resources };
}

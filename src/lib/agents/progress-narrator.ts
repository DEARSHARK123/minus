import { callAgentJson, type AgentLLMOptions } from './llm-json';
import { ProgressNarratorOutputSchema } from './schemas';
import {
  buildProgressStepsFromStage,
  normalizeLearnStage,
} from './learn-state-machine';

export interface ProgressStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done';
}

export interface ProgressNarratorResult {
  title: string;
  content: string;
  steps: ProgressStep[];
}

const SYSTEM = `You are ProgressNarrator for Minus.
You produce copy-only progress narration for the right rail / progress card.
You do NOT write calendar, library, or progress persistence — copy only.
You MUST NOT claim mastery, durable mastery, or course completion as persisted fact.
Statuses for steps should reflect the given current stage only (explain, never forge).
Given the current learn-flow stage and topic, narrate a short progress update.
Respond with ONLY valid JSON:
{
  "title": string,
  "content": string,
  "steps": [
    { "id": string, "label": string, "status": "pending" | "active" | "done" }
  ]
}
Use Chinese labels. Prefer stages: 意图 → 目标 → 校准 → 大纲 → 就绪 → 教学 → 回忆 → 评估 → 补救 → 完成.`;

/**
 * Copy-only progress narration. Repository / SessionEngine own real progress.
 * Never call this to unlock sections or write mastery.
 */
export async function runProgressNarrator(
  topic: string,
  stage: string,
  options: AgentLLMOptions,
): Promise<ProgressNarratorResult> {
  const normalized = normalizeLearnStage(stage);
  const fallbackSteps = buildProgressStepsFromStage(normalized);

  const parsed = await callAgentJson(
    SYSTEM,
    `Topic: ${topic}\nCurrent stage: ${normalized}\n` +
      `Authoritative step skeleton (preserve statuses; you may rephrase labels):\n` +
      JSON.stringify(fallbackSteps),
    { ...options, temperature: 0.4 },
    ProgressNarratorOutputSchema,
  );

  // Prefer LLM labels when present, but re-derive statuses from stage so narrator
  // cannot forge "all done / mastered" ahead of repository truth.
  const authoritative = buildProgressStepsFromStage(normalized);
  const labelById = new Map(
    parsed.steps.map((s) => [s.id, s.label.trim()] as const),
  );

  const steps: ProgressStep[] =
    authoritative.length > 0
      ? authoritative.map((s) => ({
          id: s.id,
          label: labelById.get(s.id) || s.label,
          status: s.status,
        }))
      : fallbackSteps;

  return {
    title: parsed.title.trim() || '学习进度',
    content: parsed.content.trim() || `当前阶段：${normalized}`,
    steps: steps.length > 0 ? steps : fallbackSteps,
  };
}

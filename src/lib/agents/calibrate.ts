import { callAgentJson, type AgentLLMOptions } from './llm-json';
import { CalibrateAgentOutputSchema } from './schemas';
import { injectContextPack } from '@/lib/memory/context-pack';
import { loadLearnerContextPack } from '@/lib/memory/context-pack-server';

export interface CalibrateAgentResult {
  question: string;
  options: string[];
  kind: 'single_choice' | 'multi_choice' | 'free_text';
}

const SYSTEM = `You are CalibrateAgent for Minus.
Generate a short calibration question to gauge the learner's current level on a topic.
Prefer single_choice with 3–5 concrete options tailored to the topic (not generic fluff).
If learner context is present, adapt difficulty language; do not invent a profile when empty.
Respond with ONLY valid JSON:
{
  "kind": "single_choice" | "multi_choice" | "free_text",
  "question": string,
  "options": string[]  // empty if free_text
}`;

export async function runCalibrateAgent(
  topic: string,
  options: AgentLLMOptions,
  proposal?: string,
): Promise<CalibrateAgentResult> {
  const pack = await loadLearnerContextPack('calibrate');
  const system = injectContextPack(SYSTEM, pack);

  const parsed = await callAgentJson(
    system,
    `Topic: ${topic}\nUser proposal: ${proposal || topic}`,
    { ...options, temperature: 0.5 },
    CalibrateAgentOutputSchema,
  );

  const kind = parsed.kind;
  const opts = parsed.options.map((o) => o.trim()).filter(Boolean).slice(0, 6);

  if (kind !== 'free_text' && opts.length < 2) {
    throw new Error('CalibrateAgent returned insufficient options');
  }

  return {
    kind,
    question: parsed.question.trim() || `关于「${topic}」你目前的基础如何？`,
    options: opts,
  };
}

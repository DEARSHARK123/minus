import { callAgentJson, type AgentLLMOptions } from './llm-json';
import { MemoryAgentOutputSchema } from './schemas';
import {
  buildLearnerContextPack,
  injectContextPack,
} from '@/lib/memory/context-pack';
import { loadLearnerContextPack } from '@/lib/memory/context-pack-server';
import { readLearnerMemory } from '@/lib/memory/learner-memory';

export interface MemoryAgentResult {
  entries: string[];
  summary: string;
}

const SYSTEM = `You are MemoryAgent for Minus.
Given a learning topic, stored learner memory, and optional chat history, produce a short memory recall card.
Prefer real stored memory entries. If there is no prior learner profile, return an empty entries array and note that in summary.
Do NOT invent fake transcripts of past courses the user never took.
Respond with ONLY valid JSON:
{
  "entries": string[],
  "summary": "one short sentence"
}`;

export async function runMemoryAgent(
  topic: string,
  options: AgentLLMOptions,
  history?: Array<{ role: string; content: string }>,
  knownEntries?: string[],
): Promise<MemoryAgentResult> {
  const hist =
    history && history.length > 0
      ? history
          .slice(-8)
          .map((m) => `${m.role}: ${m.content.slice(0, 180)}`)
          .join('\n')
      : '(none)';

  let storedLines: string[] = knownEntries ? [...knownEntries] : [];
  try {
    const mem = await readLearnerMemory();
    const pack = buildLearnerContextPack(mem, 'memory');
    if (!pack.empty) {
      storedLines.push(...pack.entries.map((e) => e.text));
      if (pack.summaryLine) storedLines.push(pack.summaryLine);
    }
  } catch {
    // ignore read errors; fall back to knownEntries
  }

  // Dedupe lines
  const seen = new Set<string>();
  storedLines = storedLines.filter((l) => {
    const k = l.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const known =
    storedLines.length > 0 ? storedLines.join('\n') : '(no stored long-term memory)';

  const pack = await loadLearnerContextPack('memory');
  const system = injectContextPack(SYSTEM, pack);

  const parsed = await callAgentJson(
    system,
    `Topic: ${topic}\nKnown memory:\n${known}\nChat history:\n${hist}`,
    { ...options, temperature: 0.3 },
    MemoryAgentOutputSchema,
  );

  return {
    entries: parsed.entries.map((e) => e.trim()).filter(Boolean).slice(0, 8),
    summary: parsed.summary.trim() || '暂无长期记忆',
  };
}

import { callAgentJson, type AgentLLMOptions } from './llm-json';
import { IntentJudgeOutputSchema } from './schemas';
import { injectContextPack } from '@/lib/memory/context-pack';
import { loadLearnerContextPack } from '@/lib/memory/context-pack-server';

export type IntentKind = 'chat' | 'learn' | 'desktop';

export interface IntentJudgeResult {
  intent: IntentKind;
  topic: string;
  confidence: number;
  rationale: string;
  /** Short confirm-gate copy when intent=learn */
  proposalSummary: string;
}

const SYSTEM = `You are IntentJudge for Minus (multi-agent executor + LLM Desktop).
Classify the latest user message into exactly one intent:
- "learn": user wants to study, plan a learning path, take a course, master a topic, exam prep, etc.
- "desktop": user wants to run commands, edit files, use tools, control the computer/workspace, debug code in the project, sandbox execution, etc.
- "chat": general conversation, Q&A without committing to a learning plan or tool loop.

Respond with ONLY valid JSON:
{
  "intent": "chat" | "learn" | "desktop",
  "topic": "short topic or empty string",
  "confidence": 0.0-1.0,
  "rationale": "one sentence",
  "proposalSummary": "if learn: concise restatement of what they want to learn; else empty"
}

Rules:
- Prefer "desktop" when they ask to run/fix/write files/execute in the project.
- Prefer "learn" when they want a structured learning journey (not a one-off explanation).
- One-off explanations of concepts → "chat" unless they clearly ask to learn a subject.
- Never invent a learning script; only classify.
- If learner context is provided, use it only as weak prior (e.g. known goals); do not invent intent from empty context.`;

export async function judgeIntent(
  message: string,
  options: AgentLLMOptions,
  history?: Array<{ role: string; content: string }>,
): Promise<IntentJudgeResult> {
  const hist =
    history && history.length > 0
      ? `\nRecent history:\n${history
          .slice(-6)
          .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
          .join('\n')}`
      : '';

  const pack = await loadLearnerContextPack('intent');
  const system = injectContextPack(SYSTEM, pack);

  const parsed = await callAgentJson(
    system,
    `User message:\n${message}${hist}`,
    options,
    IntentJudgeOutputSchema,
  );

  return {
    intent: parsed.intent,
    topic: parsed.topic.trim().slice(0, 80),
    confidence: parsed.confidence,
    rationale: parsed.rationale.trim() || 'classified',
    proposalSummary: parsed.proposalSummary.trim() || message.trim().slice(0, 200),
  };
}

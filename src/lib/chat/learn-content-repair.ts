import { callLLM } from '@/lib/llm/client';
import { appendSkill } from '@/lib/agents/load-skill';
import {
  ensureTeachFences,
  hasLearnContentMarkup,
  LEARN_CONTENT_SYSTEM_HINT,
  type TeachOutlineFallback,
} from './learn-content';

export interface RepairTeachFormatOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  providerId?: string;
  signal?: AbortSignal;
}

/** Server-side system hint with teach-format skill appended. */
export function buildLearnContentSystemHint(): string {
  return appendSkill(LEARN_CONTENT_SYSTEM_HINT, 'learn-teach-format', 'Teach-format skill');
}

/**
 * One-shot LLM repair to add :::summary / :::key when missing.
 * Falls back to ensureTeachFences on failure.
 */
export async function repairTeachFormat(
  text: string,
  options: RepairTeachFormatOptions,
  outline?: TeachOutlineFallback,
): Promise<string> {
  if (hasLearnContentMarkup(text)) {
    return text.trim();
  }

  try {
    const response = await callLLM(
      [
        {
          role: 'system',
          content:
            'Rewrite the teaching reply so it includes :::summary … ::: and :::key … ::: fences plus **section titles**. Keep meaning. Return ONLY the rewritten teaching message (no JSON). Prefer Chinese labels when the source is Chinese.',
        },
        { role: 'user', content: text },
      ],
      [],
      {
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        model: options.model,
        providerId: options.providerId,
        temperature: 0.3,
        maxTokens: 2048,
      },
      options.signal,
    );
    const repaired = response.content?.trim() || '';
    if (hasLearnContentMarkup(repaired)) {
      return repaired;
    }
  } catch {
    // fall through to deterministic wrap
  }

  return ensureTeachFences(text, outline);
}

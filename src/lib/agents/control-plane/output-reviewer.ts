import {
  hasLearnContentMarkup,
  parseLearnContent,
} from '@/lib/chat/learn-content';
import type { SceneContext, SkillPlan } from './schemas';
import { skillPlanAllowsTeachFences } from './skill-router';

export type OutputReviewViolation =
  | 'teach_fences_on_plain'
  | 'lesson_prose_on_planning'
  | 'forbidden_skill_chrome';

export interface OutputReviewResult {
  ok: boolean;
  text: string;
  violations: OutputReviewViolation[];
  /** True when text was rewritten (stripped / reduced). */
  modified: boolean;
  /** Alias of modified — used by chat route post-stream gate. */
  stripped: boolean;
}

/**
 * Strip :::summary / :::key / :::tip / :::definition / Chinese aliases and
 * learn-json fences, keeping inner bodies as plain prose.
 */
export function stripTeachFences(text: string): string {
  if (!text) return text;
  let out = text;

  out = out.replace(/```learn-json\s*\n[\s\S]*?```/gi, (block) => {
    try {
      const raw = block.replace(/```learn-json\s*\n/i, '').replace(/```$/, '');
      const data = JSON.parse(raw) as {
        summary?: string;
        keyPoints?: string[];
        key?: string;
        tip?: string;
        definition?: string;
        sections?: Array<{ title?: string; body?: string }>;
      };
      const parts: string[] = [];
      if (data.summary?.trim()) parts.push(data.summary.trim());
      if (Array.isArray(data.keyPoints)) {
        parts.push(
          ...data.keyPoints.map((p) => `- ${String(p).trim()}`).filter((l) => l.length > 2),
        );
      } else if (data.key?.trim()) {
        parts.push(data.key.trim());
      }
      if (data.tip?.trim()) parts.push(`提示：${data.tip.trim()}`);
      if (data.definition?.trim()) parts.push(`定义：${data.definition.trim()}`);
      if (Array.isArray(data.sections)) {
        for (const s of data.sections) {
          const title = String(s.title || '').trim();
          const body = String(s.body || '').trim();
          if (title) parts.push(title);
          if (body) parts.push(body);
        }
      }
      return parts.join('\n\n');
    } catch {
      return '';
    }
  });

  out = out.replace(
    /(?:^|\n):::(summary|key|tip|definition|重点|摘要|提示|定义)\s*\n([\s\S]*?)\n:::/gi,
    (_full, _kind: string, body: string) => `\n${(body || '').trim()}\n`,
  );

  // Orphan opening fences without close
  out = out.replace(/(?:^|\n):::(summary|key|tip|definition|重点|摘要|提示|定义)\s*\n/gi, '\n');
  out = out.replace(/(?:^|\n):::\s*$/gm, '');

  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Legacy detector retained for compatibility. Long answers are no longer truncated.
 */
export function looksLikeFullLessonProse(text: string): boolean {
  if (!text || text.trim().length < 200) return false;
  if (hasLearnContentMarkup(text)) return true;
  const sections = (text.match(/^\*\*[^*]+\*\*\s*$/gm) || []).length;
  const headings = (text.match(/^#{1,3}\s+\S+/gm) || []).length;
  return sections + headings >= 3 && text.trim().length >= 400;
}

/**
 * Scene-aware output gate.
 * - plain / no teach fences: strip teach chrome
 * - planning + no teach: strip fences and flag full lesson prose
 */
export function reviewOutput(input: {
  scene: SceneContext;
  skillPlan: SkillPlan;
  text: string;
}): OutputReviewResult {
  const { scene, skillPlan, text } = input;
  const violations: OutputReviewViolation[] = [];
  let result = text ?? '';
  const allowTeach = skillPlanAllowsTeachFences(skillPlan);
  const mode = skillPlan.outputPolicy.responseMode;

  if (!allowTeach && hasLearnContentMarkup(result)) {
    violations.push('teach_fences_on_plain');
    result = stripTeachFences(result);
  }

  void scene;
  void mode;

  // Forbidden teach skill chrome remaining as fence markers
  if (
    !allowTeach &&
    hasLearnContentMarkup(result)
  ) {
    violations.push('forbidden_skill_chrome');
    result = stripTeachFences(result);
  }

  const modified = result !== (text ?? '');
  const ok = violations.length === 0;

  // Ensure strip did not leave empty when model only sent fences
  if (modified && !result.trim() && (text || '').trim()) {
    const blocks = parseLearnContent(text);
    result = blocks
      .map((b) => (b.title ? `${b.title}\n${b.body}` : b.body))
      .join('\n\n')
      .trim() || (text || '').trim();
  }

  return {
    ok,
    text: result,
    violations,
    modified,
    /** Alias for callers that check strip flag */
    stripped: modified,
  };
}

/**
 * Apply reviewer for chat API when learnMode is false.
 * Never invent fences; only strip.
 */
export function reviewPlainChatOutput(text: string): OutputReviewResult {
  return reviewOutput({
    scene: { scene: 'chat', intent: 'chat', stage: 'idle' },
    skillPlan: {
      enabledSkills: ['plain-conversation', 'clarification'],
      forbiddenSkills: ['learn-divide', 'common-mistakes'],
      rationale: 'plain chat post-stream gate',
      budget: { maxSkillCalls: 2 },
      sideEffects: 'prompt_only',
      outputPolicy: { responseMode: 'plain', allowTeachFences: false },
    },
    text,
  });
}
